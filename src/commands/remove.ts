/**
 * Remove command implementation
 * Handles 'spaces remove workspace' and 'spaces remove project'
 */

import { existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'
import {
	getCurrentProject,
	readProjectConfig,
	getProjectWorkspacesDir,
	getProjectBaseDir,
	getProjectDir,
	readGlobalConfig,
	updateGlobalConfig,
	getAllProjectNames,
	getScriptsPhaseDir,
} from '../core/config.js'
import {
	removeWorktree,
	deleteLocalBranch,
	getWorktreeInfo,
} from '../core/git.js'
import { killSession, sessionExists, getCurrentSessionName } from '../core/tmux.js'
import { logger } from '../utils/logger.js'
import { selectItem, promptConfirm, promptInput } from '../utils/prompts.js'
import { SpacesError, NoProjectError } from '../types/errors.js'
import { runScriptsInTerminal } from '../utils/run-scripts.js'
import {
	getStackChildren,
	getStackParent,
	removeStackMetadata,
	setStackMetadata,
} from '../utils/stack.js'

/**
 * Remove a workspace
 */
export async function removeWorkspace(
	workspaceNameArg?: string,
	options: {
		force?: boolean
		keepBranch?: boolean
	} = {}
): Promise<void> {
	const currentProject = getCurrentProject()
	if (!currentProject) {
		throw new NoProjectError()
	}

	const workspacesDir = getProjectWorkspacesDir(currentProject)
	const baseDir = getProjectBaseDir(currentProject)

	if (!existsSync(workspacesDir)) {
		throw new SpacesError('No workspaces found', 'USER_ERROR', 1)
	}

	const workspaceNames = readdirSync(workspacesDir)

	if (workspaceNames.length === 0) {
		throw new SpacesError('No workspaces found', 'USER_ERROR', 1)
	}

	let workspaceName: string

	if (workspaceNameArg) {
		if (!workspaceNames.includes(workspaceNameArg)) {
			throw new SpacesError(
				`Workspace "${workspaceNameArg}" not found`,
				'USER_ERROR',
				1
			)
		}
		workspaceName = workspaceNameArg
	} else {
		// Select workspace
		const selected = await selectItem(
			workspaceNames,
			'Select workspace to remove:'
		)

		if (!selected) {
			logger.info('Cancelled')
			return
		}

		workspaceName = selected
	}

	const workspacePath = join(workspacesDir, workspaceName)

	// Get workspace info
	const info = await getWorktreeInfo(workspacePath)

	if (!info) {
		throw new SpacesError(
			`Could not get information for workspace "${workspaceName}"`,
			'SYSTEM_ERROR',
			2
		)
	}

	// Show git status
	logger.log(`\nWorkspace: ${workspaceName}`)
	logger.log(`Branch: ${info.branch}`)
	logger.log(`Uncommitted changes: ${info.uncommittedChanges}`)

	if (info.uncommittedChanges > 0) {
		logger.warning(
			`This workspace has ${info.uncommittedChanges} uncommitted changes`
		)
	}

	// Ask for confirmation unless --force
	if (!options.force) {
		const confirmed = await promptConfirm(
			`Remove workspace "${workspaceName}"?`,
			false
		)

		if (!confirmed) {
			logger.info('Cancelled')
			return
		}
	}

	// Check for dependent workspaces (children in stack)
	const children = getStackChildren(currentProject, workspaceName)

	if (children.length > 0) {
		logger.warning(`\n⚠️  Warning: This workspace has ${children.length} dependent workspace(s):`)
		for (const child of children) {
			logger.log(`  - ${child}`)
		}

		const projectConfig = readProjectConfig(currentProject)
		const parent = getStackParent(currentProject, workspaceName)
		const newBase = parent ? parent.branch : projectConfig.baseBranch
		const newBaseName = parent ? `${parent.workspaceName} (${parent.branch})` : projectConfig.baseBranch

		logger.log('\nOptions:')
		logger.log(`  1. Cancel removal`)
		logger.log(`  2. Remove and rebase children onto ${newBaseName}`)
		logger.log(`  3. Remove anyway (children will be orphaned)`)

		const choice = await selectItem(
			['Cancel', `Rebase children onto ${newBaseName}`, 'Remove anyway (orphan children)'],
			'What would you like to do?'
		)

		if (!choice || choice.startsWith('Cancel')) {
			logger.info('Cancelled')
			return
		}

		if (choice.startsWith('Rebase')) {
			// Rebase each child onto the new base
			logger.info(`\nRebasing ${children.length} dependent workspace(s)...`)

			for (const child of children) {
				const childPath = join(workspacesDir, child)

				try {
					logger.info(`Rebasing ${child}...`)

					// Fetch the new base
					let fetchResult
					if (parent) {
						const parentPath = join(workspacesDir, parent.workspaceName)
						fetchResult = spawnSync('git', [
							'fetch',
							parentPath,
							`${newBase}:refs/remotes/newbase/${newBase}`
						], {
							cwd: childPath,
							stdio: 'pipe',
						})
					} else {
						fetchResult = spawnSync('git', [
							'fetch',
							'origin',
							`${newBase}:refs/remotes/newbase/${newBase}`
						], {
							cwd: childPath,
							stdio: 'pipe',
						})
					}

					if (fetchResult.status !== 0) {
						throw new Error('Failed to fetch base branch')
					}

					// Rebase onto new base
					const rebaseResult = spawnSync('git', [
						'rebase',
						`newbase/${newBase}`
					], {
						cwd: childPath,
						stdio: 'inherit',
					})

					if (rebaseResult.status !== 0) {
						throw new Error('Rebase failed')
					}

					// Update stack metadata
					if (parent) {
						// Verify parent workspace still exists before updating metadata
						const parentPath = join(workspacesDir, parent.workspaceName)
						if (existsSync(parentPath)) {
							setStackMetadata(currentProject, child, {
								basedOn: parent.workspaceName,
								baseBranch: parent.branch,
							})
						} else {
							// Parent workspace was deleted, remove child from stack
							removeStackMetadata(currentProject, child)
							logger.debug(
								`Parent workspace "${parent.workspaceName}" no longer exists. ` +
								`Removed "${child}" from stack.`
							)
						}
					} else {
						// No parent - remove from stack
						removeStackMetadata(currentProject, child)
					}

					logger.success(`  ✓ Rebased ${child}`)
				} catch (error) {
					logger.error(`  ✗ Failed to rebase ${child}`)
					logger.error(`    ${error instanceof Error ? error.message : 'Unknown error'}`)
					logger.warning(`    You may need to manually rebase this workspace`)
				}
			}
		} else {
			// Remove anyway - just remove stack metadata for children
			logger.warning('Orphaning dependent workspaces...')
			for (const child of children) {
				removeStackMetadata(currentProject, child)
			}
		}
	}

	// Kill tmux session if it exists
	if (await sessionExists(workspaceName)) {
		// Check if we're currently in the session we're trying to kill
		const currentSession = await getCurrentSessionName()
		if (currentSession === workspaceName) {
			logger.error(
				`Cannot remove workspace while inside its tmux session "${workspaceName}"`
			)
			logger.info('Please detach from this tmux session and run the command again')
			logger.info('  Detach: Press Ctrl+b, then d')
			process.exit(1)
		}

		logger.info('Killing tmux session...')
		await killSession(workspaceName)
	}

	// Run remove scripts (cleanup before deletion)
	const projectConfig = readProjectConfig(currentProject)
	const removeScriptsDir = getScriptsPhaseDir(currentProject, 'remove')
	await runScriptsInTerminal(
		removeScriptsDir,
		workspacePath,
		workspaceName,
		projectConfig.repository
	)

	// Remove worktree
	logger.info('Removing worktree...')
	await removeWorktree(baseDir, workspacePath, true)

	logger.success(`Removed worktree: ${workspaceName}`)

	// Remove stack metadata for this workspace
	removeStackMetadata(currentProject, workspaceName)

	// Ask about deleting local branch unless --keep-branch
	if (!options.keepBranch) {
		// const deleteBranch = await promptConfirm(`Delete local branch "${info.branch}"?`, false);
		const deleteBranch = true

		if (deleteBranch) {
			try {
				await deleteLocalBranch(baseDir, info.branch, true)
				logger.success(`Deleted branch: ${info.branch}`)
			} catch (error) {
				logger.warning(
					`Could not delete branch: ${
						error instanceof Error ? error.message : 'Unknown error'
					}`
				)
			}
		}
	}
}

/**
 * Remove a project
 */
export async function removeProject(
	projectNameArg?: string,
	options: {
		force?: boolean
	} = {}
): Promise<void> {
	const allProjects = getAllProjectNames()

	if (allProjects.length === 0) {
		throw new SpacesError('No projects found', 'USER_ERROR', 1)
	}

	let projectName: string

	if (projectNameArg) {
		if (!allProjects.includes(projectNameArg)) {
			throw new SpacesError(
				`Project "${projectNameArg}" not found`,
				'USER_ERROR',
				1
			)
		}
		projectName = projectNameArg
	} else {
		// Select project
		const projectOptions = allProjects.map((name) => {
			const config = readProjectConfig(name)
			return `${name} - ${config.repository}`
		})

		const selected = await selectItem(
			projectOptions,
			'Select project to remove:'
		)

		if (!selected) {
			logger.info('Cancelled')
			return
		}

		projectName = selected.split(' - ')[0]
	}

	const projectDir = getProjectDir(projectName)
	const workspacesDir = getProjectWorkspacesDir(projectName)

	// List workspaces
	let workspaceCount = 0
	if (existsSync(workspacesDir)) {
		workspaceCount = readdirSync(workspacesDir).length
	}

	logger.warning(
		`\nThis will permanently delete project "${projectName}" and all its data:`
	)
	logger.log(`  - Project directory: ${projectDir}`)
	logger.log(`  - Workspaces: ${workspaceCount}`)

	// Ask for confirmation - require typing project name unless --force
	if (!options.force) {
		const confirmName = await promptInput(
			`Type the project name "${projectName}" to confirm:`
		)

		if (confirmName !== projectName) {
			logger.info('Cancelled (name mismatch)')
			return
		}
	}

	// Kill all tmux sessions for workspaces
	if (existsSync(workspacesDir)) {
		const workspaces = readdirSync(workspacesDir)

		for (const workspace of workspaces) {
			if (await sessionExists(workspace)) {
				logger.info(`Killing tmux session: ${workspace}`)
				await killSession(workspace)
			}
		}
	}

	// Remove entire project directory
	logger.info('Removing project directory...')
	rmSync(projectDir, { recursive: true, force: true })

	logger.success(`Removed project: ${projectName}`)

	// Update global config if this was the current project
	const globalConfig = readGlobalConfig()
	if (globalConfig.currentProject === projectName) {
		updateGlobalConfig({ currentProject: null })
		logger.info('Cleared current project (was this project)')
	}
}

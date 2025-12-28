/**
 * Clean command implementation
 * Handles 'spaces clean' to remove stale workspaces
 */

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
	getCurrentProject,
	readProjectConfig,
	getProjectWorkspacesDir,
	getProjectBaseDir,
} from '../core/config.js'
import { removeWorktree, deleteLocalBranch, getWorktreeInfo } from '../core/git.js'
import { getPRStateForBranch, type PRState } from '../core/github.js'
import { killSession, sessionExists, getCurrentSessionName } from '../core/tmux.js'
import { logger } from '../utils/logger.js'
import { selectMultiple, promptConfirm } from '../utils/prompts.js'
import { NoProjectError } from '../types/errors.js'
import type { WorktreeInfo } from '../types/workspace.js'

// Staleness thresholds (in days)
const STALE_DAYS_NO_CHANGES = 15
const STALE_DAYS_MERGED_PR = 5

/**
 * Extended workspace info with PR state for clean command
 */
interface CleanableWorkspace {
	info: WorktreeInfo
	prState: PRState
	daysSinceCommit: number
	reason: 'stale_no_changes' | 'merged_pr'
}

/**
 * Calculate days since a given date
 */
function daysSince(date: Date): number {
	const now = new Date()
	const diff = now.getTime() - date.getTime()
	return Math.floor(diff / (1000 * 60 * 60 * 24))
}

/**
 * Format a workspace for display in the selection list
 */
function formatWorkspaceChoice(workspace: CleanableWorkspace): string {
	const { info, reason, daysSinceCommit } = workspace

	if (reason === 'merged_pr') {
		return `${info.name} (PR merged, ${daysSinceCommit} days since commit)`
	}

	return `${info.name} (stale: ${daysSinceCommit} days, no uncommitted changes)`
}

/**
 * Analyze a workspace to determine if it's cleanable
 */
async function analyzeWorkspace(
	info: WorktreeInfo,
	repository: string
): Promise<CleanableWorkspace | null> {
	const daysSinceCommit = daysSince(info.lastCommitDate)

	// Check for merged PR (5+ days since commit AND PR merged)
	if (daysSinceCommit >= STALE_DAYS_MERGED_PR) {
		const prState = await getPRStateForBranch(repository, info.branch)

		if (prState === 'merged') {
			return {
				info,
				prState,
				daysSinceCommit,
				reason: 'merged_pr',
			}
		}
	}

	// Check for stale with no changes (15+ days AND no uncommitted changes)
	if (daysSinceCommit >= STALE_DAYS_NO_CHANGES && info.uncommittedChanges === 0) {
		// Still get PR state for informational purposes
		const prState = await getPRStateForBranch(repository, info.branch)

		return {
			info,
			prState,
			daysSinceCommit,
			reason: 'stale_no_changes',
		}
	}

	return null
}

/**
 * Clean stale workspaces from the current project
 */
export async function cleanWorkspaces(
	options: {
		dryRun?: boolean
		force?: boolean
	} = {}
): Promise<void> {
	const currentProject = getCurrentProject()
	if (!currentProject) {
		throw new NoProjectError()
	}

	const projectConfig = readProjectConfig(currentProject)
	const workspacesDir = getProjectWorkspacesDir(currentProject)
	const baseDir = getProjectBaseDir(currentProject)

	if (!existsSync(workspacesDir)) {
		logger.info('No workspaces found')
		return
	}

	const workspaceNames = readdirSync(workspacesDir)

	if (workspaceNames.length === 0) {
		logger.info('No workspaces found')
		return
	}

	logger.info('Analyzing workspaces...')

	// Get workspace info for all workspaces
	const workspaceInfos: WorktreeInfo[] = []
	for (const name of workspaceNames) {
		const workspacePath = join(workspacesDir, name)
		const info = await getWorktreeInfo(workspacePath)
		if (info) {
			workspaceInfos.push(info)
		}
	}

	// Analyze each workspace for staleness criteria
	const cleanableWorkspaces: CleanableWorkspace[] = []

	for (const info of workspaceInfos) {
		const analysis = await analyzeWorkspace(info, projectConfig.repository)
		if (analysis) {
			cleanableWorkspaces.push(analysis)
		}
	}

	if (cleanableWorkspaces.length === 0) {
		logger.success('No stale workspaces found')
		return
	}

	logger.info(`Found ${cleanableWorkspaces.length} cleanable workspace(s):`)
	logger.log('')

	// Display summary of found workspaces
	for (const workspace of cleanableWorkspaces) {
		const { info, reason, daysSinceCommit } = workspace
		const reasonText =
			reason === 'merged_pr' ? 'PR merged' : 'stale (no uncommitted changes)'
		logger.log(`  - ${info.name}: ${reasonText}, ${daysSinceCommit} days since commit`)
	}
	logger.log('')

	// Dry run mode - just show what would be cleaned
	if (options.dryRun) {
		logger.info('Dry run mode - no workspaces were removed')
		return
	}

	// Interactive selection (unless --force)
	let workspacesToRemove: CleanableWorkspace[]

	if (options.force) {
		// Force mode: confirm all at once
		const confirmed = await promptConfirm(
			`Remove all ${cleanableWorkspaces.length} stale workspace(s)?`,
			false
		)

		if (!confirmed) {
			logger.info('Cancelled')
			return
		}

		workspacesToRemove = cleanableWorkspaces
	} else {
		// Interactive mode: let user select which to remove
		const choices = cleanableWorkspaces.map((workspace) => ({
			name: formatWorkspaceChoice(workspace),
			value: workspace,
			checked: true, // Pre-select all by default
		}))

		const selected = await selectMultiple(
			choices,
			'Select workspaces to remove (Space to toggle, Enter to confirm):'
		)

		if (selected.length === 0) {
			logger.info('No workspaces selected')
			return
		}

		workspacesToRemove = selected
	}

	// Get current tmux session to check if we're in one of the workspaces
	const currentSession = await getCurrentSessionName()

	// Remove selected workspaces
	let removedCount = 0
	let skippedCount = 0

	for (const workspace of workspacesToRemove) {
		const { info } = workspace
		const workspacePath = info.path

		try {
			// Check if we're currently in this workspace's tmux session
			if (currentSession === info.name) {
				logger.warning(`Skipping "${info.name}" - currently in its tmux session`)
				logger.info('  Detach from session (Ctrl+b, d) and run again')
				skippedCount++
				continue
			}

			// Kill tmux session if it exists
			if (await sessionExists(info.name)) {
				logger.info(`Killing tmux session: ${info.name}`)
				await killSession(info.name)
			}

			// Remove worktree
			logger.info(`Removing workspace: ${info.name}`)
			await removeWorktree(baseDir, workspacePath, true)

			// Delete the branch (since it's stale/merged, we should clean it up)
			try {
				await deleteLocalBranch(baseDir, info.branch, true)
				logger.debug(`Deleted branch: ${info.branch}`)
			} catch (error) {
				logger.debug(
					`Could not delete branch ${info.branch}: ${
						error instanceof Error ? error.message : 'Unknown'
					}`
				)
			}

			removedCount++
		} catch (error) {
			logger.error(
				`Failed to remove "${info.name}": ${
					error instanceof Error ? error.message : 'Unknown error'
				}`
			)
			skippedCount++
		}
	}

	// Summary
	logger.log('')
	if (removedCount > 0) {
		logger.success(`Removed ${removedCount} workspace(s)`)
	}
	if (skippedCount > 0) {
		logger.warning(`Skipped ${skippedCount} workspace(s)`)
	}
}

#!/usr/bin/env node

/**
 * Spaces CLI - Main entry point
 * Manages GitHub repository workspaces using git worktrees, tmux sessions, and Linear integration
 */

import { Command } from 'commander'
import { isFirstTimeSetup, initializeSpaces } from './core/config.js'
import { logger } from './utils/logger.js'
import { SpacesError } from './types/errors.js'
import { addProject, addWorkspace } from './commands/add.js'
import { switchProject, switchWorkspace } from './commands/switch.js'
import { listProjects, listWorkspaces } from './commands/list.js'
import { removeWorkspace, removeProject } from './commands/remove.js'
import { ensureDependencies } from './utils/deps.js'
import { getProjectDirectory } from './commands/directory.js'
import { rebaseStack } from './commands/rebase-stack.js'
import { createPR } from './commands/pr.js'

const program = new Command()

// Package info
program
	.name('spaces')
	.description('CLI tool for managing GitHub repository workspaces')
	.version('1.1.0')

// First-time setup check
async function checkFirstTimeSetup(): Promise<void> {
	if (isFirstTimeSetup()) {
		logger.bold('Welcome to Spaces CLI!\n')
		logger.log('Initializing spaces directory...\n')

		// Check dependencies
		try {
			await ensureDependencies()
		} catch (error) {
			if (error instanceof SpacesError) {
				logger.error(error.message)
				process.exit(error.exitCode)
			}
			throw error
		}

		// Initialize spaces
		initializeSpaces()

		logger.success('Spaces initialized!\n')
		logger.log('Get started by adding a project:')
		logger.command('  spaces add project\n')
	}
}

// ============================================================================
// Add Commands
// ============================================================================

const addCommand = program
	.command('add')
	.description('Add a new project or workspace')

addCommand
	.command('project')
	.description('Add a new project from GitHub')
	.option('--no-clone', 'Create project structure without cloning')
	.option('--org <org>', 'Filter repos to specific organization')
	.option('--linear-key <key>', 'Provide Linear API key via flag')
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await addProject(options)
		} catch (error) {
			handleError(error)
		}
	})

addCommand
	.argument('[workspace-name]', 'Name of the workspace to create')
	.option(
		'--branch <name>',
		'Specify different branch name from workspace name'
	)
	.option('--from <branch>', 'Create from specific branch instead of base')
	.option(
		'--stacked',
		'Create workspace stacked on current or selected workspace branch'
	)
	.option('--no-tmux', "Don't create/attach tmux session")
	.option('--no-setup', 'Skip setup commands')
	.action(async (workspaceName, options) => {
		await checkFirstTimeSetup()
		try {
			await addWorkspace(workspaceName, options)
		} catch (error) {
			handleError(error)
		}
	})

// ============================================================================
// Switch Commands
// ============================================================================

const switchCommand = program
	.command('switch')
	.alias('sw')
	.description('Switch to a different project or workspace')

switchCommand
	.command('project')
	.description('Switch to a different project')
	.argument('[project-name]', 'Name of the project to switch to')
	.action(async (projectName) => {
		await checkFirstTimeSetup()
		try {
			await switchProject(projectName)
		} catch (error) {
			handleError(error)
		}
	})

switchCommand
	.argument('[workspace-name]', 'Name of the workspace to switch to')
	.option('--no-tmux', 'Just cd to workspace without tmux')
	.option(
		'--new-window',
		'Create new window in existing session instead of attaching'
	)
	.option('-f, --force', 'Jump to first fuzzy match without confirmation')
	.action(async (workspaceName, options) => {
		await checkFirstTimeSetup()
		try {
			await switchWorkspace(workspaceName, options)
		} catch (error) {
			handleError(error)
		}
	})

// ============================================================================
// List Commands
// ============================================================================

const listCommand = program
	.command('list')
	.alias('ls')
	.description('List projects or workspaces')

listCommand
	.command('projects')
	.description('List all projects')
	.option('--json', 'Output in JSON format')
	.option('--verbose', 'Show additional details')
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await listProjects(options)
		} catch (error) {
			handleError(error)
		}
	})

listCommand
	.command('workspaces')
	.description('List workspaces in current project')
	.option('--json', 'Output in JSON format')
	.option('--verbose', 'Show additional details')
	.option('--tree', 'Show workspace stack tree visualization')
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await listWorkspaces(options)
		} catch (error) {
			handleError(error)
		}
	})

// Default list command (alias for list workspaces)
listCommand
	.option('--json', 'Output in JSON format')
	.option('--verbose', 'Show additional details')
	.option('--tree', 'Show workspace stack tree visualization')
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await listWorkspaces(options)
		} catch (error) {
			handleError(error)
		}
	})

// ============================================================================
// Remove Commands
// ============================================================================

const removeCommand = program
	.command('remove')
	.alias('rm')
	.description('Remove a workspace or project')

removeCommand
	.command('workspace')
	.description('Remove a workspace')
	.argument('[workspace-name]', 'Name of the workspace to remove')
	.option('--force', 'Skip confirmation prompts')
	.option('--keep-branch', "Don't delete git branch when removing workspace")
	.action(async (workspaceName, options) => {
		await checkFirstTimeSetup()
		try {
			await removeWorkspace(workspaceName, options)
		} catch (error) {
			handleError(error)
		}
	})

removeCommand
	.command('project')
	.description('Remove a project')
	.argument('[project-name]', 'Name of the project to remove')
	.option('--force', 'Skip confirmation prompts')
	.action(async (projectName, options) => {
		await checkFirstTimeSetup()
		try {
			await removeProject(projectName, options)
		} catch (error) {
			handleError(error)
		}
	})

// Default remove command (alias for remove workspace)
removeCommand.action(async (options) => {
	await checkFirstTimeSetup()
	try {
		await removeWorkspace(undefined, options)
	} catch (error) {
		handleError(error)
	}
})

// ============================================================================
// Directory Commands
// ============================================================================

const directoryCommand = program
	.command('directory')
	.alias('dir')
	.description('Manage directories')

directoryCommand.action(async (options) => {
	await checkFirstTimeSetup()
	try {
		await getProjectDirectory(options)
	} catch (error) {
		handleError(error)
	}
})

// ============================================================================
// Stacked PR Commands
// ============================================================================

program
	.command('rebase-stack')
	.description('Rebase current workspace onto its parent workspace')
	.option('--auto', 'Skip confirmation prompt')
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await rebaseStack(options)
		} catch (error) {
			handleError(error)
		}
	})

program
	.command('pr')
	.description(
		'Create pull request with automatic base branch detection for stacked PRs'
	)
	.allowUnknownOption()
	.action(async (options, command) => {
		await checkFirstTimeSetup()
		try {
			// Get all arguments after 'pr' command
			const args = command.args || []
			await createPR(args)
		} catch (error) {
			handleError(error)
		}
	})

// ============================================================================
// Error Handling
// ============================================================================

function handleError(error: unknown): never {
	if (error instanceof SpacesError) {
		logger.error(error.message)
		process.exit(error.exitCode)
	}

	if (error instanceof Error) {
		logger.error(`Unexpected error: ${error.message}`)
		logger.debug(error.stack || '')
		process.exit(1)
	}

	logger.error('An unexpected error occurred')
	process.exit(1)
}

// ============================================================================
// Parse and Execute
// ============================================================================

// Handle uncaught errors
process.on('uncaughtException', (error) => {
	logger.error(`Uncaught exception: ${error.message}`)
	logger.debug(error.stack || '')
	process.exit(1)
})

process.on('unhandledRejection', (reason) => {
	logger.error(`Unhandled rejection: ${reason}`)
	process.exit(1)
})

// Parse command line arguments
program.parse()

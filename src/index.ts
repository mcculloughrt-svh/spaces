#!/usr/bin/env bun

/**
 * Spaces CLI - Main entry point
 * Manages GitHub repository workspaces using git worktrees and Linear integration
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
import { launchTUI } from './tui/index.js'

const program = new Command()

// Package info
program
	.name('spaces')
	.description('CLI tool for managing GitHub repository workspaces')
	.version('1.0.0')

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
	.option('--bundle-url <url>', 'Load bundle from remote URL (zip archive)')
	.option('--bundle-path <path>', 'Load bundle from local directory')
	.option('--skip-bundle', 'Skip bundle detection and onboarding')
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
	.option('--no-shell', "Don't open interactive shell after creating workspace")
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
	.option('--no-shell', "Don't open interactive shell, just print path")
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
	.action(async (options) => {
		await checkFirstTimeSetup()
		try {
			await listWorkspaces(options)
		} catch (error) {
			handleError(error)
		}
	})

// Default list command (alias for list workspaces)
listCommand.action(async (options) => {
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
// If no args provided, launch TUI
if (process.argv.length === 2) {
	// No command provided - launch TUI
	checkFirstTimeSetup()
		.then(() => launchTUI())
		.catch((error) => {
			if (error instanceof SpacesError) {
				logger.error(error.message)
				process.exit(error.exitCode)
			}
			logger.error(`Failed to launch TUI: ${error instanceof Error ? error.message : 'Unknown error'}`)
			process.exit(1)
		})
} else {
	program.parse()
}

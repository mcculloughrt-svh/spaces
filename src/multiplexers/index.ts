/**
 * Multiplexer abstraction layer
 *
 * Provides a unified interface for working with different terminal multiplexers
 * (tmux, zellij, plain shell) through a common API.
 */

export * from './interface.js'
export * from './capabilities.js'
export * from './registry.js'

import { join } from 'path'
import type { BackendId } from './registry.js'
import type { MultiplexerBackend } from './interface.js'
import { getBackend } from './registry.js'
import { hasSetupBeenRun, markSetupComplete } from '../utils/workspace-state.js'
import { getScriptsPhaseDir } from '../core/config.js'
import { discoverScripts, runScriptsInTerminal } from '../utils/run-scripts.js'
import { logger } from '../utils/logger.js'
import { SpacesError } from '../types/errors.js'

/** Script handling mode for backends without send-keys support */
export type ScriptFallbackMode = 'print' | 'run-before' | 'skip'

export interface CreateOrAttachOptions {
	/** Session name (usually workspace name) */
	sessionName: string
	/** Full path to workspace directory */
	workspacePath: string
	/** Project name for finding scripts */
	projectName: string
	/** Repository in owner/repo format */
	repository: string
	/** Skip setup scripts even if first time */
	noSetup?: boolean
	/** Preferred multiplexer backend ID */
	preferredBackend?: BackendId | null
	/** How to handle scripts when backend doesn't support send-keys */
	scriptFallbackMode?: ScriptFallbackMode
	/** Create new window in existing session instead of switching */
	newWindow?: boolean
}

/**
 * Prompt user for script handling preference when backend doesn't support send-keys
 */
async function promptScriptFallback(): Promise<ScriptFallbackMode> {
	try {
		const { select } = await import('@inquirer/prompts')
		const choice = await select({
			message:
				'Scripts need to run, but this backend cannot send commands to sessions. How would you like to handle this?',
			choices: [
				{
					name: 'Print instructions (I will run them manually)',
					value: 'print' as const,
				},
				{
					name: 'Run before attaching (blocks until complete)',
					value: 'run-before' as const,
				},
				{
					name: 'Skip scripts entirely',
					value: 'skip' as const,
				},
			],
		})
		return choice
	} catch {
		// User cancelled, default to print
		return 'print'
	}
}

/**
 * Print script instructions for manual execution
 */
function printScriptInstructions(
	scripts: string[],
	workspaceName: string,
	repository: string
): void {
	logger.warning('Please run these scripts manually in your session:')
	logger.log('')
	for (const script of scripts) {
		const scriptName = script.split('/').pop() || script
		logger.log(`  ${scriptName} ${workspaceName} ${repository}`)
	}
	logger.log('')
}

/**
 * Run scripts in session using backend's sendCommand capability
 */
async function runScriptsInSession(
	backend: MultiplexerBackend,
	sessionName: string,
	scriptsDir: string,
	workspaceName: string,
	repository: string
): Promise<void> {
	const scripts = discoverScripts(scriptsDir)

	if (scripts.length === 0) {
		logger.debug(`No scripts to run in ${scriptsDir}`)
		return
	}

	const phaseName = scriptsDir.split('/').pop() || 'scripts'
	logger.debug(`Running ${phaseName} scripts in session...`)

	for (const scriptPath of scripts) {
		const command = `${scriptPath} ${workspaceName} ${repository}`
		logger.debug(`Running in session: ${command}`)

		const success = await backend.sendCommand(sessionName, command)
		if (!success) {
			logger.warning(`Failed to send command: ${command}`)
		}

		// Small delay between commands
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	logger.debug(`Sent ${scripts.length} ${phaseName} scripts to session`)
}

/**
 * Handle scripts for backends that don't support send-keys
 */
async function handleScriptsFallback(
	mode: ScriptFallbackMode,
	scriptsDir: string,
	workspacePath: string,
	workspaceName: string,
	repository: string
): Promise<void> {
	const scripts = discoverScripts(scriptsDir)

	if (scripts.length === 0) {
		return
	}

	switch (mode) {
		case 'print':
			printScriptInstructions(scripts, workspaceName, repository)
			break
		case 'run-before':
			await runScriptsInTerminal(
				scriptsDir,
				workspacePath,
				workspaceName,
				repository
			)
			break
		case 'skip':
			logger.debug('Skipping scripts as requested')
			break
	}
}

/**
 * High-level function to create or attach to a session
 * Handles setup/select script logic with the appropriate backend
 */
export async function createOrAttachSession(
	options: CreateOrAttachOptions
): Promise<void> {
	const backend = await getBackend(options.preferredBackend)
	const exists = await backend.sessionExists(options.sessionName)

	// For shell backend, check if we're already in a session
	if (backend.isInsideSession() && !backend.capabilities.sessionSwitching) {
		const currentSession = await backend.getCurrentSessionName()
		if (currentSession === options.workspacePath) {
			logger.info('Already in this workspace session')
			return
		}
		throw new SpacesError(
			`Cannot switch sessions while inside ${backend.displayName}. Please exit first.`,
			'USER_ERROR',
			1
		)
	}

	if (exists) {
		logger.debug(`Session ${options.sessionName} exists, attaching...`)
		await backend.attachSession({ name: options.sessionName, newWindow: options.newWindow })
		return
	}

	logger.debug(`Creating new session ${options.sessionName}...`)

	// Check for backend config in workspace
	const configPath = backend.hasConfig(options.workspacePath)
		? join(options.workspacePath, backend.getConfigFileName())
		: undefined

	// Create session
	const result = await backend.createSession({
		name: options.sessionName,
		workingDirectory: options.workspacePath,
		configPath,
	})

	if (!result.success) {
		throw new SpacesError(
			`Failed to create session: ${result.error}`,
			'SYSTEM_ERROR',
			2
		)
	}

	// Determine which scripts to run based on setup status
	const setupAlreadyRun = hasSetupBeenRun(options.workspacePath)
	const workspaceName =
		options.workspacePath.split('/').pop() || options.sessionName

	// Determine scripts directory
	const scriptsDir = setupAlreadyRun
		? getScriptsPhaseDir(options.projectName, 'select')
		: options.noSetup
			? null
			: getScriptsPhaseDir(options.projectName, 'setup')

	if (scriptsDir) {
		const scripts = discoverScripts(scriptsDir)

		if (scripts.length > 0) {
			if (backend.capabilities.sendCommands) {
				// Backend supports sending commands to session
				const phaseName = setupAlreadyRun ? 'select' : 'setup'
				logger.debug(`Running ${phaseName} scripts in session...`)

				await runScriptsInSession(
					backend,
					options.sessionName,
					scriptsDir,
					workspaceName,
					options.repository
				)
			} else {
				// Backend doesn't support sending commands - need fallback
				const mode =
					options.scriptFallbackMode || (await promptScriptFallback())

				await handleScriptsFallback(
					mode,
					scriptsDir,
					options.workspacePath,
					workspaceName,
					options.repository
				)
			}
		}
	}

	// Mark setup as complete if we ran setup scripts
	if (!setupAlreadyRun && !options.noSetup) {
		markSetupComplete(options.workspacePath)
		logger.debug('Setup marked as complete')
	}

	// For shell backend, use workspace path as session name since it doesn't have real sessions
	const attachName =
		backend.id === 'shell' ? options.workspacePath : options.sessionName

	await backend.attachSession({ name: attachName, newWindow: options.newWindow })
}

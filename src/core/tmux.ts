/**
 * Tmux session management operations
 */

import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { SpacesError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import { escapeShellArg } from '../utils/shell-escape.js'
import { hasSetupBeenRun, markSetupComplete } from '../utils/workspace-state.js'
import { runScriptsInTmux } from '../utils/run-scripts.js'
import { getScriptsPhaseDir } from './config.js'

const execAsync = promisify(exec)

/**
 * Check if a tmux session exists
 */
export async function sessionExists(sessionName: string): Promise<boolean> {
	try {
		await execAsync(`tmux has-session -t ${escapeShellArg(sessionName)} 2>/dev/null`)
		return true
	} catch {
		return false
	}
}

/**
 * Check if workspace has a .tmux.conf file
 */
export function hasTmuxConf(workspacePath: string): boolean {
	const tmuxConfPath = join(workspacePath, '.tmux.conf')
	return existsSync(tmuxConfPath)
}

/**
 * Check if currently inside a tmux session
 */
export function isInsideTmux(): boolean {
	return !!process.env.TMUX
}

/**
 * Get the name of the current tmux session
 * Returns null if not inside tmux
 */
export async function getCurrentSessionName(): Promise<string | null> {
	if (!isInsideTmux()) {
		return null
	}

	try {
		const { stdout } = await execAsync('tmux display-message -p "#S"')
		return stdout.trim()
	} catch (error) {
		logger.debug(`Could not get current session name: ${error}`)
		return null
	}
}

/**
 * Create a new tmux session
 */
export async function createSession(
	sessionName: string,
	workingDir: string,
	setupCommands: string[] = [],
	tmuxConfPath?: string
): Promise<void> {
	try {
		// Create session in detached mode
		logger.debug(`Creating tmux session: ${sessionName}`)
		await execAsync(
			`tmux new-session -d -s ${escapeShellArg(sessionName)} -c ${escapeShellArg(workingDir)}`
		)

		// If there's a .tmux.conf, source it (session-specific)
		if (tmuxConfPath && existsSync(tmuxConfPath)) {
			logger.debug(`Sourcing .tmux.conf: ${tmuxConfPath}`)
			await execAsync(`tmux source-file -t ${escapeShellArg(sessionName)} ${escapeShellArg(tmuxConfPath)}`)
		}

		// Send setup commands to the session
		if (setupCommands.length > 0) {
			logger.debug(`Running ${setupCommands.length} setup commands...`)

			for (const cmd of setupCommands) {
				await sendKeys(sessionName, cmd)
				// Small delay between commands
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}
	} catch (error) {
		throw new SpacesError(
			`Failed to create tmux session: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
			'SYSTEM_ERROR',
			2
		)
	}
}

/**
 * Attach to a tmux session
 * If already inside tmux, switches to the session
 * If outside tmux, attaches to the session and replaces the current process
 */
export async function attachSession(sessionName: string): Promise<void> {
	try {
		// Check if we're already inside a tmux session
		if (isInsideTmux()) {
			// Use switch-client to avoid nested sessions
			logger.debug(`Inside tmux, switching to session: ${sessionName}`)
			await execAsync(`tmux switch-client -t ${escapeShellArg(sessionName)}`)
			// When using switch-client, we don't exit the process
			// The current shell continues running but tmux switches the view
		} else {
			// Outside tmux, attach normally and replace current process
			logger.debug(`Attaching to tmux session: ${sessionName}`)

			const tmux = spawn('tmux', ['attach-session', '-t', sessionName], {
				stdio: 'inherit',
			})

			tmux.on('exit', (code) => {
				if (code !== 0 && code !== null) {
					throw new SpacesError(
						`Tmux exited with code ${code}`,
						'SYSTEM_ERROR',
						2
					)
				}
				// Exit the process after tmux exits
				process.exit(code || 0)
			})

			tmux.on('error', (error) => {
				throw new SpacesError(
					`Failed to attach to tmux session: ${error.message}`,
					'SYSTEM_ERROR',
					2
				)
			})
		}
	} catch (error) {
		if (error instanceof SpacesError) {
			throw error
		}

		throw new SpacesError(
			`Failed to attach to tmux session: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
			'SYSTEM_ERROR',
			2
		)
	}
}

/**
 * Kill a tmux session
 */
export async function killSession(sessionName: string): Promise<void> {
	try {
		await execAsync(`tmux kill-session -t ${escapeShellArg(sessionName)}`)
	} catch (error) {
		// Ignore errors if session doesn't exist
		logger.debug(`Could not kill session ${sessionName}: ${error}`)
	}
}

/**
 * Send keys to a tmux session
 */
export async function sendKeys(
	sessionName: string,
	command: string
): Promise<void> {
	try {
		await execAsync(`tmux send-keys -t ${escapeShellArg(sessionName)} ${escapeShellArg(command)} C-m`)
	} catch (error) {
		throw new SpacesError(
			`Failed to send keys to tmux session: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
			'SYSTEM_ERROR',
			2
		)
	}
}

/**
 * List all tmux sessions
 */
export async function listSessions(): Promise<string[]> {
	try {
		const { stdout } = await execAsync(
			'tmux list-sessions -F "#{session_name}"'
		)
		return stdout
			.trim()
			.split('\n')
			.filter((session) => session.length > 0)
	} catch {
		// No sessions running
		return []
	}
}

/**
 * Create or attach to a tmux session for a workspace
 * Intelligently runs setup scripts only once (first time), then select scripts on subsequent sessions
 */
export async function createOrAttachSession(
	sessionName: string,
	workspacePath: string,
	projectName: string,
	repository: string,
	noSetup: boolean = false
): Promise<void> {
	const exists = await sessionExists(sessionName)

	if (exists) {
		logger.debug(`Session ${sessionName} exists, attaching...`)
		await attachSession(sessionName)
	} else {
		logger.debug(`Creating new session ${sessionName}...`)

		// Check for .tmux.conf in workspace
		const tmuxConfPath = hasTmuxConf(workspacePath)
			? join(workspacePath, '.tmux.conf')
			: undefined

		// Create session in detached mode first
		await execAsync(
			`tmux new-session -d -s ${escapeShellArg(sessionName)} -c ${escapeShellArg(workspacePath)}`
		)

		// Source .tmux.conf if it exists (session-specific)
		if (tmuxConfPath && existsSync(tmuxConfPath)) {
			logger.debug(`Sourcing .tmux.conf: ${tmuxConfPath}`)
			await execAsync(`tmux source-file -t ${escapeShellArg(sessionName)} ${escapeShellArg(tmuxConfPath)}`)
		}

		// Determine which scripts to run based on setup status
		const setupAlreadyRun = hasSetupBeenRun(workspacePath)
		const workspaceName = workspacePath.split('/').pop() || sessionName

		if (setupAlreadyRun) {
			// Setup has been run before, run select scripts in tmux
			logger.debug('Setup already completed, running select scripts in tmux...')
			const selectScriptsDir = getScriptsPhaseDir(projectName, 'select')
			await runScriptsInTmux(
				sessionName,
				selectScriptsDir,
				workspaceName,
				repository
			)
		} else if (!noSetup) {
			// First time setup, run setup scripts in tmux
			logger.debug('Running setup scripts in tmux for the first time...')
			const setupScriptsDir = getScriptsPhaseDir(projectName, 'setup')
			await runScriptsInTmux(
				sessionName,
				setupScriptsDir,
				workspaceName,
				repository
			)

			// Mark setup as complete
			markSetupComplete(workspacePath)
			logger.debug('Setup marked as complete')
		}

		await attachSession(sessionName)
	}
}

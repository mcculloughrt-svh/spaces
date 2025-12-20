/**
 * Zellij multiplexer backend implementation
 */

import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import type {
	MultiplexerBackend,
	CreateSessionOptions,
	AttachSessionOptions,
	SessionInfo,
	SessionOperationResult,
} from '../interface.js'
import type { MultiplexerCapabilities } from '../capabilities.js'
import { SpacesError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import { escapeShellArg } from '../../utils/shell-escape.js'

const execAsync = promisify(exec)

export class ZellijBackend implements MultiplexerBackend {
	readonly id = 'zellij'
	readonly displayName = 'Zellij'

	readonly capabilities: MultiplexerCapabilities = {
		persistentSessions: true,
		sendCommands: true, // via zellij action write-chars
		multipleWindows: true, // called tabs in zellij
		panes: true,
		configFiles: true, // KDL format
		nestingDetection: true,
		sessionSwitching: false, // Zellij doesn't support switching from inside
		sessionListing: true,
	}

	async sessionExists(name: string): Promise<boolean> {
		try {
			const { stdout } = await execAsync('zellij list-sessions 2>/dev/null')
			const sessions = stdout.trim().split('\n')
			return sessions.some(
				(s) => s.trim() === name || s.startsWith(`${name} `)
			)
		} catch {
			return false
		}
	}

	async createSession(
		options: CreateSessionOptions
	): Promise<SessionOperationResult> {
		try {
			logger.debug(`Creating zellij session: ${options.name}`)

			// Zellij doesn't have a true "create detached" mode like tmux
			// We'll create the session by spawning zellij and immediately sending detach
			// Or we can use the --session flag with a background process

			// For now, we'll note that the session will be created on attach
			// This is a limitation we document
			logger.debug(
				`Zellij session ${options.name} will be created on attach`
			)

			return { success: true }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	async attachSession(options: AttachSessionOptions): Promise<void> {
		if (this.isInsideSession()) {
			// Zellij doesn't support session switching from inside
			throw new SpacesError(
				'Cannot switch sessions while inside Zellij. Please detach first (Ctrl+o, d)',
				'USER_ERROR',
				1
			)
		}

		logger.debug(`Attaching to zellij session: ${options.name}`)

		// Check if session exists first
		const exists = await this.sessionExists(options.name)

		const args = exists
			? ['attach', options.name]
			: ['--session', options.name]

		const zellij = spawn('zellij', args, {
			stdio: 'inherit',
		})

		await new Promise<void>((resolve, reject) => {
			zellij.on('exit', (code) => {
				if (code !== 0 && code !== null) {
					reject(
						new SpacesError(
							`Zellij exited with code ${code}`,
							'SYSTEM_ERROR',
							2
						)
					)
				}
				process.exit(code || 0)
			})

			zellij.on('error', (error) => {
				reject(
					new SpacesError(
						`Failed to attach: ${error.message}`,
						'SYSTEM_ERROR',
						2
					)
				)
			})
		})
	}

	async killSession(name: string): Promise<SessionOperationResult> {
		try {
			await execAsync(`zellij kill-session ${escapeShellArg(name)}`)
			return { success: true }
		} catch (error) {
			logger.debug(`Could not kill session ${name}: ${error}`)
			return { success: false, error: 'Session may not exist' }
		}
	}

	async listSessions(): Promise<SessionInfo[]> {
		try {
			const { stdout } = await execAsync('zellij list-sessions 2>/dev/null')
			return stdout
				.trim()
				.split('\n')
				.filter((line) => line.length > 0)
				.map((line) => {
					// Zellij format: "session_name (attached)" or just "session_name"
					const isAttached = line.includes('(attached)')
					const name = line.replace(/\s*\(attached\)/, '').trim()
					return { name, isAttached }
				})
		} catch {
			return []
		}
	}

	isInsideSession(): boolean {
		return !!process.env.ZELLIJ
	}

	async getCurrentSessionName(): Promise<string | null> {
		if (!this.isInsideSession()) return null
		return process.env.ZELLIJ_SESSION_NAME || null
	}

	async sendCommand(sessionName: string, command: string): Promise<boolean> {
		try {
			// Zellij uses 'action write-chars' to send text
			// Note: This requires the session to exist and have a running pane
			await execAsync(
				`zellij --session ${escapeShellArg(sessionName)} action write-chars ${escapeShellArg(command)}`
			)
			// Send enter key
			await execAsync(
				`zellij --session ${escapeShellArg(sessionName)} action write-chars $'\\n'`
			)
			return true
		} catch (error) {
			logger.debug(`Failed to send command to zellij: ${error}`)
			return false
		}
	}

	hasConfig(workspacePath: string): boolean {
		return existsSync(join(workspacePath, this.getConfigFileName()))
	}

	getConfigFileName(): string {
		return 'zellij.kdl'
	}

	getTemplateFileName(): string {
		return 'zellij.template.kdl'
	}

	async applyConfig(sessionName: string, configPath: string): Promise<boolean> {
		// Zellij config is applied at session creation, not dynamically
		logger.debug('Zellij config should be applied at session creation')
		return false
	}

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync('zellij --version')
			return true
		} catch {
			return false
		}
	}

	getInstallInstructions(): string {
		return 'Install Zellij: https://zellij.dev/documentation/installation'
	}

	getCommandName(): string {
		return 'zellij'
	}
}

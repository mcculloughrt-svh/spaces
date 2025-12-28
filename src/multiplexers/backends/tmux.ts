/**
 * Tmux multiplexer backend implementation
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
import { FULL_CAPABILITIES } from '../capabilities.js'
import { SpacesError } from '../../types/errors.js'
import { logger } from '../../utils/logger.js'
import { escapeShellArg } from '../../utils/shell-escape.js'

const execAsync = promisify(exec)

export class TmuxBackend implements MultiplexerBackend {
	readonly id = 'tmux'
	readonly displayName = 'tmux'
	readonly capabilities: MultiplexerCapabilities = FULL_CAPABILITIES

	async sessionExists(name: string): Promise<boolean> {
		try {
			await execAsync(
				`tmux has-session -t ${escapeShellArg(name)} 2>/dev/null`
			)
			return true
		} catch {
			return false
		}
	}

	async createSession(
		options: CreateSessionOptions
	): Promise<SessionOperationResult> {
		try {
			logger.debug(`Creating tmux session: ${options.name}`)

			await execAsync(
				`tmux new-session -d -s ${escapeShellArg(options.name)} -c ${escapeShellArg(options.workingDirectory)}`
			)

			// Apply config if provided
			if (options.configPath && existsSync(options.configPath)) {
				await this.applyConfig(options.name, options.configPath)
			}

			// Run setup commands
			if (options.setupCommands?.length) {
				for (const cmd of options.setupCommands) {
					await this.sendCommand(options.name, cmd)
					await new Promise((resolve) => setTimeout(resolve, 100))
				}
			}

			return { success: true }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	async attachSession(options: AttachSessionOptions): Promise<void> {
		try {
			if (this.isInsideSession()) {
				if (options.newWindow) {
					// Create a new window in the target session and switch to it
					logger.debug(`Inside tmux, creating new window in session: ${options.name}`)
					await execAsync(
						`tmux new-window -t ${escapeShellArg(options.name)}`
					)
					await execAsync(
						`tmux switch-client -t ${escapeShellArg(options.name)}`
					)
				} else {
					logger.debug(`Inside tmux, switching to session: ${options.name}`)
					await execAsync(
						`tmux switch-client -t ${escapeShellArg(options.name)}`
					)
				}
			} else {
				logger.debug(`Attaching to tmux session: ${options.name}`)

				const tmux = spawn('tmux', ['attach-session', '-t', options.name], {
					stdio: 'inherit',
				})

				await new Promise<void>((resolve, reject) => {
					tmux.on('exit', (code) => {
						if (code !== 0 && code !== null) {
							reject(
								new SpacesError(
									`Tmux exited with code ${code}`,
									'SYSTEM_ERROR',
									2
								)
							)
						}
						process.exit(code || 0)
					})

					tmux.on('error', (error) => {
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
		} catch (error) {
			if (error instanceof SpacesError) {
				throw error
			}
			throw new SpacesError(
				`Failed to attach to tmux session: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'SYSTEM_ERROR',
				2
			)
		}
	}

	async killSession(name: string): Promise<SessionOperationResult> {
		try {
			await execAsync(`tmux kill-session -t ${escapeShellArg(name)}`)
			return { success: true }
		} catch (error) {
			logger.debug(`Could not kill session ${name}: ${error}`)
			return { success: false, error: 'Session may not exist' }
		}
	}

	async listSessions(): Promise<SessionInfo[]> {
		try {
			const { stdout } = await execAsync(
				'tmux list-sessions -F "#{session_name}:#{session_attached}"'
			)
			return stdout
				.trim()
				.split('\n')
				.filter((line) => line.length > 0)
				.map((line) => {
					const [name, attached] = line.split(':')
					return { name, isAttached: attached === '1' }
				})
		} catch {
			return []
		}
	}

	isInsideSession(): boolean {
		return !!process.env.TMUX
	}

	async getCurrentSessionName(): Promise<string | null> {
		if (!this.isInsideSession()) return null

		try {
			const { stdout } = await execAsync('tmux display-message -p "#S"')
			return stdout.trim()
		} catch {
			return null
		}
	}

	async sendCommand(sessionName: string, command: string): Promise<boolean> {
		try {
			await execAsync(
				`tmux send-keys -t ${escapeShellArg(sessionName)} ${escapeShellArg(command)} C-m`
			)
			return true
		} catch {
			return false
		}
	}

	hasConfig(workspacePath: string): boolean {
		return existsSync(join(workspacePath, this.getConfigFileName()))
	}

	getConfigFileName(): string {
		return '.tmux.conf'
	}

	getTemplateFileName(): string {
		return 'tmux.template.conf'
	}

	async applyConfig(sessionName: string, configPath: string): Promise<boolean> {
		try {
			logger.debug(`Sourcing .tmux.conf: ${configPath}`)
			await execAsync(
				`tmux source-file -t ${escapeShellArg(sessionName)} ${escapeShellArg(configPath)}`
			)
			return true
		} catch {
			return false
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync('tmux -V')
			return true
		} catch {
			return false
		}
	}

	getInstallInstructions(): string {
		return 'Install tmux: https://github.com/tmux/tmux/wiki'
	}

	getCommandName(): string {
		return 'tmux'
	}
}

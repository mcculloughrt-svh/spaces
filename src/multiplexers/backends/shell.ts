/**
 * Plain shell multiplexer backend implementation
 *
 * This is a fallback backend that simply spawns a new shell in the workspace directory.
 * It has no session persistence or multiplexing capabilities.
 */

import { spawn } from 'child_process'
import type {
	MultiplexerBackend,
	CreateSessionOptions,
	AttachSessionOptions,
	SessionInfo,
	SessionOperationResult,
} from '../interface.js'
import type { MultiplexerCapabilities } from '../capabilities.js'
import { DEFAULT_CAPABILITIES } from '../capabilities.js'
import { logger } from '../../utils/logger.js'

export class ShellBackend implements MultiplexerBackend {
	readonly id = 'shell'
	readonly displayName = 'Plain Shell'

	readonly capabilities: MultiplexerCapabilities = {
		...DEFAULT_CAPABILITIES,
		nestingDetection: true, // We track via env var
	}

	async sessionExists(name: string): Promise<boolean> {
		// Shell backend doesn't have persistent sessions
		return false
	}

	async createSession(
		options: CreateSessionOptions
	): Promise<SessionOperationResult> {
		// Shell backend creates session and attaches immediately
		// There's no "detached" mode for plain shells
		logger.debug(
			`Shell backend: session "${options.name}" will be created on attach`
		)
		return { success: true }
	}

	async attachSession(options: AttachSessionOptions): Promise<void> {
		logger.debug(`Starting shell in workspace`)

		const shell = process.env.SHELL || '/bin/bash'

		// For shell backend, the "name" in options is the workspace path
		// when called from createOrAttachSession
		const workspacePath = options.name

		const child = spawn(shell, [], {
			stdio: 'inherit',
			cwd: workspacePath,
			env: {
				...process.env,
				SPACES_SESSION: workspacePath, // Track that we're in a spaces session
			},
		})

		await new Promise<void>((resolve) => {
			child.on('exit', (code) => {
				process.exit(code || 0)
			})
		})
	}

	async killSession(name: string): Promise<SessionOperationResult> {
		// Shell sessions end when the shell exits
		logger.debug('Shell backend: no persistent session to kill')
		return { success: true }
	}

	async listSessions(): Promise<SessionInfo[]> {
		// Shell backend has no persistent sessions to list
		return []
	}

	isInsideSession(): boolean {
		return !!process.env.SPACES_SESSION
	}

	async getCurrentSessionName(): Promise<string | null> {
		return process.env.SPACES_SESSION || null
	}

	async sendCommand(sessionName: string, command: string): Promise<boolean> {
		// Shell backend cannot send commands to a running shell
		logger.debug('Shell backend does not support sending commands to sessions')
		return false
	}

	hasConfig(workspacePath: string): boolean {
		// Shell backend doesn't use config files
		return false
	}

	getConfigFileName(): string {
		return '' // No config file
	}

	getTemplateFileName(): string {
		return '' // No template
	}

	async applyConfig(sessionName: string, configPath: string): Promise<boolean> {
		// No config to apply
		return false
	}

	async isAvailable(): Promise<boolean> {
		// A shell is always available
		return true
	}

	getInstallInstructions(): string {
		return 'Shell is always available as a fallback'
	}

	getCommandName(): string {
		return process.env.SHELL || 'bash'
	}
}

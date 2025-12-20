/**
 * Multiplexer backend interface definitions
 */

import type { MultiplexerCapabilities } from './capabilities.js'

/**
 * Session information returned by the multiplexer
 */
export interface SessionInfo {
	name: string
	isAttached: boolean
	workingDirectory?: string
	createdAt?: Date
}

/**
 * Result of session operations
 */
export interface SessionOperationResult {
	success: boolean
	error?: string
}

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
	/** Session name */
	name: string
	/** Working directory for the session */
	workingDirectory: string
	/** Commands to run after session creation */
	setupCommands?: string[]
	/** Path to multiplexer-specific config file */
	configPath?: string
	/** Environment variables to set in session */
	environment?: Record<string, string>
}

/**
 * Options for attaching to a session
 */
export interface AttachSessionOptions {
	/** Session name to attach to */
	name: string
	/** If true, create new window in existing session instead of switching */
	newWindow?: boolean
}

/**
 * Base interface that all multiplexer backends must implement
 */
export interface MultiplexerBackend {
	/** Unique identifier for this backend (e.g., 'tmux', 'zellij', 'shell') */
	readonly id: string

	/** Human-readable name */
	readonly displayName: string

	/** Capabilities supported by this backend */
	readonly capabilities: MultiplexerCapabilities

	// === Core Session Operations ===

	/**
	 * Check if a session exists
	 */
	sessionExists(name: string): Promise<boolean>

	/**
	 * Create a new session (detached)
	 */
	createSession(options: CreateSessionOptions): Promise<SessionOperationResult>

	/**
	 * Attach to an existing session
	 * If already inside a session, should switch to the target session
	 */
	attachSession(options: AttachSessionOptions): Promise<void>

	/**
	 * Kill/terminate a session
	 */
	killSession(name: string): Promise<SessionOperationResult>

	/**
	 * List all active sessions managed by this backend
	 */
	listSessions(): Promise<SessionInfo[]>

	// === Environment Detection ===

	/**
	 * Check if currently inside a session managed by this backend
	 */
	isInsideSession(): boolean

	/**
	 * Get the name of the current session (null if not inside one)
	 */
	getCurrentSessionName(): Promise<string | null>

	// === Command Execution ===

	/**
	 * Send a command to be executed in a session
	 * Returns false if backend doesn't support this capability
	 */
	sendCommand(sessionName: string, command: string): Promise<boolean>

	// === Configuration ===

	/**
	 * Check if a workspace has a configuration file for this backend
	 */
	hasConfig(workspacePath: string): boolean

	/**
	 * Get the config file name for this backend (e.g., '.tmux.conf', 'zellij.kdl')
	 */
	getConfigFileName(): string

	/**
	 * Get the template file name for this backend
	 */
	getTemplateFileName(): string

	/**
	 * Source/apply configuration file to a session
	 */
	applyConfig(sessionName: string, configPath: string): Promise<boolean>

	// === Dependency Management ===

	/**
	 * Check if the backend is available on the system
	 */
	isAvailable(): Promise<boolean>

	/**
	 * Get installation instructions for missing backend
	 */
	getInstallInstructions(): string

	/**
	 * Get the required command name (for dependency checking)
	 */
	getCommandName(): string
}

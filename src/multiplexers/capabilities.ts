/**
 * Multiplexer capability definitions
 */

/**
 * Capabilities that a multiplexer backend may support
 */
export interface MultiplexerCapabilities {
	/** Can create persistent sessions that survive disconnection */
	persistentSessions: boolean

	/** Can send commands to a running session (send-keys equivalent) */
	sendCommands: boolean

	/** Can create multiple windows within a session */
	multipleWindows: boolean

	/** Can split windows into panes */
	panes: boolean

	/** Supports session-specific configuration files */
	configFiles: boolean

	/** Can detect if running inside a session */
	nestingDetection: boolean

	/** Can switch between sessions when already inside one */
	sessionSwitching: boolean

	/** Can list all active sessions */
	sessionListing: boolean
}

/**
 * Default capabilities (all false - must opt-in)
 */
export const DEFAULT_CAPABILITIES: MultiplexerCapabilities = {
	persistentSessions: false,
	sendCommands: false,
	multipleWindows: false,
	panes: false,
	configFiles: false,
	nestingDetection: false,
	sessionSwitching: false,
	sessionListing: false,
}

/**
 * Full capabilities (like tmux)
 */
export const FULL_CAPABILITIES: MultiplexerCapabilities = {
	persistentSessions: true,
	sendCommands: true,
	multipleWindows: true,
	panes: true,
	configFiles: true,
	nestingDetection: true,
	sessionSwitching: true,
	sessionListing: true,
}

/**
 * Multiplexer backend registry and selection logic
 */

import type { MultiplexerBackend } from './interface.js'
import { TmuxBackend } from './backends/tmux.js'
import { ZellijBackend } from './backends/zellij.js'
import { ShellBackend } from './backends/shell.js'
import { CmuxBackend } from './backends/cmux.js'
import { logger } from '../utils/logger.js'

/** Available backend IDs */
export type BackendId = 'tmux' | 'zellij' | 'shell' | 'cmux'

/** Registry of all available backends */
const backends = new Map<BackendId, () => MultiplexerBackend>([
	['tmux', (): MultiplexerBackend => new TmuxBackend()],
	['zellij', (): MultiplexerBackend => new ZellijBackend()],
	['shell', (): MultiplexerBackend => new ShellBackend()],
	['cmux', (): MultiplexerBackend => new CmuxBackend()],
])

let fallbackWarned = false

/** Cached backend instance */
let currentBackend: MultiplexerBackend | null = null
let currentBackendId: BackendId | null = null

/**
 * Get the current multiplexer backend
 * Uses configuration preference, falls back to detection
 */
export async function getBackend(
	preferredId?: BackendId | null
): Promise<MultiplexerBackend> {
	// Return cached instance if preference matches exactly
	// Note: null (auto-detect) should not match a specific cached backend
	if (currentBackend && preferredId === currentBackendId) {
		return currentBackend
	}

	// Try preferred backend first
	if (preferredId && backends.has(preferredId)) {
		const backend = backends.get(preferredId)!()
		if (await backend.isAvailable()) {
			currentBackend = backend
			currentBackendId = preferredId
			return backend
		}
		if (preferredId === 'cmux') {
			if (!fallbackWarned) {
				logger.warning(
					'cmux backend unavailable (must be run from inside a cmux surface); falling back.'
				)
				fallbackWarned = true
			}
		} else {
			logger.warning(
				`Preferred multiplexer "${preferredId}" not available, falling back...`
			)
		}
	}

	// Auto-detect available backend
	const backend = await detectBestBackend()
	currentBackend = backend
	currentBackendId = null // Track that this was auto-detected
	return backend
}

/**
 * Detect the best available backend
 * Priority: tmux > zellij > shell
 * If invoked from inside a cmux surface (CMUX_WORKSPACE_ID set),
 * cmux is preferred over the others so spaces-driven workspaces
 * show up in the active cmux window.
 */
export async function detectBestBackend(): Promise<MultiplexerBackend> {
	const priority: BackendId[] = process.env.CMUX_WORKSPACE_ID
		? ['cmux', 'tmux', 'zellij', 'shell']
		: ['tmux', 'zellij', 'shell']

	for (const id of priority) {
		const factory = backends.get(id)
		if (factory) {
			const backend = factory()
			if (await backend.isAvailable()) {
				logger.debug(`Auto-detected multiplexer: ${backend.displayName}`)
				return backend
			}
		}
	}

	// Shell should always be available as fallback
	return new ShellBackend()
}

/**
 * Get all registered backend IDs
 */
export function getAvailableBackendIds(): BackendId[] {
	return Array.from(backends.keys())
}

/**
 * Check if a specific backend is available
 */
export async function isBackendAvailable(id: BackendId): Promise<boolean> {
	const factory = backends.get(id)
	if (!factory) return false
	return factory().isAvailable()
}

/**
 * Get a fresh backend instance (uncached)
 */
export function createBackend(id: BackendId): MultiplexerBackend | null {
	const factory = backends.get(id)
	return factory ? factory() : null
}

/**
 * Clear the cached backend instance
 * Useful when user changes preferences
 */
export function clearBackendCache(): void {
	currentBackend = null
	currentBackendId = null
}

/**
 * Get the current backend based on user preference
 * Convenience helper that combines getMultiplexerPreference() + getBackend()
 */
export async function getCurrentBackend(): Promise<MultiplexerBackend> {
	// Dynamic import to avoid circular dependencies
	const { getMultiplexerPreference } = await import('../core/config.js')
	return getBackend(getMultiplexerPreference())
}

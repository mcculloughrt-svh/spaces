/**
 * Multiplexer backend registry and selection logic
 */

import type { MultiplexerBackend } from './interface.js'
import { TmuxBackend } from './backends/tmux.js'
import { ZellijBackend } from './backends/zellij.js'
import { ShellBackend } from './backends/shell.js'
import { logger } from '../utils/logger.js'

/** Available backend IDs */
export type BackendId = 'tmux' | 'zellij' | 'shell'

/** Registry of all available backends */
const backends = new Map<BackendId, () => MultiplexerBackend>([
	['tmux', (): MultiplexerBackend => new TmuxBackend()],
	['zellij', (): MultiplexerBackend => new ZellijBackend()],
	['shell', (): MultiplexerBackend => new ShellBackend()],
])

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
	// Return cached instance if same preference
	if (currentBackend && (!preferredId || preferredId === currentBackendId)) {
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
		logger.warning(
			`Preferred multiplexer "${preferredId}" not available, falling back...`
		)
	}

	// Auto-detect available backend
	const backend = await detectBestBackend()
	currentBackend = backend
	currentBackendId = backend.id as BackendId
	return backend
}

/**
 * Detect the best available backend
 * Priority: tmux > zellij > shell
 */
export async function detectBestBackend(): Promise<MultiplexerBackend> {
	const priority: BackendId[] = ['tmux', 'zellij', 'shell']

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

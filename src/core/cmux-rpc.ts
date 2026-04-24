/**
 * cmux RPC client — JSON-over-Unix-socket protocol.
 *
 * Protocol: newline-terminated JSON request, newline-terminated JSON response.
 * One socket connection per call (the safe default from the cmux docs).
 */

import { createConnection } from 'net'
import { existsSync } from 'fs'
import { SpacesError } from '../types/errors.js'
import { logger } from '../utils/logger.js'

const DEFAULT_SOCKET_PATH = '/tmp/cmux.sock'
const RPC_TIMEOUT_MS = 5000

function socketPath(): string {
	return process.env.CMUX_SOCKET_PATH || DEFAULT_SOCKET_PATH
}

/**
 * True if the cmux socket file exists at the configured path.
 * Does not imply the daemon is actually reachable — call `systemPing`
 * for a live check.
 */
export function socketExists(): boolean {
	return existsSync(socketPath())
}

interface RpcResponse<T = unknown> {
	id: string
	ok: boolean
	result?: T
	error?: unknown
}

let reqCounter = 0
function nextId(): string {
	reqCounter += 1
	return `spaces-${process.pid}-${reqCounter}`
}

/**
 * Extract a human-readable message from an error payload whose shape
 * the cmux docs do not specify. Best-effort: try `message`, then
 * `error` (string), else stringify.
 */
function formatRpcError(err: unknown): string {
	if (err == null) return 'unknown cmux RPC error'
	if (typeof err === 'string') return err
	if (typeof err === 'object') {
		const obj = err as Record<string, unknown>
		if (typeof obj.message === 'string') return obj.message
		if (typeof obj.error === 'string') return obj.error
	}
	try {
		return JSON.stringify(err)
	} catch {
		return String(err)
	}
}

/**
 * Send a single RPC call and return the parsed result.
 * Throws SpacesError on connection failure, protocol error, or
 * `ok: false` response.
 */
export async function rpc<T = unknown>(
	method: string,
	params: Record<string, unknown> = {}
): Promise<T> {
	const id = nextId()
	const payload = JSON.stringify({ id, method, params }) + '\n'
	const sockPath = socketPath()

	logger.debug(`cmux rpc → ${method} ${JSON.stringify(params)}`)

	return new Promise<T>((resolve, reject) => {
		const socket = createConnection(sockPath)
		let buffer = ''
		let settled = false

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			socket.destroy()
			reject(
				new SpacesError(
					`cmux RPC timeout after ${RPC_TIMEOUT_MS}ms (${method})`,
					'SYSTEM_ERROR',
					2
				)
			)
		}, RPC_TIMEOUT_MS)

		socket.on('connect', () => {
			socket.write(payload)
		})

		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf-8')
			const nlIdx = buffer.indexOf('\n')
			if (nlIdx === -1) return
			const line = buffer.slice(0, nlIdx)
			settled = true
			clearTimeout(timer)
			socket.end()

			let parsed: RpcResponse<T>
			try {
				parsed = JSON.parse(line) as RpcResponse<T>
			} catch (err) {
				reject(
					new SpacesError(
						`cmux RPC response was not valid JSON: ${
							err instanceof Error ? err.message : 'parse error'
						}`,
						'SYSTEM_ERROR',
						2
					)
				)
				return
			}

			if (!parsed.ok) {
				reject(
					new SpacesError(
						`cmux RPC ${method} failed: ${formatRpcError(parsed.error)}`,
						'SYSTEM_ERROR',
						2
					)
				)
				return
			}

			resolve((parsed.result ?? (undefined as T)) as T)
		})

		socket.on('error', (err) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(
				new SpacesError(
					`cmux RPC ${method} connection error: ${err.message}`,
					'SYSTEM_ERROR',
					2
				)
			)
		})

		socket.on('close', () => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(
				new SpacesError(
					`cmux RPC ${method}: socket closed before response`,
					'SYSTEM_ERROR',
					2
				)
			)
		})
	})
}

// === Typed wrappers ===

export interface CmuxWorkspaceEntry {
	id: string
	name: string
	cwd?: string
	selected?: boolean
	[extra: string]: unknown
}

export interface CmuxSurfaceEntry {
	id: string
	name?: string
	type?: string
	[extra: string]: unknown
}

export interface CmuxCapabilities {
	methods?: string[]
	[extra: string]: unknown
}

export async function systemPing(): Promise<boolean> {
	try {
		await rpc('system.ping')
		return true
	} catch (err) {
		logger.debug(
			`cmux system.ping failed: ${err instanceof Error ? err.message : 'unknown'}`
		)
		return false
	}
}

export async function systemCapabilities(): Promise<CmuxCapabilities> {
	const result = await rpc<CmuxCapabilities | { capabilities?: CmuxCapabilities }>(
		'system.capabilities'
	)
	// The response may wrap the payload; accept either shape.
	if (result && typeof result === 'object' && 'capabilities' in result) {
		const wrapped = (result as { capabilities?: CmuxCapabilities }).capabilities
		if (wrapped) return wrapped
	}
	return (result ?? {}) as CmuxCapabilities
}

export async function workspaceList(): Promise<CmuxWorkspaceEntry[]> {
	const result = await rpc<
		{ workspaces?: unknown[] } | unknown[]
	>('workspace.list')
	const arr: unknown[] = Array.isArray(result)
		? result
		: (result as { workspaces?: unknown[] })?.workspaces ?? []
	return arr
		.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
		.map(normalizeWorkspaceEntry)
}

export interface WorkspaceCreateParams {
	name: string
	cwd: string
	/**
	 * Optional — cmux's workspace.create RPC was empirically observed to
	 * ignore this field (spec §11), so spaces drives layout via
	 * surface.split + surface.send_text after create. Kept here so a
	 * future cmux release that honors the field is a one-line change.
	 */
	layout?: unknown
}

/**
 * Raw `workspace.create` response carrier. cmux wraps the new workspace
 * under various keys across versions, so callers get the parsed entry
 * (best-effort) plus the raw result for error surfacing.
 */
export interface WorkspaceCreateResult {
	entry: CmuxWorkspaceEntry | null
	raw: unknown
}

export async function workspaceCreate(
	params: WorkspaceCreateParams
): Promise<WorkspaceCreateResult> {
	const raw = await rpc<unknown>(
		'workspace.create',
		params as unknown as Record<string, unknown>
	)
	return { entry: unwrapWorkspaceEntry(raw), raw }
}

/**
 * Accept several plausible shapes:
 *   - the entry directly (top level has `id`/`workspace_id`/`name`)
 *   - `{ workspace: <entry> }`
 *   - `{ result: <entry> }` (in case the client saw an outer-outer wrap)
 *   - `{ created: <entry> }`
 * Returns null if we can't locate something that looks like an entry.
 */
function unwrapWorkspaceEntry(raw: unknown): CmuxWorkspaceEntry | null {
	if (raw == null || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>
	if (looksLikeEntry(obj)) return normalizeWorkspaceEntry(obj)
	for (const key of ['workspace', 'result', 'created', 'data']) {
		const nested = obj[key]
		if (nested && typeof nested === 'object' && looksLikeEntry(nested as Record<string, unknown>)) {
			return normalizeWorkspaceEntry(nested as Record<string, unknown>)
		}
	}
	return null
}

function looksLikeEntry(obj: Record<string, unknown>): boolean {
	return (
		typeof obj.id === 'string' ||
		typeof obj.workspace_id === 'string' ||
		typeof obj.workspace_ref === 'string' ||
		typeof obj.name === 'string' ||
		typeof obj.workspace_name === 'string' ||
		typeof obj.title === 'string'
	)
}

/**
 * cmux's workspace responses vary by RPC:
 *   - `workspace.create` returns `{workspace_id, workspace_ref, window_id, window_ref}`
 *     because one message carries both window and workspace info.
 *   - `workspace.current` / `workspace.list` return `{id, ref, title, ...}`
 *     (the workspace's own shape — title is cmux's display name, and
 *     may mirror the active terminal's title after a process starts).
 *
 * Normalize both shapes to `{id, name, ...}` so callers can use
 * canonical fields regardless of the underlying wire shape.
 */
function normalizeWorkspaceEntry(
	raw: Record<string, unknown>
): CmuxWorkspaceEntry {
	const entry: Record<string, unknown> = { ...raw }
	if (typeof entry.id !== 'string') {
		if (typeof raw.workspace_id === 'string') entry.id = raw.workspace_id
		else if (typeof raw.workspace_ref === 'string') entry.id = raw.workspace_ref
	}
	if (typeof entry.name !== 'string') {
		if (typeof raw.workspace_name === 'string') entry.name = raw.workspace_name
		else if (typeof raw.title === 'string') entry.name = raw.title
	}
	return entry as CmuxWorkspaceEntry
}

function normalizeSurfaceEntry(
	raw: Record<string, unknown>
): CmuxSurfaceEntry {
	const entry: Record<string, unknown> = { ...raw }
	if (typeof entry.id !== 'string') {
		if (typeof raw.surface_id === 'string') entry.id = raw.surface_id
		else if (typeof raw.surface_ref === 'string') entry.id = raw.surface_ref
	}
	if (typeof entry.name !== 'string' && typeof raw.surface_name === 'string') {
		entry.name = raw.surface_name
	}
	return entry as CmuxSurfaceEntry
}

export async function workspaceSelect(workspaceId: string): Promise<void> {
	await rpc('workspace.select', { workspace_id: workspaceId })
}

export async function workspaceClose(workspaceId: string): Promise<void> {
	await rpc('workspace.close', { workspace_id: workspaceId })
}

export async function workspaceCurrent(): Promise<CmuxWorkspaceEntry | null> {
	try {
		const result = await rpc<unknown>('workspace.current')
		if (!result || typeof result !== 'object') return null
		const obj = result as Record<string, unknown>
		const inner =
			obj.workspace && typeof obj.workspace === 'object'
				? (obj.workspace as Record<string, unknown>)
				: obj
		return looksLikeEntry(inner) ? normalizeWorkspaceEntry(inner) : null
	} catch (err) {
		logger.debug(
			`cmux workspace.current failed: ${
				err instanceof Error ? err.message : 'unknown'
			}`
		)
		return null
	}
}

export async function surfaceList(
	workspaceId: string
): Promise<CmuxSurfaceEntry[]> {
	const result = await rpc<
		{ surfaces?: unknown[] } | unknown[]
	>('surface.list', { workspace_id: workspaceId })
	const arr: unknown[] = Array.isArray(result)
		? result
		: (result as { surfaces?: unknown[] })?.surfaces ?? []
	return arr
		.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
		.map(normalizeSurfaceEntry)
}

export async function surfaceSendText(
	surfaceId: string,
	text: string
): Promise<void> {
	await rpc('surface.send_text', { surface_id: surfaceId, text })
}

export async function surfaceSendKey(
	surfaceId: string,
	key: string
): Promise<void> {
	await rpc('surface.send_key', { surface_id: surfaceId, key })
}

export type SplitDirection = 'left' | 'right' | 'up' | 'down'

/**
 * Split an existing surface. Returns the new surface's entry (or the
 * raw response if cmux wraps it — we try both shapes).
 */
export async function surfaceSplit(
	surfaceId: string,
	direction: SplitDirection
): Promise<CmuxSurfaceEntry | null> {
	const result = await rpc<unknown>('surface.split', {
		surface_id: surfaceId,
		direction,
	})
	if (!result || typeof result !== 'object') return null
	const obj = result as Record<string, unknown>
	const inner =
		obj.surface && typeof obj.surface === 'object'
			? (obj.surface as Record<string, unknown>)
			: obj
	if (
		typeof inner.id !== 'string' &&
		typeof inner.surface_id !== 'string' &&
		typeof inner.surface_ref !== 'string'
	) {
		return null
	}
	return normalizeSurfaceEntry(inner)
}

export async function surfaceFocus(surfaceId: string): Promise<void> {
	await rpc('surface.focus', { surface_id: surfaceId })
}

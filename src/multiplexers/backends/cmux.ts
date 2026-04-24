/**
 * cmux multiplexer backend — drives cmux via its Unix-socket RPC.
 *
 * Access model: inside-cmux only. `isAvailable()` returns false when
 * invoked from a regular terminal (iTerm, Terminal.app), so the
 * registry falls back to tmux/zellij/shell in that case.
 */

import { existsSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type {
	MultiplexerBackend,
	CreateSessionOptions,
	AttachSessionOptions,
	SessionInfo,
	SessionOperationResult,
} from '../interface.js'
import type { MultiplexerCapabilities } from '../capabilities.js'
import { logger } from '../../utils/logger.js'
import { readProjectConfig, getScriptsPhaseDir } from '../../core/config.js'
import { discoverScripts } from '../../utils/run-scripts.js'
import {
	socketExists,
	systemPing,
	systemCapabilities,
	workspaceList,
	workspaceCreate,
	workspaceSelect,
	workspaceClose,
	workspaceCurrent,
	surfaceList,
	surfaceSendText,
	surfaceSendKey,
	type CmuxWorkspaceEntry,
	type CmuxSurfaceEntry,
} from '../../core/cmux-rpc.js'
import {
	buildCmuxTemplateFileContent,
	buildCmuxTitleHookScript,
	buildSpacesRunnerCommand,
} from '../../core/cmux-template.js'

const execAsync = promisify(exec)

const REQUIRED_METHODS = [
	'workspace.create',
	'workspace.select',
	'workspace.close',
	'workspace.list',
	'workspace.current',
	'surface.list',
	'surface.send_text',
	'surface.send_key',
] as const

interface ResolvedProjectContext {
	projectName: string
	repository: string
	llmAssistant?: string
}

/**
 * Walk up from a worktree path to determine the owning spaces project.
 * Expected layout: ~/spaces/<project>/workspaces/<worktree>/.
 */
function resolveProjectFromWorkspacePath(
	workspacePath: string
): ResolvedProjectContext | null {
	const parts = workspacePath.split('/').filter(Boolean)
	// Look for ".../workspaces/<ws>"; the segment before "workspaces" is the project name.
	const wsIdx = parts.lastIndexOf('workspaces')
	if (wsIdx < 1) return null
	const projectName = parts[wsIdx - 1]
	try {
		const config = readProjectConfig(projectName)
		return {
			projectName,
			repository: config.repository,
			llmAssistant: config.llmAssistant,
		}
	} catch {
		return null
	}
}

export class CmuxBackend implements MultiplexerBackend {
	readonly id = 'cmux'
	readonly displayName = 'cmux'

	readonly capabilities: MultiplexerCapabilities = {
		persistentSessions: true,
		sendCommands: true,
		multipleWindows: true,
		panes: true,
		configFiles: true,
		nestingDetection: true,
		sessionSwitching: true,
		sessionListing: true,
	}

	private capabilitiesCheckResult: boolean | null = null

	private async findWorkspaceByName(
		name: string
	): Promise<CmuxWorkspaceEntry | null> {
		const list = await workspaceList()
		// cmux workspaces don't expose a stable `name` field — `title`
		// is the sidebar label but gets clobbered by the running
		// process's title. The durable identifier is the workspace's
		// cwd, which for spaces-managed workspaces always ends in
		// `/workspaces/<name>`. Try both: name match first (for the
		// brief window after create before any title update), then
		// cwd-suffix match.
		const byName = list.find((w) => w.name === name)
		if (byName) return byName
		const cwdSuffix = `/workspaces/${name}`
		const byCwd = list.find((w) => {
			const cwd = typeof w.cwd === 'string' ? w.cwd : null
			if (cwd && cwd.endsWith(cwdSuffix)) return true
			const raw = w as unknown as Record<string, unknown>
			const curdir = raw.current_directory
			return typeof curdir === 'string' && curdir.endsWith(cwdSuffix)
		})
		return byCwd ?? null
	}

	async sessionExists(name: string): Promise<boolean> {
		try {
			return (await this.findWorkspaceByName(name)) !== null
		} catch (err) {
			logger.debug(
				`cmux sessionExists(${name}) error: ${
					err instanceof Error ? err.message : 'unknown'
				}`
			)
			return false
		}
	}

	async createSession(
		options: CreateSessionOptions
	): Promise<SessionOperationResult> {
		try {
			const project = resolveProjectFromWorkspacePath(options.workingDirectory)
			if (!project) {
				return {
					success: false,
					error: `could not resolve spaces project from workspace path ${options.workingDirectory}`,
				}
			}

			// cmux's `workspace.create` RPC accepts name + cwd. Its docs
			// (docs/cmux/api.md §"Open questions") explicitly flag the
			// layout param as "verify empirically" — empirically it is
			// ignored, so we can't bake <SPACES_RUNNER> into the initial
			// surface declaratively. Instead: create the workspace,
			// select it so cmux's current-workspace pointer moves, and
			// then drive the runner via `surface.send_text` against the
			// selected workspace's primary surface.
			const setupScripts = discoverScripts(
				getScriptsPhaseDir(project.projectName, 'setup')
			)
			const selectScripts = discoverScripts(
				getScriptsPhaseDir(project.projectName, 'select')
			)
			const runner = buildSpacesRunnerCommand(
				options.name,
				project.repository,
				setupScripts,
				selectScripts
			)

			const created = await workspaceCreate({
				name: options.name,
				cwd: options.workingDirectory,
			})
			logger.debug(
				`cmux workspace.create raw response: ${JSON.stringify(created.raw)}`
			)

			const workspaceId = await this.resolveWorkspaceId(
				created.entry,
				options.name
			)
			if (!workspaceId) {
				const rawPreview = JSON.stringify(created.raw).slice(0, 500)
				return {
					success: false,
					error: `cmux workspace.create did not surface an id for ${options.name}. Raw response: ${rawPreview}`,
				}
			}
			logger.debug(`cmux new workspaceId resolved to: ${workspaceId}`)

			// Select the new workspace so subsequent surface.* calls
			// operate in its context. cmux's surface.list / surface.split
			// have been observed to operate relative to the
			// currently-selected workspace rather than strictly honoring
			// the `workspace` param we pass, so moving the pointer here
			// is load-bearing.
			try {
				await workspaceSelect(workspaceId)
			} catch (err) {
				logger.debug(
					`cmux workspace.select after create failed: ${
						err instanceof Error ? err.message : 'unknown'
					}`
				)
			}

			// Confirm the switch landed before we send any text. If
			// cmux.current doesn't report our new workspace, send_text
			// would run against whatever surface cmux considers "current"
			// — which was the bug that kept landing the runner in the
			// user's original workspace.
			const switched = await this.waitForCurrentWorkspace(
				workspaceId,
				options.name
			)
			if (!switched) {
				return {
					success: false,
					error: `cmux did not switch to new workspace ${options.name} after workspace.select`,
				}
			}

			// Wait for cmux to spawn the default terminal surface in the
			// newly-selected workspace, then send the runner to it.
			const primary = await this.waitForActiveSurface(workspaceId)
			if (!primary) {
				return {
					success: false,
					error: `cmux workspace ${options.name} has no surfaces after create`,
				}
			}
			logger.debug(`cmux sending runner to surface ${primary.id}`)

			// Stage the runner as a script on disk inside the new
			// worktree rather than sending it inline. send_text
			// simulates keystrokes into the running shell, and
			// interactive zsh configs commonly include line-editor
			// plugins (autopair, syntax-highlighting) that mutate the
			// line as characters arrive — the runner has enough
			// brackets and quotes that the resulting line ends up
			// mangled (a stray `]` kept landing on a trailing shell
			// invocation). By writing the runner to a file and sending
			// only a short `bash <path>` command, the keystrokes have
			// no metacharacters for plugins to grab.
			const runnerPath = join(options.workingDirectory, '.spaces-runner.sh')
			// Ensure the runner self-deletes on exit so we don't leave
			// it behind in the worktree. Quote $0 in case cmux's shell
			// is invoked from somewhere odd.
			const runnerScript = `#!/usr/bin/env bash\nset +e\ntrap 'rm -f "$0"' EXIT\n${runner}\n`
			writeFileSync(runnerPath, runnerScript, { mode: 0o700 })
			try {
				chmodSync(runnerPath, 0o700)
			} catch {
				// writeFileSync mode is usually honored; chmod is belt
				// and suspenders on platforms where it isn't.
			}

			// Stage a title-locker script that, when sourced into the
			// outer interactive shell, installs a precmd/PROMPT_COMMAND
			// hook to keep the cmux sidebar label stuck to the spaces
			// workspace name. We source it (not `bash <path>`) because
			// the hook must live in the outer shell — the shell whose
			// prompt cmux uses to decide the workspace title. After the
			// source completes the hook is in memory, so we delete the
			// file immediately.
			const titleHookPath = join(
				options.workingDirectory,
				'.spaces-cmux-title.sh'
			)
			writeFileSync(
				titleHookPath,
				buildCmuxTitleHookScript(options.name),
				{ mode: 0o600 }
			)

			// Small delay so the shell is reading stdin before we send.
			await new Promise((r) => setTimeout(r, 250))
			await surfaceSendText(
				primary.id,
				`source ${titleHookPath}; rm -f ${titleHookPath}; bash ${runnerPath}`
			)
			await surfaceSendKey(primary.id, 'enter')

			return { success: true }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error',
			}
		}
	}

	/**
	 * workspace.create's response shape isn't documented. Accept the id
	 * directly if the parser extracted one; otherwise fall back to
	 * `workspace.list` (retried a few times — cmux's index can briefly
	 * lag behind a successful create).
	 */
	private async resolveWorkspaceId(
		created: CmuxWorkspaceEntry | null | undefined,
		name: string
	): Promise<string | null> {
		if (created && typeof created.id === 'string' && created.id.length > 0) {
			return created.id
		}
		const maxAttempts = 10
		const delayMs = 100
		for (let i = 0; i < maxAttempts; i += 1) {
			const list = await workspaceList()
			const found = list.find((w) => w.name === name)
			if (found?.id) return found.id
			await new Promise((r) => setTimeout(r, delayMs))
		}
		return null
	}

	/**
	 * Poll `workspace.current` until it reports the workspace we just
	 * created/selected. cmux's select is asynchronous with respect to
	 * the RPC ack, so without this guard subsequent surface.* calls race
	 * against the switch and can land on the prior workspace.
	 *
	 * Matches either by id or by name to tolerate cmux echoing either
	 * the UUID (`workspace_id`) or the human-readable ref
	 * (`workspace_ref`) as the canonical id.
	 */
	private async waitForCurrentWorkspace(
		workspaceId: string,
		workspaceName: string
	): Promise<boolean> {
		const maxAttempts = 30
		const delayMs = 75
		for (let i = 0; i < maxAttempts; i += 1) {
			const current = await workspaceCurrent()
			if (current) {
				if (current.id === workspaceId) return true
				if (current.name === workspaceName) return true
			}
			await new Promise((r) => setTimeout(r, delayMs))
		}
		const current = await workspaceCurrent()
		logger.debug(
			`cmux waitForCurrentWorkspace gave up: expected ${workspaceId} / ${workspaceName}, current is ${JSON.stringify(
				current
			)}`
		)
		return false
	}

	/**
	 * Poll surface.list until a surface appears. Called only after we've
	 * confirmed the new workspace is cmux's current workspace, so
	 * whichever way surface.list interprets its `workspace` param — by
	 * id, by ref, or implicitly by "current" — all three paths converge
	 * on the right answer here.
	 */
	private async waitForActiveSurface(
		workspaceId: string
	): Promise<CmuxSurfaceEntry | null> {
		const maxAttempts = 30
		const delayMs = 75
		for (let i = 0; i < maxAttempts; i += 1) {
			const surfaces = await surfaceList(workspaceId)
			if (surfaces.length > 0) return surfaces[0]
			await new Promise((r) => setTimeout(r, delayMs))
		}
		return null
	}

	async attachSession(options: AttachSessionOptions): Promise<void> {
		const ws = await this.findWorkspaceByName(options.name)
		if (!ws) {
			logger.debug(`cmux attachSession: workspace "${options.name}" not found`)
			return
		}
		if (options.newWindow) {
			logger.debug(
				'cmux does not yet have a documented new-window RPC via spaces; selecting in current window instead.'
			)
		}
		await workspaceSelect(ws.id)
	}

	async killSession(name: string): Promise<SessionOperationResult> {
		try {
			const ws = await this.findWorkspaceByName(name)
			if (!ws) {
				// Idempotent: closing a non-existent session is success.
				return { success: true }
			}
			await workspaceClose(ws.id)
			return { success: true }
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Unknown error',
			}
		}
	}

	async listSessions(): Promise<SessionInfo[]> {
		try {
			const list = await workspaceList()
			const current = await workspaceCurrent()
			const currentId = current?.id
			return list.map((w) => ({
				name: w.name,
				isAttached: currentId ? w.id === currentId : Boolean(w.selected),
				workingDirectory: typeof w.cwd === 'string' ? w.cwd : undefined,
			}))
		} catch {
			return []
		}
	}

	isInsideSession(): boolean {
		return !!process.env.CMUX_WORKSPACE_ID
	}

	async getCurrentSessionName(): Promise<string | null> {
		try {
			const ws = await workspaceCurrent()
			return ws?.name ?? null
		} catch {
			return null
		}
	}

	async sendCommand(sessionName: string, command: string): Promise<boolean> {
		try {
			const ws = await this.findWorkspaceByName(sessionName)
			if (!ws) return false
			const surfaces = await surfaceList(ws.id)
			if (surfaces.length === 0) return false
			const target = surfaces[0].id
			await surfaceSendText(target, command)
			await surfaceSendKey(target, 'enter')
			return true
		} catch (err) {
			logger.debug(
				`cmux sendCommand failed: ${
					err instanceof Error ? err.message : 'unknown'
				}`
			)
			return false
		}
	}

	hasConfig(workspacePath: string): boolean {
		return existsSync(join(workspacePath, this.getConfigFileName()))
	}

	getConfigFileName(): string {
		return 'cmux.json'
	}

	getTemplateFileName(): string {
		return 'cmux.template.json'
	}

	async applyConfig(_sessionName: string, _configPath: string): Promise<boolean> {
		// cmux applies layout at workspace.create time via RPC; nothing to do
		// post-hoc.
		return true
	}

	async isAvailable(): Promise<boolean> {
		// Fast reject: no cmux CLI on PATH → can't be cmux.
		try {
			await execAsync('which cmux')
		} catch {
			return false
		}

		// Spec §3.1: inside-cmux-only. If we're not in a cmux surface, the
		// default socketControlMode (`cmuxOnly`) will reject us anyway, so
		// short-circuit here and let the registry fall back.
		if (!process.env.CMUX_WORKSPACE_ID) {
			return false
		}

		if (!socketExists()) {
			return false
		}

		const alive = await systemPing()
		if (!alive) return false

		// Soft version gate — only check once per process.
		if (this.capabilitiesCheckResult === null) {
			this.capabilitiesCheckResult = await this.checkCapabilities()
		}
		return this.capabilitiesCheckResult
	}

	private async checkCapabilities(): Promise<boolean> {
		try {
			const caps = await systemCapabilities()
			const methods = Array.isArray(caps.methods) ? caps.methods : null
			if (!methods) {
				// cmux didn't report a method list — assume compatible and let
				// individual calls fail loudly if something is missing.
				return true
			}
			const missing = REQUIRED_METHODS.filter((m) => !methods.includes(m))
			if (missing.length > 0) {
				logger.warning(
					`cmux is missing required RPC methods (${missing.join(
						', '
					)}); falling back to another multiplexer.`
				)
				return false
			}
			return true
		} catch (err) {
			logger.debug(
				`cmux system.capabilities check failed: ${
					err instanceof Error ? err.message : 'unknown'
				}`
			)
			return true
		}
	}

	getInstallInstructions(): string {
		return 'Install cmux: https://cmux.com/docs/getting-started'
	}

	getCommandName(): string {
		return 'cmux'
	}
}

/**
 * Re-export template-file builder so callers (config.createProject)
 * can write the initial cmux.template.json without importing the
 * template module directly.
 */
export { buildCmuxTemplateFileContent }

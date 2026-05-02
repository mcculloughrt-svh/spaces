/**
 * Config command implementation
 * Handles 'spaces config' for managing CLI configuration
 */

import {
	readGlobalConfig,
	updateGlobalConfig,
	setMultiplexerPreference,
	setMultiplexerPreferenceForTerminal,
	getMultiplexerPreference,
	getMultiplexerPreferenceMap,
	detectTerminalContext,
	getCurrentProject,
	getProjectDir,
	getAllProjectNames,
	readProjectConfig,
	getScriptsPhaseDir,
	buildTmuxTemplateFileContent,
} from '../core/config.js'
import {
	getBackend,
	getAvailableBackendIds,
	isBackendAvailable,
} from '../multiplexers/index.js'
import { logger } from '../utils/logger.js'
import { selectItem, promptInput } from '../utils/prompts.js'
import {
	isValidMultiplexerId,
	isValidTerminalContext,
} from '../types/config.js'
import type {
	MultiplexerId,
	TerminalContext,
	TerminalMultiplexerMap,
} from '../types/config.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildCmuxTemplateFileContent, renderCmuxTemplate } from '../core/cmux-template.js'
import { ensureCmuxTrust } from '../core/cmux-trust.js'
import { discoverScripts } from '../utils/run-scripts.js'
import { NoProjectError, SpacesError } from '../types/errors.js'

/**
 * Show current configuration and allow editing
 */
export async function showConfig(): Promise<void> {
	const globalConfig = readGlobalConfig()
	const activePreference = getMultiplexerPreference()
	const currentBackend = await getBackend(activePreference)
	const ctx = detectTerminalContext()
	const map = getMultiplexerPreferenceMap()

	logger.bold('Current Configuration:')
	logger.log('')
	logger.log(`  Current Project: ${globalConfig.currentProject || '(none)'}`)
	logger.log(`  Projects Directory: ${globalConfig.projectsDir}`)
	logger.log(`  Default Base Branch: ${globalConfig.defaultBaseBranch}`)
	logger.log(`  Stale Days: ${globalConfig.staleDays}`)
	logger.log('')
	logger.bold('Multiplexer:')
	logger.log(`  Detected terminal context: ${ctx}`)
	logger.log(
		`  Active preference:         ${activePreference ?? 'auto-detect'}`
	)
	logger.log(`  Active backend:            ${currentBackend.displayName}`)
	logger.log('')
	logger.log('  Per-terminal preferences:')
	for (const slot of ['cmux', 'ghostty', 'default'] as const) {
		const value = map[slot]
		const display =
			value === undefined ? '(unset)' : value === null ? 'auto-detect' : value
		const marker = slot === ctx ? '← active slot' : ''
		logger.log(`    ${slot.padEnd(8)} ${display.padEnd(14)} ${marker}`)
	}
	if (
		globalConfig.multiplexer !== undefined &&
		globalConfig.multiplexer !== null
	) {
		logger.log('')
		logger.log(
			`  Legacy fallback:           ${globalConfig.multiplexer} (used when no slot matches)`
		)
	}
	logger.log('')

	// Show edit menu
	const options = [
		`Default Base Branch (${globalConfig.defaultBaseBranch})`,
		`Stale Days (${globalConfig.staleDays})`,
		`Multiplexer (${activePreference ?? 'auto-detect'})`,
		'Exit',
	]

	const selected = await selectItem(options, 'Edit a setting:')

	if (!selected || selected === 'Exit') {
		return
	}

	if (selected.startsWith('Default Base Branch')) {
		const newValue = await promptInput('Enter new default base branch:', {
			default: globalConfig.defaultBaseBranch,
			validate: (input) => input.trim().length > 0 || 'Branch name cannot be empty',
		})

		if (newValue) {
			updateGlobalConfig({ defaultBaseBranch: newValue.trim() })
			logger.success(`Default base branch set to: ${newValue.trim()}`)
		}
	} else if (selected.startsWith('Stale Days')) {
		const newValue = await promptInput('Enter number of days before workspace is stale:', {
			default: String(globalConfig.staleDays),
			validate: (input) => {
				const num = parseInt(input, 10)
				if (isNaN(num) || num < 1) {
					return 'Must be a positive number'
				}
				return true
			},
		})

		if (newValue) {
			const staleDays = parseInt(newValue, 10)
			updateGlobalConfig({ staleDays })
			logger.success(`Stale days set to: ${staleDays}`)
		}
	} else if (selected.startsWith('Multiplexer')) {
		await setMultiplexer()
	}
}

export interface SetMultiplexerOptions {
	/**
	 * Which terminal-context slot to target. Defaults to the detected
	 * current context so `spaces config multiplexer cmux` from inside
	 * cmux writes the `cmux` slot and from Ghostty writes the `ghostty`
	 * slot — matching natural muscle memory.
	 */
	terminal?: TerminalContext
	/**
	 * If true, just dump the per-terminal map and return without
	 * prompting or mutating anything.
	 */
	list?: boolean
	/**
	 * If true, target the legacy single-preference field instead of the
	 * per-terminal map. Kept for advanced users and migrations.
	 */
	legacy?: boolean
}

/**
 * Set multiplexer preference. By default, writes the slot matching the
 * current terminal context in `multiplexerByTerminal`. Pass
 * `options.terminal` to target a specific slot, `options.legacy` to
 * target the single-field fallback, or `options.list` to dump the
 * current map without mutating.
 */
export async function setMultiplexer(
	multiplexerArg?: string,
	options: SetMultiplexerOptions = {}
): Promise<void> {
	if (options.list) {
		printMultiplexerMap()
		return
	}

	const backendIds = getAvailableBackendIds()

	// Resolve the slot to write. `legacy` bypasses the per-terminal map
	// and writes the single-preference field; otherwise default to the
	// detected context.
	const targetSlot: TerminalContext | 'legacy' = options.legacy
		? 'legacy'
		: options.terminal ?? detectTerminalContext()

	const currentPreference = slotCurrentValue(targetSlot)

	let selectedMultiplexer: MultiplexerId

	if (multiplexerArg) {
		if (multiplexerArg === 'auto') {
			selectedMultiplexer = null
		} else if (isValidMultiplexerId(multiplexerArg)) {
			selectedMultiplexer = multiplexerArg
		} else {
			logger.error(`Unknown multiplexer: ${multiplexerArg}`)
			logger.log(`\nAvailable options: auto, ${backendIds.join(', ')}`)
			return
		}
	} else {
		// Show selection menu
		logger.info(`Setting preference for slot: ${slotLabel(targetSlot)}`)

		const selectOptions: string[] = ['auto (detect best available)']
		for (const id of backendIds) {
			const available = await isBackendAvailable(id)
			const status = available ? '' : ' (not installed)'
			const current = id === currentPreference ? ' (current)' : ''
			selectOptions.push(`${id}${status}${current}`)
		}

		const selected = await selectItem(
			selectOptions,
			'Select multiplexer preference:'
		)

		if (!selected) {
			logger.info('Cancelled')
			return
		}

		const match = selected.match(/^(\w+)/)
		if (!match) return
		const choice = match[1]
		if (choice === 'auto') {
			selectedMultiplexer = null
		} else if (isValidMultiplexerId(choice)) {
			selectedMultiplexer = choice
		} else {
			return
		}
	}

	// Warn if the selected backend isn't installed in *any* terminal. Cmux
	// is a special case — it's inside-cmux-only so `isBackendAvailable`
	// returns false from outside cmux, but that's expected and doesn't
	// mean the binary is missing.
	if (
		selectedMultiplexer &&
		selectedMultiplexer !== 'cmux' &&
		!(await isBackendAvailable(selectedMultiplexer))
	) {
		logger.warning(
			`${selectedMultiplexer} is not installed. It will fall back to an available option.`
		)
	}

	// Persist.
	if (targetSlot === 'legacy') {
		setMultiplexerPreference(selectedMultiplexer)
	} else {
		setMultiplexerPreferenceForTerminal(targetSlot, selectedMultiplexer)
	}

	const formatted = selectedMultiplexer ?? 'auto-detect'
	logger.success(
		`Multiplexer for ${slotLabel(targetSlot)} set to: ${formatted}`
	)

	// If we set the *current* terminal's slot, show what will actually run.
	const current = detectTerminalContext()
	const setsCurrent = targetSlot === current || targetSlot === 'legacy'
	if (setsCurrent) {
		const backend = await getBackend(getMultiplexerPreference())
		if (
			selectedMultiplexer &&
			selectedMultiplexer !== backend.id &&
			selectedMultiplexer !== null
		) {
			logger.info(
				`Will use ${backend.displayName} (${selectedMultiplexer} not available in this terminal)`
			)
		}
	}
}

function slotLabel(slot: TerminalContext | 'legacy'): string {
	if (slot === 'legacy') return 'legacy fallback'
	return `terminal=${slot}`
}

function slotCurrentValue(slot: TerminalContext | 'legacy'): MultiplexerId {
	if (slot === 'legacy') {
		return readGlobalConfig().multiplexer
	}
	const map = getMultiplexerPreferenceMap()
	const v = map[slot]
	return v === undefined ? null : v
}

function printMultiplexerMap(): void {
	const globalConfig = readGlobalConfig()
	const map = getMultiplexerPreferenceMap()
	const ctx = detectTerminalContext()
	logger.bold('Multiplexer preference by terminal:')
	logger.log('')
	logger.log(`  Detected terminal context: ${ctx}`)
	logger.log(`  Resolved preference:       ${getMultiplexerPreference() ?? 'auto-detect'}`)
	logger.log('')
	for (const slot of ['cmux', 'ghostty', 'default'] as const) {
		const value = map[slot]
		const display =
			value === undefined ? '(unset)' : value === null ? 'auto-detect' : value
		const marker = slot === ctx ? '← active slot' : ''
		logger.log(`  ${slot.padEnd(8)} ${display.padEnd(14)} ${marker}`)
	}
	logger.log('')
	const legacy = globalConfig.multiplexer
	logger.log(
		`  Legacy fallback: ${legacy === null ? 'auto-detect' : legacy}`
	)
}

/**
 * Parse a terminal-context string argument. Returns undefined if the
 * caller didn't provide one; throws SpacesError if the value is
 * unrecognized.
 */
export function parseTerminalOption(
	raw: string | undefined
): TerminalContext | undefined {
	if (raw === undefined) return undefined
	if (!isValidTerminalContext(raw)) {
		throw new SpacesError(
			`Unknown terminal context: ${raw}\nValid options: cmux, ghostty, default`,
			'USER_ERROR',
			1
		)
	}
	return raw
}

/**
 * List available multiplexers
 */
export async function listMultiplexers(): Promise<void> {
	const backendIds = getAvailableBackendIds()
	const currentPreference = getMultiplexerPreference()
	const activeBackend = await getBackend(currentPreference)

	logger.bold('Available Multiplexers:')
	logger.log('')

	for (const id of backendIds) {
		const available = await isBackendAvailable(id)
		const isActive = id === activeBackend.id
		const isPreferred = id === currentPreference

		const status: string[] = []
		if (available) {
			status.push('installed')
		} else {
			status.push('not installed')
		}
		if (isActive) {
			status.push('active')
		}
		if (isPreferred) {
			status.push('preferred')
		}

		const indicator = isActive ? '*' : ' '
		logger.log(`  ${indicator} ${id.padEnd(10)} (${status.join(', ')})`)
	}

	logger.log('')
	logger.log(`  Preference: ${currentPreference || 'auto-detect'}`)
}

export type RetrofitBackendId = 'cmux' | 'tmux'

function isRetrofitBackendId(value: string): value is RetrofitBackendId {
	return value === 'cmux' || value === 'tmux'
}

export interface InitBackendOptions {
	/** Project to target. Defaults to the current project. */
	project?: string
	/**
	 * Also render per-worktree config files (cmux.json / .tmux.conf)
	 * into every existing workspace under the project. Off by default —
	 * the cmux backend falls back to re-rendering the template at
	 * createSession time, so this is only useful when the user wants
	 * editable per-worktree files.
	 */
	renderExisting?: boolean
}

/**
 * Retrofit a backend's template onto an existing project.
 *
 * Writes <projectDir>/<template-file> if missing. For cmux, also runs
 * the trust-directory handshake so the user doesn't hit cmux's
 * "untrusted" prompt on the next workspace open.
 */
export async function initBackend(
	backendArg: string,
	options: InitBackendOptions = {}
): Promise<void> {
	if (!isRetrofitBackendId(backendArg)) {
		throw new SpacesError(
			`Unknown backend: ${backendArg}\nValid options: cmux, tmux`,
			'USER_ERROR',
			1
		)
	}
	const backendId: RetrofitBackendId = backendArg

	const projectName = options.project ?? getCurrentProject()
	if (!projectName) {
		throw new NoProjectError()
	}
	if (!getAllProjectNames().includes(projectName)) {
		throw new SpacesError(
			`Project "${projectName}" not found`,
			'USER_ERROR',
			1
		)
	}

	const projectConfig = readProjectConfig(projectName)
	const projectDir = getProjectDir(projectName)

	if (backendId === 'cmux') {
		const templatePath = join(projectDir, 'cmux.template.json')
		if (existsSync(templatePath)) {
			logger.info(`cmux.template.json already present at ${templatePath}`)
		} else {
			writeFileSync(
				templatePath,
				buildCmuxTemplateFileContent(projectConfig.llmAssistant),
				'utf-8'
			)
			logger.success(`Wrote ${templatePath}`)
		}

		// Trust-directory handshake is idempotent via the marker file.
		await ensureCmuxTrust(projectName)

		if (options.renderExisting) {
			await renderExistingWorkspaceConfigs(projectName, 'cmux')
		} else {
			logger.info(
				'Existing worktrees will get a fresh cmux.json rendered live at next `spaces switch`.'
			)
			logger.info(
				'Pass --render-existing to eagerly write editable cmux.json files into each worktree now.'
			)
		}
		return
	}

	// backendId === 'tmux'
	const templatePath = join(projectDir, 'tmux.template.conf')
	if (existsSync(templatePath)) {
		logger.info(`tmux.template.conf already present at ${templatePath}`)
	} else {
		writeFileSync(
			templatePath,
			buildTmuxTemplateFileContent(projectConfig.llmAssistant),
			'utf-8'
		)
		logger.success(`Wrote ${templatePath}`)
	}

	if (options.renderExisting) {
		await renderExistingWorkspaceConfigs(projectName, 'tmux')
	}
}

async function renderExistingWorkspaceConfigs(
	projectName: string,
	backendId: RetrofitBackendId
): Promise<void> {
	const { readdirSync, copyFileSync } = await import('fs')
	const projectDir = getProjectDir(projectName)
	const workspacesDir = join(projectDir, 'workspaces')
	if (!existsSync(workspacesDir)) {
		logger.debug(`No workspaces directory at ${workspacesDir}`)
		return
	}
	const projectConfig = readProjectConfig(projectName)
	const entries = readdirSync(workspacesDir)
	let written = 0
	let skipped = 0

	if (backendId === 'cmux') {
		const templatePath = join(projectDir, 'cmux.template.json')
		if (!existsSync(templatePath)) return
		const templateText = readFileSync(templatePath, 'utf-8')
		const setupScripts = discoverScripts(getScriptsPhaseDir(projectName, 'setup'))
		const selectScripts = discoverScripts(getScriptsPhaseDir(projectName, 'select'))

		for (const ws of entries) {
			const wsPath = join(workspacesDir, ws)
			const cfgPath = join(wsPath, 'cmux.json')
			if (existsSync(cfgPath)) {
				skipped += 1
				continue
			}
			const rendered = renderCmuxTemplate(templateText, {
				workspace: ws,
				cwd: wsPath,
				repository: projectConfig.repository,
				llmAssistant: projectConfig.llmAssistant,
				setupScripts,
				selectScripts,
			})
			writeFileSync(cfgPath, rendered, 'utf-8')
			written += 1
		}
	} else {
		// tmux
		const templatePath = join(projectDir, 'tmux.template.conf')
		if (!existsSync(templatePath)) return
		for (const ws of entries) {
			const wsPath = join(workspacesDir, ws)
			const cfgPath = join(wsPath, '.tmux.conf')
			if (existsSync(cfgPath)) {
				skipped += 1
				continue
			}
			copyFileSync(templatePath, cfgPath)
			written += 1
		}
	}

	logger.info(
		`Rendered ${written} worktree config file(s); skipped ${skipped} that already existed.`
	)
}

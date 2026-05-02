/**
 * cmux trust-directory flow.
 *
 * cmux prompts "untrusted directory" every time a `cmux.json` outside of
 * `customCommands.trustedDirectories` is loaded. We auto-append the
 * project path (once per project, tracked by a marker file) after
 * showing the user a diff and asking for confirmation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { promptConfirm } from '../utils/prompts.js'
import { logger } from '../utils/logger.js'
import { getProjectDir } from './config.js'

const TRUST_MARKER = '.cmux-trusted'

function primarySettingsPath(): string {
	return join(homedir(), '.config', 'cmux', 'settings.json')
}

function fallbackSettingsPath(): string {
	return join(
		homedir(),
		'Library',
		'Application Support',
		'com.cmuxterm.app',
		'settings.json'
	)
}

/**
 * Resolve the settings.json path we should read/write.
 * Returns the first path that exists; if neither exists, returns the
 * primary path (which the caller can create).
 */
function resolveSettingsPath(): string {
	const primary = primarySettingsPath()
	if (existsSync(primary)) return primary
	const fallback = fallbackSettingsPath()
	if (existsSync(fallback)) return fallback
	return primary
}

/**
 * Strip JSONC comments and trailing commas to produce strict JSON.
 * Mirrors the parser in cmux.ts — kept here to avoid a cross-module
 * import just for one helper.
 */
function stripJsonc(input: string): string {
	let out = ''
	let i = 0
	const n = input.length
	let inString = false
	let stringQuote = ''
	while (i < n) {
		const ch = input[i]
		if (inString) {
			out += ch
			if (ch === '\\' && i + 1 < n) {
				out += input[i + 1]
				i += 2
				continue
			}
			if (ch === stringQuote) inString = false
			i += 1
			continue
		}
		if (ch === '"' || ch === "'") {
			inString = true
			stringQuote = ch
			out += ch
			i += 1
			continue
		}
		if (ch === '/' && i + 1 < n) {
			const next = input[i + 1]
			if (next === '/') {
				i += 2
				while (i < n && input[i] !== '\n') i += 1
				continue
			}
			if (next === '*') {
				i += 2
				while (i + 1 < n && !(input[i] === '*' && input[i + 1] === '/')) i += 1
				i += 2
				continue
			}
		}
		out += ch
		i += 1
	}
	return out.replace(/,(\s*[}\]])/g, '$1')
}

function readExistingTrustedDirs(text: string): string[] | null {
	try {
		const parsed = JSON.parse(stripJsonc(text)) as {
			customCommands?: { trustedDirectories?: unknown }
		}
		const dirs = parsed?.customCommands?.trustedDirectories
		if (Array.isArray(dirs)) return dirs.filter((d): d is string => typeof d === 'string')
		return []
	} catch {
		return null
	}
}

/**
 * Find the character index of `]` that closes the first
 * `trustedDirectories` array. Returns -1 if we can't find it (caller
 * should fall back to the strict-JSON path).
 *
 * Uses a simple string-aware scan: tracks whether we're inside a JSON
 * string literal and counts `[`/`]` nesting so that `]` inside strings
 * or nested arrays doesn't confuse us.
 */
function findTrustedDirsArrayBounds(
	text: string
): { open: number; close: number } | null {
	const keyRe = /"trustedDirectories"\s*:\s*\[/
	const match = keyRe.exec(text)
	if (!match) return null
	const open = match.index + match[0].length - 1 // index of the opening [
	let i = open + 1
	let depth = 1
	let inString = false
	let stringQuote = ''
	while (i < text.length && depth > 0) {
		const ch = text[i]
		if (inString) {
			if (ch === '\\') {
				i += 2
				continue
			}
			if (ch === stringQuote) inString = false
			i += 1
			continue
		}
		if (ch === '"' || ch === "'") {
			inString = true
			stringQuote = ch
			i += 1
			continue
		}
		if (ch === '[') depth += 1
		else if (ch === ']') {
			depth -= 1
			if (depth === 0) return { open, close: i }
		}
		i += 1
	}
	return null
}

/**
 * Insert a new string entry at the end of the `trustedDirectories`
 * array, preserving surrounding whitespace style.
 *
 * Handles three cases:
 *  - array empty: insert `"<dir>"` directly between `[` and `]`.
 *  - array has trailing comma (common in JSONC): append `"<dir>"`
 *    using the existing separator style.
 *  - array has entries without trailing comma: add `, "<dir>"` using
 *    the surrounding separator style (newline+indent if multiline).
 */
function insertIntoTrustedDirs(
	text: string,
	newDir: string,
	bounds: { open: number; close: number }
): string {
	const contents = text.slice(bounds.open + 1, bounds.close)
	const encoded = JSON.stringify(newDir)

	const trimmed = contents.replace(/\s+$/, '')
	const trailingWhitespace = contents.slice(trimmed.length)

	let insert: string
	if (trimmed.length === 0) {
		insert = encoded
	} else if (trimmed.endsWith(',')) {
		// Already has a trailing comma; reuse it.
		insert = ` ${encoded}`
	} else {
		// Detect whether the array is multiline (has a newline before `]`)
		// so we can match style.
		if (trailingWhitespace.includes('\n')) {
			// Find the indentation used by existing items by looking at the
			// whitespace that follows a comma on a new line.
			const indentMatch = contents.match(/\n([ \t]+)"/)
			const indent = indentMatch ? indentMatch[1] : '  '
			insert = `,\n${indent}${encoded}`
		} else {
			insert = `, ${encoded}`
		}
	}

	return (
		text.slice(0, bounds.open + 1) +
		trimmed +
		insert +
		trailingWhitespace +
		text.slice(bounds.close)
	)
}

interface TrustResult {
	updated: boolean
	reason?: string
}

function defaultSettingsContent(projectPath: string): string {
	const obj = {
		$schema:
			'https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux-settings.schema.json',
		schemaVersion: 1,
		customCommands: {
			trustedDirectories: [projectPath],
		},
	}
	return JSON.stringify(obj, null, 2) + '\n'
}

/**
 * Rewrite `settings.json` to include `projectPath` in
 * `customCommands.trustedDirectories`, preserving JSONC if present.
 * Returns { updated: true } on success.
 */
function addTrustedDir(
	settingsPath: string,
	projectPath: string
): TrustResult {
	if (!existsSync(settingsPath)) {
		mkdirSync(dirname(settingsPath), { recursive: true })
		writeFileSync(settingsPath, defaultSettingsContent(projectPath), 'utf-8')
		return { updated: true }
	}

	const original = readFileSync(settingsPath, 'utf-8')

	// JSONC-preserving splice when the key already exists.
	const bounds = findTrustedDirsArrayBounds(original)
	if (bounds) {
		const next = insertIntoTrustedDirs(original, projectPath, bounds)
		writeFileSync(settingsPath, next, 'utf-8')
		return { updated: true }
	}

	// Key doesn't exist — fall back to a strict JSON rewrite. This loses
	// JSONC comments, so surface that in the reason so the caller can
	// warn the user.
	try {
		const parsed = JSON.parse(stripJsonc(original)) as Record<string, unknown>
		const cc = (parsed.customCommands as Record<string, unknown> | undefined) ?? {}
		const existing = Array.isArray(cc.trustedDirectories)
			? (cc.trustedDirectories as unknown[]).filter(
					(d): d is string => typeof d === 'string'
				)
			: []
		parsed.customCommands = {
			...cc,
			trustedDirectories: [...existing, projectPath],
		}
		writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
		return {
			updated: true,
			reason:
				'settings.json lacked customCommands.trustedDirectories; rewrote with strict JSON (comments, if any, were not preserved).',
		}
	} catch (err) {
		return {
			updated: false,
			reason: `could not parse ${settingsPath}: ${
				err instanceof Error ? err.message : 'unknown parse error'
			}`,
		}
	}
}

function printManualInstructions(
	settingsPath: string,
	projectPath: string
): void {
	logger.info('To add it manually, open:')
	logger.log(`  ${settingsPath}`)
	logger.log('and ensure it contains:')
	logger.log('')
	logger.log('  {')
	logger.log('    "customCommands": {')
	logger.log('      "trustedDirectories": [')
	logger.log(`        ${JSON.stringify(projectPath)}`)
	logger.log('      ]')
	logger.log('    }')
	logger.log('  }')
	logger.log('')
}

/**
 * Ensure the project path is in cmux's trusted-directories list.
 *
 * Runs at most once per project — skipped if the marker file at
 * `~/spaces/<project>/.cmux-trusted` exists. The marker is written
 * after a confirmed mutation OR when the settings.json already trusts
 * the project.
 */
export async function ensureCmuxTrust(projectName: string): Promise<void> {
	const projectDir = getProjectDir(projectName)
	const markerPath = join(projectDir, TRUST_MARKER)
	if (existsSync(markerPath)) return

	const settingsPath = resolveSettingsPath()

	// Short-circuit: if settings.json already trusts this directory, write
	// the marker and move on.
	if (existsSync(settingsPath)) {
		const text = readFileSync(settingsPath, 'utf-8')
		const existing = readExistingTrustedDirs(text)
		if (existing && existing.includes(projectDir)) {
			writeFileSync(markerPath, '', 'utf-8')
			return
		}
	}

	// Otherwise, show the diff and ask.
	logger.info(
		'cmux prompts on every untrusted cmux.json. spaces can add this project to its trusted list.'
	)
	logger.log('')
	logger.log('  customCommands.trustedDirectories:')
	logger.log(`    + ${JSON.stringify(projectDir)}`)
	logger.log('')
	logger.log(`  File: ${settingsPath}`)
	logger.log('')

	const confirmed = await promptConfirm('Apply this change?', true)
	if (!confirmed) {
		printManualInstructions(settingsPath, projectDir)
		return
	}

	const result = addTrustedDir(settingsPath, projectDir)
	if (!result.updated) {
		logger.warning(`Could not update ${settingsPath}: ${result.reason}`)
		printManualInstructions(settingsPath, projectDir)
		return
	}
	if (result.reason) {
		logger.warning(result.reason)
	}
	writeFileSync(markerPath, '', 'utf-8')
	logger.success(`Added ${projectDir} to cmux trusted directories.`)
}

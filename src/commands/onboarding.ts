/**
 * Onboarding command implementation
 * Handles first-time setup wizard for Spaces CLI
 */

import { logger } from '../utils/logger.js'
import { selectItem, promptConfirm } from '../utils/prompts.js'
import {
	getAvailableBackendIds,
	isBackendAvailable,
} from '../multiplexers/registry.js'
import { setMultiplexerPreference } from '../core/config.js'
import { addProject } from './add.js'
import type { MultiplexerId } from '../types/config.js'

/**
 * Run the first-time onboarding wizard
 * Prompts user to configure multiplexer preference and optionally create first project
 */
export async function runOnboarding(): Promise<void> {
	logger.log('')

	// Ask if user wants to configure or skip
	const shouldConfigure = await promptConfirm(
		'Would you like to configure Spaces now?',
		true
	)

	if (!shouldConfigure) {
		logger.log('\nUsing defaults (auto-detect multiplexer).')
		logger.log('You can configure later with: spaces config\n')
		return
	}

	// Step 1: Multiplexer selection
	const multiplexer = await selectMultiplexer()

	// User may have cancelled
	if (multiplexer === undefined) {
		logger.log('\nUsing defaults (auto-detect multiplexer).\n')
		return
	}

	setMultiplexerPreference(multiplexer)

	if (multiplexer) {
		logger.success(`Multiplexer set to: ${multiplexer}`)
	} else {
		logger.success('Multiplexer set to: auto-detect')
	}

	// Step 2: Offer to create first project
	logger.log('')
	const createProject = await promptConfirm(
		'Would you like to create your first project now?',
		true
	)

	if (createProject) {
		await addProject({})
	} else {
		logger.log('\nYou can create a project later with: spaces add project\n')
	}
}

/**
 * Interactive multiplexer selection
 * Shows available backends with installation status
 */
async function selectMultiplexer(): Promise<MultiplexerId | undefined> {
	const backendIds = getAvailableBackendIds()

	// Build options list with availability indicators
	const options: string[] = ['Auto-detect (recommended)']

	for (const id of backendIds) {
		const available = await isBackendAvailable(id)
		const status = available ? ' (installed)' : ' (not installed)'
		options.push(`${id}${status}`)
	}

	const selected = await selectItem(
		options,
		'Which terminal multiplexer would you like to use?'
	)

	if (!selected) {
		// User cancelled
		return undefined
	}

	// Parse selection to extract multiplexer ID
	if (selected.startsWith('Auto-detect')) {
		return null
	}

	const match = selected.match(/^(\w+)/)
	if (match) {
		const choice = match[1]
		return choice as MultiplexerId
	}

	return null
}

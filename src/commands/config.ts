/**
 * Config command implementation
 * Handles 'spaces config' for managing CLI configuration
 */

import {
	readGlobalConfig,
	updateGlobalConfig,
	setMultiplexerPreference,
	getMultiplexerPreference,
} from '../core/config.js'
import {
	getBackend,
	getAvailableBackendIds,
	isBackendAvailable,
} from '../multiplexers/index.js'
import { logger } from '../utils/logger.js'
import { selectItem, promptInput } from '../utils/prompts.js'
import { isValidMultiplexerId } from '../types/config.js'
import type { MultiplexerId } from '../types/config.js'

/**
 * Show current configuration and allow editing
 */
export async function showConfig(): Promise<void> {
	const globalConfig = readGlobalConfig()
	const currentBackend = await getBackend(globalConfig.multiplexer)

	logger.bold('Current Configuration:')
	logger.log('')
	logger.log(`  Current Project: ${globalConfig.currentProject || '(none)'}`)
	logger.log(`  Projects Directory: ${globalConfig.projectsDir}`)
	logger.log(`  Default Base Branch: ${globalConfig.defaultBaseBranch}`)
	logger.log(`  Stale Days: ${globalConfig.staleDays}`)
	logger.log('')
	logger.bold('Multiplexer:')
	logger.log(
		`  Preference: ${globalConfig.multiplexer || 'auto-detect'}`
	)
	logger.log(`  Active Backend: ${currentBackend.displayName}`)
	logger.log('')

	// Show edit menu
	const options = [
		`Default Base Branch (${globalConfig.defaultBaseBranch})`,
		`Stale Days (${globalConfig.staleDays})`,
		`Multiplexer (${globalConfig.multiplexer || 'auto-detect'})`,
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

/**
 * Set multiplexer preference
 */
export async function setMultiplexer(
	multiplexerArg?: string
): Promise<void> {
	const backendIds = getAvailableBackendIds()
	const currentPreference = getMultiplexerPreference()

	let selectedMultiplexer: MultiplexerId

	if (multiplexerArg) {
		// Validate the argument
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
		const options: string[] = ['auto (detect best available)']

		// Add available backends with availability status
		for (const id of backendIds) {
			const available = await isBackendAvailable(id)
			const status = available ? '' : ' (not installed)'
			const current = id === currentPreference ? ' (current)' : ''
			options.push(`${id}${status}${current}`)
		}

		const selected = await selectItem(
			options,
			'Select multiplexer preference:'
		)

		if (!selected) {
			logger.info('Cancelled')
			return
		}

		// Parse selection
		const match = selected.match(/^(\w+)/)
		if (match) {
			const choice = match[1]
			if (choice === 'auto') {
				selectedMultiplexer = null
			} else if (isValidMultiplexerId(choice)) {
				selectedMultiplexer = choice
			} else {
				return
			}
		} else {
			return
		}
	}

	// Check if the selected backend is available
	if (selectedMultiplexer && !(await isBackendAvailable(selectedMultiplexer))) {
		logger.warning(
			`${selectedMultiplexer} is not installed. It will fall back to an available option.`
		)
	}

	// Save preference
	setMultiplexerPreference(selectedMultiplexer)

	if (selectedMultiplexer) {
		logger.success(`Multiplexer set to: ${selectedMultiplexer}`)
	} else {
		logger.success('Multiplexer set to: auto-detect')
	}

	// Show what will actually be used
	const backend = await getBackend(selectedMultiplexer)
	if (selectedMultiplexer !== backend.id && selectedMultiplexer !== null) {
		logger.info(`Will use ${backend.displayName} (${selectedMultiplexer} not available)`)
	}
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

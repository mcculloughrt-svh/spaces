/**
 * Linear API integration for issue management
 * Note: @linear/sdk is lazy-loaded to improve CLI startup time
 */

import { SpacesError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import type { LinearIssue } from '../types/workspace.js'

// Lazy-loaded types
type LinearClient = InstanceType<typeof import('@linear/sdk').LinearClient>
type Issue = Awaited<ReturnType<LinearClient['issues']>>['nodes'][number]
type LinearError = InstanceType<typeof import('@linear/sdk').LinearError>

/**
 * Singleton Linear client instance
 */
let clientInstance: LinearClient | null = null

/**
 * Get or create Linear client instance
 */
async function getLinearClient(apiKey: string): Promise<LinearClient> {
	if (!clientInstance) {
		const { LinearClient } = await import('@linear/sdk')
		clientInstance = new LinearClient({ apiKey })
	}
	return clientInstance
}

/**
 * Reset the Linear client (useful when API key changes)
 */
export function resetLinearClient(): void {
	clientInstance = null
}

/**
 * Custom error class for Linear API errors
 */
export class LinearAPIError extends SpacesError {
	constructor(message: string, originalError?: unknown) {
		super(message, 'SERVICE_ERROR', 3)
		this.name = 'LinearAPIError'

		if (originalError) {
			logger.debug(`Linear API error: ${originalError}`)
		}
	}
}

/**
 * Check if an error is a LinearError
 */
async function isLinearError(error: unknown): Promise<boolean> {
	const { LinearError } = await import('@linear/sdk')
	return error instanceof LinearError
}

/**
 * Retry a function with exponential backoff
 */
async function fetchWithRetry<T>(
	fetchFn: () => Promise<T>,
	maxRetries = 3
): Promise<T> {
	let lastError: unknown

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fetchFn()
		} catch (error: unknown) {
			lastError = error

			// Check if it's a retryable error (429 or 5xx)
			let shouldRetry = false
			let statusCode: number | undefined

			if (await isLinearError(error)) {
				// @ts-ignore - response may or may not have status
				statusCode = (error as { response?: { status?: number } }).response?.status
			}

			if (statusCode === 429 || (statusCode && statusCode >= 500)) {
				shouldRetry = true
			}

			if (shouldRetry && attempt < maxRetries - 1) {
				// Exponential backoff: 200ms, 400ms, 800ms
				const delay = 200 * Math.pow(2, attempt)
				await new Promise((resolve) => setTimeout(resolve, delay))
				continue
			}

			throw error
		}
	}

	throw lastError
}

/**
 * Fetch all pages from a paginated Linear SDK response
 */
async function fetchAllPages<T extends { id: string }>(initialPage: {
	nodes: T[]
	pageInfo: { hasNextPage: boolean }
	fetchNext?: () => Promise<{ nodes: T[]; pageInfo: { hasNextPage: boolean } }>
}): Promise<T[]> {
	const allItems: T[] = []
	const seenIds = new Set<string>()
	let currentPage = initialPage

	while (true) {
		// Add unique items
		for (const item of currentPage.nodes) {
			if (!seenIds.has(item.id)) {
				seenIds.add(item.id)
				allItems.push(item)
			}
		}

		if (!currentPage.pageInfo.hasNextPage || !currentPage.fetchNext) {
			break
		}

		currentPage = await currentPage.fetchNext()
	}

	return allItems
}

/**
 * Fetch unstarted issues from Linear
 * @param apiKey Linear API key
 * @param teamKey Optional team key to filter by (e.g., "ENG")
 * @returns Array of unstarted issues
 */
export async function fetchUnstartedIssues(
	apiKey: string,
	teamKey?: string
): Promise<LinearIssue[]> {
	try {
		return await fetchWithRetry(async () => {
			const client = await getLinearClient(apiKey)

			// Build filter for unstarted issues
			const filter = {
				state: { type: { eq: 'unstarted' } },
			}

			let linearIssues: Issue[]

			if (teamKey) {
				// Fetch team first
				const teamsConnection = await client.teams({
					filter: { key: { eq: teamKey } },
				})

				const team = teamsConnection.nodes[0]

				if (!team) {
					throw new LinearAPIError(`Team with key "${teamKey}" not found`)
				}

				// Fetch issues for the team
				const issuesConnection = await team.issues({ filter })
				linearIssues = await fetchAllPages(issuesConnection)
			} else {
				// Fetch all unstarted issues
				const issuesConnection = await client.issues({ filter })
				linearIssues = await fetchAllPages(issuesConnection)
			}

			const convertedIssues: LinearIssue[] = []
			for (let i = 0; i < linearIssues.length; i++) {
				const issue = linearIssues[i]

				// Create a lazy function for attachments (only fetched when called)
				const attachments = async () => {
					const attachmentsConnection = await issue.attachments()
					const linearAttachments = await fetchAllPages(attachmentsConnection)

					// Convert to our attachment format
					return linearAttachments.map((att) => ({
						id: att.id,
						url: att.url,
						title: att.title ?? null,
						sourceType: att.sourceType ?? null,
						createdAt: att.createdAt,
					}))
				}

				convertedIssues.push({
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.description ?? null,
					state: issue.state,
					url: issue.url,
					assignee: issue.assignee,
					createdAt: issue.createdAt,
					updatedAt: issue.updatedAt,
					attachments,
				})
			}

			return convertedIssues
		})
	} catch (error) {
		if (error instanceof LinearAPIError) {
			throw error
		}

		if (await isLinearError(error)) {
			throw new LinearAPIError(`Linear API error: ${(error as Error).message}`, error)
		}

		throw new LinearAPIError(
			`Failed to fetch Linear issues: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
			error
		)
	}
}

/**
 * Validate a Linear API key
 */
export async function validateLinearApiKey(apiKey: string): Promise<boolean> {
	try {
		const { LinearClient } = await import('@linear/sdk')
		const testClient = new LinearClient({ apiKey })
		await testClient.viewer
		return true
	} catch {
		return false
	}
}

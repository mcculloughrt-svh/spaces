/**
 * Type definitions for Spaces CLI configuration
 */

/** Available multiplexer backend IDs */
export type MultiplexerId = 'tmux' | 'zellij' | 'shell' | 'cmux' | null;

/** Valid multiplexer IDs (excluding null/auto-detect) */
const VALID_MULTIPLEXER_IDS = ['tmux', 'zellij', 'shell', 'cmux'] as const;

/**
 * Type guard to check if a value is a valid multiplexer ID
 */
export function isValidMultiplexerId(value: string): value is Exclude<MultiplexerId, null> {
  return VALID_MULTIPLEXER_IDS.includes(value as any);
}

/**
 * Detected terminal context used to route multiplexer preference.
 * 'cmux' wins when CMUX_WORKSPACE_ID is set (even though cmux uses
 * libghostty and may still expose Ghostty-looking env vars).
 * 'ghostty' is Ghostty-proper. 'default' is everything else.
 */
export type TerminalContext = 'cmux' | 'ghostty' | 'default';

/** Valid terminal contexts */
const VALID_TERMINAL_CONTEXTS = ['cmux', 'ghostty', 'default'] as const;

/**
 * Type guard for terminal context strings.
 */
export function isValidTerminalContext(value: string): value is TerminalContext {
  return VALID_TERMINAL_CONTEXTS.includes(value as TerminalContext);
}

/**
 * Terminal → multiplexer preference map. Any key may be omitted; the
 * resolver falls back to `default`, then to the legacy single-preference
 * field on GlobalConfig.
 */
export interface TerminalMultiplexerMap {
  cmux?: MultiplexerId;
  ghostty?: MultiplexerId;
  default?: MultiplexerId;
}

/**
 * Global configuration stored in ~/spaces/.config.json
 */
export interface GlobalConfig {
  /** Name of the currently active project */
  currentProject: string | null;
  /** Path to the projects directory (default: ~/spaces) */
  projectsDir: string;
  /** Default base branch for new projects (default: "main") */
  defaultBaseBranch: string;
  /** Number of days before a workspace is considered stale (default: 30) */
  staleDays: number;
  /**
   * Legacy single-preference multiplexer field. Still honored as a
   * fallback when no entry in `multiplexerByTerminal` matches the
   * detected terminal context. New installs should use
   * `multiplexerByTerminal` instead.
   */
  multiplexer: MultiplexerId;
  /**
   * Per-terminal multiplexer preferences. Resolution order when a
   * `spaces` command runs:
   *   1. If the detected terminal context has an entry, use it.
   *   2. Else if `default` is set, use it.
   *   3. Else fall back to the legacy `multiplexer` field.
   *   4. Else auto-detect.
   * Undefined (the whole field missing) keeps legacy single-pref behavior.
   */
  multiplexerByTerminal?: TerminalMultiplexerMap;
}

/**
 * Project-specific configuration stored in ~/spaces/{PROJECT_NAME}/.config.json
 */
export interface ProjectConfig {
  /** Project name */
  name: string;
  /** GitHub repository in owner/repo format */
  repository: string;
  /** Base branch for creating worktrees */
  baseBranch: string;
  /** Optional Linear API key for issue integration */
  linearApiKey?: string;
  /** Optional Linear team key for filtering issues (e.g., "ENG") */
  linearTeamKey?: string;
  /** Optional LLM assistant command to run in tmux (e.g., "claude", "aider") */
  llmAssistant?: string;
  /** ISO timestamp when project was created */
  createdAt: string;
  /** ISO timestamp when project was last accessed */
  lastAccessed: string;
}

/**
 * Default global configuration values
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  currentProject: null,
  projectsDir: '', // Will be set to ~/spaces at runtime
  defaultBaseBranch: 'main',
  staleDays: 30,
  multiplexer: null, // Auto-detect
};

/**
 * Create default project configuration
 */
export function createDefaultProjectConfig(
  name: string,
  repository: string,
  baseBranch: string,
  linearApiKey?: string,
  linearTeamKey?: string,
  llmAssistant?: string
): ProjectConfig {
  const now = new Date().toISOString();
  return {
    name,
    repository,
    baseBranch,
    linearApiKey,
    linearTeamKey,
    llmAssistant,
    createdAt: now,
    lastAccessed: now,
  };
}

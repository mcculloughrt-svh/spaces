/**
 * Type definitions for Spaces CLI configuration
 */

/**
 * Stack metadata for tracking parent-child relationships between workspaces
 */
export interface StackMetadata {
  /** Name of the parent workspace this is based on */
  basedOn: string;
  /** Name of the parent branch */
  baseBranch: string;
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
  /** Stack metadata for tracking workspace relationships */
  stacks?: Record<string, StackMetadata>;
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

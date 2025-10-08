/**
 * Add command implementation
 * Handles both 'spaces add project' and 'spaces add [workspace-name]'
 */

import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  readGlobalConfig,
  readProjectConfig,
  createProject,
  setCurrentProject,
  getProjectBaseDir,
  getProjectWorkspacesDir,
  getProjectDir,
  getCurrentProject,
  getAllProjectNames,
  projectExists,
  getScriptsPhaseDir,
} from '../core/config.js';
import { checkGitHubAuth, ensureDependencies } from '../utils/deps.js';
import { selectItem, promptConfirm, promptPassword, promptInput } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { listAllRepos, cloneRepository } from '../core/github.js';
import {
  getDefaultBranch,
  createWorktree,
  checkRemoteBranch,
  listRemoteBranches,
} from '../core/git.js';
import { createOrAttachSession } from '../core/tmux.js';
import { fetchUnstartedIssues } from '../core/linear.js';
import {
  sanitizeForFileSystem,
  generateWorkspaceName,
  isValidWorkspaceName,
  extractRepoName,
} from '../utils/sanitize.js';
import {
  SpacesError,
  NoProjectError,
  ProjectExistsError,
  WorkspaceExistsError,
} from '../types/errors.js';
import type { CreateWorkspaceOptions } from '../types/workspace.js';
import { runScriptsInTerminal } from '../utils/run-scripts.js';
import { hasSetupBeenRun } from '../utils/workspace-state.js';
import { generateMarkdown } from '../utils/markdown.js';

/**
 * Add a new project
 */
export async function addProject(options: {
  noClone?: boolean;
  org?: string;
  linearKey?: string;
}): Promise<void> {
  // Check dependencies
  await ensureDependencies();
  await checkGitHubAuth();

  // List all GitHub repositories
  logger.info('Fetching repositories...');
  const repos = await listAllRepos(options.org);

  if (repos.length === 0) {
    throw new SpacesError(
      'No repositories found',
      'USER_ERROR',
      1
    );
  }

  // Select repository
  const selectedRepo = await selectItem(repos, 'Select a repository:');

  if (!selectedRepo) {
    logger.info('Cancelled');
    return;
  }

  logger.success(`Selected: ${selectedRepo}`);

  // Extract repo name for project directory
  const projectName = extractRepoName(selectedRepo);

  // Check if project already exists
  if (projectExists(projectName)) {
    throw new ProjectExistsError(
      projectName,
      getProjectBaseDir(projectName)
    );
  }

  // Check for duplicate repositories
  const existingProjects = getAllProjectNames();
  for (const existingProject of existingProjects) {
    const existingConfig = readProjectConfig(existingProject);
    if (existingConfig.repository === selectedRepo) {
      throw new SpacesError(
        `Repository ${selectedRepo} is already tracked by project "${existingProject}"\n\nTo use that project:\n  spaces switch project ${existingProject}`,
        'USER_ERROR',
        1
      );
    }
  }

  // Clone the repository unless --no-clone
  const baseDir = getProjectBaseDir(projectName);

  if (!options.noClone) {
    logger.info(`Cloning to ${baseDir}...`);
    await cloneRepository(selectedRepo, baseDir);
    logger.success(`Cloned to ${baseDir}`);
  }

  // Detect default branch
  const baseBranch = await getDefaultBranch(baseDir);
  logger.debug(`Detected default branch: ${baseBranch}`);

  // Ask about Linear integration
  const useLinear = await promptConfirm('Does this project use Linear?', false);

  let linearApiKey: string | undefined;
  let linearTeamKey: string | undefined;

  if (useLinear) {
    if (!options.linearKey) {
      linearApiKey = await promptPassword('Enter Linear API key:') || undefined;
    } else {
      linearApiKey = options.linearKey;
    }

    linearTeamKey = await promptInput('Enter Linear team key (optional, e.g., ENG):') || undefined;
  }

  // Ask about LLM assistant in tmux
  const useLlmAssistant = await promptConfirm('Do you want an LLM assistant in tmux?', false);

  let llmAssistant: string | undefined;

  if (useLlmAssistant) {
    llmAssistant = await promptInput('Enter the command to run (e.g., "claude", "aider", "codex"):') || undefined;
  }

  // Create project configuration
  createProject(
    projectName,
    selectedRepo,
    baseBranch,
    linearApiKey,
    linearTeamKey,
    llmAssistant
  );

  logger.success(`Project '${projectName}' created`);

  // Set as current project
  setCurrentProject(projectName);
  logger.success('Set as current project');

  // Print environment variable suggestion
  logger.log('\nAdd this to your shell profile to persist:');
  logger.command(`  export SPACES_CURRENT_PROJECT="${projectName}"`);
}

/**
 * Add a new workspace
 */
export async function addWorkspace(
  workspaceNameArg?: string,
  options: Partial<CreateWorkspaceOptions> = {}
): Promise<void> {
  // Get current project
  const currentProject = getCurrentProject();
  if (!currentProject) {
    throw new NoProjectError();
  }

  const projectConfig = readProjectConfig(currentProject);
  const baseDir = getProjectBaseDir(currentProject);
  const workspacesDir = getProjectWorkspacesDir(currentProject);

  let workspaceName: string;
  let branchName: string;

  let existsRemotely = false;
  let selectedLinearIssue: Awaited<ReturnType<typeof fetchUnstartedIssues>>[0] | undefined;

  if (workspaceNameArg) {
    // Workspace name provided as argument
    if (!isValidWorkspaceName(workspaceNameArg)) {
      throw new SpacesError(
        `Invalid workspace name: ${workspaceNameArg}\nWorkspace names must contain only alphanumeric characters, hyphens, and underscores.`,
        'USER_ERROR',
        1
      );
    }

    workspaceName = workspaceNameArg;
    branchName = options.branchName || workspaceName;
  } else {
    // No workspace name provided, prompt for source
    const sourceOptions = ['Create from GitHub branch', 'Create with manual name'];

    // Add Linear option if configured
    if (projectConfig.linearApiKey) {
      sourceOptions.splice(1, 0, 'Create from Linear issue');
    }

    const source = await selectItem(sourceOptions, 'How would you like to create the workspace?');

    if (!source) {
      logger.info('Cancelled');
      return;
    }

    if (source === 'Create from GitHub branch') {
      // List remote branches
      logger.info('Fetching remote branches...');
      const allBranches = await listRemoteBranches(baseDir);

      // Filter out the base branch
      const branches = allBranches.filter((branch) => branch !== projectConfig.baseBranch);

      if (branches.length === 0) {
        throw new SpacesError(
          `No remote branches found (excluding base branch ${projectConfig.baseBranch})`,
          'USER_ERROR',
          1
        );
      }

      const selectedBranch = await selectItem(branches, 'Select a branch:');

      if (!selectedBranch) {
        logger.info('Cancelled');
        return;
      }

      // Use branch name as workspace name (sanitize for workspace naming)
      workspaceName = selectedBranch.replace(/\//g, '-');
      branchName = selectedBranch;
      existsRemotely = true; // We know it exists remotely
    } else if (source === 'Create from Linear issue') {
      // Fetch unstarted issues from Linear
      logger.info('Fetching Linear issues...');

      const issues = await fetchUnstartedIssues(
        projectConfig.linearApiKey!,
        projectConfig.linearTeamKey
      );

      if (issues.length === 0) {
        throw new SpacesError(
          'No unstarted Linear issues found',
          'USER_ERROR',
          1
        );
      }

      // Format for selection
      const issueOptions = issues.map(
        (issue) => `${issue.identifier} - ${issue.title}`
      );

      const selectedIssueString = await selectItem(issueOptions, 'Select an issue:');

      if (!selectedIssueString) {
        logger.info('Cancelled');
        return;
      }

      // Find the corresponding LinearIssue object
      const [identifier] = selectedIssueString.split(' - ');
      selectedLinearIssue = issues.find(issue => issue.identifier === identifier);

      if (!selectedLinearIssue) {
        throw new SpacesError(
          `Failed to find Linear issue with identifier ${identifier}`,
          'SYSTEM_ERROR',
          2
        );
      }

      // Generate workspace name
      workspaceName = generateWorkspaceName(selectedLinearIssue.identifier, selectedLinearIssue.title);
      branchName = options.branchName || workspaceName;
    } else {
      // Manual entry
      const name = await promptInput('Enter workspace name:', {
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Workspace name is required';
          }
          if (!isValidWorkspaceName(input)) {
            return 'Workspace name must contain only alphanumeric characters, hyphens, and underscores';
          }
          return true;
        },
      });

      if (!name) {
        logger.info('Cancelled');
        return;
      }

      workspaceName = name;
      branchName = options.branchName || workspaceName;
    }
  }

  const workspacePath = join(workspacesDir, workspaceName);

  // Check if workspace already exists
  if (existsSync(workspacePath)) {
    throw new WorkspaceExistsError(workspaceName);
  }

  logger.info(`Creating workspace: ${workspaceName}`);

  // Check if branch exists remotely (if we don't already know)
  if (!existsRemotely) {
    existsRemotely = await checkRemoteBranch(baseDir, branchName);

    if (existsRemotely) {
      // Prompt user
      const pullRemote = await promptConfirm(`Branch '${branchName}' exists on remote. Pull it down?`, true);

      if (!pullRemote) {
        logger.info('Cancelled');
        return;
      }
    }
  }

  // Create worktree
  const baseBranch = options.fromBranch || projectConfig.baseBranch;
  await createWorktree(
    baseDir,
    workspacePath,
    branchName,
    baseBranch,
    existsRemotely
  );

  logger.success(`Created worktree from ${baseBranch}`);

  // Copy tmux template if it exists
  const projectDir = getProjectDir(currentProject);
  const tmuxTemplatePath = join(projectDir, 'tmux.template.conf');
  const tmuxConfPath = join(workspacePath, '.tmux.conf');

  if (existsSync(tmuxTemplatePath)) {
    copyFileSync(tmuxTemplatePath, tmuxConfPath);
    logger.debug(`Copied tmux.template.conf to workspace .tmux.conf`);
  }

  // If workspace was created from a Linear issue, save issue details as markdown
  if (selectedLinearIssue) {
    const promptDir = join(workspacePath, '.prompt');
    mkdirSync(promptDir, { recursive: true });

    const markdown = await generateMarkdown(selectedLinearIssue, promptDir, projectConfig.linearApiKey);
    const issueMarkdownPath = join(promptDir, 'issue.md');
    writeFileSync(issueMarkdownPath, markdown, 'utf-8');

    logger.debug('Saved Linear issue details to .prompt/issue.md');
  }

  // Check if this is first-time setup (no marker exists)
  const isFirstTime = !hasSetupBeenRun(workspacePath);

  // Run pre scripts if this is the first time (before tmux/setup)
  if (isFirstTime && !options.noSetup) {
    const preScriptsDir = getScriptsPhaseDir(currentProject, 'pre');
    await runScriptsInTerminal(preScriptsDir, workspacePath, workspaceName, projectConfig.repository);
  }

  // Create/attach tmux session unless --no-tmux
  if (!options.noTmux) {
    logger.success(`Creating tmux session: ${workspaceName}`);
    await createOrAttachSession(
      workspaceName,
      workspacePath,
      currentProject,
      projectConfig.repository,
      options.noSetup || false
    );
  } else {
    logger.success(`Workspace created at: ${workspacePath}`);
    logger.log(`\nTo navigate:\n  cd ${workspacePath}`);
  }
}

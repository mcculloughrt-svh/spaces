/**
 * Switch command implementation
 * Handles both 'spaces switch project' and 'spaces switch [workspace-name]'
 */

import { existsSync, readdirSync } from 'fs';
import {
  readGlobalConfig,
  readProjectConfig,
  setCurrentProject,
  getAllProjectNames,
  getCurrentProject,
  getProjectWorkspacesDir,
} from '../core/config.js';
import { selectItem } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { createOrAttachSession } from '../core/tmux.js';
import { getWorktreeInfo } from '../core/git.js';
import { SpacesError, NoProjectError } from '../types/errors.js';
import { join } from 'path';
import { runCommandsInTerminal } from '../utils/run-commands.js';

/**
 * Switch to a different project
 */
export async function switchProject(projectNameArg?: string): Promise<void> {
  const allProjects = getAllProjectNames();

  if (allProjects.length === 0) {
    throw new SpacesError(
      'No projects found\n\nCreate a project first:\n  spaces add project',
      'USER_ERROR',
      1
    );
  }

  let projectName: string;

  if (projectNameArg) {
    // Project name provided as argument
    if (!allProjects.includes(projectNameArg)) {
      throw new SpacesError(
        `Project "${projectNameArg}" not found`,
        'USER_ERROR',
        1
      );
    }
    projectName = projectNameArg;
  } else {
    // Select project using fzf
    const currentProject = getCurrentProject();
    const projectOptions = allProjects.map((name) => {
      const config = readProjectConfig(name);
      const indicator = name === currentProject ? ' (current)' : '';
      return `${name} - ${config.repository}${indicator}`;
    });

    const selected = await selectItem(projectOptions, 'Select project:');

    if (!selected) {
      logger.info('Cancelled');
      return;
    }

    // Extract project name from selection
    projectName = selected.split(' - ')[0];
  }

  // Set as current project
  setCurrentProject(projectName);
  logger.success(`Switched to project: ${projectName}`);

  // Print environment variable suggestion
  logger.log('\nUpdate your environment:');
  logger.command(`  export SPACES_CURRENT_PROJECT="${projectName}"`);
}

/**
 * Switch to a workspace in the current project
 */
export async function switchWorkspace(
  workspaceNameArg?: string,
  options: {
    noTmux?: boolean;
    newWindow?: boolean;
  } = {}
): Promise<void> {
  // Get current project
  const currentProject = getCurrentProject();
  if (!currentProject) {
    throw new NoProjectError();
  }

  const projectConfig = readProjectConfig(currentProject);
  const workspacesDir = getProjectWorkspacesDir(currentProject);

  // Check if workspaces directory exists
  if (!existsSync(workspacesDir)) {
    throw new SpacesError(
      `No workspaces found in project "${currentProject}"\n\nCreate a workspace first:\n  spaces add`,
      'USER_ERROR',
      1
    );
  }

  // Get all workspace directories
  const workspaces = readdirSync(workspacesDir).filter((entry) => {
    const path = join(workspacesDir, entry);
    return existsSync(path) && readdirSync(path).length > 0; // Not empty
  });

  if (workspaces.length === 0) {
    throw new SpacesError(
      `No workspaces found in project "${currentProject}"\n\nCreate a workspace first:\n  spaces add`,
      'USER_ERROR',
      1
    );
  }

  let workspaceName: string;

  if (workspaceNameArg) {
    // Workspace name provided as argument
    if (!workspaces.includes(workspaceNameArg)) {
      throw new SpacesError(
        `Workspace "${workspaceNameArg}" not found`,
        'USER_ERROR',
        1
      );
    }
    workspaceName = workspaceNameArg;
  } else {
    // Get workspace info for display
    const workspaceOptions: string[] = [];

    for (const workspace of workspaces) {
      const workspacePath = join(workspacesDir, workspace);
      const info = await getWorktreeInfo(workspacePath);

      if (info) {
        const statusParts: string[] = [];

        // Add ahead/behind info
        if (info.ahead > 0 || info.behind > 0) {
          statusParts.push(`[${info.branch} +${info.ahead} -${info.behind}]`);
        } else {
          statusParts.push(`[${info.branch}]`);
        }

        // Add uncommitted changes
        if (info.uncommittedChanges > 0) {
          statusParts.push(`${info.uncommittedChanges} uncommitted`);
        } else {
          statusParts.push('clean');
        }

        const display = `${workspace.padEnd(30)} ${statusParts.join(' ')}`;
        workspaceOptions.push(display);
      } else {
        workspaceOptions.push(workspace);
      }
    }

    const selected = await selectItem(workspaceOptions, 'Select workspace:');

    if (!selected) {
      logger.info('Cancelled');
      return;
    }

    // Extract workspace name (first part before padding)
    workspaceName = selected.split(/\s+/)[0];
  }

  const workspacePath = join(workspacesDir, workspaceName);

  // Switch to workspace
  if (options.noTmux) {
    logger.success(`Workspace: ${workspacePath}`);
    logger.log(`\nTo navigate:\n  cd ${workspacePath}`);
  } else {
    // Create or attach to tmux session
    await createOrAttachSession(
      workspaceName,
      workspacePath,
      currentProject,
      projectConfig.repository,
      false // never skip setup on switch
    );
  }
}

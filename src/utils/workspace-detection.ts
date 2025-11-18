import { existsSync } from 'fs';
import { join, relative } from 'path';
import { getCurrentProject } from '../core/config.js';
import { getProjectWorkspacesDir } from '../core/config.js';
import { getWorktreeInfo } from '../core/git.js';

export interface CurrentWorkspaceInfo {
  workspaceName: string;
  workspacePath: string;
  branch: string;
  projectName: string;
}

/**
 * Detects if the current working directory is within a workspace.
 * Returns workspace information if found, null otherwise.
 */
export async function getCurrentWorkspace(): Promise<CurrentWorkspaceInfo | null> {
  try {
    const cwd = process.cwd();
    const projectName = await getCurrentProject();

    if (!projectName) {
      return null;
    }

    const workspacesDir = getProjectWorkspacesDir(projectName);

    // Check if cwd is within the workspaces directory
    const relativePath = relative(workspacesDir, cwd);

    // If relativePath starts with '..' or is absolute, we're not in a workspace
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
      return null;
    }

    // Extract workspace name (first segment of relative path)
    const workspaceName = relativePath.split('/')[0];

    if (!workspaceName) {
      return null;
    }

    const workspacePath = join(workspacesDir, workspaceName);

    // Verify workspace exists
    if (!existsSync(workspacePath)) {
      return null;
    }

    // Get branch information
    const worktreeInfo = await getWorktreeInfo(workspacePath);

    if (!worktreeInfo) {
      return null;
    }

    return {
      workspaceName,
      workspacePath,
      branch: worktreeInfo.branch,
      projectName,
    };
  } catch {
    return null;
  }
}

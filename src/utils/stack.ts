import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { StackMetadata } from '../types/config.js';
import {
  readProjectConfig,
  writeProjectConfig,
  getProjectWorkspacesDir,
} from '../core/config.js';
import { getWorktreeInfo } from '../core/git.js';

/**
 * Get stack metadata for a specific workspace
 */
export function getStackMetadata(
  projectName: string,
  workspaceName: string
): StackMetadata | null {
  const config = readProjectConfig(projectName);
  return config.stacks?.[workspaceName] || null;
}

/**
 * Set stack metadata for a workspace
 */
export function setStackMetadata(
  projectName: string,
  workspaceName: string,
  metadata: StackMetadata
): void {
  const config = readProjectConfig(projectName);

  if (!config.stacks) {
    config.stacks = {};
  }

  config.stacks[workspaceName] = metadata;
  writeProjectConfig(projectName, config);
}

/**
 * Remove stack metadata for a workspace
 */
export function removeStackMetadata(
  projectName: string,
  workspaceName: string
): void {
  const config = readProjectConfig(projectName);

  if (config.stacks) {
    delete config.stacks[workspaceName];
    writeProjectConfig(projectName, config);
  }
}

/**
 * Get all child workspaces (dependents) of a given workspace
 */
export function getStackChildren(
  projectName: string,
  workspaceName: string
): string[] {
  const config = readProjectConfig(projectName);

  if (!config.stacks) {
    return [];
  }

  const children: string[] = [];

  for (const [childName, metadata] of Object.entries(config.stacks)) {
    if (metadata.basedOn === workspaceName) {
      children.push(childName);
    }
  }

  return children;
}

/**
 * Get parent workspace information
 */
export function getStackParent(
  projectName: string,
  workspaceName: string
): { workspaceName: string; branch: string } | null {
  const metadata = getStackMetadata(projectName, workspaceName);

  if (!metadata) {
    return null;
  }

  return {
    workspaceName: metadata.basedOn,
    branch: metadata.baseBranch,
  };
}

/**
 * Stack tree node for visualization
 */
export interface StackTreeNode {
  workspaceName: string;
  branch: string;
  children: StackTreeNode[];
  depth: number;
}

/**
 * Build a tree structure of all workspace stacks
 */
export async function getStackTree(projectName: string): Promise<StackTreeNode[]> {
  const config = readProjectConfig(projectName);
  const workspacesDir = getProjectWorkspacesDir(projectName);

  if (!existsSync(workspacesDir)) {
    return [];
  }

  const allWorkspaces = readdirSync(workspacesDir);
  const stacks = config.stacks || {};

  // Build a map of workspace to its branch
  const workspaceBranches = new Map<string, string>();

  for (const workspace of allWorkspaces) {
    try {
      const workspacePath = join(workspacesDir, workspace);
      const info = await getWorktreeInfo(workspacePath);
      if (info) {
        workspaceBranches.set(workspace, info.branch);
      }
    } catch {
      // Skip workspaces we can't read
      continue;
    }
  }

  // Build tree recursively
  function buildNode(
    workspaceName: string,
    depth: number,
    visited: Set<string>
  ): StackTreeNode | null {
    if (visited.has(workspaceName)) {
      // Circular dependency detected
      return null;
    }

    const branch = workspaceBranches.get(workspaceName);
    if (!branch) {
      return null;
    }

    visited.add(workspaceName);

    const children = getStackChildren(projectName, workspaceName);
    const childNodes: StackTreeNode[] = [];

    for (const child of children) {
      const childNode = buildNode(child, depth + 1, new Set(visited));
      if (childNode) {
        childNodes.push(childNode);
      }
    }

    return {
      workspaceName,
      branch,
      children: childNodes,
      depth,
    };
  }

  // Find root nodes (workspaces without parents)
  const roots: StackTreeNode[] = [];

  for (const workspace of allWorkspaces) {
    const hasParent = stacks[workspace] !== undefined;

    if (!hasParent) {
      const node = buildNode(workspace, 0, new Set());
      if (node) {
        roots.push(node);
      }
    }
  }

  return roots;
}

/**
 * Detect if adding a new workspace based on a parent would create a circular dependency
 * Returns true if circular dependency detected, false otherwise
 */
export function detectCircularDependency(
  projectName: string,
  parentWorkspace: string,
  newWorkspace: string
): boolean {
  let current = parentWorkspace;
  const visited = new Set<string>();

  // Traverse up the stack from parent to root
  while (current) {
    // If we've seen this workspace before, or it matches the new workspace name, it's circular
    if (visited.has(current) || current === newWorkspace) {
      return true;
    }

    visited.add(current);

    // Get the parent of the current workspace
    const parent = getStackParent(projectName, current);
    current = parent?.workspaceName || '';
  }

  return false;
}

/**
 * Check if a stacked workspace is out of sync with its parent
 * Returns number of commits the child is behind the parent, or null if not applicable
 */
export async function isStackOutOfSync(
  childPath: string,
  parentPath: string
): Promise<number | null> {
  try {
    const childInfo = await getWorktreeInfo(childPath);
    const parentInfo = await getWorktreeInfo(parentPath);

    if (!childInfo || !parentInfo) {
      return null;
    }

    // Get merge-base (common ancestor)
    const mergeBase = execSync(
      `git -C "${childPath}" merge-base "${childInfo.branch}" "${parentInfo.branch}"`,
      { encoding: 'utf-8' }
    ).trim();

    // Get parent's current commit
    const parentCommit = execSync(
      `git -C "${parentPath}" rev-parse HEAD`,
      { encoding: 'utf-8' }
    ).trim();

    // If merge-base is not the same as parent's HEAD, child is out of sync
    if (mergeBase !== parentCommit) {
      // Count commits child is behind
      const behindCount = execSync(
        `git -C "${childPath}" rev-list --count ${mergeBase}..${parentCommit}`,
        { encoding: 'utf-8' }
      ).trim();

      return parseInt(behindCount, 10);
    }

    return 0;
  } catch {
    return null;
  }
}

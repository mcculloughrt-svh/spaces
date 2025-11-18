/**
 * Rebase-stack command implementation
 * Rebases the current workspace onto its parent workspace's latest commits
 */

import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { getCurrentWorkspace } from '../utils/workspace-detection.js';
import { getStackMetadata } from '../utils/stack.js';
import { getProjectWorkspacesDir } from '../core/config.js';
import { logger } from '../utils/logger.js';
import { SpacesError, NoProjectError } from '../types/errors.js';
import { promptConfirm } from '../utils/prompts.js';

/**
 * Rebase current workspace onto its parent workspace
 */
export async function rebaseStack(options: { auto?: boolean } = {}): Promise<void> {
  // Detect current workspace
  const currentWorkspace = await getCurrentWorkspace();

  if (!currentWorkspace) {
    throw new SpacesError(
      'Not currently in a workspace. Run this command from within a workspace directory.',
      'USER_ERROR',
      1
    );
  }

  const { workspaceName, workspacePath, projectName } = currentWorkspace;

  // Check if this workspace is stacked
  const stackMetadata = getStackMetadata(projectName, workspaceName);

  if (!stackMetadata) {
    throw new SpacesError(
      `Workspace "${workspaceName}" is not a stacked workspace. It has no parent to rebase onto.`,
      'USER_ERROR',
      1
    );
  }

  const { basedOn: parentWorkspace, baseBranch: parentBranch } = stackMetadata;

  // Verify parent workspace exists
  const workspacesDir = getProjectWorkspacesDir(projectName);
  const parentPath = join(workspacesDir, parentWorkspace);

  if (!existsSync(parentPath)) {
    throw new SpacesError(
      `Parent workspace "${parentWorkspace}" no longer exists. Cannot rebase.`,
      'USER_ERROR',
      1
    );
  }

  logger.info(`Rebasing ${workspaceName} onto parent: ${parentWorkspace} (${parentBranch})`);

  // Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });

    if (status.trim()) {
      throw new SpacesError(
        'You have uncommitted changes. Please commit or stash them before rebasing.',
        'USER_ERROR',
        1
      );
    }
  } catch (error) {
    if (error instanceof SpacesError) {
      throw error;
    }
    throw new SpacesError(
      `Failed to check git status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SYSTEM_ERROR',
      2
    );
  }

  // Fetch latest changes from parent workspace
  logger.info('Fetching latest changes...');
  const fetchResult = spawnSync('git', [
    'fetch',
    parentPath,
    `${parentBranch}:refs/remotes/parent/${parentBranch}`
  ], {
    cwd: workspacePath,
    stdio: 'inherit',
  });

  if (fetchResult.status !== 0) {
    throw new SpacesError(
      `Failed to fetch parent branch`,
      'SYSTEM_ERROR',
      2
    );
  }

  // Confirm rebase unless --auto flag
  if (!options.auto) {
    const confirmed = await promptConfirm(
      `Ready to rebase onto parent/${parentBranch}. Continue?`,
      true
    );

    if (!confirmed) {
      logger.info('Rebase cancelled');
      return;
    }
  }

  // Perform rebase
  logger.info('Rebasing...');
  const rebaseResult = spawnSync('git', [
    'rebase',
    `parent/${parentBranch}`
  ], {
    cwd: workspacePath,
    stdio: 'inherit',
  });

  if (rebaseResult.status === 0) {
    logger.success(`Successfully rebased ${workspaceName} onto ${parentWorkspace}`);
    logger.log('\nYour workspace is now up to date with its parent.');
    logger.warning('\n⚠️  Important: You need to force push your rebased branch:');
    logger.log('  git push --force-with-lease');
    logger.log('\nThis is safe because --force-with-lease ensures you don\'t overwrite others\' work.\n');
  } else {
    logger.error('Rebase failed with conflicts.');
    logger.log('\nResolve conflicts, then run:');
    logger.log('  git rebase --continue');
    logger.log('\nOr abort the rebase:');
    logger.log('  git rebase --abort');
    throw new SpacesError('Rebase failed - please resolve conflicts', 'USER_ERROR', 1);
  }
}

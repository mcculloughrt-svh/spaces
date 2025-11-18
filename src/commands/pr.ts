/**
 * PR command implementation
 * Wrapper around `gh pr create` that automatically sets the correct base branch for stacked PRs
 */

import { spawnSync } from 'child_process';
import { getCurrentWorkspace } from '../utils/workspace-detection.js';
import { getStackMetadata } from '../utils/stack.js';
import { logger } from '../utils/logger.js';
import { SpacesError } from '../types/errors.js';
import { readProjectConfig } from '../core/config.js';

/**
 * Create a pull request with automatic base branch detection for stacked PRs
 */
export async function createPR(args: string[] = []): Promise<void> {
  // Detect current workspace
  const currentWorkspace = await getCurrentWorkspace();

  if (!currentWorkspace) {
    throw new SpacesError(
      'Not currently in a workspace. Run this command from within a workspace directory.',
      'USER_ERROR',
      1
    );
  }

  const { workspaceName, workspacePath, branch, projectName } = currentWorkspace;
  const projectConfig = readProjectConfig(projectName);

  // Check if this workspace is stacked
  const stackMetadata = getStackMetadata(projectName, workspaceName);

  let baseBranch: string;
  let isStacked = false;

  if (stackMetadata) {
    // This is a stacked PR - use parent branch as base
    baseBranch = stackMetadata.baseBranch;
    isStacked = true;
    logger.info(`Creating stacked PR: ${branch} → ${baseBranch} (parent: ${stackMetadata.basedOn})`);
  } else {
    // Regular PR - use project base branch
    baseBranch = projectConfig.baseBranch;
    logger.info(`Creating PR: ${branch} → ${baseBranch}`);
  }

  // Check if user already specified --base flag
  const hasBaseFlag = args.some((arg) => arg.startsWith('--base') || arg === '-B');

  if (hasBaseFlag && isStacked) {
    logger.warning('Warning: --base flag provided, but this is a stacked workspace.');
    logger.warning(`Consider using base branch: ${baseBranch}`);
  }

  // Build gh pr create command
  const ghArgs = ['pr', 'create'];

  // Add base branch if not already specified
  if (!hasBaseFlag) {
    ghArgs.push('--base', baseBranch);
  }

  // Add user-provided arguments
  ghArgs.push(...args);

  // Show helpful context for stacked PRs
  if (isStacked && stackMetadata) {
    logger.log('\n📚 Stacked PR Tips:');
    logger.log(`  • This PR targets "${baseBranch}" (from workspace: ${stackMetadata.basedOn})`);
    logger.log(`  • Merge the parent PR first, then this one`);
    logger.log(`  • Keep in sync: spaces rebase-stack\n`);
  }

  // Execute gh pr create
  try {
    logger.debug(`Running: gh ${ghArgs.join(' ')}`);

    const result = spawnSync('gh', ghArgs, {
      cwd: workspacePath,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      throw new SpacesError(
        'Failed to create PR',
        'SYSTEM_ERROR',
        2
      );
    }
  } catch (error) {
    if (error instanceof SpacesError) {
      throw error;
    }
    throw new SpacesError(
      `Failed to create PR: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SYSTEM_ERROR',
      2
    );
  }
}

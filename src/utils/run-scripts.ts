/**
 * Convention-based script runner
 * Discovers and runs executable scripts from project scripts/ directories
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SpacesError } from '../types/errors.js';
import { logger } from './logger.js';
import { escapeShellArg } from './shell-escape.js';

const execAsync = promisify(exec);

/**
 * Discover executable scripts in a directory
 * Returns scripts sorted alphabetically for predictable execution order
 */
export function discoverScripts(scriptsDir: string): string[] {
  if (!existsSync(scriptsDir)) {
    logger.debug(`Scripts directory does not exist: ${scriptsDir}`);
    return [];
  }

  try {
    const files = readdirSync(scriptsDir);
    const scripts: string[] = [];

    for (const file of files) {
      const filePath = join(scriptsDir, file);
      const stats = statSync(filePath);

      // Check if file is executable (has execute permission)
      // On Unix: check if any execute bit is set
      if (stats.isFile() && (stats.mode & 0o111) !== 0) {
        scripts.push(filePath);
      }
    }

    // Sort alphabetically for predictable order
    scripts.sort();

    logger.debug(`Discovered ${scripts.length} executable scripts in ${scriptsDir}`);
    return scripts;
  } catch (error) {
    logger.debug(`Error discovering scripts: ${error}`);
    return [];
  }
}

/**
 * Run scripts in the current terminal
 * Used for pre-scripts that run before tmux session
 */
export async function runScriptsInTerminal(
  scriptsDir: string,
  workspacePath: string,
  workspaceName: string,
  repository: string
): Promise<void> {
  const scripts = discoverScripts(scriptsDir);

  if (scripts.length === 0) {
    logger.debug(`No scripts to run in ${scriptsDir}`);
    return;
  }

  const phaseName = scriptsDir.split('/').pop() || 'scripts';
  logger.info(`Running ${phaseName} scripts...`);

  for (const scriptPath of scripts) {
    await new Promise<void>((resolve, reject) => {
      const scriptName = scriptPath.split('/').pop() || scriptPath;
      logger.dim(`  $ ${scriptName} ${workspaceName} ${repository}`);

      const child = spawn(scriptPath, [workspaceName, repository], {
        stdio: 'inherit',
        shell: false,
        cwd: workspacePath,
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new SpacesError(
              `Script failed with exit code ${code}: ${scriptName}`,
              'SYSTEM_ERROR',
              2
            )
          );
        } else {
          resolve();
        }
      });

      child.on('error', (error) => {
        reject(
          new SpacesError(
            `Failed to run script: ${error.message}`,
            'SYSTEM_ERROR',
            2
          )
        );
      });
    });
  }

  logger.success(`${phaseName} scripts completed`);
}

/**
 * Run scripts inside a tmux session
 * Used for setup and select scripts that run in the tmux environment
 */
export async function runScriptsInTmux(
  sessionName: string,
  scriptsDir: string,
  workspaceName: string,
  repository: string
): Promise<void> {
  const scripts = discoverScripts(scriptsDir);

  if (scripts.length === 0) {
    logger.debug(`No scripts to run in ${scriptsDir}`);
    return;
  }

  const phaseName = scriptsDir.split('/').pop() || 'scripts';
  logger.debug(`Running ${phaseName} scripts in tmux session...`);

  for (const scriptPath of scripts) {
    const scriptName = scriptPath.split('/').pop() || scriptPath;
    const command = `${scriptPath} ${workspaceName} ${repository}`;

    logger.debug(`  Running in tmux: ${scriptName} ${workspaceName} ${repository}`);

    try {
      await execAsync(`tmux send-keys -t ${escapeShellArg(sessionName)} ${escapeShellArg(command)} C-m`);
      // Small delay to allow command to start
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      throw new SpacesError(
        `Failed to send script to tmux: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SYSTEM_ERROR',
        2
      );
    }
  }

  logger.debug(`Sent ${scripts.length} ${phaseName} scripts to tmux session`);
}

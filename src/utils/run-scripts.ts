/**
 * Convention-based script runner
 * Discovers and runs executable scripts from project scripts/ directories
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { SpacesError } from '../types/errors.js';
import { logger } from './logger.js';

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


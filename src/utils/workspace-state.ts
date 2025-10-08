/**
 * Workspace state tracking utilities
 * Tracks whether setup commands have been run for a workspace
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SpacesError } from '../types/errors.js';

/**
 * Marker file name to indicate setup has been completed
 */
const SETUP_MARKER_FILE = '.spaces-setup';

/**
 * Check if setup commands have been run for a workspace
 * @param workspacePath Absolute path to the workspace directory
 * @returns true if setup has been run, false otherwise
 */
export function hasSetupBeenRun(workspacePath: string): boolean {
  const markerPath = join(workspacePath, SETUP_MARKER_FILE);
  return existsSync(markerPath);
}

/**
 * Mark setup as complete for a workspace
 * Creates a marker file in the workspace directory
 * @param workspacePath Absolute path to the workspace directory
 */
export function markSetupComplete(workspacePath: string): void {
  const markerPath = join(workspacePath, SETUP_MARKER_FILE);

  try {
    const timestamp = new Date().toISOString();
    writeFileSync(
      markerPath,
      `Setup completed: ${timestamp}\nThis file indicates that setup commands have been run for this workspace.\n`,
      'utf-8'
    );
  } catch (error) {
    throw new SpacesError(
      `Failed to mark setup complete: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SYSTEM_ERROR',
      2
    );
  }
}

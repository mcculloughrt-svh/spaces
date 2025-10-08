/**
 * Custom error types for Spaces CLI
 */

export type ErrorCode = 'USER_ERROR' | 'SYSTEM_ERROR' | 'SERVICE_ERROR';

/**
 * Base error class for Spaces CLI
 */
export class SpacesError extends Error {
  public readonly code: ErrorCode;
  public readonly exitCode: number;

  constructor(message: string, code: ErrorCode = 'USER_ERROR', exitCode?: number) {
    super(message);
    this.name = 'SpacesError';
    this.code = code;

    // Set exit code based on error type if not provided
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    } else {
      switch (code) {
        case 'USER_ERROR':
          this.exitCode = 1;
          break;
        case 'SYSTEM_ERROR':
          this.exitCode = 2;
          break;
        case 'SERVICE_ERROR':
          this.exitCode = 3;
          break;
      }
    }

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when a dependency is missing
 */
export class DependencyError extends SpacesError {
  constructor(message: string) {
    super(message, 'SYSTEM_ERROR', 2);
    this.name = 'DependencyError';
  }
}

/**
 * Error thrown when GitHub CLI is not authenticated
 */
export class GitHubAuthError extends SpacesError {
  constructor() {
    super(
      '✗ Error: GitHub CLI is not authenticated\n\nPlease run: gh auth login\n\nThen try again.',
      'SYSTEM_ERROR',
      2
    );
    this.name = 'GitHubAuthError';
  }
}

/**
 * Error thrown when a project already exists
 */
export class ProjectExistsError extends SpacesError {
  constructor(projectName: string, projectPath: string) {
    super(
      `✗ Error: Project "${projectName}" already exists\n\nThe directory ${projectPath} already contains a project.\n\nTo use this project:\n  spaces switch project ${projectName}\n\nTo remove and recreate:\n  spaces remove project ${projectName}\n  spaces add project`,
      'USER_ERROR',
      1
    );
    this.name = 'ProjectExistsError';
  }
}

/**
 * Error thrown when a workspace already exists
 */
export class WorkspaceExistsError extends SpacesError {
  constructor(workspaceName: string) {
    super(
      `✗ Error: Workspace "${workspaceName}" already exists\n\nTo switch to this workspace:\n  spaces switch ${workspaceName}`,
      'USER_ERROR',
      1
    );
    this.name = 'WorkspaceExistsError';
  }
}

/**
 * Error thrown when no project is selected
 */
export class NoProjectError extends SpacesError {
  constructor() {
    super(
      '✗ Error: No project selected\n\nPlease add a project first:\n  spaces add project\n\nOr switch to an existing project:\n  spaces switch project',
      'USER_ERROR',
      1
    );
    this.name = 'NoProjectError';
  }
}

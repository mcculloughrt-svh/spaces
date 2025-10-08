# Claude Code Development Guide

This document provides comprehensive information for AI assistants working on the Spaces CLI project.

## Project Overview

**Spaces** is a powerful CLI tool for managing GitHub repository workspaces using git worktrees, tmux sessions, and optional Linear integration. It allows developers to work on multiple features/tasks simultaneously, each in its own isolated workspace with dedicated tmux sessions.

**Key Capabilities:**
- Git worktrees for parallel branch development
- Automatic tmux session management
- Linear issue integration for workspace creation
- Convention-based custom scripts (pre, setup, select phases)
- Project and workspace lifecycle management

## Architecture

### Core Concepts

1. **Projects**: Top-level containers for a GitHub repository
   - Located at `~/spaces/<project-name>/`
   - Contains: base repo clone, workspaces, scripts, config

2. **Workspaces**: Individual git worktrees for features/branches
   - Located at `~/spaces/<project-name>/workspaces/<workspace-name>/`
   - Each workspace has its own branch and optional tmux session

3. **Scripts**: Convention-based automation
   - `pre/`: Run in terminal before tmux (e.g., copy .env files)
   - `setup/`: Run once in tmux on first workspace creation (e.g., npm install)
   - `select/`: Run in tmux every time workspace is opened (e.g., git fetch)

### Directory Structure

```
~/spaces/
├── app/                              # This CLI application
│   ├── src/
│   │   ├── index.ts                  # Entry point
│   │   ├── commands/                 # Command implementations
│   │   │   ├── add.ts                # Add projects/workspaces
│   │   │   ├── switch.ts             # Switch projects/workspaces
│   │   │   ├── list.ts               # List projects/workspaces
│   │   │   └── remove.ts             # Remove projects/workspaces
│   │   ├── core/                     # Core functionality
│   │   │   ├── config.ts             # Configuration management
│   │   │   ├── git.ts                # Git operations (worktrees, branches)
│   │   │   ├── github.ts             # GitHub API (via gh CLI)
│   │   │   ├── tmux.ts               # Tmux session management
│   │   │   └── linear.ts             # Linear API integration
│   │   ├── utils/                    # Utility functions
│   │   │   ├── deps.ts               # Dependency checking
│   │   │   ├── logger.ts             # Colored logging
│   │   │   ├── prompts.ts            # User prompts (@inquirer/prompts)
│   │   │   ├── run-scripts.ts        # Script discovery and execution
│   │   │   ├── sanitize.ts           # String sanitization
│   │   │   └── workspace-state.ts    # Workspace state tracking
│   │   └── types/                    # TypeScript type definitions
│   │       ├── config.ts
│   │       ├── errors.ts
│   │       └── workspace.ts
│   └── dist/                         # Built JavaScript (via tsup)
└── <project-name>/                   # User projects
    ├── .config.json                  # Project configuration
    ├── tmux.template.conf            # Template tmux config (copied to workspaces)
    ├── base/                         # Base repository clone
    ├── workspaces/                   # Git worktrees
    │   └── <workspace-name>/
    │       ├── .tmux.conf            # Workspace tmux config (sourced by tmux)
    │       └── .spaces-setup         # Marker file (setup scripts completed)
    └── scripts/                      # Custom automation scripts
        ├── pre/                      # Run before tmux (terminal)
        │   └── 01-copy-env.sh
        ├── setup/                    # Run once in tmux (first time)
        │   └── 01-install.sh
        └── select/                   # Run in tmux (every time)
            └── 01-fetch.sh
```

## Configuration Files

### Global Config (`~/spaces/.config.json`)

```json
{
  "currentProject": "my-app",
  "projectsDir": "/Users/username/spaces",
  "defaultBaseBranch": "main",
  "staleDays": 30
}
```

### Project Config (`~/spaces/<project>/.config.json`)

```json
{
  "name": "my-app",
  "repository": "myorg/my-app",
  "baseBranch": "main",
  "linearApiKey": "lin_api_...",
  "linearTeamKey": "ENG",
  "createdAt": "2025-10-06T12:00:00Z",
  "lastAccessed": "2025-10-06T12:00:00Z"
}
```

## Key Conventions

### 1. Convention Over Configuration

Scripts are **discovered by file system convention**, not listed in config:
- Place executable scripts in `~/spaces/<project>/scripts/{pre|setup|select}/`
- Scripts execute **alphabetically** (use `01-`, `02-` prefixes)
- Scripts receive two arguments: `$1` = workspace name, `$2` = repository
- Scripts execute with **workspace directory as cwd**

### 2. Script Phases

**Pre Scripts** (`scripts/pre/`):
- Run in **terminal** (not tmux)
- Run **once** when workspace is created
- Run **before** tmux session creation
- Use for: copying .env files, creating directories

**Setup Scripts** (`scripts/setup/`):
- Run in **tmux session**
- Run **once** when workspace is created
- After completion, `.spaces-setup` marker is created
- Use for: npm install, builds, database setup

**Select Scripts** (`scripts/select/`):
- Run in **tmux session**
- Run **every time** workspace is opened (when setup already complete)
- Use for: git fetch, status checks

### 3. Tmux Configuration

**Template**: `~/spaces/<project>/tmux.template.conf`
- Created automatically when project is added
- Visible in editors (no leading dot)
- Copied to `.tmux.conf` in each new workspace

**Per-Workspace**: `~/spaces/<project>/workspaces/<workspace>/.tmux.conf`
- Copied from template on workspace creation
- Sourced by tmux after global `~/.tmux.conf`
- Can be customized per-workspace

## Development Workflow

### Building and Testing

```bash
# Type check
npm run typecheck

# Build (creates dist/index.js)
npm run build

# Run in development
npm run dev <command>

# Lint
npm run lint
```

### Code Style

- **TypeScript**: ESM modules, strict mode
- **Error Handling**: Use typed errors from `types/errors.ts`
- **Logging**: Use `logger` from `utils/logger.ts` (supports colors, levels)
- **User Prompts**: Use functions from `utils/prompts.ts` (selectItem, promptInput, promptConfirm, promptPassword)

### Adding New Commands

1. Create command file in `src/commands/`
2. Export function(s) from the command file
3. Register command in `src/index.ts` using Commander.js
4. Follow existing patterns for error handling and logging

### Git Worktree Operations

All worktree operations go through `src/core/git.ts`:
- `createWorktree()` - Create new worktree and branch
- `removeWorktree()` - Remove worktree and optionally delete branch
- `getWorktreeInfo()` - Get status (branch, ahead/behind, uncommitted changes)
- `checkRemoteBranch()` - Check if branch exists on remote

## Important Implementation Details

### Dependency Checking

Required system dependencies (checked at runtime):
- GitHub CLI (`gh`) - with authentication
- Git
- tmux
- jq
- Node.js 18+

**Note**: fzf is NOT required (we use @inquirer/prompts instead)

### Script Execution

Scripts discovered via:
```typescript
// src/utils/run-scripts.ts
export function discoverScripts(scriptsDir: string): string[] {
  // Finds executable files (mode & 0o111 !== 0)
  // Returns sorted array
}
```

Scripts execute with:
- **Terminal**: `spawn()` with `stdio: 'inherit'` and `cwd: workspacePath`
- **Tmux**: `tmux send-keys` to session

### Workspace State Tracking

Marker file: `~/spaces/<project>/workspaces/<workspace>/.spaces-setup`
- Created after setup scripts complete
- Prevents setup scripts from running again
- Triggers select scripts instead on subsequent sessions

## Common Tasks

### Add Support for a New Script Phase

1. Update `getScriptsPhaseDir()` in `src/core/config.ts` to accept new phase
2. Create directory in `createProject()` function
3. Add logic in appropriate command (add.ts, switch.ts, etc.)
4. Update README.md with phase documentation

### Add a New Config Field

1. Update type in `src/types/config.ts` (GlobalConfig or ProjectConfig)
2. Update default config creation functions
3. Update `readGlobalConfig()` or `readProjectConfig()` to merge defaults
4. Update any command that uses the config

### Add a New User Prompt

Use functions from `src/utils/prompts.ts`:
```typescript
import { selectItem, promptInput, promptConfirm, promptPassword } from '../utils/prompts.js';

// Searchable list
const selected = await selectItem(items, 'Select an item:');

// Text input with validation
const name = await promptInput('Enter name:', {
  validate: (input) => input.length > 0 || 'Name required'
});

// Confirmation
const confirmed = await promptConfirm('Continue?', true);

// Password
const apiKey = await promptPassword('Enter API key:');
```

## Testing Checklist

When making changes, test these workflows:

1. **Project Creation**:
   - `spaces add project`
   - Verify: base clone, config created, scripts directories exist, tmux template created

2. **Workspace Creation**:
   - `spaces add <name>`
   - Verify: worktree created, tmux template copied, pre scripts run, setup scripts run in tmux, marker created

3. **Workspace Switching**:
   - `spaces switch <name>`
   - Verify: select scripts run in tmux, setup scripts NOT run

4. **Script Execution**:
   - Test scripts with `$1` and `$2` arguments
   - Verify cwd is workspace directory
   - Check pre scripts run in terminal, setup/select in tmux

5. **Edge Cases**:
   - Cancelled prompts (return null)
   - Missing dependencies
   - Non-existent workspaces/projects
   - Remote branch conflicts

## Error Handling Patterns

Use typed errors from `src/types/errors.ts`:

```typescript
import { SpacesError, NoProjectError, WorkspaceExistsError } from '../types/errors.js';

// General error
throw new SpacesError('Error message', 'USER_ERROR', 1);

// Specific error types
throw new NoProjectError();
throw new WorkspaceExistsError('workspace-name');
```

Error types:
- `USER_ERROR` (exit code 1): User-facing issues
- `SYSTEM_ERROR` (exit code 2): System/runtime issues

## External Dependencies

**Runtime**:
- `commander` - CLI framework
- `@inquirer/prompts` - User prompts (search, input, confirm, password)
- `@linear/sdk` - Linear API client
- `chalk` - Terminal colors
- `ora` - Loading spinners
- `conf` - Not currently used (configs are JSON files)
- `simple-git` - Not currently used (we use git CLI directly)

**System Commands**:
- `gh` - GitHub CLI (list repos, check auth)
- `git` - Git operations (worktree, branch management)
- `tmux` - Session management
- `jq` - JSON processing (used by some git operations)

## Special Considerations

1. **No Inline Bash for Communication**: Never use `echo` or bash tools to communicate with users. Use `logger` instead.

2. **Always Read Before Edit**: The Edit tool requires reading files first.

3. **Tmux Session Attachment**: `attachSession()` replaces current process with tmux, so any code after it won't execute.

4. **Script Permissions**: Example scripts are created with `chmod 0o755` (executable).

5. **Environment Variable**: `SPACES_CURRENT_PROJECT` overrides config's `currentProject`.

6. **Git Worktree Paths**: Always use absolute paths, never relative.

7. **Concurrent Workspaces**: Multiple workspaces can exist for the same project, each on different branches.

## Quick Reference

**Get project directory**: `getProjectDir(projectName)`
**Get workspace directory**: `join(getProjectWorkspacesDir(projectName), workspaceName)`
**Get script phase directory**: `getScriptsPhaseDir(projectName, 'pre' | 'setup' | 'select')`
**Check setup status**: `hasSetupBeenRun(workspacePath)`
**Mark setup complete**: `markSetupComplete(workspacePath)`
**Discover scripts**: `discoverScripts(scriptsDir)`
**Run scripts in terminal**: `runScriptsInTerminal(scriptsDir, workspacePath, workspaceName, repository)`
**Run scripts in tmux**: `runScriptsInTmux(sessionName, scriptsDir, workspaceName, repository)`

## Documentation

**README.md**: User-facing documentation
**CLAUDE.md**: This file - development documentation
**package.json**: Dependencies and scripts
**tsconfig.json**: TypeScript configuration
**src/types/**: TypeScript type definitions

---

**Last Updated**: 2025-10-07
**CLI Version**: 1.0.0
**Node Version**: 18+

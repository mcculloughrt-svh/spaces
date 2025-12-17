# Spaces CLI

A powerful CLI tool for managing GitHub repository workspaces using git worktrees, tmux sessions, and optional Linear integration. Work on multiple features/tasks simultaneously, each in its own isolated workspace with dedicated tmux sessions.

## Features

- 🚀 **Git Worktrees**: Work on multiple branches simultaneously without stashing
- 🖥️ **Tmux Integration**: Automatic session management for each workspace
- 📋 **Linear Integration**: Create workspaces directly from Linear issues with automatic markdown documentation
- 🔄 **Smart Branch Management**: Automatic detection of remote branches with fuzzy matching
- 📊 **Workspace Status**: Track uncommitted changes, stale workspaces, and more
- ⚙️ **Custom Scripts**: Convention-based scripts for setup, select, pre-setup, and removal phases

## Prerequisites

The following tools must be installed and available in your PATH:

- [GitHub CLI (`gh`)](https://cli.github.com/) - for listing repositories
- [Git](https://git-scm.com/) - for worktree management
- [tmux](https://github.com/tmux/tmux/wiki) - for session management
- [jq](https://stedolan.github.io/jq/) - for JSON processing
- [Bun](https://bun.sh) - to run the CLI (or node.js... if you don't mind startup lag)

**GitHub Authentication**: You must authenticate the GitHub CLI before using Spaces:

```bash
gh auth login
```

## Installation

```bash
bun install -g @mcculloughrt-svh/spaces
```

Verify installation:
```bash
spaces --version
```

To update:
```bash
bun update -g @mcculloughrt-svh/spaces
```

## Quick Start

### 1. Add Your First Project

```bash
# This will list all your GitHub repositories
spaces add project
```

Select a github repository, and Spaces will:

- Clone the repository to `~/spaces/<project-name>/base`
- Detect the default branch
- Create project configuration
- Optionally set up Linear integration

### 2. Create a Workspace

```bash
# Create a workspace from a Linear issue (if configured)
spaces add

# Or create a workspace with a custom name
spaces add my-feature
```

This will:

- Create a git worktree in `~/spaces/<project-name>/workspaces/<workspace-name>`
- Create a new branch (or use an existing one)
- Create a tmux session
- Run setup scripts (if present)

### 3. Switch Between Workspaces

```bash
# List and select a workspace interactively with switch (or sw)
spaces switch

# Switch to a specific workspace, workspaces are fuzzy matched
spaces switch my-feature
```

### 4. List Workspaces

```bash
# List workspaces in the current project with list (or ls)
spaces list

# List projects
spaces list projects
```

## Commands

### `spaces add project`

Add a new project from GitHub.

```bash
spaces add project [options]

Options:
  --no-clone           Create project structure without cloning
  --org <org>          Filter repos to specific organization
  --linear-key <key>   Provide Linear API key via flag
```

**Example:**

```bash
# Add a project with Linear integration
spaces add project --linear-key lin_api_...
```

### `spaces add [workspace-name]`

Create a new workspace in the current project. Omit workspace-name to interactively choose
from github branches and linear issues to create from.

```bash
spaces add [workspace-name] [options]

Options:
  --branch <name>      Specify different branch name from workspace name
  --from <branch>      Create from specific branch instead of base
  --no-tmux            Don't create/attach tmux session
  --no-setup           Skip setup commands
```

**Example:**

```bash
# Create workspace from Linear issue (interactive selection)
spaces add

# Create workspace with custom name
spaces add fix-bug-123

# Create workspace from specific branch
spaces add hotfix --from production
```

**Linear Integration:**
When creating a workspace from a Linear issue, Spaces will:

- Generate a workspace name from the issue identifier and title
- Save the full issue details (description, metadata, attachments) to `.prompt/issue.md` in the workspace
- This markdown file can be used with LLM assistants for context about the task

### `spaces switch project [project-name]`

Switch to a different project.

```bash
spaces switch project [project-name]
```

**Example:**

```bash
# Interactive selection
spaces switch project

# Direct switch
spaces switch project my-app
```

### `spaces switch [workspace-name]`

Switch to a workspace in the current project. Workspace names are **fuzzy-matched**, so you don't need to type the exact name. Or leave workspace-name blank for interactive selection.

```bash
spaces switch [workspace-name] [options]
# Alias
spaces sw [workspace-name]

Options:
  --no-tmux            Just cd to workspace without tmux
  --new-window         Create new window in existing session instead of attaching
  -f, --force          Jump to first fuzzy match without confirmation
```

**Fuzzy Matching:**

- Workspace names are matched approximately, so `feat` can match `feature-branch`
- Shorter workspace names and active tmux sessions score higher
- If multiple matches are found, you'll be prompted to choose (unless using `-f`)

**Example:**

```bash
# Interactive selection
spaces switch

# Direct switch (exact match)
spaces switch my-feature

# Fuzzy match - will find 'my-feature-branch'
spaces switch my-feat

# Force first fuzzy match without confirmation
spaces switch feat -f
```

### `spaces list [subcommand]`

List projects or workspaces.

```bash
spaces list [subcommand] [options]
# Alias
spaces ls [subcommand] [options]

Subcommands:
  projects             List all projects
  workspaces           List workspaces in current project (default)

Options:
  --json               Output in JSON format
  --verbose            Show additional details
```

**Example:**

```bash
# List workspaces
spaces list
# Or using alias
spaces ls

# List projects
spaces list projects
# Or using alias
spaces ls projects

# Verbose output
spaces list --verbose
```

### `spaces remove workspace [workspace-name]`

Remove a workspace.

```bash
spaces remove workspace [workspace-name] [options]
# Alias
spaces rm workspace [workspace-name] [options]

Options:
  --force              Skip confirmation prompts
  --keep-branch        Don't delete git branch when removing workspace
```

**Example:**

```bash
# Interactive removal
spaces remove workspace
# Or using alias
spaces rm workspace

# Force remove without confirmation
spaces remove workspace my-feature --force
# Or using alias
spaces rm workspace my-feature --force
```

### `spaces remove project [project-name]`

Remove a project.

```bash
spaces remove project [project-name] [options]
# Alias
spaces rm project [project-name] [options]

Options:
  --force              Skip confirmation prompts
```

**Example:**

```bash
# Interactive removal (requires typing project name to confirm)
spaces remove project
# Or using alias
spaces rm project

# Direct removal
spaces remove project my-app
# Or using alias
spaces rm project my-app
```

### `spaces directory`

Print the current project directory path. Useful for shell integration.

```bash
spaces directory
# Alias
spaces dir
```

**Example:**

```bash
# Print current project directory
spaces directory
# Output: /Users/username/spaces/my-app

# Shell integration - cd to project directory
cd $(spaces dir)

# Or use in scripts
PROJECT_DIR=$(spaces directory)
echo "Working in: $PROJECT_DIR"
```

## Configuration

### Global Configuration

Located at `~/spaces/.config.json`:

```json
{
	"currentProject": "my-app",
	"projectsDir": "/Users/username/spaces",
	"defaultBaseBranch": "main",
	"staleDays": 30
}
```

- `currentProject`: Currently active project (can be overridden by `SPACES_CURRENT_PROJECT` env var)
- `projectsDir`: Path to the spaces directory
- `defaultBaseBranch`: Default base branch for new projects
- `staleDays`: Days before a workspace is considered stale

### Project Configuration

Located at `~/spaces/<project-name>/.config.json`:

```json
{
	"name": "my-app",
	"repository": "myorg/my-app",
	"baseBranch": "main",
	"linearApiKey": "lin_api_...",
	"linearTeamKey": "ENG",
	"llmAssistant": "claude",
	"createdAt": "2025-10-06T12:00:00Z",
	"lastAccessed": "2025-10-06T12:00:00Z"
}
```

- `linearApiKey`: Optional Linear API key for issue integration
- `linearTeamKey`: Optional Linear team filter
- `llmAssistant`: Optional command to run in a split tmux pane (e.g., `"claude"`, `"aider"`, `"cursor"`)

### Custom Scripts

Spaces uses **convention over configuration** for custom scripts. Instead of listing commands in the config file, you create executable scripts in phase-specific directories within each project:

```
~/spaces/<project-name>/scripts/
├── pre/                   # Run before immediately after worktree creation
│   ├── 01-copy-env.sh
│   └── 02-setup-dirs.sh
├── setup/                 # Run on workspace creation after pre scripts have finished (will execute in new tmux session if tmux is present)
│   ├── 01-install.sh
│   └── 02-build.sh
├── select/                # Run every time the workspace is opened (will execute in a new tmux session if tmux is present)
│   ├── 01-fetch.sh
│   └── 02-status.sh
└── remove/                # Run before workspace deletion (in terminal)
    ├── 01-cleanup.sh
    └── 02-notify.sh
```

#### Script Execution Rules

1. **Discovery**: Spaces walks each phase directory and finds all **executable** scripts
2. **Execution Order**: Scripts run **alphabetically** (hence the `01-`, `02-` prefixes)
3. **Working Directory**: All scripts execute with the **workspace directory** as their current working directory (e.g., `~/spaces/my-app/workspaces/my-feature/`), so you can use relative paths
4. **Arguments**: Every script receives two arguments:
   - `$1`: Workspace name (e.g., `my-feature`)
   - `$2`: Repository name (e.g., `myorg/my-app`)

**Example script** (`~/spaces/my-app/scripts/setup/01-install.sh`):

```bash
#!/bin/bash
# Current working directory: ~/spaces/my-app/workspaces/<workspace-name>/
WORKSPACE_NAME=$1
REPOSITORY=$2

echo "Installing dependencies for $WORKSPACE_NAME ($REPOSITORY)..."
npm install
npm run build
```

**Make scripts executable:**

```bash
chmod +x ~/spaces/my-app/scripts/setup/01-install.sh
```

#### Script Phases

**1. Pre Scripts** (`pre/`): Run **once** in the current terminal, **before** tmux session creation. Perfect for:

- Copying environment templates (`cp .env.example .env`)
- Creating directories (`mkdir -p tmp/uploads`)
- File preparation that setup scripts need

These run in the terminal so you can see their output immediately.

**2. Setup Scripts** (`setup/`): Run **once** inside the tmux session when a workspace is first created. Perfect for:

- Installing dependencies (`npm install`)
- Initial builds (`npm run build`)
- Database initialization
- Custom setup tasks

After running, Spaces creates a `.spaces-setup` marker file. This prevents pre and setup scripts from running again, even if you destroy and recreate the tmux session.

**3. Select Scripts** (`select/`): Run **inside the tmux session** every time you create a new session for an existing workspace. Perfect for:

- Fetching latest changes (`git fetch --all`)
- Checking workspace state (`git status`)
- Environment checks
- Quick status updates

**4. Remove Scripts** (`remove/`): Run **in the terminal** before a workspace is deleted. Perfect for:

- Cleaning up temporary files or caches
- Notifying external services
- Backing up important data
- Logging or auditing workspace removal

These run before the worktree is removed, so you can still access workspace files.

**Example workflow:**

```bash
# First time: creates workspace, runs pre scripts → setup scripts, marks setup complete
spaces add my-feature
# → Creates worktree
# → Running pre scripts...
#   $ 01-copy-env.sh my-feature myorg/my-app
#   $ 02-setup-dirs.sh my-feature myorg/my-app
# → Creating tmux session
# → Running setup scripts in tmux...
#   $ 01-install.sh my-feature myorg/my-app
#   $ 02-build.sh my-feature myorg/my-app
# → (marker created)

# Later: tmux session destroyed, recreate it
spaces switch my-feature
# → Running select scripts in tmux...
#   $ 01-fetch.sh my-feature myorg/my-app
#   $ 02-status.sh my-feature myorg/my-app
# → (NO pre or setup scripts - they already ran!)
```

### Environment Variables

```bash
# Set the current project (overrides global config)
export SPACES_CURRENT_PROJECT="my-app"
```

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) to persist.

## Custom Tmux Layouts

You can create a `.tmux.conf` file in any workspace root to define a custom tmux layout:

```bash
# ~/spaces/my-app/workspaces/my-feature/.tmux.conf

# Split window horizontally (30% on right)
split-window -h -p 30

# Select left pane
select-pane -t 0

# Split left pane vertically
split-window -v -p 50

# Select top-left pane
select-pane -t 0
```

When you create or switch to this workspace, Spaces will automatically source this `.tmux.conf` file.

## Advanced Workflows

### Working on Multiple Features

```bash
# Create workspaces for different features
spaces add feature-a
# Work on feature-a...
# Ctrl+B, D to detach from tmux

spaces add feature-b
# Work on feature-b...
# Ctrl+B, D to detach

# Switch back to feature-a
spaces switch feature-a
```

### Stale Workspace Detection

Workspaces that haven't had commits in more than `staleDays` (default: 30) will be marked as stale:

```bash
spaces list
# Output:
#   my-feature  main  clean
#   old-feature main  clean  [stale: 45 days]
```

### Remote Branch Handling

When creating a workspace, if the branch exists on remote, Spaces will prompt:

```
Branch 'feature-x' exists on remote. Pull it down? (Y/n)
```

This allows you to safely pull down branches created by teammates.

## Development

### Build from Source

```bash
# Clone the repository
git clone https://github.com/mcculloughrt-svh/spaces.git
cd spaces

# Install dependencies
bun install

# Link for local development
bun link

# Type checking
bun run typecheck

# Build (optional - bun runs TypeScript directly)
bun run build

# Run linter
bun run lint
```

### Project Structure

```
~/spaces/app/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── commands/                # Command implementations
│   │   ├── add.ts
│   │   ├── switch.ts
│   │   ├── list.ts
│   │   ├── remove.ts
│   │   └── directory.ts
│   ├── core/                    # Core functionality
│   │   ├── config.ts
│   │   ├── git.ts
│   │   ├── github.ts
│   │   ├── tmux.ts
│   │   └── linear.ts
│   ├── utils/                   # Utilities
│   │   ├── deps.ts
│   │   ├── fuzzy-match.ts
│   │   ├── logger.ts
│   │   ├── markdown.ts
│   │   ├── prompts.ts
│   │   ├── run-commands.ts
│   │   ├── run-scripts.ts
│   │   ├── sanitize.ts
│   │   ├── shell-escape.ts
│   │   └── workspace-state.ts
│   └── types/                   # Type definitions
│       ├── config.ts
│       ├── errors.ts
│       ├── workspace.ts
│       └── workspace-fuzzy.ts
└── bin/
    └── spaces                   # Executable

~/spaces/<project-name>/
├── .config.json                 # Project configuration
├── tmux.template.conf           # Template tmux config (copied to workspaces)
├── base/                        # Base repository clone
├── workspaces/                  # Git worktrees (one per feature/task)
│   └── my-feature/
│       ├── .spaces-setup        # Marker file (setup completed)
│       ├── .tmux.conf           # Workspace tmux config (copied from template)
│       └── .prompt/             # Linear integration (optional)
│           └── issue.md         # Linear issue details
└── scripts/                     # Custom scripts
    ├── pre/                     # Run before tmux (terminal)
    ├── setup/                   # Run once in tmux (first time)
    ├── select/                  # Run in tmux (every session)
    └── remove/                  # Run before workspace deletion (terminal)
```

## Troubleshooting

### GitHub CLI not authenticated

```
Error: GitHub CLI is not authenticated

Please run: gh auth login
```

**Solution:** Run `gh auth login` and follow the prompts.

### Missing dependencies

```
Error: Missing required dependencies:
  fzf (fzf)
    Install: https://github.com/junegunn/fzf
```

**Solution:** Install the missing dependencies using the provided URLs.

### Workspace already exists

```
Error: Workspace "my-feature" already exists

To switch to this workspace:
  spaces switch my-feature
```

**Solution:** Use `spaces switch my-feature` to switch to the existing workspace, or choose a different name.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

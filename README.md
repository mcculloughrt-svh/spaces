# Spaces CLI

A powerful CLI tool for managing GitHub repository workspaces using git worktrees, tmux sessions, and optional Linear integration. Work on multiple features/tasks simultaneously, each in its own isolated workspace with dedicated tmux sessions.

## Features

- 🚀 **Git Worktrees**: Work on multiple branches simultaneously without stashing
- 🖥️ **Tmux Integration**: Automatic session management for each workspace
- 📋 **Linear Integration**: Create workspaces directly from Linear issues with automatic markdown documentation
- 🔄 **Smart Branch Management**: Automatic detection of remote branches with fuzzy matching
- 📊 **Workspace Status**: Track uncommitted changes, stale workspaces, and more
- 📚 **Stacked PRs**: Create dependent pull requests with automatic base branch detection, tree visualization, and rebase workflows
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
# Clone this repository
git clone https://github.com/mcculloughrt-svh/spaces.git

# Install dependencies
bun install

# Build the CLI
bun run build

# Link the CLI globally
bun link

# Verify installation
spaces --version
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
  --stacked            Create workspace stacked on current or selected workspace branch
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

# Create stacked workspace (while in another workspace)
spaces add feature-b --stacked

# Create stacked workspace (will prompt for parent selection)
cd ~/spaces/my-app  # Not in a workspace
spaces add feature-c --stacked
```

**Stacked Workspaces:**

The `--stacked` flag creates a workspace based on another workspace's branch instead of the main branch. This is useful for:
- Building features that depend on unreviewed code
- Creating a series of smaller, focused PRs
- Testing changes before the base PR is merged

When using `--stacked`:
- If you're currently in a workspace, it uses that workspace's branch as the base
- If you're not in a workspace, it prompts you to select a parent workspace
- The stack relationship is tracked automatically for later commands

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
  --tree               Show workspace stack tree visualization
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

# Tree view (shows stack relationships)
spaces list --tree
```

**Workspace List Output:**

The default list view shows workspace status including stack information:

```
Workspaces (my-app):
  feature-a         +2 -0    clean            (active tmux)
  feature-b         +1 -0    clean            [based on: feature-a]
  feature-c         +0 -0    2 uncommitted    [based on: feature-b]  ⚠️ Behind base by 3 commits
```

**Tree View:**

The `--tree` flag displays workspaces in a hierarchical tree structure:

```
Workspaces (my-app) - Tree View:
├── feature-a (feature-a-branch) [+2 -0, clean, (active)]
│   └── feature-b (feature-b-branch) [+1 -0, clean]
│       └── feature-c (feature-c-branch) [+0 -0, 2 uncommitted]
└── hotfix (hotfix-branch) [+0 -0, clean]
```

This makes it easy to visualize dependencies between stacked workspaces.

### `spaces rebase-stack`

Rebase the current workspace onto its parent workspace's latest commits. This command must be run from within a stacked workspace directory.

```bash
spaces rebase-stack [options]

Options:
  --auto               Skip confirmation prompt
```

**Example:**

```bash
# From within a stacked workspace
cd ~/spaces/my-app/workspaces/feature-b
spaces rebase-stack

# Skip confirmation
spaces rebase-stack --auto
```

**How it works:**

1. Verifies you're in a stacked workspace (has a parent)
2. Checks for uncommitted changes (must be clean)
3. Fetches latest commits from the parent workspace
4. Rebases current branch onto parent's branch
5. Handles conflicts if they occur

**Conflict Resolution:**

If conflicts occur during rebase, Spaces will pause and show:

```
Rebase failed with conflicts.

Resolve conflicts, then run:
  git rebase --continue

Or abort the rebase:
  git rebase --abort
```

Resolve conflicts manually, then continue or abort the rebase using the standard git commands.

### `spaces pr`

Create a pull request with automatic base branch detection for stacked PRs. This is a wrapper around `gh pr create` that automatically sets the correct base branch for stacked workspaces.

```bash
spaces pr [gh pr create options]
```

All options and flags are passed through to `gh pr create`, so you can use any `gh` PR creation flags.

**Example:**

```bash
# Create PR from a regular workspace (targets main branch)
spaces pr --title "Add new feature" --body "Description here"

# Create PR from a stacked workspace (automatically targets parent branch)
cd ~/spaces/my-app/workspaces/feature-b  # This is stacked on feature-a
spaces pr --title "Part 2: Add tests" --body "Builds on feature-a"
# Automatically creates PR with base branch = feature-a

# Use any gh pr create flags
spaces pr --draft --reviewer octocat --label enhancement
```

**How it works:**

For stacked workspaces, `spaces pr`:
1. Detects the parent workspace from stack metadata
2. Automatically sets `--base` to the parent's branch
3. Shows helpful tips about the stack structure
4. Passes all other arguments to `gh pr create`

For regular (non-stacked) workspaces, it behaves like `gh pr create` with the base branch set to your project's main branch.

**Stacked PR Tips:**

When you create a stacked PR, Spaces displays helpful reminders:

```
📚 Stacked PR Tips:
  • This PR targets "feature-a-branch" (from workspace: feature-a)
  • Merge the parent PR first, then this one
  • Keep in sync: spaces rebase-stack
```

### `spaces remove workspace [workspace-name]`

Remove a workspace. If the workspace has dependent workspaces (children in a stack), you'll be prompted with options for handling them.

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

**Dependent Workspace Handling:**

When removing a workspace that has dependent workspaces (children in a stack), Spaces will detect this and present options:

```
⚠️ Warning: This workspace has 2 dependent workspace(s):
  - feature-b
  - feature-c

Options:
  1. Cancel removal
  2. Remove and rebase children onto main
  3. Remove anyway (children will be orphaned)

What would you like to do?
```

- **Cancel**: Abort the removal operation
- **Rebase children**: Automatically rebases each dependent workspace onto the grandparent (or main if no grandparent exists), maintaining the stack
- **Remove anyway**: Removes the workspace and orphans the children (they become regular workspaces based on main)

This ensures you don't accidentally break your stack structure when removing workspaces.

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
	"stacks": {
		"feature-b": {
			"basedOn": "feature-a",
			"baseBranch": "feature-a-branch"
		},
		"feature-c": {
			"basedOn": "feature-b",
			"baseBranch": "feature-b-branch"
		}
	},
	"createdAt": "2025-10-06T12:00:00Z",
	"lastAccessed": "2025-10-06T12:00:00Z"
}
```

- `linearApiKey`: Optional Linear API key for issue integration
- `linearTeamKey`: Optional Linear team filter
- `llmAssistant`: Optional command to run in a split tmux pane (e.g., `"claude"`, `"aider"`, `"cursor"`)
- `stacks`: Tracks parent-child relationships between stacked workspaces (automatically managed)

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

### Stacked PRs Workflow

Stacked PRs allow you to create multiple dependent pull requests that build on each other. This is especially useful for:
- Breaking large features into smaller, reviewable chunks
- Building features that depend on unmerged code
- Iterating quickly while previous PRs are in review

**Example: Building a complete authentication system in stacked PRs**

```bash
# 1. Create base workspace for auth infrastructure
spaces add auth-core
# Implement: database models, JWT helpers, password hashing
# Commit your changes

# 2. Create stacked workspace for API endpoints (while in auth-core)
cd ~/spaces/my-app/workspaces/auth-core
spaces add auth-api --stacked
# Implement: login, register, logout endpoints
# These endpoints use the code from auth-core
# Commit your changes

# 3. Create stacked workspace for UI components (based on auth-api)
cd ~/spaces/my-app/workspaces/auth-api
spaces add auth-ui --stacked
# Implement: login form, registration page
# These use the API endpoints from auth-api
# Commit your changes

# 4. View your stack
spaces list --tree
# Output:
# └── auth-core (auth-core-branch) [+5 -0, clean]
#     └── auth-api (auth-api-branch) [+3 -0, clean]
#         └── auth-ui (auth-ui-branch) [+4 -0, 2 uncommitted]
```

**Creating PRs for the stack:**

```bash
# Create PR for auth-core (targets main)
cd ~/spaces/my-app/workspaces/auth-core
spaces pr --title "Auth: Core infrastructure" --draft

# Create PR for auth-api (automatically targets auth-core-branch)
cd ~/spaces/my-app/workspaces/auth-api
spaces pr --title "Auth: API endpoints" --draft
# Output: 📚 Stacked PR Tips:
#   • This PR targets "auth-core-branch" (from workspace: auth-core)
#   • Merge the parent PR first, then this one
#   • Keep in sync: spaces rebase-stack

# Create PR for auth-ui (automatically targets auth-api-branch)
cd ~/spaces/my-app/workspaces/auth-ui
spaces pr --title "Auth: UI components" --draft
```

**Result:** Three PRs that can be reviewed independently:
1. `auth-core` → `main` (5 commits)
2. `auth-api` → `auth-core` (3 commits)
3. `auth-ui` → `auth-api` (4 commits)

**Updating stacked PRs when parent changes:**

```bash
# Reviewer requests changes to auth-core
cd ~/spaces/my-app/workspaces/auth-core
# Make the changes and commit
git add .
git commit -m "Address review comments"
git push

# Now auth-api and auth-ui are out of sync
spaces list
# Output:
#   auth-core   +6 -0    clean
#   auth-api    +3 -0    clean            [based on: auth-core]  ⚠️ Behind base by 1 commits
#   auth-ui     +4 -0    clean            [based on: auth-api]

# Rebase auth-api onto updated auth-core
cd ~/spaces/my-app/workspaces/auth-api
spaces rebase-stack
# Rebases auth-api onto auth-core's latest commit

# Rebase auth-ui onto updated auth-api
cd ~/spaces/my-app/workspaces/auth-ui
spaces rebase-stack
# Rebases auth-ui onto auth-api's latest commit

# Force push the rebased branches
git push --force-with-lease
```

**Merging the stack:**

Once the first PR (`auth-core → main`) is approved and merged:

```bash
# Update auth-api's base branch to main on GitHub
gh pr edit --base main  # In auth-api workspace

# Clean up: remove auth-core workspace
spaces remove auth-core
# Output: ⚠️ Warning: This workspace has 1 dependent workspace(s):
#   - auth-api
# Choose: "Rebase children onto main"

# This automatically rebases auth-api onto main
# Repeat the process for auth-api → auth-ui
```

**Tips for Managing Stacks:**

1. **Keep stacks shallow**: 2-3 levels deep is ideal. Deeper stacks become harder to manage
2. **Rebase frequently**: Run `spaces rebase-stack` after each parent update to avoid large conflicts
3. **Use tree view**: `spaces list --tree` helps visualize complex dependencies
4. **Create PRs early**: Draft PRs provide context and allow parallel review
5. **Consider the merge order**: Always merge from bottom to top (base first, then children)

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
# Install dependencies
npm install

# Development mode (with watch)
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build

# Run linter
npm run lint
```

### Project Structure

```
~/spaces/app/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── commands/                # Command implementations
│   │   ├── add.ts               # Add projects and workspaces (includes --stacked)
│   │   ├── switch.ts
│   │   ├── list.ts              # List with tree visualization support
│   │   ├── remove.ts            # Remove with dependent checking
│   │   ├── directory.ts
│   │   ├── rebase-stack.ts      # Rebase stacked workspaces
│   │   └── pr.ts                # PR creation with auto base detection
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
│   │   ├── workspace-state.ts
│   │   ├── stack.ts             # Stack relationship management
│   │   └── workspace-detection.ts # Current workspace detection
│   └── types/                   # Type definitions
│       ├── config.ts            # Includes StackMetadata type
│       ├── errors.ts
│       ├── workspace.ts
│       └── workspace-fuzzy.ts
└── bin/
    └── spaces                   # Executable

~/spaces/<project-name>/
├── .config.json                 # Project configuration (includes stacks field)
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

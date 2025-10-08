# Shell Completion Implementation Plan

## Overview
Implement comprehensive shell completion for Bash, Zsh, and Fish to provide auto-completion for commands, subcommands, options, and dynamic values (project names, workspace names, branches).

## Goals
- **Tab completion** for all commands and subcommands
- **Dynamic completion** for project/workspace names from actual filesystem
- **Context-aware suggestions** (only show relevant workspaces for current project)
- **Flag/option completion** with descriptions
- **Performance** - completions should be instant (<50ms)

## Architecture

### 1. Completion Script Generator
**Location**: `src/commands/completion.ts`

```typescript
export async function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): Promise<string>
```

**Responsibilities**:
- Generate shell-specific completion scripts
- Output to stdout for shell evaluation
- Support installation to shell config files

### 2. Completion Helper Command
**Location**: `src/commands/completion-helper.ts`

```typescript
// Hidden command for shells to invoke
export async function completionHelper(args: {
  type: 'projects' | 'workspaces' | 'branches' | 'scripts',
  project?: string
}): Promise<void>
```

**Why separate helper?**
- Shell completion runs in subprocess - needs fast startup
- Helper provides dynamic data without parsing entire CLI
- Can be invoked as: `spaces __complete projects`

### 3. Shell-Specific Implementations

#### Bash Completion
**File**: `completions/spaces.bash`

**Features**:
- Use `complete -F` for programmable completion
- Call `spaces __complete` for dynamic data
- Support both `compgen` and modern `_comp_` helpers

**Structure**:
```bash
_spaces_completion() {
  local cur prev words cword
  _init_completion || return

  case "${prev}" in
    switch|remove)
      # Complete with workspace names
      COMPREPLY=($(compgen -W "$(spaces __complete workspaces)" -- "${cur}"))
      return 0
      ;;
    project)
      # Complete with project names
      COMPREPLY=($(compgen -W "$(spaces __complete projects)" -- "${cur}"))
      return 0
      ;;
  esac

  # Complete subcommands
  COMPREPLY=($(compgen -W "add switch list remove" -- "${cur}"))
}

complete -F _spaces_completion spaces
```

#### Zsh Completion
**File**: `completions/_spaces`

**Features**:
- Use Zsh's `_arguments` framework
- Support descriptions for options
- Integrate with Zsh's caching system
- Group completions by category

**Structure**:
```zsh
#compdef spaces

_spaces() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \
    '1: :->command' \
    '*::arg:->args'

  case $state in
    command)
      _arguments '1:Commands:((
        add\:"Add a new project or workspace"
        switch\:"Switch to a different project or workspace"
        list\:"List projects or workspaces"
        remove\:"Remove a workspace or project"
      ))'
      ;;
    args)
      case $words[1] in
        switch)
          _spaces_workspaces
          ;;
        remove)
          _spaces_workspaces
          ;;
      esac
      ;;
  esac
}

_spaces_workspaces() {
  local workspaces
  workspaces=(${(f)"$(spaces __complete workspaces 2>/dev/null)"})
  _describe 'workspaces' workspaces
}

_spaces "$@"
```

#### Fish Completion
**File**: `completions/spaces.fish`

**Features**:
- Use Fish's declarative completion syntax
- Support dynamic conditions with `--condition`
- Rich descriptions with `--description`

**Structure**:
```fish
# Complete 'add' subcommand
complete -c spaces -n "__fish_use_subcommand" -a "add" -d "Add a new project or workspace"

# Complete workspace names for 'switch'
complete -c spaces -n "__fish_seen_subcommand_from switch" -a "(spaces __complete workspaces)" -d "Workspace"

# Complete project names for 'switch project'
complete -c spaces -n "__fish_seen_subcommand_from switch; and __fish_seen_subcommand_from project" -a "(spaces __complete projects)" -d "Project"
```

## Implementation Steps

### Phase 1: Foundation (Week 1)
1. **Add completion command** to CLI
   - `spaces completion bash|zsh|fish` - output script
   - `spaces completion install` - auto-detect shell and install

2. **Add completion helper command**
   - `spaces __complete projects` - list project names
   - `spaces __complete workspaces [--project <name>]` - list workspaces
   - `spaces __complete branches` - list git branches
   - Mark as hidden command (don't show in help)

3. **Create completion generators**
   - Function to generate Bash completion script
   - Function to generate Zsh completion script
   - Function to generate Fish completion script

### Phase 2: Bash Support (Week 1)
1. **Write Bash completion script template**
   - Command/subcommand completion
   - Option/flag completion
   - Dynamic workspace/project completion

2. **Test Bash completion**
   - Test on Bash 4.x and 5.x
   - Test all command paths
   - Verify performance (<50ms)

3. **Add installation logic**
   - Detect `~/.bashrc` or `~/.bash_completion`
   - Add source line safely (check for duplicates)
   - Provide manual instructions as fallback

### Phase 3: Zsh Support (Week 2)
1. **Write Zsh completion script template**
   - Use `_arguments` for structure
   - Add descriptions for all options
   - Implement completion caching

2. **Test Zsh completion**
   - Test on Zsh 5.x
   - Test with Oh My Zsh
   - Test with Prezto

3. **Add installation logic**
   - Detect completion directory (`$fpath`)
   - Install to `~/.zsh/completions/` or `/usr/local/share/zsh/site-functions/`
   - Provide instructions for manual setup

### Phase 4: Fish Support (Week 2)
1. **Write Fish completion script**
   - Use declarative completion syntax
   - Add conditions for context-aware completion

2. **Test Fish completion**
   - Test on Fish 3.x
   - Verify descriptions appear

3. **Add installation logic**
   - Install to `~/.config/fish/completions/spaces.fish`

### Phase 5: Advanced Features (Week 3)
1. **Branch completion**
   - Complete git branches for `--from` and `--branch` flags
   - Cache results for performance

2. **Script completion**
   - Complete script phase names (pre, setup, select, remove)
   - Complete script filenames when editing

3. **Option completion with descriptions**
   - Add descriptions to flags (especially in Zsh/Fish)
   - Show valid values for enum options

4. **Smart context detection**
   - Only show workspace completions when in a project context
   - Filter remote branches based on project configuration

5. **Performance optimization**
   - Cache completion data with 60-second TTL
   - Lazy-load expensive operations
   - Background refresh of completion cache

## File Structure
```
src/
├── commands/
│   ├── completion.ts           # Main completion command
│   └── completion-helper.ts    # Hidden helper for shells
└── completions/
    ├── generator.ts            # Generate completion scripts
    ├── templates/
    │   ├── bash.ts             # Bash template
    │   ├── zsh.ts              # Zsh template
    │   └── fish.ts             # Fish template
    └── installer.ts            # Installation logic

dist/completions/               # Built completion files (for distribution)
├── spaces.bash
├── _spaces                     # Zsh
└── spaces.fish

docs/
└── completion.md               # User documentation
```

## CLI Interface

### Generate completion script
```bash
# Output to stdout
spaces completion bash
spaces completion zsh
spaces completion fish

# Install automatically
spaces completion install           # Auto-detect shell
spaces completion install bash      # Force specific shell
spaces completion install --dry-run # Preview changes
```

### Hidden helper command
```bash
# These are invoked by completion scripts, not users
spaces __complete projects
spaces __complete workspaces
spaces __complete workspaces --project my-app
spaces __complete branches --project my-app
```

## Performance Considerations

### Caching Strategy
1. **In-memory cache** for completion helper
   - Cache workspace list for 60 seconds
   - Cache project list for 60 seconds
   - Invalidate on any write operation

2. **Shell-side caching**
   - Zsh: Use `_cache_store` and `_retrieve_cache`
   - Bash: Write to `/tmp/spaces-completion-cache-$USER`
   - Fish: Use Fish's built-in completion caching

### Fast Startup
- Keep `__complete` command minimal
- Don't load full CLI framework for helper
- Direct filesystem access instead of config parsing where possible

## Testing Strategy

### Manual Testing Checklist
- [ ] Tab completion shows all commands
- [ ] Completing `spaces sw<TAB>` → `spaces switch`
- [ ] Completing `spaces switch <TAB>` → shows workspaces
- [ ] Completing `spaces switch project <TAB>` → shows projects
- [ ] Completing `spaces add --<TAB>` → shows flags
- [ ] Completing `spaces list <TAB>` → shows `projects` and `workspaces`
- [ ] Works in subdirectories
- [ ] Works when no projects exist
- [ ] Performance is fast (<50ms)

### Automated Testing
```bash
# Test completion output
test_bash_completion() {
  local script=$(spaces completion bash)
  assert_contains "$script" "_spaces_completion"
  assert_contains "$script" "complete -F"
}

# Test helper output
test_completion_helper() {
  # Create test project
  spaces add project --no-clone test-project

  local projects=$(spaces __complete projects)
  assert_contains "$projects" "test-project"
}
```

## Documentation

### User Guide (README.md section)
```markdown
## Shell Completion

Spaces supports tab completion for Bash, Zsh, and Fish.

### Installation

**Automatic** (recommended):
```bash
spaces completion install
```

**Manual**:
```bash
# Bash
spaces completion bash >> ~/.bashrc
source ~/.bashrc

# Zsh
spaces completion zsh > ~/.zsh/completions/_spaces
# Add to .zshrc: fpath=(~/.zsh/completions $fpath)

# Fish
spaces completion fish > ~/.config/fish/completions/spaces.fish
```

### Usage
After installation, use `<TAB>` to complete:
- Commands: `spaces sw<TAB>` → `switch`
- Workspaces: `spaces switch my-<TAB>` → `my-feature`
- Options: `spaces add --<TAB>` → shows all flags
```

### Developer Guide (CLAUDE.md section)
```markdown
## Completion System

The completion system has two parts:
1. **Completion scripts** - Shell-specific files that define completion behavior
2. **Completion helper** - Fast CLI command that provides dynamic data

Adding new completions:
1. Update `src/completions/templates/*.ts` with new command/option
2. Update `src/commands/completion-helper.ts` to provide dynamic data
3. Test in all three shells
```

## Edge Cases to Handle

1. **No projects exist** - Don't fail, return empty list
2. **No workspaces exist** - Return helpful message or empty
3. **Invalid project context** - Gracefully handle when current project is invalid
4. **Permission errors** - Don't crash completion on unreadable directories
5. **Slow filesystem** - Timeout after 100ms, return partial results
6. **Multiple shells** - Detect which shells are available before installing

## Success Metrics

- ✅ Completion works in Bash 4.x+, Zsh 5.x+, Fish 3.x+
- ✅ All commands, subcommands, and options are completable
- ✅ Dynamic completion works for projects and workspaces
- ✅ Completion response time <50ms for typical usage
- ✅ Installation is one command for most users
- ✅ Documentation is clear and comprehensive
- ✅ No errors when no projects/workspaces exist

## Future Enhancements

- **Smart ranking** - Prioritize recently used workspaces
- **Fuzzy matching** - Complete `spaces switch my-ft<TAB>` → `my-feature`
- **Description preview** - Show workspace branch/status in completion
- **Command history integration** - Learn from usage patterns
- **Alias expansion** - Complete custom aliases defined in config

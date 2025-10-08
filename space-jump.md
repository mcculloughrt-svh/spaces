# Spaces Jump Implementation Plan

## Overview
Implement `spaces jump` command for fast fuzzy-matching workspace switching with smart ranking based on usage patterns, recency, and git status.

## Goals
- **Instant switching** with partial/fuzzy workspace names
- **Smart ranking** based on recency, frequency, and context
- **Fallback search** across all projects when workspace not found in current project
- **Minimal typing** - optimize for developer flow
- **No configuration required** - smart defaults that learn from usage

## User Experience

### Basic Usage
```bash
# Instead of:
spaces switch my-super-long-feature-name

# Just type:
spaces jump my-super    # Matches "my-super-long-feature-name"
spaces jump super       # Also matches (fuzzy)
spaces j feat           # Abbreviation + fuzzy match

# Interactive when ambiguous:
spaces jump my-
# → Shows ranked list of matches:
#   1. my-feature-a     (current project, used 2m ago)
#   2. my-feature-b     (current project, used 1h ago)
#   3. my-new-idea      (other-project, used 3d ago)
```

### Advanced Features
```bash
# Jump to workspace in different project
spaces jump other-project:workspace-name
spaces jump op:ws                         # Fuzzy match both

# Jump with filters
spaces jump --dirty                # Only workspaces with uncommitted changes
spaces jump --stale                # Only stale workspaces
spaces jump --active               # Only workspaces with active tmux sessions

# Jump to last used workspace (resume)
spaces jump -                      # Or: spaces resume
spaces jump --previous             # Alternative syntax

# Jump with history navigation
spaces jump @1                     # 1st most recent workspace
spaces jump @2                     # 2nd most recent workspace
```

## Architecture

### 1. Jump History Tracking
**Location**: `~/spaces/.jump-history.json`

**Schema**:
```typescript
interface JumpHistory {
  version: string;
  workspaces: {
    [key: string]: WorkspaceUsageStats;  // key: "project:workspace"
  };
  sessions: JumpSession[];  // Recent jump history
}

interface WorkspaceUsageStats {
  project: string;
  workspace: string;
  lastAccessed: string;      // ISO timestamp
  accessCount: number;        // Total times accessed
  totalTimeSpent: number;     // Milliseconds (estimated)
  firstAccessed: string;      // ISO timestamp
}

interface JumpSession {
  from: string | null;        // "project:workspace" or null
  to: string;                 // "project:workspace"
  timestamp: string;          // ISO timestamp
  duration?: number;          // Time spent (if known)
}
```

### 2. Fuzzy Matching Algorithm
**Location**: `src/utils/fuzzy-match.ts`

**Implementation**:
```typescript
interface FuzzyMatch {
  item: string;
  score: number;
  matches: number[];  // Character indices that matched
}

export function fuzzyMatch(query: string, candidates: string[]): FuzzyMatch[] {
  // Algorithm:
  // 1. Convert query to lowercase
  // 2. For each candidate:
  //    - Check if all query chars exist in order
  //    - Calculate score based on:
  //      * Consecutive character matches (bonus)
  //      * Word boundary matches (bonus)
  //      * Case matches (bonus)
  //      * Distance between matches (penalty)
  // 3. Sort by score descending
  // 4. Return top matches
}
```

**Scoring Weights**:
- Consecutive match: +10 points
- Word boundary match: +5 points (e.g., "fb" matches "feature-branch")
- Exact case match: +2 points
- Character proximity: -1 point per gap
- Start of string match: +15 points

### 3. Smart Ranking System
**Location**: `src/utils/workspace-ranker.ts`

**Ranking Algorithm**:
```typescript
interface RankedWorkspace {
  project: string;
  workspace: string;
  score: number;
  reasons: string[];  // Why this score? (for debugging)
}

export function rankWorkspaces(
  workspaces: WorkspaceInfo[],
  query: string,
  context: RankingContext
): RankedWorkspace[] {
  // Scoring factors:
  // 1. Fuzzy match score (0-100)
  // 2. Recency bonus (0-50)
  // 3. Frequency bonus (0-30)
  // 4. Current project bonus (+20)
  // 5. Active tmux session (+10)
  // 6. Uncommitted changes (configurable: +5 or -5)
  // 7. Name length (shorter = +5)
}
```

**Recency Calculation**:
```typescript
function calculateRecencyBonus(lastAccessed: Date): number {
  const hoursAgo = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 1) return 50;        // <1h ago: max bonus
  if (hoursAgo < 24) return 30;       // <1d ago: high bonus
  if (hoursAgo < 168) return 15;      // <1w ago: medium bonus
  if (hoursAgo < 720) return 5;       // <1mo ago: low bonus
  return 0;                            // >1mo ago: no bonus
}
```

**Frequency Calculation**:
```typescript
function calculateFrequencyBonus(accessCount: number, firstAccessed: Date): number {
  const daysOld = (Date.now() - firstAccessed.getTime()) / (1000 * 60 * 60 * 24);
  const accessesPerDay = accessCount / Math.max(daysOld, 1);

  if (accessesPerDay > 5) return 30;   // Very frequent
  if (accessesPerDay > 2) return 20;   // Frequent
  if (accessesPerDay > 0.5) return 10; // Moderate
  return 5;                            // Occasional
}
```

### 4. Jump Command Implementation
**Location**: `src/commands/jump.ts`

```typescript
export async function jump(
  query?: string,
  options: JumpOptions = {}
): Promise<void> {
  // 1. Handle special queries
  if (!query || query === '-' || options.previous) {
    return jumpToPrevious();
  }

  if (query.startsWith('@')) {
    const index = parseInt(query.slice(1), 10);
    return jumpToHistoryIndex(index);
  }

  // 2. Parse project:workspace format
  const [projectQuery, workspaceQuery] = query.includes(':')
    ? query.split(':')
    : [null, query];

  // 3. Gather candidates
  const candidates = await gatherWorkspaceCandidates(projectQuery, options);

  // 4. Fuzzy match + rank
  const matches = fuzzyMatch(workspaceQuery, candidates.map(c => c.workspace));
  const ranked = rankWorkspaces(
    candidates.filter((c, i) => matches[i]?.score > 30),  // Threshold
    workspaceQuery,
    { currentProject: getCurrentProject(), history: loadHistory() }
  );

  // 5. Handle results
  if (ranked.length === 0) {
    throw new SpacesError(`No workspaces match "${query}"`, 'USER_ERROR', 1);
  }

  if (ranked.length === 1 || options.force) {
    // Direct jump
    return jumpToWorkspace(ranked[0].project, ranked[0].workspace, options);
  }

  // 6. Interactive selection (show top 10)
  const selected = await selectItem(
    ranked.slice(0, 10).map(formatWorkspaceChoice),
    `Multiple matches for "${query}":`
  );

  if (selected) {
    const [project, workspace] = parseWorkspaceChoice(selected);
    return jumpToWorkspace(project, workspace, options);
  }
}

async function gatherWorkspaceCandidates(
  projectQuery: string | null,
  options: JumpOptions
): Promise<WorkspaceCandidate[]> {
  const candidates: WorkspaceCandidate[] = [];

  if (projectQuery) {
    // Search specific project (with fuzzy match)
    const projects = getAllProjectNames();
    const projectMatches = fuzzyMatch(projectQuery, projects);

    for (const match of projectMatches.slice(0, 3)) {
      const workspaces = await getWorkspacesForProject(match.item);
      candidates.push(...workspaces.map(w => ({
        project: match.item,
        workspace: w,
        ...getWorkspaceInfo(match.item, w)
      })));
    }
  } else {
    // Search current project first, then others
    const currentProject = getCurrentProject();

    if (currentProject) {
      const workspaces = await getWorkspacesForProject(currentProject);
      candidates.push(...workspaces.map(w => ({
        project: currentProject,
        workspace: w,
        ...getWorkspaceInfo(currentProject, w)
      })));
    }

    // Also search other projects if enabled
    if (!options.currentProjectOnly) {
      const otherProjects = getAllProjectNames().filter(p => p !== currentProject);
      for (const project of otherProjects) {
        const workspaces = await getWorkspacesForProject(project);
        candidates.push(...workspaces.map(w => ({
          project,
          workspace: w,
          ...getWorkspaceInfo(project, w)
        })));
      }
    }
  }

  // Apply filters
  if (options.dirty) {
    candidates = candidates.filter(c => c.uncommittedChanges > 0);
  }
  if (options.stale) {
    const staleDays = readGlobalConfig().staleDays;
    candidates = candidates.filter(c =>
      daysSince(c.lastCommitDate) > staleDays
    );
  }
  if (options.active) {
    candidates = candidates.filter(async c =>
      await sessionExists(c.workspace)
    );
  }

  return candidates;
}

async function jumpToWorkspace(
  project: string,
  workspace: string,
  options: JumpOptions
): Promise<void> {
  // 1. Record jump in history
  recordJump(project, workspace);

  // 2. Switch project if needed
  const currentProject = getCurrentProject();
  if (currentProject !== project) {
    logger.info(`Switching from project "${currentProject}" to "${project}"`);
    setCurrentProject(project);
  }

  // 3. Switch to workspace (reuse existing logic)
  await switchWorkspace(workspace, {
    noTmux: options.noTmux,
    newWindow: options.newWindow
  });
}
```

## History Management

### Recording Jumps
```typescript
// src/utils/jump-history.ts

export function recordJump(project: string, workspace: string): void {
  const history = loadHistory();
  const key = `${project}:${workspace}`;
  const now = new Date().toISOString();

  // Update workspace stats
  if (!history.workspaces[key]) {
    history.workspaces[key] = {
      project,
      workspace,
      lastAccessed: now,
      accessCount: 1,
      totalTimeSpent: 0,
      firstAccessed: now
    };
  } else {
    const stats = history.workspaces[key];

    // Calculate time spent in previous workspace
    const lastSession = history.sessions[history.sessions.length - 1];
    if (lastSession && !lastSession.duration) {
      const duration = Date.now() - new Date(lastSession.timestamp).getTime();
      lastSession.duration = duration;

      // Add to total time spent
      const prevKey = lastSession.to;
      if (history.workspaces[prevKey]) {
        history.workspaces[prevKey].totalTimeSpent += duration;
      }
    }

    stats.lastAccessed = now;
    stats.accessCount++;
  }

  // Add session record
  const previousSession = history.sessions[history.sessions.length - 1];
  history.sessions.push({
    from: previousSession?.to || null,
    to: key,
    timestamp: now
  });

  // Keep only last 1000 sessions
  if (history.sessions.length > 1000) {
    history.sessions = history.sessions.slice(-1000);
  }

  saveHistory(history);
}
```

### Loading/Saving History
```typescript
const HISTORY_PATH = join(getSpacesDir(), '.jump-history.json');

export function loadHistory(): JumpHistory {
  if (!existsSync(HISTORY_PATH)) {
    return {
      version: '1.0.0',
      workspaces: {},
      sessions: []
    };
  }

  try {
    const content = readFileSync(HISTORY_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.warning('Failed to load jump history, using empty history');
    return { version: '1.0.0', workspaces: {}, sessions: [] };
  }
}

export function saveHistory(history: JumpHistory): void {
  try {
    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
  } catch (error) {
    logger.debug(`Failed to save jump history: ${error}`);
    // Don't fail the operation if history save fails
  }
}
```

## CLI Interface

### Command Registration
```typescript
// src/index.ts

program
  .command('jump')
  .alias('j')
  .description('Quickly jump to a workspace with fuzzy matching')
  .argument('[query]', 'Workspace name or pattern (supports fuzzy matching)')
  .option('-', 'Jump to previous workspace')
  .option('--previous', 'Jump to previous workspace')
  .option('--dirty', 'Only show workspaces with uncommitted changes')
  .option('--stale', 'Only show stale workspaces')
  .option('--active', 'Only show workspaces with active tmux sessions')
  .option('--current-project-only', 'Only search in current project')
  .option('--no-tmux', "Don't create/attach tmux session")
  .option('--new-window', 'Create new window in existing session')
  .option('-f, --force', 'Jump to first match without confirmation')
  .action(async (query, options) => {
    await checkFirstTimeSetup();
    try {
      await jump(query, options);
    } catch (error) {
      handleError(error);
    }
  });

// Add alias for resume
program
  .command('resume')
  .description('Resume last workspace (alias for "jump -")')
  .action(async () => {
    await checkFirstTimeSetup();
    try {
      await jump('-', {});
    } catch (error) {
      handleError(error);
    }
  });
```

## Implementation Steps

### Phase 1: Core Jump Functionality (Week 1)
1. **Implement fuzzy matching**
   - Create `src/utils/fuzzy-match.ts`
   - Write unit tests for scoring algorithm
   - Optimize for performance (<10ms for 100 items)

2. **Implement jump command**
   - Create `src/commands/jump.ts`
   - Support basic fuzzy matching to workspace name
   - Handle current project only first
   - Reuse `switchWorkspace` logic

3. **Add CLI registration**
   - Register `jump` command
   - Add `-j` alias
   - Add basic options (--no-tmux, --force)

### Phase 2: History Tracking (Week 1-2)
1. **Implement history data model**
   - Create `src/utils/jump-history.ts`
   - Implement `loadHistory()` and `saveHistory()`
   - Add migration support for future schema changes

2. **Integrate history recording**
   - Record jumps in `jump` command
   - Record jumps in `switch` command (for consistency)
   - Calculate duration between sessions

3. **Implement history-based features**
   - `jump -` to jump to previous
   - `jump @1`, `jump @2` for history index
   - Show history in jump list (recency indicator)

### Phase 3: Smart Ranking (Week 2)
1. **Implement ranking algorithm**
   - Create `src/utils/workspace-ranker.ts`
   - Calculate recency score
   - Calculate frequency score
   - Combine with fuzzy match score

2. **Add context awareness**
   - Boost current project matches
   - Boost active tmux sessions
   - Integrate git status (uncommitted changes)

3. **Display ranked results**
   - Format workspace choices with metadata
   - Show why each match was ranked (--verbose mode)
   - Color-code by relevance

### Phase 4: Advanced Features (Week 2-3)
1. **Cross-project search**
   - Implement `project:workspace` syntax
   - Fuzzy match project names too
   - Auto-switch projects

2. **Filtering options**
   - `--dirty` filter
   - `--stale` filter
   - `--active` filter
   - Combine multiple filters

3. **Performance optimization**
   - Cache workspace info for 30 seconds
   - Parallelize git status checks
   - Lazy load history only when needed

### Phase 5: Polish & Documentation (Week 3)
1. **Error handling**
   - Handle missing workspaces gracefully
   - Handle corrupted history file
   - Provide helpful error messages

2. **Testing**
   - Unit tests for fuzzy matching
   - Unit tests for ranking
   - Integration tests for jump command
   - Test with large numbers of workspaces (100+)

3. **Documentation**
   - Add to README.md
   - Add examples to help text
   - Document fuzzy matching behavior
   - Document ranking algorithm

## File Structure
```
src/
├── commands/
│   └── jump.ts                    # Main jump command
├── utils/
│   ├── fuzzy-match.ts            # Fuzzy matching algorithm
│   ├── workspace-ranker.ts       # Smart ranking system
│   └── jump-history.ts           # History tracking
└── types/
    └── jump.ts                   # TypeScript types

~/spaces/
└── .jump-history.json            # Persistent usage data
```

## Example Interactions

### Simple fuzzy match
```bash
$ spaces jump feat
✓ Switched to workspace: feature-login (my-app)
```

### Multiple matches - interactive
```bash
$ spaces jump my-
? Multiple matches for "my-":
  1. my-feature-auth    [my-app] (main +2 -0, 5 uncommitted, active, 2m ago)
  2. my-feature-ui      [my-app] (main +0 -0, clean, 1h ago)
  3. my-refactor        [other-app] (develop +5 -2, clean, 3d ago)
> 1

✓ Switched to workspace: my-feature-auth (my-app)
```

### Cross-project jump
```bash
$ spaces jump other:workspace
✓ Switched from project "my-app" to "other-app"
✓ Switched to workspace: workspace-name (other-app)
```

### Resume last workspace
```bash
$ spaces jump -
✓ Resumed workspace: feature-login (my-app)
```

### Filter by status
```bash
$ spaces jump --dirty
? Workspaces with uncommitted changes:
  1. my-feature-auth    [my-app] (5 uncommitted, 2m ago)
  2. bugfix-123         [my-app] (2 uncommitted, 1d ago)
> 1
```

## Performance Targets

- Fuzzy match 100 workspaces: <10ms
- Rank 100 workspaces: <20ms
- Load history file: <5ms
- Save history file: <10ms
- Full jump operation: <100ms (excluding tmux attach)
- Interactive selection: <200ms to display results

## Success Metrics

- ✅ Fuzzy matching accurately finds workspaces with partial names
- ✅ Ranking prioritizes recently/frequently used workspaces
- ✅ History tracking persists across sessions
- ✅ Cross-project jumping works seamlessly
- ✅ Performance meets targets even with 100+ workspaces
- ✅ Works with zero configuration
- ✅ Fallback behavior when history file is missing/corrupted

## Future Enhancements

- **Machine learning ranking** - Learn from user corrections (when they pick #2 instead of #1)
- **Workspace pinning** - Pin frequently used workspaces to top
- **Jump aliases** - User-defined shortcuts (e.g., `spaces jump @work` → specific workspace)
- **Team sync** - Share jump history/rankings across team
- **Integration with shell history** - Boost workspaces where you run certain commands
- **Time-of-day awareness** - Different rankings for morning vs afternoon
- **Project affinity** - Learn which workspaces are often used together

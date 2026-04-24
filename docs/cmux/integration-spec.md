# cmux Backend Integration — Specification

Target: add cmux as a first-class multiplexer backend alongside tmux/zellij/shell.

Branch: `support-cmux`. See [INDEX.md](INDEX.md) for cmux API/docs research.

---

## 1. Goals & non-goals

**Goals**
- `spaces add <ws>` and `spaces switch <ws>` create/select a cmux workspace that mirrors the tmux flow: a sidebar entry whose `cwd` is the worktree path, with pre/setup/select scripts running at the right moments.
- Users can customize pane layout per project via a hand-editable `cmux.template.json` (analog of `tmux.template.conf`).
- Existing tmux flow unchanged for users who don't touch cmux.
- `spaces remove` and `spaces clean` correctly close cmux workspaces (no zombie sidebar entries).

**Non-goals (v1)**
- Running cmux from outside a cmux surface (see §3).
- Automatic workspace coloring.
- Browser-pane auto-attach for Linear issues (deferred).
- Progress bars / rich sidebar metadata beyond one status pill during setup.

---

## 2. Architecture

### 2.1 Strategy: native backend

A new `CmuxBackend` class implementing `MultiplexerBackend` at
`src/multiplexers/backends/cmux.ts`, registered in `src/multiplexers/registry.ts`.

Rejected: tmux-compat shim pattern. cmux's own shim model targets orchestrators
cmux itself launches (PATH-injected); spaces launches itself from a surface, so
the shim would need its own lifecycle. Native backend is a cleaner match for the
existing abstraction and unlocks cmux-only features (notifications, status pills).

### 2.2 Capability flags

```ts
readonly capabilities: MultiplexerCapabilities = {
  persistentSessions: true,  // workspaces persist until closed
  sendCommands: true,        // surface.send_text RPC
  multipleWindows: true,     // cmux macOS Windows
  panes: true,               // surface.split
  configFiles: true,         // cmux.json per worktree
  nestingDetection: true,    // CMUX_WORKSPACE_ID env var
  sessionSwitching: true,    // workspace.select RPC
  sessionListing: true,      // workspace.list RPC
}
```

### 2.3 Type additions

- `MultiplexerId` gains `'cmux'`. Update in `src/types/config.ts`:
  ```ts
  export type MultiplexerId = 'tmux' | 'zellij' | 'shell' | 'cmux' | null;
  const VALID_MULTIPLEXER_IDS = ['tmux', 'zellij', 'shell', 'cmux'] as const;
  ```
- Registry `BackendId` union in `registry.ts` gains `'cmux'`.
- `backends` Map adds `['cmux', () => new CmuxBackend()]`.

### 2.4 RPC client

New helper module `src/core/cmux-rpc.ts`:
- Single newline-terminated JSON per call over `process.env.CMUX_SOCKET_PATH` (fallback `/tmp/cmux.sock`).
- One connection per call (safe default from docs).
- Thin wrappers for: `system.ping`, `system.capabilities`, `workspace.list`,
  `workspace.create`, `workspace.select`, `workspace.close`, `workspace.current`,
  `surface.list`, `surface.split`, `surface.send_text`, `surface.send_key`,
  `notification.create`, `set-status`, `clear-status`.
- Returns typed results; error responses (`ok: false`) throw `SpacesError` with
  `SYSTEM_ERROR`.

---

## 3. Access model & detection

### 3.1 Access model: inside-cmux-only

`automation.socketControlMode` defaults to `cmuxOnly`. spaces does **not**
attempt to modify this setting. The cmux backend is only considered available
when spaces is invoked from within a cmux surface
(`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` present, socket reachable).

### 3.2 `isAvailable()`

Returns true iff **both**:
1. `cmux` CLI on PATH (`which cmux` succeeds), AND
2. `system.ping` RPC returns `ok: true`.

If the socket is absent (cmux app not running, or socketControlMode rejects us),
`isAvailable()` returns false. The registry then falls back to the next backend.

### 3.3 `isInsideSession()`

```ts
isInsideSession(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID
}
```

### 3.4 `getCurrentSessionName()`

Issue `workspace.current` RPC; return workspace name. null if not inside cmux.

### 3.5 Fallback when outside cmux with cmux preferred

If `multiplexer` preference is `cmux` but `isAvailable()` returns false
(typically: user is in iTerm/Terminal.app), the registry falls back to the
next available backend (`tmux > zellij > shell`) and `logger.warning()`s once:

```
cmux backend unavailable (must be run from inside a cmux surface); using tmux.
```

### 3.6 Auto-detect priority

Current priority: `tmux > zellij > shell`.

New behavior: if `CMUX_WORKSPACE_ID` is set at auto-detect time, prefer
`cmux > tmux > zellij > shell`. Outside cmux, priority is unchanged, so
existing tmux users see no behavior change.

Implementation in `detectBestBackend()`:
```ts
const priority: BackendId[] = process.env.CMUX_WORKSPACE_ID
  ? ['cmux', 'tmux', 'zellij', 'shell']
  : ['tmux', 'zellij', 'shell']
```

### 3.7 Soft version gating

On first cmux call per process, issue `system.capabilities` and cache the result.
Required methods: `workspace.create`, `workspace.select`, `workspace.close`,
`workspace.list`, `surface.list`, `surface.send_text`, `surface.send_key`.

If any required method is missing, `logger.warning` with the missing list and
return `isAvailable(): false` (triggers fallback). No hard version pin —
capability-gated.

---

## 4. Per-workspace layout: `cmux.json`

### 4.1 Files on disk

Project directory gains a template file:

```
~/spaces/<project>/
  ├── .config.json
  ├── tmux.template.conf         (already written today)
  ├── cmux.template.json         (NEW — always written at project add)
  ├── base/
  └── workspaces/
      └── <ws>/
          ├── .tmux.conf         (copy of tmux.template.conf)
          └── cmux.json          (rendered from cmux.template.json)
```

`cmux.template.json` is written **unconditionally** at project add, alongside
`tmux.template.conf`. This preserves tmux-first flexibility and lets users
switch backends later without reinitializing.

### 4.2 Template format

One top-level `commands[]` entry: a single cmux workspace command.

**Default (no llmAssistant):**
```jsonc
{
  "commands": [
    {
      "name": "Open {{workspace}}",
      "keywords": ["spaces", "{{workspace}}"],
      "restart": "ignore",
      "workspace": {
        "name": "{{workspace}}",
        "cwd": "{{cwd}}",
        "layout": {
          "pane": {
            "surfaces": [
              {
                "type": "terminal",
                "name": "{{workspace}}",
                "focus": true,
                "command": "<SPACES_RUNNER>"
              }
            ]
          }
        }
      }
    }
  ]
}
```

**With llmAssistant (horizontal split, assistant left, shell right):**
```jsonc
{
  "commands": [{
    "name": "Open {{workspace}}",
    "keywords": ["spaces", "{{workspace}}"],
    "restart": "ignore",
    "workspace": {
      "name": "{{workspace}}",
      "cwd": "{{cwd}}",
      "layout": {
        "direction": "horizontal",
        "split": 0.5,
        "children": [
          {
            "pane": {
              "surfaces": [{
                "type": "terminal",
                "name": "<llmAssistant>",
                "command": "<llmAssistant>",
                "focus": false
              }]
            }
          },
          {
            "pane": {
              "surfaces": [{
                "type": "terminal",
                "name": "shell",
                "focus": true,
                "command": "<SPACES_RUNNER>"
              }]
            }
          }
        ]
      }
    }
  }]
}
```

### 4.3 Token substitution

At render time, spaces does literal string replacement on the template:

| Token              | Value                                                |
|--------------------|------------------------------------------------------|
| `{{workspace}}`    | workspace name (e.g. `feat-x`)                       |
| `{{cwd}}`          | absolute worktree path                               |
| `{{repository}}`   | `owner/repo` from project config                     |

Substitution runs before JSON parsing — tokens may appear anywhere a string
does. Comments and trailing commas in the template are preserved
(cmux accepts JSONC); the rendered file is also JSONC.

### 4.4 `<SPACES_RUNNER>` expansion

Not a template token — a code-generated shell one-liner injected into the
runner surface's `command` field:

```bash
if [ -f .spaces-setup ]; then
  for s in ~/spaces/<project>/scripts/select/*.sh; do
    [ -x "$s" ] && "$s" <workspace> <repository>;
  done;
else
  (for s in ~/spaces/<project>/scripts/setup/*.sh; do
    [ -x "$s" ] && "$s" <workspace> <repository> || exit $?;
  done) && touch .spaces-setup && cmux notify "Setup complete: <workspace>";
fi
```

Notes:
- `cmux notify` at end of setup path is v1 bonus (see §6.1).
- Status-pill wrapper (§6.2) wraps the setup branch with `cmux set-status`/`clear-status`.
- Placeholder substitution for `<project>`, `<workspace>`, `<repository>` is
  done in code (shell-safely quoted) — not via the `{{}}` tokens, to keep
  this behavior stable when users hand-edit the template.

### 4.5 Template generation at project add

In `createProject()` (src/core/config.ts):
1. Continue writing `tmux.template.conf` as today.
2. Additionally write `cmux.template.json`:
   - If `llmAssistant` set → the split-layout variant.
   - Else → the single-surface variant.
3. Top-of-file comment block explaining the `{{}}` tokens and
   `<SPACES_RUNNER>` semantics.

### 4.6 Collision with repo-owned `cmux.json`

When a worktree is created, `git worktree add` checks out whatever the branch
contains. If the repo itself ships a `cmux.json` at its root, that file lands at
`<worktree>/cmux.json` automatically.

**Behavior:** if `<worktree>/cmux.json` exists after worktree creation, spaces
does **not** overwrite it. Logs:

```
repo ships cmux.json at worktree root; using as-is (skipping spaces-generated file)
```

spaces still drives `workspace.create` via RPC using its own in-memory layout
(rendered from `cmux.template.json`), so setup/select scripts run regardless of
what the repo's `cmux.json` says. The on-disk repo file remains available for
the palette; the RPC path is authoritative for spaces-initiated workspaces.

### 4.7 Regeneration policy

`cmux.json` is generated once at workspace creation and not re-synced if the
template changes. Future `spaces init` / `spaces regen` tooling is out of scope
for v1.

---

## 5. Trust (`customCommands.trustedDirectories`)

cmux prompts "untrusted directory" every time a `cmux.json` outside of
`trustedDirectories` is loaded. spaces auto-appends the project path.

### 5.1 Trigger

Check + prompt runs on the **first `spaces add <ws>` with cmux backend active
per project**. Track via a simple marker file at
`~/spaces/<project>/.cmux-trusted` (empty file, existence = we've already
handled this project). Not re-checked once the marker exists.

### 5.2 Flow

1. Read `~/.config/cmux/settings.json` (or the Application Support fallback).
2. If `customCommands.trustedDirectories` already contains the project path
   (`~/spaces/<project>` resolved absolute), write the marker and continue.
3. Otherwise, compute the JSON diff and show it:
   ```
   spaces needs to add this project to cmux's trusted directories:

     customCommands.trustedDirectories:
     + "/Users/you/spaces/myapp"

   File: ~/.config/cmux/settings.json
   ```
4. `promptConfirm('Apply this change?', true)`. If no → print manual
   instructions + skip (marker not written, we'll re-ask next time).
5. If yes → rewrite settings.json preserving JSONC/comments/trailing commas
   (use a tolerant parser such as `jsonc-parser` or a minimal in-place splice
   that targets the `trustedDirectories` array). Write the marker.

### 5.3 Settings path resolution

Prefer `~/.config/cmux/settings.json`. If that doesn't exist, check
`~/Library/Application Support/com.cmuxterm.app/settings.json`. If neither
exists, create `~/.config/cmux/settings.json` with a minimal schema.

### 5.4 No socket-mode patching

spaces does **not** modify `automation.socketControlMode`. The inside-cmux
access model means the default `cmuxOnly` is already permissive enough for
spaces' child-of-surface invocations. Leave this setting to the user.

---

## 6. Bonus features (v1)

### 6.1 Setup-complete notification

At the end of the setup path in `<SPACES_RUNNER>`, invoke:

```bash
cmux notify "Setup complete: <workspace>"
```

Desktop notification lands in macOS Notification Center. Trivial code addition;
genuinely useful for long `npm install` / `cargo build` setup scripts.

### 6.2 Status pill during setup

Wrap the setup branch of `<SPACES_RUNNER>` with pill commands:

```bash
cmux set-status --workspace <ws-id> --icon hourglass --color blue "setting up"
# ... run setup scripts ...
cmux clear-status --workspace <ws-id>
```

Resolved workspace id comes from `CMUX_WORKSPACE_ID` inside the surface. If
unset for any reason, `set-status` calls can omit the `--workspace` flag and
target the current workspace implicitly.

### 6.3 Deferred

- Browser pane for Linear issue URL.
- Progress bars (`set-progress`).
- Rich log entries (`log` RPC).

Document as `// TODO(cmux-bonus)` in code; revisit once v1 ships.

---

## 7. Backend method contracts

Class: `CmuxBackend implements MultiplexerBackend`.

| Method | Behavior |
|---|---|
| `id` | `'cmux'` |
| `displayName` | `'cmux'` |
| `capabilities` | see §2.2 |
| `sessionExists(name)` | `workspace.list` → any entry with `name === name`. |
| `createSession({name, workingDirectory, configPath, ...})` | Render layout from `cmux.template.json` (or from `<worktree>/cmux.json` if present and user-owned). Call `workspace.create` RPC with `{name, cwd: workingDirectory, layout}`. Returns `{success:true}` on ok response. |
| `attachSession({name, newWindow})` | If `newWindow`: open new cmux macOS Window (RPC or fallback to plain `workspace.select`). Else: `workspace.select` by name. Non-blocking — returns after RPC ack. |
| `killSession(name)` | `workspace.list` → if present, `workspace.close` by id. If not present, `{success:true}` (no-op). |
| `listSessions()` | `workspace.list` → map to `SessionInfo[]` with `isAttached` = whether currently selected. |
| `isInsideSession()` | `!!process.env.CMUX_WORKSPACE_ID` |
| `getCurrentSessionName()` | `workspace.current` RPC → `name`; `null` if outside cmux. |
| `sendCommand(sessionName, command)` | `workspace.list` → id. `surface.list` in that workspace → `surfaces[0].id`. `surface.send_text` text=command. `surface.send_key` key=`enter`. Return true/false. |
| `hasConfig(workspacePath)` | `existsSync(join(workspacePath, 'cmux.json'))`. |
| `getConfigFileName()` | `'cmux.json'` |
| `getTemplateFileName()` | `'cmux.template.json'` |
| `applyConfig(sessionName, configPath)` | No-op (layouts applied at create time via RPC). Return true. |
| `isAvailable()` | see §3.2 |
| `getInstallInstructions()` | `'Install cmux: https://cmux.com/docs/getting-started'` |
| `getCommandName()` | `'cmux'` |

### 7.1 `workspace.select` semantics

Per docs, selects an existing workspace in the current window. For
`attachSession` after `createOrAttachSession` decides the workspace exists, call
`workspace.select {workspace: id}`. Do not spawn a subprocess; don't
`process.exit()`. The caller's terminal stays alive — the cmux app just raises
the selected workspace.

### 7.2 `newWindow` behavior

`attachSession({newWindow: true})`:
- Primary path: RPC to create a new cmux macOS Window containing the workspace.
  Use `system.capabilities` to verify method exists.
- Fallback: `workspace.select` into the current window (log that `--new-window`
  was downgraded).

This matches user's mental model of `--new-window`: two workspaces visible
side-by-side on screen.

### 7.3 Non-existent workspace during `switchWorkspace`

The high-level `createOrAttachSession` in `src/multiplexers/index.ts` already
handles the exists/not-exists branching: if `sessionExists()` is false, it
calls `createSession()` then `attachSession()`. For cmux, this means:

```
spaces switch feat-x
  → workspace.list (is 'feat-x' present?)
    yes → workspace.select
    no  → render layout from cmux.json → workspace.create → workspace.select
```

No additional changes to `createOrAttachSession` needed; the behavior falls out
of the existing logic plus the backend method implementations.

---

## 8. Lifecycle flows

### 8.1 `spaces add project`

Unchanged flow, except:
- Prompt "Do you want an LLM assistant in tmux?" is **renamed** to
  `"Do you want an LLM assistant in your workspace?"` (backend-agnostic).
- `createProject()` additionally writes `cmux.template.json` — default or
  llmAssistant-split variant.
- `tmux.template.conf` still written (tmux-first behavior preserved).

### 8.2 `spaces add <ws>` with cmux backend active

1. Existing flow: create worktree.
2. Existing flow: copy `tmux.template.conf` → `.tmux.conf` IF tmux backend
   (this is already gated on `backend.getTemplateFileName()`).
3. New gating: if cmux backend AND `<worktree>/cmux.json` does not already
   exist, render `cmux.template.json` with `{{workspace}}` / `{{cwd}}` /
   `{{repository}}` + `<SPACES_RUNNER>` substitution → write to
   `<worktree>/cmux.json`.
4. New: trust check (§5) — once per project.
5. Existing flow: run pre scripts (terminal, outside cmux).
6. Existing flow: `createOrAttachSession` → delegates to backend.

### 8.3 Inside `CmuxBackend.createSession`

1. Build the layout tree in memory:
   - If `<worktree>/cmux.json` exists: parse it, extract `commands[0].workspace.layout`.
     (Honors repo-owned cmux.json per §4.6.)
   - Else: parse `~/spaces/<project>/cmux.template.json` + token substitution
     + `<SPACES_RUNNER>` injection into the runner surface.
2. Call `workspace.create` RPC with `{name, cwd, layout}`.
3. Success → return `{success:true}`. Errors → `{success:false, error}`.

Setup/select scripts run **inside cmux** as part of the surface's `command` —
spaces doesn't need to RPC send_text after creation. This is why
`createOrAttachSession` in `src/multiplexers/index.ts` works without changes:
scripts are baked into the initial surface command, not sent post-hoc. The
`runScriptsInSession()` helper is not invoked for cmux in practice because
the `scripts` discovered in the pre/setup/select dirs are embedded in the
layout's surface command via `<SPACES_RUNNER>`.

**Concretely**: the `SPACES_RUNNER` string is built from
`discoverScripts(setupScriptsDir)` and `discoverScripts(selectScriptsDir)` at
render time — spaces iterates the script dirs, shell-escapes paths, and emits
a static bash one-liner. The resulting `cmux.json` pins script execution at
workspace-open time, not at worktree-create time.

### 8.4 `spaces switch <ws>`

Unchanged: delegates to `createOrAttachSession`. Backend handles existing vs.
not-existing. See §7.3.

### 8.5 `spaces remove <ws>`

Existing flow, backend-abstracted. `CmuxBackend.killSession` issues
`workspace.close`. "Currently in session" check uses
`getCurrentSessionName()` which now returns the current cmux workspace name.

Detach instruction branch in `src/commands/remove.ts` currently has
`tmux`/`zellij` branches; add a `cmux` branch:

```ts
if (backend.id === 'cmux') {
  logger.info('  Switch to another cmux workspace (⌘1–⌘9 or the sidebar) and try again.')
}
```

### 8.6 `spaces clean` (**refactor required**)

`src/commands/clean.ts` today imports `killSession`, `sessionExists`,
`getCurrentSessionName` directly from `src/core/tmux.ts`. It must be refactored
to go through `getBackend(...)` (pattern: see `src/commands/remove.ts`).
Without this, `spaces clean` will delete cmux worktrees while leaving cmux
workspaces open with now-invalid `cwd`s.

Changes:
- Replace `import { killSession, sessionExists, getCurrentSessionName } from '../core/tmux.js'`
  with backend calls.
- Add backend-specific detach hints (same pattern as §8.5).

---

## 9. File-by-file change summary

### New files
- `src/multiplexers/backends/cmux.ts` — `CmuxBackend` class implementing `MultiplexerBackend`.
- `src/core/cmux-rpc.ts` — thin RPC client (connect, send, receive; typed wrappers).

### Modified files
- `src/types/config.ts` — add `'cmux'` to `MultiplexerId` and `VALID_MULTIPLEXER_IDS`.
- `src/multiplexers/registry.ts` — add `'cmux'` to `BackendId` and backends map; update `detectBestBackend()` priority for inside-cmux case.
- `src/core/config.ts` — `createProject()` writes `cmux.template.json`; rename LLM prompt wording is handled at the call site (add.ts); add renderer helper `renderCmuxTemplate(template, {workspace, cwd, repository}, runnerCommand)` or colocate in the new backend.
- `src/commands/add.ts` — change LLM prompt wording to "in your workspace"; render + write `<worktree>/cmux.json` when cmux backend active AND file doesn't already exist; add trust check (§5).
- `src/commands/remove.ts` — add cmux branch for detach hint.
- `src/commands/clean.ts` — refactor to use backend abstraction (§8.6).
- `src/utils/deps.ts` — no code change required; `getRequiredDeps()` already auto-adds backend deps via `backend.getCommandName()`. Cmux will flow through automatically.

### Documentation
- `CLAUDE.md` — remove the in-progress-work preamble for cmux or update it to "done"; add cmux to the backend list.
- `README.md` — user-facing: add cmux to supported multiplexers; document `cmux.template.json`; note inside-cmux requirement.

---

## 10. Testing checklist

Manual end-to-end (no unit-test framework in this repo today):

1. **Project add with cmux backend preference**
   - From inside a cmux surface: `spaces config multiplexer cmux && spaces add project`.
   - Verify: `cmux.template.json` written alongside `tmux.template.conf`.
   - Trust prompt appears on first `spaces add <ws>`.

2. **Workspace creation (no llmAssistant)**
   - `spaces add feat-x` → worktree created, `<worktree>/cmux.json` written, cmux workspace appears with single terminal surface. Setup scripts execute in that surface. `.spaces-setup` marker created.

3. **Workspace creation (llmAssistant set)**
   - Configure project with `llmAssistant: 'claude'` → generated cmux.json has horizontal split, left pane runs `claude`, right pane runs runner. Both surfaces visible after create.

4. **Switch to existing workspace**
   - `spaces switch feat-x` → cmux sidebar focuses feat-x. No re-create. Select scripts run in the runner surface.

5. **Switch to not-yet-opened workspace**
   - Close feat-x in cmux, then `spaces switch feat-x` → RPC `workspace.create` recreates the workspace with same layout.

6. **Repo-owned cmux.json**
   - Commit a `cmux.json` in the repo. `spaces add feat-y` → spaces respects the checked-out file, logs the skip, still creates the workspace via RPC.

7. **Trust prompt**
   - First workspace per project triggers trust check. Accept → settings.json updated. Reject → manual instructions printed, marker not written.

8. **Outside-cmux fallback**
   - In iTerm with preference=cmux: `spaces switch feat-x` warns once and falls back to tmux. Subsequent calls in same invocation don't re-warn.

9. **Removal**
   - `spaces remove feat-x` → cmux workspace closes, worktree removed. Current-workspace guard: run from inside feat-x's surface → refused with hint.

10. **Clean**
    - Stale workspace with open cmux workspace: `spaces clean` closes cmux workspace and removes worktree. (Verify after refactor per §8.6.)

11. **Version gating**
    - Mock missing `workspace.create` in `system.capabilities` → `isAvailable()` returns false; fallback chosen; warning logged.

12. **Notifications and status pill**
    - Slow setup script → status pill visible in sidebar during run; notification fires on completion.

---

## 11. Open questions / follow-ups

- **Worktree regeneration on template change** — v1 skips. Future: `spaces regen cmux.json` subcommand.
- **Browser pane for Linear issues** — deferred; nice UX win, low effort.
- **Color management** — deferred; user picks in cmux if desired.
- **Outside-cmux automation** — if we ever want `spaces switch` from iTerm to work, we'd need an opt-in `socketControlMode=allowAll` patch flow. Not in v1.
- **Ghostty config coupling** — cmux's terminals use Ghostty. If spaces ever wants to customize per-workspace terminal appearance, that's `~/.config/ghostty/config` (shared) and outside spaces' concern.
- **Error response shape** — cmux docs don't document the `ok:false` payload. Discover empirically during implementation; catch and surface `error.message || JSON.stringify(error)`.

---

## 12. Decisions captured (for reference)

| Topic | Decision |
|---|---|
| Integration strategy | Native `CmuxBackend` class |
| Socket access | Inside-cmux only; auto-fall back outside |
| Layout source | Per-worktree `cmux.json` at worktree root |
| Template | Project-level `cmux.template.json`, `{{}}` token substitution |
| Scripts | Baked into surface `command` as bash if/else on `.spaces-setup` marker |
| Trust | Auto-append with diff + confirm, on first `spaces add` per project |
| Socket mode | Not patched by spaces (leave as `cmuxOnly`) |
| Workspace name | Matches spaces workspace name 1:1 |
| Workspace color | Not managed by spaces |
| LLM assistant | Horizontal split, assistant left (no focus), runner right (focus) |
| LLM prompt | Renamed backend-agnostic: "in your workspace" |
| Switch flow | `workspace.select` if exists, else `workspace.create` from layout |
| Remove flow | `workspace.close` + worktree remove; refuse if current |
| `--new-window` | New cmux macOS Window; fallback to plain select |
| `sendCommand` | First surface of target workspace |
| Auto-detect priority | `cmux > tmux > zellij > shell` iff `CMUX_WORKSPACE_ID` set |
| Version gate | Soft `system.capabilities` check; fall back if methods missing |
| v1 bonus features | `cmux notify` on setup complete + status pill during setup |
| Collision with repo cmux.json | Respect existing; log; still use RPC-driven create |
| `spaces clean` | Refactor to backend abstraction (in scope) |

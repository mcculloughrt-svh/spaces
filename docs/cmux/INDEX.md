# cmux Documentation Index

Research index for adding cmux support as an additional backend to the spaces CLI.
Source: https://cmux.com/docs

## What is cmux?

cmux is a lightweight native macOS terminal built on Ghostty for managing multiple AI coding agents. It features vertical tabs (workspaces), split panes, embedded browser panes, a notification panel, and socket-based programmatic control. It is the natural comparator to tmux within the spaces tool — spaces currently shells out to `tmux`, and cmux offers analogous concepts with a richer API.

## Architectural TL;DR (for spaces integration)

Hierarchy: **Window → Workspace → Pane → Surface → Panel**
- `Workspace` = sidebar entry (what spaces currently calls a "workspace" maps cleanly).
- `Pane` = split region within a workspace.
- `Surface` = tab within a pane (terminal or browser).
- `Panel` = underlying Ghostty terminal or embedded webview.

Two primary integration surfaces for a backend:
1. **Declarative**: write a `cmux.json` with a custom command whose `workspace` layout encodes the desired pane tree. Opened via the command palette. See [custom-commands.md](custom-commands.md).
2. **Programmatic**: JSON-over-Unix-socket RPC at `/tmp/cmux.sock` (or `CMUX_SOCKET_PATH`). Same surface is exposed via the `cmux` CLI. See [api.md](api.md).

For spaces-style automation (creating a workspace, sending `send-keys` to run setup/select scripts), the **socket API** is the closest analog to tmux's `send-keys` / `new-window` model.

## Files in this index

| File | Covers | Remote URL |
|------|--------|-----------|
| [getting-started.md](getting-started.md) | Install, CLI setup, autoupdate, session restoration | https://cmux.com/docs/getting-started |
| [concepts.md](concepts.md) | Window/Workspace/Pane/Surface/Panel hierarchy | https://cmux.com/docs/concepts |
| [configuration.md](configuration.md) | `settings.json`, Ghostty config, full schema, precedence | https://cmux.com/docs/configuration |
| [custom-commands.md](custom-commands.md) | `cmux.json`, simple commands, workspace layout trees | https://cmux.com/docs/custom-commands |
| [api.md](api.md) | Socket protocol, CLI, all RPC methods, env vars | https://cmux.com/docs/api |
| [keyboard-shortcuts.md](keyboard-shortcuts.md) | All default bindings, chord syntax, customization | https://cmux.com/docs/keyboard-shortcuts |
| [browser-automation.md](browser-automation.md) | `cmux browser` CLI for browser panes | https://cmux.com/docs/browser-automation |
| [notifications.md](notifications.md) | `cmux notify`, OSC 777 / OSC 99, custom commands | https://cmux.com/docs/notifications |
| [ssh.md](ssh.md) | `cmux ssh`, remote daemon, port forwarding semantics | https://cmux.com/docs/ssh |
| [agent-integrations.md](agent-integrations.md) | claude-code-teams, omc, omx, omo + tmux shim pattern | https://cmux.com/docs/agent-integrations/* |
| [changelog.md](changelog.md) | Recent releases (0.61–0.63.2, through April 2026) | https://cmux.com/docs/changelog |

## Where to look first, by task

| If you need to… | Start here |
|-----------------|-----------|
| Detect whether cmux is available at runtime | [api.md § Detection](api.md) — check `CMUX_SOCKET_PATH`, `CMUX_WORKSPACE_ID`, or `which cmux` |
| Create a new workspace programmatically | [api.md § Workspace Commands](api.md) — `workspace.create` / `new-workspace` |
| Run a command in a specific surface (analog of `tmux send-keys`) | [api.md § Input Commands](api.md) — `surface.send_text`, `surface.send_key` |
| Define a multi-pane layout declaratively | [custom-commands.md § Workspace Commands](custom-commands.md) — `workspace.layout` tree |
| Set working directory for a workspace | `cwd` on workspace OR per-surface (both in custom-commands.md) |
| Wire up pre/setup/select script phases | Combine `workspace.create` + `surface.send_text` (see api.md) |
| Trigger a desktop notification from a script phase | [notifications.md](notifications.md) — `cmux notify` or OSC 777 |
| Target a specific surface in a chain of commands | [api.md § CLI Options](api.md) — `--window/--workspace/--surface` |
| Understand tmux-to-cmux translation (existing pattern) | [agent-integrations.md § Tmux Shim Pattern](agent-integrations.md) |
| See what `cmux.json` fields exist | [custom-commands.md § Fields tables](custom-commands.md) |
| Know the user-visible defaults (shortcuts, colors) | [configuration.md](configuration.md) + [keyboard-shortcuts.md](keyboard-shortcuts.md) |

## Key facts worth pinning

- Socket path default: `/tmp/cmux.sock` (debug: `/tmp/cmux-debug.sock`). Overridable via `CMUX_SOCKET_PATH`.
- Access mode default: `cmuxOnly` — only child processes of cmux can connect. For external control (e.g. a separate `spaces` CLI invocation), the user must set `socketControlMode` to `allowAll` or similar. Relevant: `automation.socketControlMode`, `CMUX_SOCKET_ENABLE`, `CMUX_SOCKET_MODE`.
- Protocol: newline-terminated JSON `{"id","method","params"}` → `{"id","ok",...}`.
- Env vars set inside a cmux surface: `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `CMUX_SOCKET_PATH`.
- Settings file: `~/.config/cmux/settings.json` (falls back to `~/Library/Application Support/com.cmuxterm.app/settings.json`). Reload: `Cmd+Shift+,` or `cmux reload-config`.
- Custom command file: `./cmux.json` (project, takes priority) or `~/.config/cmux/cmux.json` (global). JSON with comments + trailing commas allowed.
- Ghostty config is separate: `~/.config/ghostty/config` — where terminal look-and-feel lives.
- `cmux notify` works anywhere a terminal is open — including over SSH.
- Tmux-compat shim pattern (used by claude-code-teams, omc, omx, omo) translates `tmux` CLI calls to socket RPC. If spaces wants to keep a single codepath, this pattern is the reference.

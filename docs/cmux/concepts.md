# Concepts

Source: https://cmux.com/docs/concepts

## Hierarchy

```
Window
  └── Workspace     (sidebar entry, aka "tab")
        └── Pane    (split region)
              └── Surface   (tab within pane)
                    └── Panel   (terminal OR browser content)
```

## Each level

| Level | Created by | Identifier | Notes |
|-------|-----------|-----------|-------|
| Window | `⌘⇧N` | — | macOS app window. Each has its own sidebar of workspaces. |
| Workspace | `⌘N` | `CMUX_WORKSPACE_ID` | Sidebar entry, "tabs" in UI language. `⌘1–⌘9` to jump. |
| Pane | `⌘D` (right), `⌘⇧D` (down) | — | Split region inside a workspace. `⌥⌘ + arrow` to navigate. |
| Surface | `⌘T` | `CMUX_SURFACE_ID` | Tab within a pane. `⌘[` / `⌘]` or `⌃1–⌃9`. |
| Panel | internal | — | The actual Ghostty terminal or embedded browser. Users interact via surfaces, not panels. |

## Mapping to spaces concepts

| spaces concept | cmux analog |
|----------------|-------------|
| project | (none — projects are a spaces-level concept, orthogonal to cmux) |
| workspace (git worktree) | Workspace (sidebar entry) |
| tmux session for a workspace | Workspace itself (no separate session abstraction) |
| tmux pane/window | Pane + Surface |
| `.tmux.conf` per workspace | Per-workspace appearance is driven by `cmux.json` layout + global `settings.json`; there is no per-workspace config file sourced the way tmux sources `.tmux.conf` |

Implication: when porting spaces' tmux integration to cmux, the workspace-level `.tmux.conf` concept does **not** carry over directly. Per-workspace behavior is encoded either in the `cmux.json` workspace layout (declarative, at create time) or via socket RPC after creation.

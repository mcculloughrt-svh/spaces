# Custom Commands

Source: https://cmux.com/docs/custom-commands

Declarative counterpart to the socket API. Users (or tools) write a `cmux.json` that defines named commands surfaced in the command palette. Each command is either a **simple shell command** or a **workspace definition** (layout tree).

## File locations

1. `./cmux.json` — project-local (highest priority).
2. `~/.config/cmux/cmux.json` — global.

Project commands override global commands of the same name. Changes hot-reload (no restart). Project dirs must be trusted (`customCommands.trustedDirectories` in settings — see [configuration.md](configuration.md)).

## Top-level schema

```json
{
  "commands": [ /* array of commands */ ]
}
```

## Simple commands

```json
{
  "commands": [
    {
      "name": "Run Tests",
      "keywords": ["test", "check"],
      "command": "npm test",
      "confirm": true
    }
  ]
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | yes | Palette label |
| `description` | no | Help text |
| `keywords` | no | Extra search terms |
| `command` | no | Shell command to run in focused terminal |
| `confirm` | no | Show confirmation dialog first |

**cwd behavior**: runs in the focused terminal's current dir. For git-root: prefix with `cd "$(git rev-parse --show-toplevel)" && …`.

## Workspace commands

```json
{
  "commands": [
    {
      "name": "Dev Environment",
      "keywords": ["dev", "fullstack"],
      "restart": "confirm",
      "workspace": {
        "name": "Dev",
        "cwd": ".",
        "color": "#3b82f6",
        "layout": { /* layout tree */ }
      }
    }
  ]
}
```

| Workspace field | Description |
|-----------------|-------------|
| `name` | Tab title (defaults to command name) |
| `cwd` | Working dir for the workspace |
| `color` | Hex color for the sidebar tab |
| `layout` | Recursive layout tree |

`restart` (on the command, not the workspace):
- `"ignore"` — switch to existing if present (default).
- `"recreate"` — close and recreate without prompting.
- `"confirm"` — ask before recreating.

## Layout tree

Two node kinds: **split** and **pane**.

### Split node

```json
{
  "direction": "horizontal",
  "split": 0.5,
  "children": [ /* exactly 2 */ ]
}
```

- `direction`: `horizontal` (side-by-side) or `vertical` (stacked).
- `split`: 0.1–0.9, default 0.5.
- `children`: exactly two nodes (each split or pane).

### Pane node

```json
{
  "pane": {
    "surfaces": [ /* array of surface defs */ ]
  }
}
```

Leaf of the tree — holds one or more tabbed surfaces.

## Surface definition

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `type` | string | both | `terminal` or `browser` |
| `name` | string | both | Tab title |
| `command` | string | terminal | Auto-run shell command |
| `cwd` | string | both | Working directory |
| `env` | object | both | Environment variables |
| `url` | string | browser | URL to open |
| `focus` | bool | both | Focus after creation |

### cwd resolution

- `.` or omitted → workspace cwd
- `./sub` → relative to workspace cwd
- `~/x` → home expansion
- `/abs` → absolute

## Complete example

```json
{
  "commands": [
    {
      "name": "Web Dev",
      "description": "Docs site with live preview",
      "keywords": ["web", "docs", "next", "frontend"],
      "restart": "confirm",
      "workspace": {
        "name": "Web Dev",
        "cwd": "./web",
        "color": "#3b82f6",
        "layout": {
          "direction": "horizontal",
          "split": 0.5,
          "children": [
            {
              "pane": {
                "surfaces": [
                  {
                    "type": "terminal",
                    "name": "Next.js",
                    "command": "npm run dev",
                    "focus": true
                  }
                ]
              }
            },
            {
              "direction": "vertical",
              "split": 0.6,
              "children": [
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "browser",
                        "name": "Preview",
                        "url": "http://localhost:3777"
                      }
                    ]
                  }
                },
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "terminal",
                        "name": "Shell",
                        "env": { "NODE_ENV": "development" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    }
  ]
}
```

## Integration notes for spaces

- A spaces *workspace* could emit a per-worktree `cmux.json` that declares a "Open <worktree>" command whose `workspace` layout preconfigures pre/setup/select phases as surface `command` fields.
- Alternatively, spaces can skip `cmux.json` entirely and build the workspace at runtime via the socket API. `cmux.json` is best for user-selectable entries in the palette; direct RPC is best for tool-driven workflows where spaces already knows what it wants.
- There is no placeholder/templating syntax documented — if spaces needs to parametrize (e.g. inject workspace name), it must regenerate the JSON or use the API.
- Settings key `customCommands.trustedDirectories` must include the project path, or users will be prompted on each load.

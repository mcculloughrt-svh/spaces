# Configuration

Source: https://cmux.com/docs/configuration

## File locations

**Ghostty config** (terminal look & feel — font, theme, scrollback, etc.):
1. `~/.config/ghostty/config`
2. `~/Library/Application Support/com.mitchellh.ghostty/config`

**cmux settings** (app-owned — appearance, sidebar, automation, browser, shortcuts):
1. `~/.config/cmux/settings.json` (priority)
2. `~/Library/Application Support/com.cmuxterm.app/settings.json`

Create the Ghostty config dir if missing:
```bash
mkdir -p ~/.config/ghostty
touch ~/.config/ghostty/config
```

## Precedence

- `~/.config/cmux/settings.json` wins over Application Support fallback.
- File-managed values override Settings window values.
- Remove a key to revert to Settings window value.
- Reload: `Cmd+Shift+,` or `cmux reload-config`.
- JSON-with-comments and trailing commas are allowed in `settings.json`.

## Top-level metadata

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `$schema` | string | schema URL | For editor autocompletion |
| `schemaVersion` | integer | 1 | Future migrations |

Canonical schema: https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux-settings.schema.json

## `app.*`

| Field | Type | Default | Values |
|-------|------|---------|--------|
| `language` | string | `system` | system, en, ar, bs, zh-Hans, zh-Hant, da, de, es, fr, it, ja, ko, nb, pl, pt-BR, ru, th, tr |
| `appearance` | string | `system` | system, light, dark |
| `appIcon` | string | `automatic` | automatic, light, dark |
| `newWorkspacePlacement` | string | `afterCurrent` | top, afterCurrent, end |
| `minimalMode` | bool | false | Hide workspace title bar |
| `keepWorkspaceOpenWhenClosingLastSurface` | bool | false | |
| `focusPaneOnFirstClick` | bool | true | |
| `preferredEditor` | string | `""` | Custom editor command |
| `openMarkdownInCmuxViewer` | bool | false | |
| `reorderOnNotification` | bool | true | Move workspaces with new notifications toward top |
| `sendAnonymousTelemetry` | bool | true | |
| `warnBeforeQuit` | bool | true | |
| `renameSelectsExistingName` | bool | true | |
| `commandPaletteSearchesAllSurfaces` | bool | false | |

## `terminal.*`

| Field | Type | Default |
|-------|------|---------|
| `showScrollBar` | bool | true |

## `notifications.*`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `dockBadge` | bool | true | Unread count in Dock |
| `showInMenuBar` | bool | true | |
| `unreadPaneRing` | bool | true | Highlight unread panes |
| `paneFlash` | bool | true | |
| `sound` | string | `default` | default, Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink, custom_file, none |
| `customSoundFilePath` | string | `""` | |
| `command` | string | `""` | Shell command run on each notification via `/bin/sh -c` |

## `sidebar.*`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `hideAllDetails` | bool | false | |
| `branchLayout` | string | `vertical` | vertical, inline |
| `showNotificationMessage` | bool | true | |
| `showBranchDirectory` | bool | true | |
| `showPullRequests` | bool | true | |
| `openPullRequestLinksInCmuxBrowser` | bool | true | |
| `openPortLinksInCmuxBrowser` | bool | true | |
| `showSSH` | bool | true | |
| `showPorts` | bool | true | Detected listening ports |
| `showLog` | bool | true | Agent log entries |
| `showProgress` | bool | true | Agent progress bars |
| `showCustomMetadata` | bool | true | Custom status pills |

## `workspaceColors.*`

| Field | Type | Default |
|-------|------|---------|
| `indicatorStyle` | string | `leftRail` (values: leftRail, solidFill, rail, border, wash, lift, typography, washRail, blueWashColorRail) |
| `selectionColor` | color | null |
| `notificationBadgeColor` | color | null |
| `colors` | object | 16 presets below |

Default palette:
```json
{
  "Red": "#C0392B", "Crimson": "#922B21", "Orange": "#A04000", "Amber": "#7D6608",
  "Olive": "#4A5C18", "Green": "#196F3D", "Teal": "#006B6B", "Aqua": "#0E6B8C",
  "Blue": "#1565C0", "Navy": "#1A5276", "Indigo": "#283593", "Purple": "#6A1B9A",
  "Magenta": "#AD1457", "Rose": "#880E4F", "Brown": "#7B3F00", "Charcoal": "#3E4B5E"
}
```

## `sidebarAppearance.*`

| Field | Type | Default |
|-------|------|---------|
| `matchTerminalBackground` | bool | false |
| `tintColor` | color | `#000000` |
| `lightModeTintColor` | color | null |
| `darkModeTintColor` | color | null |
| `tintOpacity` | number | 0.03 |

## `automation.*` — **key section for spaces integration**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `socketControlMode` | string | `cmuxOnly` | off, cmuxOnly, automation, password, allowAll, openAccess, fullOpenAccess, notifications, full |
| `socketPassword` | string\|null | `""` | Required when mode = password |
| `claudeCodeIntegration` | bool | true | Enable Claude Code hooks |
| `claudeBinaryPath` | string | `""` | |
| `portBase` | int | 9100 | Starting port reserved for workspaces |
| `portRange` | int | 10 | Ports reserved per workspace |

**For spaces to drive cmux from a separate process**, the user's `socketControlMode` must be permissive enough. `cmuxOnly` (default) will reject connections from a spaces CLI invoked *outside* a cmux surface. Options:
- Run spaces from within a cmux surface (child process, allowed by `cmuxOnly`).
- Document that users set `automation.socketControlMode` to `allowAll` (or `password` + `socketPassword`) for external automation.

## `customCommands.*`

| Field | Type | Default |
|-------|------|---------|
| `trustedDirectories` | array<string> | `[]` |

Directories whose `./cmux.json` is auto-trusted without prompting.

## `browser.*`

| Field | Type | Default | Values |
|-------|------|---------|--------|
| `defaultSearchEngine` | string | `google` | google, duckduckgo, bing, kagi, startpage |
| `showSearchSuggestions` | bool | true | |
| `theme` | string | `system` | system, light, dark |
| `openTerminalLinksInCmuxBrowser` | bool | true | |
| `interceptTerminalOpenCommandInCmuxBrowser` | bool | true | |
| `hostsToOpenInEmbeddedBrowser` | array<string> | `[]` | |
| `urlsToAlwaysOpenExternally` | array<string> | `[]` | |
| `insecureHttpHostsAllowedInEmbeddedBrowser` | array<string> | localhost variants | |
| `showImportHintOnBlankTabs` | bool | true | |
| `reactGrabVersion` | string | `0.1.29` | Pinned react-grab injector |

## `shortcuts.*`

| Field | Type | Default |
|-------|------|---------|
| `showModifierHoldHints` | bool | true |
| `bindings` | object | (see [keyboard-shortcuts.md](keyboard-shortcuts.md)) |

Binding syntax: string for single (`"cmd+b"`) or two-item array for chord (`["ctrl+b", "c"]`).

## Full example

```json
{
  "$schema": "https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux-settings.schema.json",
  "schemaVersion": 1,

  "app": {
    "appearance": "dark",
    "newWorkspacePlacement": "afterCurrent"
  },

  "terminal": {
    "showScrollBar": false
  },

  "browser": {
    "openTerminalLinksInCmuxBrowser": true,
    "hostsToOpenInEmbeddedBrowser": ["localhost", "*.internal.example"]
  },

  "workspaceColors": {
    "colors": {
      "Red": "#C0392B",
      "Blue": "#1565C0",
      "Neon Mint": "#00F5D4"
    }
  },

  "shortcuts": {
    "bindings": {
      "toggleSidebar": "cmd+b",
      "newTab": ["ctrl+b", "c"]
    }
  }
}
```

## Example Ghostty config

```
font-family = SF Mono
font-size = 13
theme = One Dark
scrollback-limit = 50000000
split-divider-color = #3e4451
working-directory = ~/code
```

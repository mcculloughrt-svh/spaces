# Keyboard Shortcuts

Source: https://cmux.com/docs/keyboard-shortcuts

All cmux-owned shortcuts are user-rebindable via Settings or `~/.config/cmux/settings.json` under `shortcuts.bindings`. Chord sequences (`prefix, key`) are supported.

## Binding syntax

```json
{
  "shortcuts": {
    "bindings": {
      "newSurface": ["ctrl+b", "c"],
      "showNotifications": ["ctrl+b", "i"],
      "toggleSidebar": "cmd+b"
    }
  }
}
```

Single binding = string. Chord = two-element array (prefix, then key).

## Defaults (macOS: ⌘=cmd, ⌃=ctrl, ⌥=opt)

### App
| Action | Binding |
|--------|---------|
| openSettings | ⌘, |
| reloadConfiguration | ⌘⇧, |
| showHideAllWindows | ⌃⌥⌘. |
| commandPalette | ⌘⇧P |
| newWindow | ⌘⇧N |
| closeWindow | ⌃⌘W |
| toggleFullScreen | ⌃⌘F |
| sendFeedback | ⌥⌘F |
| reopenPreviousSession | ⌘⇧O |
| quit | ⌘Q |

### Workspaces
| Action | Binding |
|--------|---------|
| toggleSidebar | ⌘B |
| newTab | ⌘N |
| openFolder | ⌘O |
| goToWorkspace | ⌘P |
| nextSidebarTab | ⌃⌘] |
| prevSidebarTab | ⌃⌘[ |
| selectWorkspaceByNumber | ⌘1…⌘9 |
| renameWorkspace | ⌘⇧R |
| closeWorkspace | ⌘⇧W |

### Surfaces
| Action | Binding |
|--------|---------|
| newSurface | ⌘T |
| nextSurface | ⌘⇧] |
| prevSurface | ⌘⇧[ |
| selectSurfaceByNumber | ⌃1…⌃9 |
| renameTab | ⌘R |
| closeTab | ⌘W |
| closeOtherTabsInPane | ⌥⌘T |
| reopenClosedBrowserPanel | ⌘⇧T |
| toggleTerminalCopyMode | ⌘⇧M |

### Split Panes
| Action | Binding |
|--------|---------|
| focusLeft / focusRight / focusUp / focusDown | ⌥⌘← / → / ↑ / ↓ |
| splitRight | ⌘D |
| splitDown | ⌘⇧D |
| splitBrowserRight | ⌥⌘D |
| splitBrowserDown | ⌥⌘⇧D |
| toggleSplitZoom | ⌘⇧↩ |

### Browser
| Action | Binding |
|--------|---------|
| openBrowser | ⌘⇧L |
| focusBrowserAddressBar | ⌘L |
| browserBack | ⌘[ |
| browserForward | ⌘] |
| browserReload | ⌘R |
| browserZoomIn / Out / Reset | ⌘= / - / 0 |
| toggleBrowserDeveloperTools | ⌥⌘I |
| showBrowserJavaScriptConsole | ⌥⌘C |
| toggleReactGrab | ⌘⇧G |

### Find
| Action | Binding |
|--------|---------|
| find | ⌘F |
| findNext | ⌘G |
| findPrevious | ⌥⌘G |
| hideFind | ⌘⇧F |
| useSelectionForFind | ⌘E |

### Notifications
| Action | Binding |
|--------|---------|
| showNotifications | ⌘I |
| jumpToUnread | ⌘⇧U |
| triggerFlash | ⌘⇧H |

All bindings above are macOS defaults. No non-macOS platform is documented — cmux is macOS-only.

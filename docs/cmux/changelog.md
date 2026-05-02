# Changelog (recent)

Source: https://cmux.com/docs/changelog

Only the last several releases — the ones that matter for capability feature-gating.

## 0.63.2 — 2026-04-06
- Chorded keyboard shortcuts.
- Remote SSH port detection.
- Editable workspace descriptions.
- New agent integrations: `cmux omx` (oh-my-codex), `cmux omc` (oh-my-claudecode).
- Fixes: terminal freezes, sidebar layout, browser pane rendering.

## 0.63.1 — 2026-03-28
- Emergency patch: startup crash from stale window geometry on upgrade.

## 0.63.0 — 2026-03-28 — **major**
- **SSH remote workspaces**.
- **Claude Code Teams integration** (`cmux claude-teams`).
- **oh-my-openagent** support (`cmux omo`).
- Browser profile import (Chrome/Firefox/Safari).
- Minimal mode.
- **Custom commands via `cmux.json`**.
- Customizable workspace switching shortcuts.

## 0.62.2 — 2026-03-14
- Configurable sidebar tint with light/dark mode support.
- `⌘P` all-surfaces search.
- Bundled Ghostty themes command.
- Adjustable sidebar width.

## 0.62.0 — 2026-03-12
- Markdown viewer with live file watching.
- Browser find (`⌘F`).
- Vi-style terminal copy mode.
- Custom notification sounds.
- 17 languages (incl. Japanese).

## 0.61.0 — 2026-02-25
- Tab colors (17 presets + custom).
- Command palette (`⌘⇧P`).
- "Open With" for external editors.
- Workspace pinning.

## Capability gates relevant to spaces

- **Custom commands (`cmux.json`)**: since 0.63.0.
- **Socket API with `workspace.*` / `surface.*` RPC**: assumed current; no explicit version gate documented. Use `system.capabilities` at runtime.
- **Chord key bindings**: since 0.63.2.
- **SSH workspaces**: since 0.63.0 (not on critical path for initial integration).

# Getting Started

Source: https://cmux.com/docs/getting-started

## What cmux is

A lightweight native macOS terminal built on Ghostty for managing multiple AI coding agents. Key differentiators vs. plain Ghostty or tmux:
- Vertical sidebar tabs = workspaces.
- Native split panes with terminal *or* browser surfaces.
- Notification panel + Dock badge integration.
- Unix-socket RPC API for programmatic control.

## Installation

Two supported methods:
1. **DMG download** (recommended) — from cmux.com.
2. **Homebrew** — cask form (exact formula not shown in docs; check the getting-started page if needed).

## CLI setup

cmux ships a `cmux` CLI that talks to the running app via the socket (see [api.md](api.md)). Available only after install.

## Autoupdate

Uses Sparkle for automatic updates.

## Session restoration

On relaunch, cmux restores:
- Windows
- Workspaces
- Browsing history

**Not restored**: active terminal processes — any running command is killed when cmux exits. Relevant for spaces integration: setup/select scripts must be idempotent if a restart is expected.

## Related sidebar pages

- Concepts: /docs/concepts
- Configuration: /docs/configuration
- Custom Commands: /docs/custom-commands
- Keyboard Shortcuts: /docs/keyboard-shortcuts
- API Reference: /docs/api
- Browser Automation: /docs/browser-automation
- Notifications: /docs/notifications
- SSH: /docs/ssh
- Agent Integrations: /docs/agent-integrations/{claude-code-teams,oh-my-opencode,oh-my-codex,oh-my-claudecode}
- Changelog: /docs/changelog

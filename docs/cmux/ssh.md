# SSH

Source: https://cmux.com/docs/ssh

cmux has first-class SSH workspaces — a remote-dev mode where a workspace's surfaces run against a remote host, with local-feeling browser panes, notifications, and agent support.

## Usage

```bash
cmux ssh user@remote
cmux ssh user@remote --name "dev server"
cmux ssh user@remote -p 2222
cmux ssh user@remote -i ~/.ssh/id_ed25519
```

Reads `~/.ssh/config` for host aliases, identity files, and proxy settings. Flags mirror standard ssh.

## Flags

| Flag | Purpose |
|------|---------|
| `--name` | Workspace title |
| `-p`, `--port` | SSH port (default 22) |
| `-i`, `--identity` | Identity file |
| `-o`, `--ssh-option` | Arbitrary SSH options |
| `--no-focus` | Create without switching to it |

## Features

- **Browser routing**: Browser panes inside an SSH workspace route HTTP and WebSocket traffic through the remote machine's network. Localhost URLs reference the remote host without manual port forwarding.
- **Drag-and-drop upload**: Files dropped onto an SSH surface are `scp`'d through the existing connection. Auto-detects TTY.
- **Notifications**: Remote processes can trigger local notifications via `cmux notify`. Per-host cooldown suppresses spam.
- **Agent support**: `cmux claude-teams` and `cmux omo` work inside SSH workspaces. Splits are local; compute is remote.
- **Reconnection**: Exponential backoff 3s → 60s. Defaults `ServerAliveInterval=20`, `ServerAliveCountMax=2`.

## Remote daemon

cmux deploys a signed, versioned relay daemon (`cmuxd-remote`) to each host:
- Path: `~/.cmux/bin/cmuxd-remote/<version>/<os>-<arch>/cmuxd-remote`
- SHA-256 verified on install.
- Handles SOCKS5 proxying, CLI relay (HMAC-SHA256 auth), session persistence across disconnects.

## Relevance for spaces

Low priority for a first integration — spaces targets a local project tree. If spaces ever supports remote worktrees, `cmux ssh` + the remote daemon is the pre-built path.

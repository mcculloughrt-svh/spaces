# API Reference

Source: https://cmux.com/docs/api

**This is the primary integration surface for spaces.** The `cmux` CLI and the Unix-socket RPC expose the same methods — every CLI command maps to a socket RPC call.

## Socket

| Socket path | Build |
|------------|-------|
| `/tmp/cmux.sock` | release |
| `/tmp/cmux-debug.sock` | debug |
| `/tmp/cmux-debug-<tag>.sock` | tagged debug |
| `$CMUX_SOCKET_PATH` | override |

## Access modes (set in `automation.socketControlMode`)

| Mode | Who can connect |
|------|-----------------|
| `off` | nobody (socket disabled) |
| `cmuxOnly` | default; only cmux child processes |
| `allowAll` | any local process |
| (other values) | password, notifications, full, etc. — see [configuration.md § automation](configuration.md) |

Also controllable via env: `CMUX_SOCKET_ENABLE` (1/0/true/false/on/off), `CMUX_SOCKET_MODE`.

## Protocol

One newline-terminated JSON request per call. Required fields: `id`, `method`, `params`.

**Request**:
```json
{"id":"req-1","method":"workspace.list","params":{}}
```

**Response**:
```json
{"id":"req-1","ok":true,"result":{"workspaces":[...]}}
```

Errors are returned with `"ok": false` and an error payload (exact shape not shown in the public docs — inspect at runtime).

## CLI options

| Flag | Purpose |
|------|---------|
| `--socket PATH` | custom socket path |
| `--json` | JSON output |
| `--window ID` | target window |
| `--workspace ID` | target workspace |
| `--surface ID` | target surface |
| `--id-format refs\|uuids\|both` | identifier format |

## Method index

Columns: RPC method (socket) / CLI verb (subcommand). Both work.

### Workspace

| RPC | CLI |
|-----|-----|
| `workspace.list` | `list-workspaces` |
| `workspace.create` | `new-workspace` |
| `workspace.select` | `select-workspace` |
| `workspace.current` | `current-workspace` |
| `workspace.close` | `close-workspace` |

### Surface / Split

| RPC | CLI |
|-----|-----|
| `surface.split` | `new-split` (directions: left, right, up, down) |
| `surface.list` | `list-surfaces` |
| `surface.focus` | `focus-surface` |

### Input

| RPC | CLI | Notes |
|-----|-----|-------|
| `surface.send_text` | `send` / `send-surface` | Send text as if typed |
| `surface.send_key` | `send-key` / `send-key-surface` | Keys: `enter`, `tab`, `escape`, `backspace`, `delete`, `up`, `down`, `left`, `right` |

### Notifications

| RPC | CLI |
|-----|-----|
| `notification.create` | `notify` |
| `notification.list` | `list-notifications` |
| `notification.clear` | `clear-notifications` |

### Sidebar metadata (per-workspace status pills, progress bars, logs)

| RPC/CLI | Purpose |
|---------|---------|
| `set-status` / `clear-status` / `list-status` | Status pills (icon + color) |
| `set-progress` / `clear-progress` | Progress bars (0.0–1.0) |
| `log` / `clear-log` / `list-log` | Log entries (levels: info, progress, success, warning, error) |
| `sidebar-state` | Full dump |

### System

| RPC | CLI |
|-----|-----|
| `system.ping` | `ping` |
| `system.capabilities` | `capabilities` |
| `system.identify` | `identify` |

Use `system.capabilities` to feature-gate — e.g. confirm the cmux version in use supports a given method.

## Environment variables (visible inside a cmux surface)

| Var | Set by cmux | Used for |
|-----|------------|----------|
| `CMUX_SOCKET_PATH` | yes | Override / detect |
| `CMUX_SOCKET_ENABLE` | user | Toggle socket |
| `CMUX_SOCKET_MODE` | user | Access mode |
| `CMUX_WORKSPACE_ID` | yes | Auto-targets current workspace for CLI |
| `CMUX_SURFACE_ID` | yes | Auto-targets current surface for CLI |

When a child process runs `cmux send "hi"`, the CLI uses `CMUX_SURFACE_ID` unless `--surface` is passed.

## Detection (spaces backend check)

Order of checks:
1. `process.env.CMUX_SOCKET_PATH` set AND socket exists at that path.
2. `cmux` binary on PATH.
3. `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` present — indicates running inside a cmux surface.

## Client examples

### Python

```python
import json, os, socket
SOCKET_PATH = os.environ.get("CMUX_SOCKET_PATH", "/tmp/cmux.sock")
def rpc(method, params=None, req_id=1):
    payload = {"id": req_id, "method": method, "params": params or {}}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(SOCKET_PATH)
        sock.sendall(json.dumps(payload).encode("utf-8") + b"\n")
        return json.loads(sock.recv(65536).decode("utf-8"))
```

### Bash

```bash
SOCK="${CMUX_SOCKET_PATH:-/tmp/cmux.sock}"
cmux_cmd() { printf "%s\n" "$1" | nc -U "$SOCK"; }
cmux_cmd '{"id":"ws","method":"workspace.list","params":{}}'
```

## Mapping spaces' current tmux operations → cmux

| spaces does in tmux | cmux equivalent |
|---------------------|-----------------|
| `tmux new-session -s <ws> -c <path>` | `workspace.create` with `cwd` |
| `tmux send-keys -t <session> "<cmd>" Enter` | `surface.send_text` + `surface.send_key enter` (or a trailing `\n` in `send_text`) |
| `tmux attach-session -t <session>` | Bring app forward; `workspace.select` |
| `tmux kill-session -t <session>` | `workspace.close` |
| `tmux split-window -h` | `surface.split` direction=right |
| `tmux list-windows` / `list-panes` | `workspace.list` + `surface.list` |
| Sourcing a per-workspace `.tmux.conf` | Not supported directly — encode layout in `cmux.json` or drive via RPC on create |

## Open questions (not covered in public docs)

- Exact shape of error responses (`ok:false`) — discover at runtime.
- `workspace.create` full parameter list (does it accept a layout tree like `cmux.json`, or only name + cwd?) — verify empirically.
- Whether a single socket connection can stream responses or must be closed per-call — Python sample above uses one-connection-per-call, which is the safe default.

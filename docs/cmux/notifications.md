# Notifications

Source: https://cmux.com/docs/notifications

Three ways to send a notification from inside a cmux surface: `cmux notify` (CLI), OSC 777 (simple), OSC 99 (rich). Useful for pre/setup/select scripts to signal completion.

## `cmux notify`

```bash
cmux notify --title "Task Complete" --body "Your build finished"
cmux notify --title "Claude Code" --subtitle "Waiting" --body "Agent needs input"
```

## OSC 777 — simple, title + body only

```bash
printf '\e]777;notify;My Title;Message body here\a'
```

Shell helper:
```bash
notify_osc777() {
    local title="$1"
    local body="$2"
    printf '\e]777;notify;%s;%s\a' "$title" "$body"
}
```

## OSC 99 — rich, supports subtitle + notification ID

```bash
printf '\e]99;i=1;e=1;d=0:Hello World\e\\'
printf '\e]99;i=1;e=1;d=0;p=title:Build Complete\e\\'
```

## Feature comparison

| Feature | OSC 99 | OSC 777 |
|---------|--------|---------|
| Title + body | yes | yes |
| Subtitle | yes | no |
| Notification ID | yes | no |

## Lifecycle

1. **Received** — alert fires (unless suppressed).
2. **Unread** — badge on workspace tab.
3. **Read** — clears on workspace view.
4. **Cleared** — removed from panel.

Alerts are suppressed when the cmux window is focused, the sending workspace is active, or the notification panel is open.

## Panel

- Open notification panel: `⌘⇧I`.
- Jump to latest unread: `⌘⇧U`.

## Custom command (runs for every notification)

Set under Settings > App > Notification Command, or `notifications.command` in `settings.json`. Runs via `/bin/sh -c` with env vars:
- `CMUX_NOTIFICATION_TITLE`
- `CMUX_NOTIFICATION_SUBTITLE`
- `CMUX_NOTIFICATION_BODY`

Examples:
```bash
say "$CMUX_NOTIFICATION_TITLE"
afplay /path/to/sound.aiff
echo "$CMUX_NOTIFICATION_TITLE: $CMUX_NOTIFICATION_BODY" >> ~/notifications.log
```

## Language helpers

**Python**:
```python
import sys
def notify(title, body):
    sys.stdout.write(f'\x1b]777;notify;{title};{body}\x07')
    sys.stdout.flush()
```

**Node.js**:
```javascript
function notify(title, body) {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}
```

**Shell alias — notify when a command finishes successfully**:
```bash
notify-after() {
  "$@"
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    cmux notify --title "✓ Command Complete" --body "$1"
  fi
  return $exit_code
}
```

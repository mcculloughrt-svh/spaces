# Browser Automation

Source: https://cmux.com/docs/browser-automation

cmux ships a `cmux browser` CLI group to drive browser surfaces programmatically — navigate, interact, inspect, evaluate JS, manage state. Likely out-of-scope for an initial spaces cmux backend, but useful if a pre/setup/select script wants to open or control a browser pane.

## Targeting a surface

Most subcommands need a target browser surface (positional or `--surface`):

```bash
cmux browser open https://example.com
cmux browser surface:2 url
cmux browser --surface surface:2 url
```

Use `identify` to discover IDs and browser metadata.

## Command categories

| Category | Key commands |
|----------|-------------|
| Navigation | `open`, `navigate`, `back`, `forward`, `reload`, `url` |
| Waiting | `wait` (selectors, text, URLs, load states, JS conditions) |
| DOM | `click`, `type`, `fill`, `scroll`, `check`, `uncheck` |
| Inspection | `snapshot`, `screenshot`, `get`, `is`, `find`, `highlight` |
| JavaScript | `eval`, `addinitscript`, `addscript`, `addstyle` |
| State | `cookies`, `storage`, `state` |
| Tabs & diag | `tab`, `console`, `errors`, `dialog`, `download` |

## JavaScript / DOM

```bash
cmux browser surface:2 eval "document.title"
cmux browser surface:2 eval --script "window.location.href"

cmux browser surface:2 addscript "document.querySelector('#name')?.focus()"
cmux browser surface:2 addstyle "#debug-banner { display: none !important; }"
```

## State persistence

```bash
cmux browser surface:2 state save /tmp/session.json
cmux browser surface:2 state load /tmp/session.json

cmux browser surface:2 cookies set session_id abc123 --domain example.com
cmux browser surface:2 storage local set theme dark
```

## Not documented

- React introspection details (the `toggleReactGrab` shortcut toggles the feature but automation hooks aren't publicly documented).
- Developer tools integration beyond opening them.

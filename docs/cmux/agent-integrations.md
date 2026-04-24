# Agent Integrations

Source: https://cmux.com/docs/agent-integrations/*

All four integrations share the **same architectural pattern**: they launch an external multi-agent orchestrator that originally drives tmux, and cmux intercepts those tmux calls via a per-integration shim and translates them to cmux socket RPC. This is the reference pattern for anything that wants tmux compatibility inside cmux.

**This is directly relevant to the spaces project** — spaces currently drives tmux, and the shim approach is one strategy for a cmux backend: keep the tmux code path, drop a shim, let it translate.

## The tmux-compat shim pattern (shared by all four)

1. cmux creates a fake `tmux` binary at `~/.cmuxterm/<integration>-bin/tmux`.
2. The shim's PATH directory is prepended so the orchestrator finds it first.
3. Env vars are faked:
   - `TMUX` — fake socket path encoding workspace/pane.
   - `TMUX_PANE` — fake pane ID mapped to the current cmux pane.
   - `CMUX_SOCKET_PATH` — real cmux socket.
4. The shim translates tmux commands (`new-session`, `split-window`, `send-keys`, `capture-pane`, `select-pane`, `kill-pane`, `list-panes`, etc.) into cmux socket RPC calls.
5. Persistent state (e.g. tmux buffers) stored at `~/.cmuxterm/tmux-compat-store.json`.

The intercepted command set spans: window/session creation (→ new workspaces), splits, `send-keys`/`capture-pane`, focus nav, `kill-pane`/`kill-window`, enumeration.

## Claude Code Teams — `cmux claude-teams`

Source: /docs/agent-integrations/claude-code-teams

Launches Claude Code with agent-teams mode enabled. Teammate agents appear as native cmux splits instead of tmux panes.

```bash
cmux claude-teams
cmux claude-teams --continue
cmux claude-teams --model sonnet
```

All args after `claude-teams` are forwarded to Claude Code. The command sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and installs the shim at `~/.cmuxterm/claude-teams-bin/tmux`.

## oh-my-claudecode (OMC) — `cmux omc`

Source: /docs/agent-integrations/oh-my-claudecode

"Multi-agent orchestration for Claude Code — 19 specialized agents, smart model routing, tmux-based team pipelines."

Install:
```bash
npm install -g oh-my-claude-sisyphus
```
(Requires an authenticated Claude Code CLI.)

Usage:
```bash
cmux omc
cmux omc team 3:claude "implement feature"
cmux omc --watch
```

Features: team worker panes as splits, HUD status pane, auto main-vertical grid layout.

Shim dir: `~/.cmuxterm/omc-bin/`. State: `~/.cmuxterm/tmux-compat-store.json`.

## oh-my-codex (OMX) — `cmux omx`

Source: /docs/agent-integrations/oh-my-codex

Multi-agent layer for **OpenAI Codex CLI**, 30+ agent roles.

Install:
```bash
npm install -g @openai/codex oh-my-codex
omx setup
omx doctor
```

Usage:
```bash
cmux omx
cmux omx --madmax --high
cmux omx team
```

Shim: `~/.cmuxterm/omx-bin/tmux`. HUD pane shows model, branch, context, token usage.

## oh-my-opencode (OMO) — `cmux omo`

Source: /docs/agent-integrations/oh-my-opencode

Launches **OpenCode** with the oh-my-openagent plugin in cmux-aware mode. Supports multiple model providers (Claude, GPT, Gemini, Grok) as specialized sub-agents in parallel.

First-run setup is automatic:
1. Shadow config at `~/.cmuxterm/omo-config/`.
2. Installs `oh-my-opencode` via bun or npm.
3. Symlinks `node_modules`, `package.json`, plugin config from `~/.config/opencode/`.
4. Enables tmux mode in the shadow config.

Your original OpenCode config is left untouched.

```bash
cmux omo
cmux omo --continue
cmux omo --model claude-sonnet-4-6
```

Features:
- Each sub-agent (Hephaestus, Atlas, Oracle, …) in its own cmux split.
- Auto-layout (main-vertical default), dynamic resize.
- Idle cleanup: agents removed after 3 consecutive idle polls.
- Queue: agents wait when no window space, retry every 2s.

Shim: `~/.cmuxterm/omo-bin/tmux`.

## Implications for spaces

Two viable strategies for a cmux backend:

**Strategy A — Shim (like the four integrations)**
- Keep spaces' current `tmux` shell-outs unchanged.
- At runtime, detect cmux and prepend a PATH shim that rewrites `tmux` commands to socket RPC.
- Pros: minimal code churn, shared code path for tmux and cmux users.
- Cons: cmux's shim targets *orchestrators* that cmux itself launches (so PATH injection is safe); in a spaces-initiated scenario, the shim directory must be one spaces controls, and the shim must be robust against all the tmux subcommands spaces calls.

**Strategy B — Native backend**
- Add a `cmux` implementation alongside the existing `tmux` module (`src/core/tmux.ts` → add `src/core/cmux.ts`), gated by detection.
- Command-level dispatch selects backend per op.
- Pros: cleaner, uses cmux features (notifications, status pills, browser panes) that have no tmux analog.
- Cons: more code, two code paths to maintain.

Given the spaces codebase is small and idiomatic, Strategy B is likely cleaner long-term. Strategy A is the answer if we want to ship fast with minimal risk to existing tmux users.

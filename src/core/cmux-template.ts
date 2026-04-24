/**
 * cmux.template.json rendering.
 *
 * Responsibilities:
 *  - Provide the default template body written at project creation.
 *  - Render a concrete `cmux.json` for a workspace by substituting
 *    `{{workspace}}` / `{{cwd}}` / `{{repository}}` tokens and injecting
 *    the `<SPACES_RUNNER>` shell one-liner into the runner surface.
 *  - Build the SPACES_RUNNER command from the project's discovered
 *    setup/select scripts so script execution is pinned at
 *    workspace-open time (not worktree-create time).
 */

import { escapeShellArg } from '../utils/shell-escape.js'

const TEMPLATE_HEADER = `// cmux workspace template
//
// This template is rendered to <worktree>/cmux.json each time a new
// workspace is created under this project. cmux accepts JSONC, so
// comments and trailing commas are preserved.
//
// Token substitution (literal text replacement before JSON parsing):
//   {{workspace}}    workspace name (e.g. "feat-x")
//   {{cwd}}          absolute path to the worktree
//   {{repository}}   "owner/repo" from the project config
//
// Special placeholder:
//   <SPACES_RUNNER>  code-generated bash one-liner that runs the
//                    project's pre/setup/select scripts using the
//                    \`.spaces-setup\` marker. Spaces renders this at
//                    workspace-creation time using the scripts
//                    currently in ~/spaces/<project>/scripts/.
//
// Do not rename the <SPACES_RUNNER> string; spaces looks for it by
// exact literal match. Substitution is done on the string, so if you
// want to skip the runner entirely just replace the surface "command"
// with your own shell command.
`

const DEFAULT_TEMPLATE_BODY = `{
  "commands": [
    {
      "name": "Open {{workspace}}",
      "keywords": ["spaces", "{{workspace}}"],
      "restart": "ignore",
      "workspace": {
        "name": "{{workspace}}",
        "cwd": "{{cwd}}",
        "layout": {
          "pane": {
            "surfaces": [
              {
                "type": "terminal",
                "name": "{{workspace}}",
                "focus": true,
                "command": "<SPACES_RUNNER>"
              }
            ]
          }
        }
      }
    }
  ]
}
`

const LLM_ASSISTANT_TEMPLATE_BODY = `{
  "commands": [
    {
      "name": "Open {{workspace}}",
      "keywords": ["spaces", "{{workspace}}"],
      "restart": "ignore",
      "workspace": {
        "name": "{{workspace}}",
        "cwd": "{{cwd}}",
        "layout": {
          "direction": "horizontal",
          "split": 0.5,
          "children": [
            {
              "pane": {
                "surfaces": [
                  {
                    "type": "terminal",
                    "name": "<llmAssistant>",
                    "command": "<llmAssistant>",
                    "focus": false
                  }
                ]
              }
            },
            {
              "pane": {
                "surfaces": [
                  {
                    "type": "terminal",
                    "name": "shell",
                    "focus": true,
                    "command": "<SPACES_RUNNER>"
                  }
                ]
              }
            }
          ]
        }
      }
    }
  ]
}
`

/**
 * Build the text of cmux.template.json to write at project creation.
 */
export function buildCmuxTemplateFileContent(llmAssistant?: string): string {
	const body = llmAssistant ? LLM_ASSISTANT_TEMPLATE_BODY : DEFAULT_TEMPLATE_BODY
	return TEMPLATE_HEADER + body
}

export interface RenderContext {
	workspace: string
	cwd: string
	repository: string
	llmAssistant?: string
	/** Absolute paths to the project's setup scripts, alphabetically sorted */
	setupScripts: string[]
	/** Absolute paths to the project's select scripts, alphabetically sorted */
	selectScripts: string[]
}

/**
 * Substitute the `{{...}}` tokens. Literal text replacement, matching
 * the spec contract (§4.3). Values are assumed safe for JSON strings
 * (workspace names are sanitized; cwd/repository are bounded by
 * filesystem + gh constraints).
 */
function substituteTokens(template: string, ctx: RenderContext): string {
	return template
		.replaceAll('{{workspace}}', ctx.workspace)
		.replaceAll('{{cwd}}', ctx.cwd)
		.replaceAll('{{repository}}', ctx.repository)
}

/**
 * Replace a quoted JSON placeholder like `"<SPACES_RUNNER>"` with a
 * JSON-encoded string value. Using `JSON.stringify` for the replacement
 * guarantees valid JSON even if the runner contains quotes or
 * backslashes.
 */
function replaceQuotedPlaceholder(
	template: string,
	placeholder: string,
	value: string
): string {
	const quoted = `"${placeholder}"`
	const encoded = JSON.stringify(value)
	return template.split(quoted).join(encoded)
}

/**
 * Build the SPACES_RUNNER shell one-liner.
 *
 * Behavior:
 *   - If `.spaces-setup` already exists, run each select script once,
 *     ignoring individual failures (status checks shouldn't block the shell).
 *   - Otherwise, set a cmux "setting up" status pill, run each setup
 *     script via `&&` (stop at the first failure), and on success
 *     touch the marker and fire a cmux notification.
 *   - Clear the status pill on both success and failure paths.
 *   - Regardless of outcome, drop into an interactive login shell so
 *     the user has a prompt after scripts finish.
 *
 * All script paths and arguments are single-quoted via
 * `escapeShellArg`, so they survive embedding in a JSON string.
 */
export function buildSpacesRunnerCommand(
	workspaceName: string,
	repository: string,
	setupScripts: string[],
	selectScripts: string[]
): string {
	const wsArg = escapeShellArg(workspaceName)
	const repoArg = escapeShellArg(repository)

	// select scripts run unconditionally, continuing past individual failures
	// so a stale network call doesn't block the user's prompt.
	const selectSeq = selectScripts.length
		? selectScripts
				.map((s) => `${escapeShellArg(s)} ${wsArg} ${repoArg} || true`)
				.join('; ')
		: ':'

	// setup scripts chain with && — fail fast so the marker isn't written
	// when setup breaks halfway through.
	const setupSeq = setupScripts.length
		? setupScripts
				.map((s) => `${escapeShellArg(s)} ${wsArg} ${repoArg}`)
				.join(' && ')
		: 'true'

	const notifyMsg = escapeShellArg(`Setup complete: ${workspaceName}`)
	const statusMsg = escapeShellArg('setting up')

	// On setup failure: drop the status pill and fall through to the
	// interactive shell so the user can diagnose. We intentionally do
	// *not* exit with the failure code — that would just close the
	// cmux surface with no chance for the user to inspect state, and
	// .spaces-setup won't have been written so the next open re-runs
	// setup anyway.
	const setupBranch =
		`cmux set-status --icon hourglass --color blue ${statusMsg} 2>/dev/null || true; ` +
		`if ${setupSeq}; then ` +
		`touch .spaces-setup; ` +
		`cmux clear-status 2>/dev/null || true; ` +
		`cmux notify ${notifyMsg} 2>/dev/null || true; ` +
		`else cmux clear-status 2>/dev/null || true; fi`

	// Deliberately no trailing `exec $SHELL` / child shell. The cmux
	// backend runs this as a bash script via `bash <path>` inside
	// cmux's default terminal surface; when the script ends, control
	// returns to the surface's outer interactive shell at its own
	// prompt. Spawning another shell here would just stack one on
	// top that the user has to exit past first.
	return (
		`if [ -f .spaces-setup ]; then ${selectSeq}; ` +
		`else ${setupBranch}; fi`
	)
}

/**
 * Build the layout object passed as `layout` in the
 * `workspace.create` RPC. Matches the shape of
 * `commands[*].workspace.layout` documented in cmux's custom-commands
 * schema: either a single `pane` node, or a two-child `split` node
 * when an llm assistant is configured. The runner command is baked
 * directly into the initial surface so no post-hoc send_text is
 * needed.
 */
export function buildCreateLayout(
	workspaceName: string,
	runner: string,
	llmAssistant?: string
): Record<string, unknown> {
	const shellPane = {
		pane: {
			surfaces: [
				{
					type: 'terminal',
					name: llmAssistant ? 'shell' : workspaceName,
					focus: true,
					command: runner,
				},
			],
		},
	}

	if (!llmAssistant) {
		return shellPane
	}

	return {
		direction: 'horizontal',
		split: 0.5,
		children: [
			{
				pane: {
					surfaces: [
						{
							type: 'terminal',
							name: llmAssistant,
							command: llmAssistant,
							focus: false,
						},
					],
				},
			},
			shellPane,
		],
	}
}

/**
 * Render a project's cmux.template.json against a specific workspace.
 * Returns JSONC text (cmux accepts JSONC, so comments in the template
 * survive).
 */
export function renderCmuxTemplate(
	templateText: string,
	ctx: RenderContext
): string {
	let out = substituteTokens(templateText, ctx)
	if (ctx.llmAssistant) {
		out = replaceQuotedPlaceholder(out, '<llmAssistant>', ctx.llmAssistant)
	}
	// In the cmux.json palette path, the runner IS the surface's
	// primary process — if it exits the surface closes. Append an
	// interactive login shell so the user is left at a prompt after
	// setup/select complete. (The cmux backend's RPC path stages the
	// runner as a script and executes it inside the surface's
	// existing shell, so it does not want this tail.)
	const runner =
		buildSpacesRunnerCommand(
			ctx.workspace,
			ctx.repository,
			ctx.setupScripts,
			ctx.selectScripts
		) + `; exec "${'${SHELL:-/bin/bash}'}" -l`
	out = replaceQuotedPlaceholder(out, '<SPACES_RUNNER>', runner)
	return out
}

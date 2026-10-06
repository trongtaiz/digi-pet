// What a tool call tells the pet, pure: research, code written, and the checks
// (tests, builds, type checks, linters) whose red-to-green runs are its battles.

const RESEARCH = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'LSP'])
const LINES_PER_CALL = 200

/** A test, build, type-check or lint command, named by its runner (`jest`, `npm test`, `tsc` …). */
const CHECK =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)|pytest|jest|vitest|tsc|eslint|ruff|mypy|go test|cargo (?:test|check|build|clippy)|claude plugin test|make test|xcodebuild)\b/

/**
 * A run that failed, read from its output: a check's output is mostly piped
 * (`… 2>&1 | tail`), so the exit code is the pipe's and no error is reported.
 */
const FAILED =
  /\b[1-9]\d* (?:failed|failing|fail)\b|^\s*FAIL\b|\(fail\)|error TS\d+|Found [1-9]\d* errors?|\([1-9]\d* errors?,|npm ERR!|error\[E\d+\]|\bFAILED\b|BUILD FAILED|Command failed|exited with code [1-9]/m

/** `git`, with any options before the subcommand (`git -C <dir> commit`). */
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`
const COMMIT = new RegExp(String.raw`${GIT}commit\b`)
/** A commit's output (`[main 1a2b3c4] …`): git prints it only for a commit made, so it is proof even when a later step of the call fails. */
const COMMITTED = /^\[[^\]\n]+ [0-9a-f]{7,40}\]/m
/**
 * What opens a pull or merge request: the forges' CLIs (GitHub, GitLab, Gitea,
 * Forgejo, Azure DevOps), a push to GitLab with `merge_request.create`, and a
 * push to Gerrit's `refs/for/`.
 */
const PR_CREATE = new RegExp(
  String.raw`\b(?:gh\s+pr\s+create|glab\s+mr\s+create|tea\s+(?:pr|pulls?)\s+create|fj\s+pr\s+create|az\s+repos\s+pr\s+create)\b|${GIT}push\b[^\n;&|]*(?:merge_request\.create|refs\/for\/)`,
)
/**
 * The new request's URL as the forge prints it: `/pull/7` (GitHub), `/-/merge_requests/12`
 * (GitLab), `/pulls/3` (Gitea, Forgejo), `/pullRequests/7` (Azure DevOps), a Gerrit change marked [NEW].
 */
const PR_OPENED = /https?:\/\/\S+?\/(?:pull|pulls|-\/merge_requests|pullrequests?)\/\d+\b|https?:\/\/\S+\/c\/\S+\/\+\/\d+\b.*\[NEW\]/i
/** gh and glab print the open request's URL when they refuse to open another. */
const PR_EXISTS = /already exists/i
/** An MCP tool that opens a pull or merge request (`mcp__gitlab__create_merge_request`, `…__repo_create_pull_request`). */
const PR_TOOL = /^mcp__.+__(?:\w+_)?create_(?:pull|merge)_request$/
/** Risky commands; `--force-with-lease` is the careful push and is not one. */
const RISKY = /\bgit\s+push\b[^\n;&|]*(?:--force(?![-\w])|\s-f\b)|--no-verify\b|\bgit\s+reset\s+--hard\b/
/** `rm -rf` of anything but a temp folder or build output; a `$VAR` path names no folder we can judge. */
const RM_RF = /\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*((?:\s+[^\s;&|]+)+)/g
const DISPOSABLE = /^["']?(?:\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\$TMPDIR|\$\{?TMPDIR|(?:\.\/)?(?:node_modules|dist|build|out|coverage|\.next|\.cache|tmp)(?:\/|$|["']))/

export type ToolSignal =
  | { kind: 'research' }
  | { kind: 'write'; lines: number }
  | { kind: 'check'; runner: string; isPass: boolean }
  | { kind: 'summon' }
  | { kind: 'other' }

/** The trophies a call won: a commit made and a pull or merge request opened, each as its output proves, on any forge. */
export function trophiesOf(tool: string, input: Record<string, unknown>, isError: boolean, text: string): number {
  if (PR_TOOL.test(tool)) return isError ? 0 : 1
  if (tool !== 'Bash') return 0
  const command = String(input.command ?? '')
  const committed = COMMIT.test(command) && COMMITTED.test(text)
  const opened = !isError && PR_CREATE.test(command) && PR_OPENED.test(text) && !PR_EXISTS.test(text)
  return Number(committed) + Number(opened)
}

/** Whether a shell command is a risky move (Chaos). */
export function isRisky(command: string): boolean {
  if (RISKY.test(command)) return true
  for (const m of command.matchAll(RM_RF)) {
    const targets = m[1]!.trim().split(/\s+/).filter(a => !a.startsWith('-') && !/^["']?\$/.test(a))
    if (targets.some(a => !DISPOSABLE.test(a))) return true
  }
  return false
}

/** The call's input, and what came back: `isError` as the engine set it, `text` as the model read it. */
export function signalOf(tool: string, input: Record<string, unknown>, isError: boolean, text: string): ToolSignal {
  if (RESEARCH.has(tool)) return isError ? { kind: 'other' } : { kind: 'research' }
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    if (isError) return { kind: 'other' }
    const body = String(input.new_string ?? input.content ?? input.new_source ?? '')
    return { kind: 'write', lines: Math.min(LINES_PER_CALL, body ? body.split('\n').length : 0) }
  }
  if ((tool === 'Agent' || tool === 'Task') && !isError) return { kind: 'summon' }
  if (tool === 'Bash' && !input.run_in_background) {
    const command = String(input.command ?? '')
    const runner = command.match(CHECK)?.[0]
    if (runner) return { kind: 'check', runner: runner.replace(/\s+run\s+/, ' '), isPass: !isError && !FAILED.test(text) }
  }
  return { kind: 'other' }
}

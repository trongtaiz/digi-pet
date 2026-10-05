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

/** A commit's output (`[main 1a2b3c4] …`) or a new pull request's URL: proof of a trophy, where no error is none. */
const COMMITTED = /^\[[^\]\n]+ [0-9a-f]{7,40}\]/m
const PR_OPENED = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/
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

/** Whether a shell command made a commit or opened a pull request, as its output proves: a trophy. */
export function isTrophy(command: string, text: string, isError: boolean): boolean {
  return !isError && ((/\bgit\s+commit\b/.test(command) && COMMITTED.test(text)) || (/\bgh\s+pr\s+create\b/.test(command) && PR_OPENED.test(text)))
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

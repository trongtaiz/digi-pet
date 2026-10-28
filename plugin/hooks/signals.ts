// What a tool call tells the pet, pure: research, code written, and the checks
// (tests, builds, type checks, linters) whose red-to-green runs are its battles.

const RESEARCH = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'LSP'])
const LINES_PER_CALL = 200

/** A test, build, type-check or lint runner (`jest`, `npm test`, `tsc` …). */
const RUNNER = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)|pytest|jest|vitest|tsc|eslint|ruff|mypy|go test|cargo (?:test|check|build|clippy)|claude plugin test|make test|xcodebuild`
/**
 * A runner run as a command: where one starts (after `;`, `&&`, `|`, `(` or a
 * newline), past env settings, a launcher (`npx`, `timeout 500`) or a path.
 * Named anywhere else (`grep "jest"`), it is not run.
 */
const CHECK = new RegExp(
  String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+|(?:npx|bunx|pnpm\s+(?:exec|dlx)|yarn|time|timeout\s+\S+|uv\s+run|poetry\s+run|python3?\s+-m)\s+|[^\s;&|()/]*\/)*(${RUNNER})\b`,
  'g',
)
/** A heredoc's body (`<<'EOF' … EOF`): text fed to a command, not commands. The rest of its first line is kept. */
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n(?:[\s\S]*?\n)?[ \t]*\2[ \t]*(?=\n|$)/g
/** A quoted string: an argument (`grep "jest\\|tsc"`), not commands. */
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g

/**
 * A run that failed, read from its output: a check's output is mostly piped
 * (`… 2>&1 | tail`), so the exit code is the pipe's and no error is reported.
 */
const FAILED =
  /\b[1-9]\d* (?:failed|failing|fail)\b|^\s*FAIL\b|\(fail\)|error TS\d+|Found [1-9]\d* errors?|\([1-9]\d* errors?,|npm ERR!|error\[E\d+\]|\bFAILED\b|BUILD FAILED|Command failed|exited with code [1-9]/m
/** A test run's failures. */
const TESTS_FAILED = /\b[1-9]\d* (?:failed|failing|fail)\b|^\s*FAIL\b|\(fail\)|\bFAILED\b/m
/** The failures a runner prints itself; one that runs others (`npm test`, `make test`) may print any. */
const FAILED_BY: Record<string, RegExp> = {
  jest: TESTS_FAILED,
  vitest: TESTS_FAILED,
  pytest: TESTS_FAILED,
  'go test': TESTS_FAILED,
  'claude plugin test': TESTS_FAILED,
  tsc: /error TS\d+|Found [1-9]\d* errors?/,
  eslint: /\([1-9]\d* errors?,/,
  ruff: /Found [1-9]\d* errors?/,
  mypy: /Found [1-9]\d* errors?/,
}

/** `git`, with any options before the subcommand (`git -C <dir> commit`). */
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`
/** What sets other code than the work in place to be checked: a stash, an old commit or a remote branch checked out, a new worktree. */
const ELSEWHERE = new RegExp(
  String.raw`${GIT}(?:stash(?![ \t]+(?:pop|apply|list|show|drop)\b)|worktree\s+add\b|checkout\s+(?:-(?!-\s)\S*\s+)*(?:[0-9a-f]{7,40}\b|origin\/|HEAD[~^])|switch\s+(?:-\S+\s+)*--detach\b)`,
)
const COMMIT = new RegExp(String.raw`${GIT}commit\b`)
/** A commit's output (`[main 1a2b3c4] …`): git prints it only for a commit made, so it is proof even when a later step of the call fails. */
const COMMITTED = /^\[[^\]\n]+ [0-9a-f]{7,40}\]/gm
/** A quiet commit (`-q`, `--quiet`, `-aqm`), which prints nothing when it is made. */
const QUIET_COMMIT = new RegExp(String.raw`${GIT}commit\b[^\n;&|]*\s(?:-[a-zA-Z]*q[a-zA-Z]*|--quiet)\b`, 'g')
/** What git says when a commit found nothing to make. */
const NOTHING = /\b(?:nothing to commit|nothing added to commit|no changes added to commit)\b/
/**
 * What opens a pull or merge request: the forges' CLIs (GitHub, GitLab, Gitea,
 * Forgejo, Azure DevOps), a push to GitLab with `merge_request.create`, and a
 * push to Gerrit's `refs/for/`.
 */
const PR_CREATE = new RegExp(
  String.raw`\b(?:gh\s+pr\s+(?:create|new)|glab\s+mr\s+(?:create|new)|tea\s+(?:pr|pulls?)\s+create|fj\s+pr\s+create|az\s+repos\s+pr\s+create)\b|${GIT}push\b[^\n;&|]*(?:merge_request\.create|refs\/for\/)`,
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

/**
 * One runner's run in a call: on the part it names (`jest a.test.js`, `-t sum`)
 * or on everything (none), green or red, and what it names as failed.
 */
export type Check = { runner: string; scope: string[]; isPass: boolean; failures: string[] }
/** The checks red and not green again, kept from turn to turn, and those of them already counted lost. */
export type Battles = { red: Map<string, Red>; lost: Set<string> }

export type ToolSignal =
  | { kind: 'research' }
  | { kind: 'write'; lines: number }
  | { kind: 'check'; checks: Check[] }
  | { kind: 'summon' }
  | { kind: 'other' }

/**
 * The trophies a call won: each commit made and a pull or merge request opened, as the output proves, on any forge.
 * A quiet commit has no output to prove it: a call that answered without an error is taken as one.
 */
export function trophiesOf(tool: string, input: Record<string, unknown>, isError: boolean, text: string): number {
  if (PR_TOOL.test(tool)) return isError ? 0 : 1
  if (tool !== 'Bash') return 0
  const command = String(input.command ?? '')
  const proven = COMMIT.test(command) ? (text.match(COMMITTED)?.length ?? 0) : 0
  const quiet = !isError && !NOTHING.test(text) ? (command.match(QUIET_COMMIT)?.length ?? 0) : 0
  const opened = !isError && PR_CREATE.test(command) && PR_OPENED.test(text) && !PR_EXISTS.test(text)
  return proven + quiet + Number(opened)
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
    const checks = checksOf(String(input.command ?? ''), isError, text)
    if (checks.length) return { kind: 'check', checks }
  }
  return { kind: 'other' }
}

/**
 * The checks a shell command ran, each red or green. With several in one call,
 * each is judged by the failures it prints itself, and a runner of others by
 * the ones no other claims; an exit code with no failure printed falls on all.
 * A run against other code than the work (`git stash`, an old commit) is none.
 */
function checksOf(command: string, isError: boolean, text: string): Check[] {
  const shell = command.replace(HEREDOC, '$3')
  // Quoted strings masked to their length: no runner is read in them, and the words stay where they were.
  const masked = shell.replace(QUOTED, q => q[0] + 'x'.repeat(q.length - 2) + q[0])
  if (ELSEWHERE.test(masked)) return []
  const runs = new Map<string, { runner: string; scope: string[] }>()
  for (const m of masked.matchAll(CHECK)) {
    const runner = m[1]!.replace(/\s+run\s+/, ' ')
    const from = m.index + m[0].length
    const to = from + masked.slice(from).split(/[;&|\n)]/)[0]!.length
    // `claude plugin test`'s one word is the plugin's folder: it always runs every test.
    const scope = runner === 'claude plugin test' ? [] : scopeOf(shell.slice(from, to))
    runs.set([runner, ...scope].join(' '), { runner, scope })
  }
  const all = [...runs.values()]
  const lines = text.split('\n')
  const own = all.map(r => FAILED_BY[r.runner])
  // Several in one call: each owns the failure lines it prints itself, a runner of others the ones no other claims.
  const mine = all.map((_, i) => (all.length === 1 ? lines : lines.filter(line => (own[i] ? own[i].test(line) : FAILED.test(line) && !own.some(o => o?.test(line))))))
  const isRed = all.map((_, i) => (all.length === 1 ? FAILED.test(text) : mine[i]!.length > 0))
  const isAnyRed = isRed.some(Boolean)
  return all.map((r, i) => {
    const isPass = isAnyRed ? !isRed[i] : !isError && !FAILED.test(text)
    return { ...r, isPass, failures: isPass ? [] : namesOf(mine[i]!.join('\n')) }
  })
}

/** Flags that run part of the checks: a path or name pattern (`-t`, `-k`), files by path, or what changed. */
const NARROWING = /^(?:--testPathPatterns?|--testNamePattern|-t|--runTestsByPath|--findRelatedTests|--selectProjects|-k|-m|--grep|-g|--filter|-run|--lf|--last-failed|--changed|-o|--onlyChanged)$/
/** Flags whose word is a setting, not a part to run: what to leave out, a config, a project (`tsc -p`). */
const SETTING = /^(?:--\w*(?:[Ii]gnore|[Ee]xclude)\w*|-[pcw]|--config|--project|--reporters?|--maxWorkers|--env|--rootDir)$/

/**
 * The part of the checks a run runs: the files and tests it names (`a.test.js`,
 * `-t "sum"`). None, or `.`: all of them. Redirects and settings' words are not parts.
 */
function scopeOf(args: string): string[] {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const scope: string[] = []
  let isPositional = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/^(['"])(.*)\1$/, '$2')
    if (/^\d*[<>]+&?$/.test(w)) i++
    else if (/^\d*[<>]/.test(w)) continue
    else if (w === '--') isPositional = true
    else if (!isPositional && w.startsWith('-')) {
      const [flag, value] = w.split('=', 2) as [string, string | undefined]
      if (value !== undefined) {
        if (NARROWING.test(flag)) scope.push(value)
      } else if (NARROWING.test(flag) && i + 1 < words.length && !words[i + 1]!.startsWith('-')) scope.push(words[++i]!.replace(/^(['"])(.*)\1$/, '$2'))
      else if (SETTING.test(flag)) i++
      else if (NARROWING.test(flag)) scope.push(flag)
    } else if (!['.', './', './...'].includes(w)) scope.push(w)
  }
  return scope.sort()
}

/** The checks a red run names as failed (`FAIL tests/a.test.js`, `src/a.ts(3,1): error TS…`), by file or test. */
const NAMES: RegExp[] = [/^\s*FAIL\s+(\S+)/gm, /^FAILED (\S+?)(?:::|\s|$)/gm, /^(\S+?)\(\d+,\d+\): error TS/gm, /^--- FAIL: (\S+)/gm, /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm]

function namesOf(text: string): string[] {
  return [...new Set(NAMES.flatMap(re => [...text.matchAll(re)].map(m => m[1]!)))].sort()
}

/** A battle still being fought: a runner's run gone red, known by the files or tests it named as failed, or else by the part it ran. */
export type Red = { runner: string; names: string[]; scope: string[] }

/**
 * Whether a run on `scope` runs the red check: a run on everything runs all; one
 * on some, the failures it names. A red run that named none could have been any
 * part, so any run of its runner is taken to run it.
 */
function runs(scope: string[], red: Red): boolean {
  if (!scope.length || !red.names.length) return true
  return scope.some(s => red.names.some(n => n.includes(s) || s.includes(n)))
}

/**
 * A call's checks fought. Red, a run opens one battle, for the failures it
 * names that no battle holds yet, or for the part it ran when it names none;
 * a failure already being fought is the same battle, whatever run shows it.
 * Green again, the battles it ran are won, at most one a run. A run on some
 * files says nothing of the others.
 */
export function fight(b: Battles, checks: Check[]): { passed: number; won: number } {
  let passed = 0
  let won = 0
  for (const c of checks) {
    const mine = [...b.red].filter(([, r]) => r.runner === c.runner)
    const ran = mine.filter(([, r]) => runs(c.scope, r))
    if (c.isPass) {
      passed++
      for (const [k] of ran) b.red.delete(k)
      for (const [k] of ran) b.lost.delete(k)
      if (ran.length) won++
    } else if (c.failures.length) {
      // What this runner ran red and named nothing of is now named: the same battle, under its names.
      const unnamed = mine.filter(([, r]) => !r.names.length)
      const wasLost = unnamed.some(([k]) => b.lost.has(k))
      for (const [k] of unnamed) b.red.delete(k)
      for (const [k] of unnamed) b.lost.delete(k)
      const known = new Set(mine.flatMap(([, r]) => r.names))
      const fresh = c.failures.filter(n => !known.has(n))
      if (!fresh.length) continue
      const k = `${c.runner}: ${fresh.join(', ')}`
      b.red.set(k, { runner: c.runner, names: fresh, scope: c.scope })
      if (wasLost) b.lost.add(k)
    } else if (!ran.length) b.red.set([c.runner, ...c.scope].join(' '), { runner: c.runner, names: [], scope: c.scope })
  }
  return { passed, won }
}

/**
 * A turn's end: each check still red is a battle lost, once; still red at the
 * next turn's end, it is the same battle. One whose failures are all `known`
 * (lost by a session before) was lost already. Returns the battles lost now.
 */
export function lostAtEnd(b: Battles, known: ReadonlySet<string> = new Set()): number {
  const fresh = [...b.red].filter(([k]) => !b.lost.has(k))
  for (const [k] of fresh) b.lost.add(k)
  return fresh.filter(([, r]) => !r.names.length || !r.names.every(n => known.has(n))).length
}

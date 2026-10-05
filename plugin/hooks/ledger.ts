// What each session did, day by day, kept in the plugin's store for the stats
// and the evolution. A session writes only its own key (`ledger:<id>`), so
// sessions running side by side never overwrite each other; readers add them up.

export type Counters = {
  /** Main-loop turns. */
  turns: number
  /** Turns run inside a rest window: the pet's sleep disturbed. */
  restTurns: number
  /** Requests that fed the cache. */
  meals: number
  /** After a gap of over five minutes, whether the cache was still there. */
  cacheHits: number
  cacheMisses: number
  careMistakes: number
  /** Main-loop turns that used a tool: training. */
  toolTurns: number
  /** Time the main loop spent on turns. */
  activeMs: number
  /** Research calls that answered: Read, Grep, WebFetch … */
  research: number
  /** Lines written by Edit / Write. */
  linesWritten: number
  /** Test, build, type-check and lint runs that passed. */
  checksPassed: number
  /** Requests that ran two or more tools at once. */
  parallelSteps: number
  prompts: number
  /** The context filling past 85%. */
  overfeeds: number
  /** A check gone red and green again within the turn; one still red when the turn ended is lost. */
  battlesWon: number
  battlesLost: number
  /** Commits made and pull requests opened, as their output proves. */
  trophies: number
  /** Subagents sent. */
  summons: number
  /** Risky moves: a turn interrupted, a push forced, a hook skipped, a hard reset, an `rm -rf` outside a temp folder. */
  chaos: number
  /** Turns under a minute that used a tool and answered. */
  quickTurns: number
  /** `/digi pet`. */
  pats: number
}

export type Ledger = Record<string, Counters>

export const ZERO: Counters = {
  turns: 0,
  restTurns: 0,
  meals: 0,
  cacheHits: 0,
  cacheMisses: 0,
  careMistakes: 0,
  toolTurns: 0,
  activeMs: 0,
  research: 0,
  linesWritten: 0,
  checksPassed: 0,
  parallelSteps: 0,
  prompts: 0,
  overfeeds: 0,
  battlesWon: 0,
  battlesLost: 0,
  trophies: 0,
  summons: 0,
  chaos: 0,
  quickTurns: 0,
  pats: 0,
}

type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  keys: () => Promise<string[]>
}

export const keyOf = (sessionId: string) => `ledger:${sessionId}`

export function asLedger(kept: unknown): Ledger {
  if (!kept || typeof kept !== 'object') return {}
  const out: Ledger = {}
  for (const [day, value] of Object.entries(kept as Record<string, unknown>)) {
    const v = (value ?? {}) as Partial<Record<keyof Counters, unknown>>
    out[day] = Object.fromEntries(Object.keys(ZERO).map(k => [k, Number(v[k as keyof Counters]) || 0])) as Counters
  }
  return out
}

/** Adds `delta` to the session's counters for `day`. */
export function add(ledger: Ledger, day: string, delta: Partial<Counters>): Ledger {
  const was = ledger[day] ?? ZERO
  const now = { ...was }
  for (const [k, n] of Object.entries(delta)) now[k as keyof Counters] += n ?? 0
  return { ...ledger, [day]: now }
}

/** Every session's counters added up. */
export async function totals(store: Store): Promise<Counters> {
  const sum = { ...ZERO }
  for (const day of Object.values(await byDay(store))) {
    for (const k of Object.keys(sum) as (keyof Counters)[]) sum[k] += day[k]
  }
  return sum
}

/** Every session's counters added up day by day. */
export async function byDay(store: Store): Promise<Ledger> {
  let days: Ledger = {}
  for (const key of await store.keys()) {
    if (!key.startsWith('ledger:')) continue
    for (const [day, counters] of Object.entries(asLedger(await store.get(key)))) days = add(days, day, counters)
  }
  return days
}

/** One writer per session: each bump reads, adds and writes after the one before it has. */
export function writer(store: Store) {
  let chain: Promise<unknown> = Promise.resolve()
  return {
    bump(sessionId: string, day: string, delta: Partial<Counters>): Promise<Ledger> {
      const run = chain.then(async () => {
        const next = add(asLedger(await store.get(keyOf(sessionId))), day, delta)
        await store.set(keyOf(sessionId), next)
        return next
      })
      chain = run.catch(() => undefined)
      return run
    },
    async read(sessionId: string): Promise<Ledger> {
      await chain
      return asLedger(await store.get(keyOf(sessionId)))
    },
  }
}

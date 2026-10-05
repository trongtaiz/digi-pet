/** This session's side of the pet's hunger (hooks/hunger.ts `Feeding`). */
export type DigiFeeding = {
  lastFedAt: number | null
  isSide: boolean
  isAsleep: boolean
  breakUntil: number | null
  contextTokens: number | null
}

/** A state `/digi sim` shows in place of the real one. */
export type DigiSim = { species: string; state: string; to: string | null }

/** What the pet is doing besides being hungry: eating after a meal, sick after a care mistake, happy after a pat. */
export type DigiMood = { kind: 'normal' | 'eating' | 'sick' | 'happy'; turnsLeft: number }

/** What the running turn is doing; `idle` between turns. */
export type DigiActivity = { act: 'idle' | 'think' | 'tool' | 'say' | 'ask'; tool?: string }

/** Local facts the drawing needs: the clock's offset from UTC and the project's name. */
export type DigiLocal = { offsetMin: number; project: string; ttlMs: number }

/** How the pet is growing, worked out after each turn for the band and the pane to draw. */
export type DigiGrowth = {
  stats: { STA: number; INT: number; ATK: number; DEF: number; SPD: number; SYN: number }
  /** This stage's battles. */
  battles: { won: number; lost: number }
  /** Days with five turns or more, ever. */
  ageDays: number
  next: { label: string; ratio: number } | null
  log: { name: string; day: string }[]
  /** What this stage's evolution rules read, counted since the pet entered it. */
  stage: { careMistakes: number; training: number; overfeed: number; sleepDisturbances: number; trophies: number; summons: number; chaos: number }
  /** Every trophy ever, and the win ratio over every battle ever. */
  trophies: number
  winRatio: number
}

/** The fight in the band: checks red right now, battles won this stage, and whether one was won just now. */
export type DigiBattle = { open: number; won: number; flash: boolean }

/** A digivolution playing in the band until `until`. */
export type DigiEvolving = { from: string; to: string; until: number }

declare module 'claude-code' {
  interface PluginState {
    'digi-pet': {
      feeding: DigiFeeding
      /** The clock as the last tick read it: the band redraws from it. */
      now: number
      mood: DigiMood
      sim: DigiSim | null
      /** True while a `/` or `@` picker is open above the band. */
      isPicking: boolean
      /** Care mistakes on record, every session's. */
      mistakes: number
      /** Lines for the pane: today's counts, the last cache hit or miss. */
      facts: string[]
      local: DigiLocal
      species: string
      activity: DigiActivity
      growth: DigiGrowth | null
      evolving: DigiEvolving | null
      battle: DigiBattle
    }
  }
}

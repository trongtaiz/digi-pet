// How the pet grows, pure: the six stats from every day's counters, and when and
// into what it digivolves. The branches are Digital Monster Color's own rules
// (care mistakes, training, overfeed, sleep disturbances, battles, win ratio),
// counted since the pet entered its stage; how long a stage lasts is ours (GATES),
// and so are Chaos turning a branch Virus and a jogress partner on call.
import type { Counters, Ledger } from './ledger'
import { STAT_NAMES } from './render'
import type { StatName } from './render'

export type Range = { min: number; max: number | null }
const REQUIREMENTS = ['careMistakes', 'training', 'overfeed', 'sleepDisturbances', 'battles', 'winRatio'] as const
export type Requirement = (typeof REQUIREMENTS)[number]
/** A way on: the requirements to meet, or a jogress with the partner named. */
export type Rule = { to: string; jogress?: string } & Partial<Record<Requirement, Range>>
export type SpeciesRules = { name: string; stage: string; attribute: string; power: number | null; rules: Rule[] }

/** What a stage's rules read: counted since the pet entered the stage. */
export type Counts = {
  turns: number
  /** Days before today with at least ACTIVE_TURNS turns: a holiday is no day of growth. */
  activeDays: number
  careMistakes: number
  training: number
  overfeed: number
  sleepDisturbances: number
  battles: number
  wins: number
  trophies: number
  summons: number
  chaos: number
}

/** The pet as the store keeps it (`pet`): what it is, since when, and the counts it entered its stage with. */
export type Pet = { species: string; enteredDay: string; base: Counts; log: { id: string; day: string }[] }

/** What else growing reads: every battle ever (the win ratio carries over a digivolution), the day, the pace. */
export type Context = { life: Pick<Counts, 'battles' | 'wins'>; day: string; pace: number }

export const START_SPECIES = 'egg1'
export const ACTIVE_TURNS = 5
/** Turns with a tool that count as training in a day (at normal pace); more that day train no further. */
export const TRAINING_PER_DAY = 12
/** Risky moves a stage takes, per day it lasts, before its branch turns Virus. */
export const CHAOS_PER_DAY = 5
/** `pace` → how long every stage lasts, against normal. */
export const PACES: Record<string, number> = { fast: 0.25, normal: 1, slow: 2 }

type Gate = { days?: number; turns?: number; trophies?: number; summons?: number }
/** How long each stage lasts before the pet can digivolve. Guesses: tune after a few weeks. */
export const GATES: Record<string, Gate> = {
  egg: { turns: 3 },
  baby1: { turns: 25 },
  baby2: { days: 2, turns: 100 },
  rookie: { days: 5 },
  champion: { days: 10, trophies: 30 },
  ultimate: { days: 21, trophies: 60, summons: 10 },
  mega: { days: 14 },
}
const NEXT_STAGE: Record<string, string> = { egg: 'Baby I', baby1: 'Baby II', baby2: 'Rookie', rookie: 'Champion', champion: 'Ultimate', ultimate: 'Mega', mega: 'Jogress' }
/** As the device asks of Stages V and VI: below 40% wins never, at 80% surely, between by chance. */
const MIN_WIN_RATIO = 40
/** What a jogress asks of a Mega: the battles a Stage VI asks for. */
const JOGRESS = { battles: { min: 15, max: null }, winRatio: { min: 80, max: null } } as const

/** A day's stat points: past DAILY_POINTS a stat gains a quarter as fast, so no one day makes the pet. */
const DAILY_POINTS = 20
const POINTS: Record<StatName, (c: Counters) => number> = {
  STA: c => c.activeMs / 360_000,
  INT: c => c.research / 4,
  ATK: c => c.linesWritten / 25,
  DEF: c => c.checksPassed * 2,
  SPD: c => c.parallelSteps + c.quickTurns,
  SYN: c => c.prompts / 2 + Math.min(PATS_PER_DAY, c.pats) * 2,
}
export const PATS_PER_DAY = 3
/** A day's SYN for showing up: one point per active day in the week before it, up to five. */
const STREAK_DAYS = 7
const STREAK_POINTS = 5

export const ZERO_COUNTS: Counts = {
  turns: 0,
  activeDays: 0,
  careMistakes: 0,
  training: 0,
  overfeed: 0,
  sleepDisturbances: 0,
  battles: 0,
  wins: 0,
  trophies: 0,
  summons: 0,
  chaos: 0,
}

export function paceOf(name: unknown): number {
  return PACES[String(name)] ?? 1
}

/** A gate's number at `pace`, never under one. */
function scaled(n: number, pace: number): number {
  return Math.max(1, Math.ceil(n * pace))
}

export function countsOf(days: Ledger, today: string, pace = 1): Counts {
  const trainingCap = Math.ceil(TRAINING_PER_DAY / pace)
  const c = { ...ZERO_COUNTS }
  for (const [day, d] of Object.entries(days)) {
    c.turns += d.turns
    if (day < today && d.turns >= ACTIVE_TURNS) c.activeDays++
    c.careMistakes += d.careMistakes
    c.training += Math.min(trainingCap, d.toolTurns)
    c.overfeed += d.overfeeds
    c.sleepDisturbances += d.restTurns
    c.battles += d.battlesWon + d.battlesLost
    c.wins += d.battlesWon
    c.trophies += d.trophies
    c.summons += d.summons
    c.chaos += d.chaos
  }
  return c
}

export function minus(a: Counts, b: Counts): Counts {
  return Object.fromEntries(Object.keys(ZERO_COUNTS).map(k => [k, Math.max(0, a[k as keyof Counts] - b[k as keyof Counts])])) as Counts
}

export function statsOf(days: Ledger): Record<StatName, number> {
  const soft = (n: number) => (n <= DAILY_POINTS ? n : DAILY_POINTS + (n - DAILY_POINTS) / 4)
  const active = new Set(Object.entries(days).filter(([, d]) => d.turns >= ACTIVE_TURNS).map(([day]) => day))
  const stats = Object.fromEntries(STAT_NAMES.map(s => [s, 0])) as Record<StatName, number>
  for (const [day, d] of Object.entries(days)) {
    for (const s of STAT_NAMES) stats[s] += soft(POINTS[s](d))
    if (active.has(day)) stats.SYN += Math.min(STREAK_POINTS, daysBefore(day, STREAK_DAYS).filter(x => active.has(x)).length)
  }
  return Object.fromEntries(STAT_NAMES.map(s => [s, Math.floor(stats[s])])) as Record<StatName, number>
}

/** The `n` dates before `day` (YYYY-MM-DD). */
function daysBefore(day: string, n: number): string[] {
  const t = Date.parse(`${day}T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (i + 1) * 86_400_000).toISOString().slice(0, 10))
}

export function winRatio(c: Pick<Counts, 'battles' | 'wins'>): number {
  return c.battles ? Math.floor((100 * c.wins) / c.battles) : 0
}

/** The day's roll for a species, 0..1: the same in every session, a new one each day. */
export function rollOf(id: string, day: string): number {
  let h = 2166136261
  for (const ch of `${id}@${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

function isMet(r: Rule, c: Counts, ctx: Context, roll: number): boolean {
  const values: Record<Requirement, number> = { ...c, winRatio: winRatio(ctx.life) }
  return REQUIREMENTS.every(k => {
    const range = r[k]
    if (!range) return true
    const v = values[k]
    if (range.max !== null && v > range.max) return false
    if (v >= range.min) return true
    // Short of the win ratio asked: from 40% up, a chance that grows with it.
    return k === 'winRatio' && v >= MIN_WIN_RATIO && roll < (v - MIN_WIN_RATIO) / (range.min - MIN_WIN_RATIO)
  })
}

function isGateOpen(stage: string, c: Counts, pace: number): boolean {
  const gate = GATES[stage]
  if (!gate) return false
  return (['days', 'turns', 'trophies', 'summons'] as const).every(k => !gate[k] || c[k === 'days' ? 'activeDays' : k] >= scaled(gate[k], pace))
}

/** What the pet digivolves into now, given its stage's counts; null while its stage lasts or no rule lets it. */
export function evolveTo(id: string, c: Counts, species: Record<string, SpeciesRules>, ctx: Context = { life: c, day: '', pace: 1 }): string | null {
  const s = species[id]
  const rules = s?.rules.filter(r => !r.jogress) ?? []
  if (!s || !rules.length || !isGateOpen(s.stage, c, ctx.pace)) return null
  const targets = [...new Set(rules.map(r => r.to))]
  // A reckless stage takes the Virus branch, where it has one.
  if (targets.length > 1 && c.chaos >= CHAOS_PER_DAY * scaled(GATES[s.stage]!.days ?? 1, ctx.pace)) {
    const virus = targets.find(to => species[to]?.attribute === 'Virus')
    if (virus) return virus
  }
  const roll = rollOf(id, ctx.day)
  const rule = rules.find(r => isMet(r, c, ctx, roll))
  if (rule) return rule.to
  // A Rookie no rule takes still digivolves, as on the device: into its chart's catch-all, listed last.
  return s.stage === 'rookie' ? rules[rules.length - 1]!.to : null
}

/** The jogress a Mega can make now (`/digi jogress`): its partner and what they become, or why not. */
export function jogressOf(id: string, c: Counts, species: Record<string, SpeciesRules>, ctx: Context): { to: string; partner: string } | { missing: string } {
  const rule = species[id]?.rules.find(r => r.jogress)
  if (!rule) return { missing: `${species[id]?.name ?? id} has no jogress partner on its chart.` }
  if (!isGateOpen(species[id]!.stage, c, ctx.pace)) return { missing: `Not yet: ${progressOf(id, c, species, ctx)?.label ?? ''}` }
  if (!isMet({ to: rule.to, ...JOGRESS }, c, ctx, rollOf(id, ctx.day))) return { missing: `Not yet: ${JOGRESS.battles.min} battles this stage and a ${JOGRESS.winRatio.min}% win ratio first.` }
  return { to: rule.to, partner: rule.jogress! }
}

/** The way to the next stage (`day 1/2 · turns 40/100 → Rookie`) and how far along, 0..1; null at the last stage. */
export function progressOf(id: string, c: Counts, species: Record<string, SpeciesRules>, ctx: Context = { life: c, day: '', pace: 1 }): { label: string; ratio: number } | null {
  const s = species[id]
  const gate = s && GATES[s.stage]
  if (!s || !gate || !s.rules.length) return null
  const parts: string[] = []
  const ratios: number[] = []
  const add = (label: string, have: number, need: number) => {
    parts.push(`${label} ${Math.min(have, need)}/${need}`)
    ratios.push(have / need)
  }
  if (gate.days) add('day', c.activeDays, scaled(gate.days, ctx.pace))
  if (gate.turns) add('turns', c.turns, scaled(gate.turns, ctx.pace))
  if (gate.trophies) add('trophies', c.trophies, scaled(gate.trophies, ctx.pace))
  if (gate.summons) add('summons', c.summons, scaled(gate.summons, ctx.pace))
  const fights = s.rules.some(r => r.jogress) ? JOGRESS : s.rules.find(r => r.battles)
  if (fights?.battles) {
    parts.push(`battles ${c.battles}/${fights.battles.min} · win ${winRatio(ctx.life)}%${fights.winRatio ? `/${fights.winRatio.min}%` : ''}`)
    ratios.push(c.battles / fights.battles.min)
  }
  return { label: `${parts.join(' · ')} → ${NEXT_STAGE[s.stage]}`, ratio: Math.max(0, Math.min(1, ...ratios)) }
}

/** A new pet's egg: one of the chart's versions, `roll` (0..1) picking among them evenly. */
export function eggOf(species: Record<string, SpeciesRules>, roll: number): string {
  const eggs = Object.keys(species).filter(id => species[id]!.stage === 'egg')
  return eggs[Math.min(eggs.length - 1, Math.floor(roll * eggs.length))] ?? START_SPECIES
}

export function asPet(kept: unknown, start = START_SPECIES): Pet {
  const p = (kept && typeof kept === 'object' ? kept : {}) as Partial<Pet>
  const base = { ...ZERO_COUNTS }
  for (const k of Object.keys(base) as (keyof Counts)[]) base[k] = Number(p.base?.[k]) || 0
  return {
    species: typeof p.species === 'string' ? p.species : start,
    enteredDay: typeof p.enteredDay === 'string' ? p.enteredDay : '',
    base,
    log: Array.isArray(p.log) ? p.log.filter(e => e && typeof e.id === 'string').map(e => ({ id: e.id, day: String(e.day ?? '') })) : [],
  }
}

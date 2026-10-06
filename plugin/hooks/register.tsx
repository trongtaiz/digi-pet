// digi-pet: a Digimon V-Pet that lives above the prompt. It eats this session's
// prompt cache: as the cache nears its expiry the pet grows hungry and yells
// (the band, a toast, a macOS notification), and a cache left to go cold on a
// working day is a care mistake. Rest windows, breaks, `/digi sleep` and side
// sessions keep it quiet. Each session's counts go to the store; after each
// turn they grow the six stats and, once a stage has lasted, digivolve the pet.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { DigiActivity, DigiBattle, DigiEvolving, DigiFeeding, DigiGrowth, DigiMood, DigiSim } from '../types'
import { busyLabel, toolLabel } from './activity'
import { segments } from './cells'
import type { Grid } from './cells'
import { ACTIVE_TURNS, PATS_PER_DAY, START_SPECIES, asPet, countsOf, eggOf, evolveTo, jogressOf, minus, paceOf, progressOf, statsOf, winRatio } from './growth'
import type { Context, Counts, Pet } from './growth'
import {
  clockText,
  dayOf,
  hungerOf,
  isCareMistake,
  isResting,
  isSidePath,
  minutesLeft,
  parseBreak,
  parseOffset,
  parseRest,
  quietOf,
  restEnd,
  warningOf,
} from './hunger'
import type { Config, Quiet } from './hunger'
import { byDay, totals, writer } from './ledger'
import type { Counters, Ledger } from './ledger'
import { BAND_WIDTH, MINI_BAND_ROWS, band, isLoud, miniBand, notification, statusLine, toast } from './render'
import type { Attribute, Hunger } from './render'
import type { ScreenProps } from './screen'
import { isRisky, isTrophy, signalOf } from './signals'
import { SPECIES } from './species.gen'
import { isSpecies, petView, spriteOf } from './view'
import type { PaneJson, ViewJson } from './view'

const PANE = 'digi'
const MINUTE = 60_000
const TICK_MS = 15_000
const EATING_MS = 4_000
const SICK_TURNS = 3
/** A quick turn, for SPD. */
const QUICK_MS = 60_000
const LOUD_ROWS = 9
const WORK_ROWS = 8
/** The pet's block while it fights: its screen and a few words, the arena takes the rest. */
const WORK_BLOCK = 54
const MIN_ARENA = 20
/** How long the band plays a digivolution. */
const EVOLVE_MS = 20_000
/** The context this full is an overfeed; it counts again once the context has dropped under REFED. */
const OVERFULL_PERCENT = 85
const REFED_PERCENT = 70
const STATES = ['full', 'peckish', 'hungry', 'starving', 'cold', 'asleep', 'sick', 'eating', 'evolving'] as const

const EMPTY: DigiFeeding = { lastFedAt: null, isSide: false, isAsleep: false, breakUntil: null, contextTokens: null }

const feeding = atom({ plugin: 'digi-pet', key: 'feeding' } as const, EMPTY)
const now = atom({ plugin: 'digi-pet', key: 'now' } as const, 0)
const mood = atom({ plugin: 'digi-pet', key: 'mood' } as const, { kind: 'normal', turnsLeft: 0 } as DigiMood)
const sim = atom({ plugin: 'digi-pet', key: 'sim' } as const, null as DigiSim | null)
const isPicking = atom({ plugin: 'digi-pet', key: 'isPicking' } as const, false)
const mistakes = atom({ plugin: 'digi-pet', key: 'mistakes' } as const, 0)
const facts = atom({ plugin: 'digi-pet', key: 'facts' } as const, [] as string[])
const local = atom({ plugin: 'digi-pet', key: 'local' } as const, { offsetMin: 0, project: '', ttlMs: 60 * MINUTE })
const species = atom({ plugin: 'digi-pet', key: 'species' } as const, START_SPECIES)
const activity = atom({ plugin: 'digi-pet', key: 'activity' } as const, { act: 'idle' } as DigiActivity)
const growth = atom({ plugin: 'digi-pet', key: 'growth' } as const, null as DigiGrowth | null)
const evolving = atom({ plugin: 'digi-pet', key: 'evolving' } as const, null as DigiEvolving | null)
const battle = atom({ plugin: 'digi-pet', key: 'battle' } as const, { open: 0, won: 0, flash: false } as DigiBattle)

const USAGE = '[stats | pane | log | pet | jogress | sleep | break 90m|until 15:30|off | side [off] | sim <species> [state] [to] | sim off | debug ttl <min>|off]'

/** Whether the prompt's draft has a `/` or `@` picker open, which the engine draws above the band. */
function isPickerOpen(text: string, cursor = text.length): boolean {
  const before = text.slice(0, cursor)
  return /^\/\S*$/.test(before) || /(^|\s)@\S*$/.test(before)
}

/** The store as the ledger takes it, each call spelled on `$`. */
function storeOf($: EngineInterface) {
  return {
    get: (key: string) => $.store.get(key),
    set: (key: string, value: unknown) => $.store.set(key, value),
    keys: () => $.store.keys(),
  }
}

/** What the hooks share for this load: the options, and what a reload starts over. */
type Ctx = {
  ttlMinutes: number
  restText: string
  rest: Config['rest']
  dayStartsHour: number
  minContextTokens: number
  sidePaths: string[]
  isNotifying: boolean
  ledger: ReturnType<typeof writer> | undefined
  tick: { cancel: () => void } | undefined
  eatingTimer: { cancel: () => void } | undefined
  isMistakePending: boolean
  warned: { fedAt: number; levels: Set<string> }
  shownStatus: string | undefined
  /** The main loop's tool calls running now, by id, with their labels. */
  running: Map<string, string>
  /** Whether the running turn has used a tool: a turn of training. */
  isTraining: boolean
  /** The checks gone red this turn and not green again: battles still being fought. */
  red: Set<string>
  isOverfull: boolean
  /** `pace`: how long every stage lasts, against normal. */
  pace: number
  /** `reducedMotion`: the band and the pane drawn still. */
  isStill: boolean
  /** A `/digi side` flag kept by the conversation a /clear just ended, for the one it starts. */
  sideOnClear: boolean | undefined
}

function contextOf(options: Readonly<Record<string, unknown>>): Ctx {
  const restText = String(options.restHours ?? '12:00-14:00,18:00-08:00')
  return {
    ttlMinutes: Number(options.ttlMinutes) || 60,
    restText,
    rest: parseRest(restText),
    dayStartsHour: Number(options.dayStartsHour ?? 4),
    minContextTokens: Number(options.minContextTokens ?? 20_000),
    sidePaths: String(options.sidePaths ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    isNotifying: options.notify !== false,
    ledger: undefined,
    tick: undefined,
    eatingTimer: undefined,
    isMistakePending: false,
    warned: { fedAt: -1, levels: new Set() },
    shownStatus: undefined,
    running: new Map(),
    isTraining: false,
    red: new Set(),
    isOverfull: false,
    pace: paceOf(options.pace),
    isStill: options.reducedMotion === true,
    sideOnClear: undefined,
  }
}

async function configOf($: EngineInterface, ctx: Ctx): Promise<Config> {
  const { offsetMin, ttlMs } = await read($, local)
  return { ttlMs, rest: ctx.rest, dayStartsHour: ctx.dayStartsHour, minContextTokens: ctx.minContextTokens, offsetMin }
}

function ledgerOf($: EngineInterface, ctx: Ctx) {
  ctx.ledger ??= writer(storeOf($))
  return ctx.ledger
}

async function bump($: EngineInterface, ctx: Ctx, delta: Partial<Counters>) {
  const cfg = await configOf($, ctx)
  return ledgerOf($, ctx).bump(await $.session.id(), dayOf(await $.clock.now(), cfg), delta)
}

function quietText(q: Quiet | null, f: DigiFeeding, t: number, cfg: Config): string | undefined {
  switch (q) {
    case 'side':
      return 'side session · not hungry'
    case 'asleep':
      return '💤 asleep until your next prompt'
    case 'break':
      return `☕ on break until ${clockText(f.breakUntil ?? t, cfg.offsetMin)}`
    case 'rest': {
      const end = restEnd(t, cfg)
      return `💤 resting${end ? ` until ${clockText(end, cfg.offsetMin)}` : ''}`
    }
    case 'small':
      return 'small context · not hungry'
    case 'unfed':
      return 'waiting for the first prompt'
    default:
      return undefined
  }
}

/** The pet as the band and the pane draw it, now (or as `/digi sim` asks). */
async function viewOf($: EngineInterface, ctx: Ctx, t: number): Promise<ViewJson> {
  const cfg = await configOf($, ctx)
  const { project } = await read($, local)
  const shown = await read($, sim)
  const base = { attribute: null, project, ttlMinutes: cfg.ttlMs / MINUTE }
  if (shown) {
    const state = shown.state as (typeof STATES)[number]
    const hunger: Hunger = (['full', 'peckish', 'hungry', 'starving', 'cold'] as const).find(h => h === state) ?? 'full'
    const left = { full: 48, peckish: 24, hungry: 12, starving: 4, cold: 0 }[hunger] * (cfg.ttlMs / (60 * MINUTE))
    return {
      ...base,
      species: shown.species,
      hunger,
      minutesLeft: left,
      mood: state === 'asleep' || state === 'sick' || state === 'eating' ? state : 'normal',
      ...withText('evolvingTo', state === 'evolving' ? (shown.to ?? undefined) : undefined),
    }
  }
  const f = await read($, feeding)
  const q = quietOf(f, t, cfg)
  const m = await read($, mood)
  const hunger: Hunger = f.lastFedAt === null || q ? 'full' : hungerOf(t - f.lastFedAt, cfg.ttlMs)
  const isNapping = q === 'rest' || q === 'break' || q === 'asleep'
  const id = await read($, species)
  const ev = await read($, evolving)
  const shownId = ev && t < ev.until ? ev.from : id
  const g = await read($, growth)
  return {
    ...base,
    species: shownId,
    attribute: attributeOf(shownId),
    ...withText('evolvingTo', ev && t < ev.until ? ev.to : undefined),
    ...(g ? { next: g.next } : {}),
    hunger,
    minutesLeft: minutesLeft(f, t, cfg),
    mood: m.kind !== 'normal' ? m.kind : isNapping ? 'asleep' : 'normal',
    ...withText('quiet', quietText(q, f, t, cfg)),
    ...(await actOf($)),
  }
}

function attributeOf(id: string): Attribute | null {
  const a = SPECIES[id]?.attribute
  return a === 'Vaccine' || a === 'Data' || a === 'Virus' ? a : null
}

/** A grid of cells as Text rows. */
function drawn(ui: Pick<Elements['terminal'], 'Box' | 'Text'>, rows: Grid): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">
          {segments(row).map(seg => (
            <Text color={seg.c} backgroundColor={seg.bg} bold={seg.b} dimColor={seg.d}>
              {seg.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

/** The record as lines: this session today, and every session ever. */
async function recordLines($: EngineInterface, ctx: Ctx): Promise<string[]> {
  const cfg = await configOf($, ctx)
  const today = (await ledgerOf($, ctx).read(await $.session.id()))[dayOf(await $.clock.now(), cfg)]
  const all = await totals(storeOf($))
  return [
    `Today here: ${today?.turns ?? 0} turns · ${today?.meals ?? 0} meals · cache ${today?.cacheHits ?? 0} hit / ${today?.cacheMisses ?? 0} miss after a gap`,
    `All time: ${all.turns} turns · ${all.meals} meals · ${all.restTurns} in rest hours · cache ${all.cacheHits} hit / ${all.cacheMisses} miss`,
  ]
}

/** Weight, as the device shows it: grams, here from the context the pet carries (10k tokens a gram, 5g at least). */
function weightOf(tokens: number | null): number {
  return Math.max(5, Math.round((tokens ?? 0) / 10_000))
}

/** The stats, this stage's counts and the way on, as `/digi stats` prints them. */
function growthLines(g: DigiGrowth): string[] {
  const s = g.stats
  const st = g.stage
  return [
    `Stats: STA ${s.STA} · INT ${s.INT} · ATK ${s.ATK} · DEF ${s.DEF} · SPD ${s.SPD} · SYN ${s.SYN}`,
    `This stage: ${st.careMistakes} care mistakes · ${st.training} training · ${st.overfeed} overfeed · ${st.sleepDisturbances} sleep disturbances · ${st.chaos} chaos · ${st.trophies} trophies · ${st.summons} summons`,
    `Battles this stage: ${g.battles.won}W ${g.battles.lost}L · win ratio ${g.winRatio}% over every battle · ${g.trophies} trophies ever`,
    g.next ? `Next: ${g.next.label}` : 'Fully digivolved',
    ...(g.log.length ? [`Evolution: ${g.log.map(e => `${e.name} (${e.day})`).join(' → ')}`] : []),
  ]
}

/** The running turn's act and tool for the view, or nothing between turns. */
async function actOf($: EngineInterface): Promise<Pick<ViewJson, 'act' | 'tool'>> {
  const a = await read($, activity)
  if (a.act === 'idle') return {}
  return { act: a.act, ...withText('tool', a.tool) }
}

async function settle($: EngineInterface, ctx: Ctx) {
  const tool = busyLabel([...ctx.running.values()])
  await update($, activity, (a): DigiActivity => (a.act === 'idle' ? a : tool ? { act: 'tool', tool } : { act: 'think' }))
}

/** `{ [key]: text }`, or nothing when there is no text: a Client's props hold no undefined. */
function withText<K extends string>(key: K, text: string | undefined): { [P in K]?: string } {
  return (text === undefined ? {} : { [key]: text }) as { [P in K]?: string }
}

async function notify($: EngineInterface, ctx: Ctx, title: string, body: string) {
  if (!ctx.isNotifying) return
  // Title and body ride as arguments, never inside the script, so no project name can break out of it.
  await $.process
    .run(['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body])
    .catch(() => undefined)
}

/** Every tick: redraw the hearts, and yell once per level per meal while yelling can still save the cache. */
async function onTick($: EngineInterface, ctx: Ctx) {
  const t = await $.clock.now()
  await update($, now, () => t)
  // Another session digivolved the pet: draw what it is now.
  const kept = asPet(await $.store.get('pet'))
  if (kept.species !== (await read($, species)) && isSpecies(kept.species)) await grow($, ctx)
  const f = await read($, feeding)
  const cfg = await configOf($, ctx)
  const level = warningOf(f, t, cfg)
  if (level && f.lastFedAt !== null) {
    if (ctx.warned.fedAt !== f.lastFedAt) ctx.warned = { fedAt: f.lastFedAt, levels: new Set() }
    if (!ctx.warned.levels.has(level)) {
      ctx.warned.levels.add(level)
      const v = petView(await viewOf($, ctx, t), 0)
      const text = toast(v)
      const n = notification(v)
      if (text) $.ui.toast(text, { timeoutMs: 8000 })
      if (n) await notify($, ctx, n.title, n.body)
    }
  }
  const status = level === 'starving' ? statusLine(petView(await viewOf($, ctx, t), 0)) : undefined
  if (status !== ctx.shownStatus) {
    ctx.shownStatus = status
    $.ui.status(status)
  }
}

/** (Re)starts the tick: every 15 s, or often enough that a short TTL's starving stretch (1/12 of it) is never skipped. */
function startTick($: EngineInterface, ctx: Ctx, ttlMs: number) {
  ctx.tick?.cancel()
  ctx.tick = $.clock.every(Math.min(TICK_MS, Math.floor(ttlMs / 24)), () => void onTick($, ctx))
}

async function endEating($: EngineInterface) {
  await update($, mood, m => (m.kind === 'eating' || m.kind === 'happy' ? ({ kind: 'normal', turnsLeft: 0 } as DigiMood) : m))
}

async function setMood($: EngineInterface, ctx: Ctx, next: DigiMood) {
  await update($, mood, () => next)
  ctx.eatingTimer?.cancel()
  if (next.kind === 'eating' || next.kind === 'happy') ctx.eatingTimer = $.clock.after(EATING_MS, () => void endEating($))
}

/** A request of the main loop answered: the cache is fed. */
async function meal($: EngineInterface, ctx: Ctx, usage: { cache_read_input_tokens: number; cache_creation_input_tokens: number } | null) {
  const t = await $.clock.now()
  const f = await read($, feeding)
  const cfg = await configOf($, ctx)
  const gap = f.lastFedAt === null ? null : t - f.lastFedAt
  const wasHungry = f.lastFedAt !== null && !quietOf(f, t, cfg) && ['hungry', 'starving', 'cold'].includes(hungerOf(t - f.lastFedAt, cfg.ttlMs))
  const isHit = usage ? usage.cache_read_input_tokens >= usage.cache_creation_input_tokens : null
  const isLongGap = gap !== null && gap > 5 * MINUTE

  // The band draws from the tick's clock: bring it up to the meal first, or the meal looks to be in its future.
  await update($, now, () => t)
  await update($, feeding, x => ({ ...x, lastFedAt: t }))
  if (isLongGap && isHit !== null) {
    const fact = `Cache ${isHit ? 'hit ✓' : 'miss ✗'} after a ${Math.round(gap / MINUTE)}m gap (${clockText(t, cfg.offsetMin)})`
    await update($, facts, list => [fact, ...list.filter(l => !l.startsWith('Cache '))].slice(0, 4))
  }
  await bump($, ctx, { meals: 1, ...(isLongGap && isHit !== null ? (isHit ? { cacheHits: 1 } : { cacheMisses: 1 }) : {}) })

  if (ctx.isMistakePending) {
    ctx.isMistakePending = false
    // The cache answered after all: nothing was lost.
    if (isHit !== true) {
      await bump($, ctx, { careMistakes: 1 })
      await update($, mistakes, n => n + 1)
      await setMood($, ctx, { kind: 'sick', turnsLeft: SICK_TURNS })
      const name = spriteOf(await read($, species)).name
      $.ui.toast(`${name} got sick: the cache went cold and had to be rebuilt (care mistake, ${dayOf(t, cfg)})`, { timeoutMs: 8000 })
      return
    }
  }
  if (wasHungry && (await read($, mood)).kind !== 'sick') await setMood($, ctx, { kind: 'eating', turnsLeft: 0 })
}

/** What a finished tool call adds to the stats, and a check's run to its battle: red opens one, green again wins it. */
async function trained<R extends object>($: EngineInterface, ctx: Ctx, e: { tool: string }, result: R): Promise<R> {
  if ('deny' in result && result.deny !== undefined) return result
  const r = result as { isError?: boolean; text?: string }
  const input = e as unknown as Record<string, unknown>
  const signal = signalOf(e.tool, input, r.isError === true, r.text ?? '')
  if (signal.kind === 'research') await bump($, ctx, { research: 1 })
  if (signal.kind === 'write' && signal.lines) await bump($, ctx, { linesWritten: signal.lines })
  if (signal.kind === 'summon') await bump($, ctx, { summons: 1 })
  // A commit can ride along with a check (`npm test && git commit`): judged on its own.
  if (e.tool === 'Bash' && isTrophy(String(input.command ?? ''), r.text ?? '', r.isError === true)) await bump($, ctx, { trophies: 1 })
  if (e.tool === 'Bash' && isRisky(String(input.command ?? ''))) await bump($, ctx, { chaos: 1 })
  if (signal.kind === 'check' && !signal.isPass) ctx.red.add(signal.runner)
  if (signal.kind === 'check' && signal.isPass && ctx.red.delete(signal.runner)) {
    await bump($, ctx, { checksPassed: 1, battlesWon: 1 })
    await update($, battle, b => ({ open: ctx.red.size, won: b.won + 1, flash: true }))
  } else if (signal.kind === 'check' && signal.isPass) await bump($, ctx, { checksPassed: 1 })
  if (signal.kind === 'check') await update($, battle, b => (b.open === ctx.red.size ? b : { ...b, open: ctx.red.size }))
  return result
}

/** The stats and the way to the next stage from every session's days; digivolves the pet, one stage, once its stage has lasted. */
async function grow($: EngineInterface, ctx: Ctx) {
  const t = await $.clock.now()
  const cfg = await configOf($, ctx)
  const today = dayOf(t, cfg)
  const days = await byDay(storeOf($))
  // Read back every time: another session may have digivolved the pet.
  let pet = await petOf($)
  const all = countsOf(days, today, ctx.pace)
  const life: Context = { life: all, day: today, pace: ctx.pace }
  const to = evolveTo(pet.species, minus(all, pet.base), SPECIES, life)
  if (to && isSpecies(to)) {
    const from = pet.species
    const isHatching = SPECIES[from]?.stage === 'egg'
    // Hatching takes nothing from the counts: the egg's turns are the Baby's first.
    pet = { species: to, enteredDay: today, base: isHatching ? pet.base : all, log: [...pet.log, { id: to, day: today }] }
    await digivolve($, ctx, pet, from, isHatching ? `${spriteOf(from).name} hatched into ${spriteOf(to).name}!` : `${spriteOf(from).name} digivolved to ${spriteOf(to).name}!`)
  }
  if ((await read($, species)) !== pet.species) await update($, species, () => pet.species)
  const g = growthOf(pet, days, all, life)
  await update($, growth, () => g)
  if ((await read($, battle)).won !== g.battles.won) await update($, battle, b => ({ ...b, won: g.battles.won }))
}

async function petOf($: EngineInterface): Promise<Pet> {
  const kept = await $.store.get('pet')
  // No pet yet: draw an egg and keep it at once, so every later read finds the same one.
  if (kept === undefined || kept === null) {
    const egg = asPet({ species: eggOf(SPECIES, Math.random()) })
    await $.store.set('pet', egg)
    return egg
  }
  const pet = asPet(kept)
  return isSpecies(pet.species) ? pet : { ...pet, species: START_SPECIES }
}

/** Keeps the pet's new form, plays it in the band, and says so. */
async function digivolve($: EngineInterface, ctx: Ctx, pet: Pet, from: string, text: string) {
  const t = await $.clock.now()
  await $.store.set('pet', pet)
  await update($, now, () => t)
  await update($, evolving, () => ({ from, to: pet.species, until: t + EVOLVE_MS }))
  $.ui.toast(text, { timeoutMs: 8000 })
  await notify($, ctx, 'digi-pet', text)
}

function growthOf(pet: Pet, days: Ledger, all: Counts, life: Context): DigiGrowth {
  const stage = minus(all, pet.base)
  return {
    stats: statsOf(days),
    battles: { won: stage.wins, lost: stage.battles - stage.wins },
    ageDays: Object.values(days).filter(d => d.turns >= ACTIVE_TURNS).length,
    next: progressOf(pet.species, stage, SPECIES, life),
    log: pet.log.map(e => ({ name: spriteOf(e.id).name, day: e.day })),
    stage: {
      careMistakes: stage.careMistakes,
      training: stage.training,
      overfeed: stage.overfeed,
      sleepDisturbances: stage.sleepDisturbances,
      trophies: stage.trophies,
      summons: stage.summons,
      chaos: stage.chaos,
    },
    trophies: all.trophies,
    winRatio: winRatio(all),
  }
}

/** `/digi jogress`: a Mega whose chart names a partner fuses with it, once its stage has lasted and it has won enough. */
async function jogress($: EngineInterface, ctx: Ctx): Promise<string> {
  const t = await $.clock.now()
  const today = dayOf(t, await configOf($, ctx))
  const days = await byDay(storeOf($))
  const pet = await petOf($)
  const all = countsOf(days, today, ctx.pace)
  const made = jogressOf(pet.species, minus(all, pet.base), SPECIES, { life: all, day: today, pace: ctx.pace })
  if ('missing' in made) return made.missing
  const text = `${spriteOf(pet.species).name} and ${made.partner} jogressed into ${spriteOf(made.to).name}!`
  await digivolve($, ctx, { species: made.to, enteredDay: today, base: all, log: [...pet.log, { id: made.to, day: today }] }, pet.species, text)
  await grow($, ctx)
  return text
}

/** A conversation's own state: its clock, project, side flag, the pet as kept, and the tick. */
async function begin($: EngineInterface, ctx: Ctx, cwd: string) {
  const zone = await $.process.run(['date', '+%z']).catch(() => null)
  const offsetMin = parseOffset(zone?.stdout ?? '') ?? -new Date().getTimezoneOffset()
  const project = cwd.replace(/\/$/, '').split('/').pop() || cwd
  const ttl = Number(await $.store.get('debugTtlMinutes')) || ctx.ttlMinutes
  await update($, local, () => ({ offsetMin, project, ttlMs: ttl * MINUTE }))
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const id = await $.session.id()
  const keptSide = await $.store.get(`side:${id}`)
  const isSide = typeof keptSide === 'boolean' ? keptSide : isSidePath(cwd, ctx.sidePaths, home)
  await update($, feeding, f => ({ ...f, isSide }))
  await grow($, ctx)
  const onRecord = (await totals(storeOf($))).careMistakes
  await update($, mistakes, () => onRecord)
  startTick($, ctx, ttl * MINUTE)
  await onTick($, ctx)
}

export const register: Register = (on, options) => {
  const ctx = contextOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'digi', description: 'Your Digimon V-Pet: its hunger, breaks, side sessions and a preview of any species', argumentHint: USAGE })
    await begin($, ctx, e.cwd)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A /clear starts a conversation with an empty cache; the side flag stays with the terminal.
    if (e.reason === 'clear') {
      ctx.isMistakePending = false
      const keptSide = await $.store.get(`side:${e.sessionId}`)
      ctx.sideOnClear = typeof keptSide === 'boolean' ? keptSide : undefined
      await update($, feeding, f => ({ ...EMPTY, isSide: f.isSide }))
    }
    return next(e)
  })

  // A /clear raises no session.start, and its conversation starts with no state: set it up again, or the band draws an egg until the next tick.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      if (ctx.sideOnClear !== undefined) await $.store.set(`side:${await $.session.id()}`, ctx.sideOnClear)
      ctx.sideOnClear = undefined
      await begin($, ctx, e.cwd)
    }
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const isOpen = isPickerOpen(box.text, box.cursor)
    if ((await read($, isPicking)) !== isOpen) await update($, isPicking, () => isOpen)
    return box
  })

  on('prompt.submit', async ($, e, next) => {
    if (await read($, isPicking)) await update($, isPicking, () => false)
    const t = await $.clock.now()
    const f = await read($, feeding)
    const cfg = await configOf($, ctx)
    const mine = await ledgerOf($, ctx).read(await $.session.id())
    const days = Object.entries(mine)
      .filter(([, c]) => c.careMistakes > 0)
      .map(([day]) => day)
    ctx.isMistakePending = isCareMistake(f, t, cfg, days)
    // A prompt ends `/digi sleep` and a break: the person is back.
    if (f.isAsleep || f.breakUntil !== null) await update($, feeding, x => ({ ...x, isAsleep: false, breakUntil: null }))
    await bump($, ctx, { prompts: 1 })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.stopReason !== null) await meal($, ctx, result.usage)
    if (result.toolUses.length >= 2) await bump($, ctx, { parallelSteps: 1 })
    return result
  })

  on('turn.start', async ($, e, next) => {
    ctx.running.clear()
    ctx.isTraining = false
    ctx.red.clear()
    await update($, battle, b => (b.open || b.flash ? { ...b, open: 0, flash: false } : b))
    await update($, activity, () => ({ act: 'think' }) as DigiActivity)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return trained($, ctx, e, await next(e))
    ctx.isTraining = true
    if ((await read($, battle)).flash) await update($, battle, b => ({ ...b, flash: false }))
    ctx.running.set(e.tool_use_id, toolLabel(e as unknown as { tool: string } & Record<string, unknown>))
    await update($, activity, () => (e.tool === 'AskUserQuestion' ? { act: 'ask' } : { act: 'tool', tool: busyLabel([...ctx.running.values()]) }) as DigiActivity)
    try {
      return await trained($, ctx, e, await next(e))
    } finally {
      ctx.running.delete(e.tool_use_id)
      await settle($, ctx)
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    ctx.running.clear()
    await update($, activity, () => ({ act: 'idle' }) as DigiActivity)
    const t = await $.clock.now()
    // A check still red when the turn ends is a battle lost; an interrupted turn fought none to the end, and is a risky move.
    const isAborted = e.reason === 'aborted'
    const lost = isAborted ? 0 : ctx.red.size
    await bump($, ctx, {
      turns: 1,
      activeMs: e.durationMs,
      ...(isResting(t, await configOf($, ctx)) ? { restTurns: 1 } : {}),
      ...(ctx.isTraining ? { toolTurns: 1 } : {}),
      ...(ctx.isTraining && e.reason === 'answer' && e.durationMs < QUICK_MS ? { quickTurns: 1 } : {}),
      ...(lost ? { battlesLost: lost } : {}),
      ...(isAborted ? { chaos: 1 } : {}),
    })
    ctx.isTraining = false
    ctx.red.clear()
    await update($, battle, b => (b.open ? { ...b, open: 0 } : b))
    const m = await read($, mood)
    if (m.kind === 'sick') await setMood($, ctx, m.turnsLeft > 1 ? { kind: 'sick', turnsLeft: m.turnsLeft - 1 } : { kind: 'normal', turnsLeft: 0 })
    await grow($, ctx)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens ?? null
    if ((await read($, feeding)).contextTokens !== tokens) await update($, feeding, f => ({ ...f, contextTokens: tokens }))
    const percent = e.context.percent
    if (percent !== undefined && percent >= OVERFULL_PERCENT && !ctx.isOverfull) {
      ctx.isOverfull = true
      await bump($, ctx, { overfeeds: 1 })
    } else if (percent !== undefined && percent < REFED_PERCENT) ctx.isOverfull = false
    return next(e)
  })

  on('command.run', { command: 'digi' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')
    const t = await $.clock.now()
    const cfg = await configOf($, ctx)
    const id = await $.session.id()
    switch (verb.toLowerCase()) {
      case 'pane':
        await $.ui.open({ id: PANE, title: 'digi-pet' })
        return { text: 'Opened the digi-pet pane.' }
      case 'pet': {
        await bump($, ctx, { pats: 1 })
        // A pat cheers a pet up, but does not cure one sick from a care mistake.
        if ((await read($, mood)).kind !== 'sick') await setMood($, ctx, { kind: 'happy', turnsLeft: 0 })
        await grow($, ctx)
        return { text: `${spriteOf(await read($, species)).name} is happy! ♥ (the first ${PATS_PER_DAY} pats a day raise SYN)` }
      }
      case 'log': {
        const g = await read($, growth)
        const pet = await petOf($)
        if (!pet.log.length) return { text: `${spriteOf(pet.species).name} has not digivolved yet.${g?.next ? ` Next: ${g.next.label}` : ''}` }
        return { text: [`Evolution of ${spriteOf(pet.species).name}:`, ...pet.log.map(e => `  ${e.day}  ${spriteOf(e.id).name}`), ...(g?.next ? [`Next: ${g.next.label}`] : [])].join('\n') }
      }
      case 'jogress':
        return { text: await jogress($, ctx) }
      case 'sleep':
        await update($, feeding, f => ({ ...f, isAsleep: true }))
        return { text: 'The pet sleeps until your next prompt: no hunger, no alerts.' }
      case 'break': {
        if (arg === 'off') {
          await update($, feeding, f => ({ ...f, breakUntil: null }))
          return { text: 'Break over.' }
        }
        const until = parseBreak(arg || '60m', t, cfg.offsetMin)
        if (until === null) return { text: 'Usage: /digi break 90m | 1h30m | until 15:30 | off' }
        await update($, feeding, f => ({ ...f, breakUntil: until }))
        return { text: `On break until ${clockText(until, cfg.offsetMin)}: no hunger, no alerts, and a cache gone cold meanwhile is no care mistake. Your next prompt ends it.` }
      }
      case 'side': {
        const isSide = arg !== 'off'
        await update($, feeding, f => ({ ...f, isSide }))
        await $.store.set(`side:${id}`, isSide)
        return { text: isSide ? 'Side session: the pet does not get hungry here. Usage still counts toward its growth. `/digi side off` to undo.' : 'Main session again: the pet minds this cache.' }
      }
      case 'sim': {
        if (rest[0] === 'off' || !rest[0]) {
          await update($, sim, () => null)
          return { text: 'Simulation off.' }
        }
        const [who, state = 'full', to] = rest
        if (!isSpecies(who!)) return { text: `No species "${who}". Ids are the chart's short names: bota, koro, agu, grey, devi, nume, metalgrey_vi, blitzgrey, …` }
        if (!STATES.includes(state as (typeof STATES)[number])) return { text: `States: ${STATES.join(' ')}` }
        if (to !== undefined && !isSpecies(to)) return { text: `No species "${to}".` }
        await update($, sim, () => ({ species: who!, state, to: to ?? (state === 'evolving' ? 'grey' : null) }))
        return { text: `Showing ${spriteOf(who!).name} as ${state}. \`/digi sim off\` to go back.` }
      }
      case 'debug': {
        if (rest[0] !== 'ttl') return { text: 'Usage: /digi debug ttl <minutes> | off' }
        const minutes = rest[1] === 'off' ? null : Number(rest[1])
        if (minutes !== null && !(minutes > 0)) return { text: 'Usage: /digi debug ttl <minutes> | off' }
        await $.store.set('debugTtlMinutes', minutes)
        await update($, local, l => ({ ...l, ttlMs: (minutes ?? ctx.ttlMinutes) * MINUTE }))
        startTick($, ctx, (minutes ?? ctx.ttlMinutes) * MINUTE)
        ctx.warned = { fedAt: -1, levels: new Set() }
        await onTick($, ctx)
        return { text: minutes ? `Cache TTL is ${minutes} min for the pet until \`/digi debug ttl off\`.` : `Cache TTL back to ${ctx.ttlMinutes} min.` }
      }
      case '':
      case 'stats': {
        const v = await viewOf($, ctx, t)
        const f = await read($, feeding)
        const g = await read($, growth)
        const lines = [
          `${spriteOf(v.species).name} (${spriteOf(v.species).stage}${v.attribute ? `, ${v.attribute}` : ''})${g ? ` · day ${g.ageDays}` : ''} · ${weightOf(f.contextTokens)}g`,
          ...(g ? growthLines(g) : []),
          v.quiet ? `Hunger: ${v.quiet}` : f.lastFedAt === null ? 'Hunger: not fed yet' : `Hunger: ${v.hunger}, the cache goes cold in ${Math.ceil(v.minutesLeft)}m (TTL ${cfg.ttlMs / MINUTE}m)`,
          `Care mistakes: ${await read($, mistakes)} in all`,
          ...(await recordLines($, ctx)),
          ...(await read($, facts)),
          `Rest hours: ${ctx.restText} · side session: ${f.isSide ? 'yes' : 'no'}`,
          `Usage: /digi ${USAGE}`,
        ]
        return { text: lines.join('\n') }
      }
      default:
        return { text: `Usage: /digi ${USAGE}` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const t = await read($, now)
    const v = await viewOf($, ctx, t)
    const width = Math.max(20, e.props.bodyColumns - 2)
    const pv = petView(v, 0)
    // While a `/` or `@` picker is open the engine draws it above the band: one row keeps it near the prompt.
    const room = (await read($, isPicking)) ? 1 : e.props.maxRows
    let mine: RenderElement
    if ('Client' in ui && room >= WORK_ROWS && width >= 60) {
      const { Client } = ui
      const isFighting = v.act !== undefined && !(isLoud(pv) && room >= LOUD_ROWS)
      const fight = await read($, battle)
      const block = Math.min(width, isFighting ? WORK_BLOCK : BAND_WIDTH)
      const props: ScreenProps = { kind: 'band', width: block, maxRows: room, view: v, isStill: ctx.isStill }
      const shape = isLoud(pv) && room >= LOUD_ROWS ? 'loud' : (v.act ?? 'idle')
      const screen = <Client key={`band-${v.species}-${shape}`} module="./screen.tsx" width={block} props={props} />
      const field = width - block - 2
      mine =
        isFighting && field >= MIN_ARENA ? (
          <Box flexDirection="row" columnGap={2} alignItems="flex-end">
            <Client key={`arena-${v.act}-${fight.won}`} module="./arena.tsx" width={field} props={{ width: field, act: v.act!, fight, isStill: ctx.isStill }} />
            {screen}
          </Box>
        ) : (
          screen
        )
    } else if (room >= MINI_BAND_ROWS && width >= 40) {
      mine = drawn(ui, miniBand(pv, 0, Math.min(width, BAND_WIDTH)))
    } else {
      mine = drawn(ui, band(pv, 0, width, 1))
    }
    const below = await next(e)
    // At the band's right edge, as spinner's pet sat.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="flex-end">
          {mine}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Text } = ui
    const t = await read($, now)
    const g = await read($, growth)
    const view: PaneJson = {
      ...(await viewOf($, ctx, t)),
      careMistakes: await read($, mistakes),
      facts: [...(await recordLines($, ctx)), ...(await read($, facts))],
      ...(g ? { stats: g.stats, battles: g.battles, ageDays: g.ageDays, log: g.log, trophies: g.trophies } : {}),
      weight: weightOf((await read($, feeding)).contextTokens),
    }
    if (!('Client' in ui)) return <Text>{`${spriteOf(view.species).name} · ${view.quiet ?? view.hunger}`}</Text>
    const { Client } = ui
    const width = Math.max(40, e.props.bodyColumns)
    const props: ScreenProps = { kind: 'pane', width, view, isStill: ctx.isStill }
    return <Client key="pane" module="./screen.tsx" width={width} props={props} />
  })
}

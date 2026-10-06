// The pet's hunger: this session's prompt cache, how long it has left, when the
// pet may yell about it, and when a cold cache counts as a care mistake. Pure:
// every time is epoch milliseconds, and local time comes from an offset.
import type { Hunger } from './render'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export type Config = {
  ttlMs: number
  /** Rest windows, in minutes of the local day; `end` before `start` runs past midnight. */
  rest: Window[]
  /** The hour the day begins, so a late night belongs to the evening before. */
  dayStartsHour: number
  minContextTokens: number
  /** Local time minus UTC, in minutes. */
  offsetMin: number
}

export type Window = { start: number; end: number }

/** This session's side of the hunger. */
export type Feeding = {
  /** When the last request of the main loop answered; null before the first. */
  lastFedAt: number | null
  isSide: boolean
  /** `/digi sleep`: done with this session until the next prompt. */
  isAsleep: boolean
  /** `/digi break`: resting until then, or null. */
  breakUntil: number | null
  /** `/digi wake`: up through the rest window it woke in, until that window ends; null otherwise. */
  awakeUntil: number | null
  /** The live context's tokens, as the last measurement said; null before one. */
  contextTokens: number | null
}

/** `"12:00-14:00,18:00-08:00"` as windows; a part that does not parse is left out. */
export function parseRest(text: string): Window[] {
  const minutes = (hm: string) => {
    const m = hm.trim().match(/^(\d{1,2})(?::(\d{2}))?$/)
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2] ?? 0)
    return h <= 24 && min < 60 ? (h * 60 + min) % (24 * 60) : null
  }
  return text
    .split(',')
    .map(part => part.split('-'))
    .flatMap(([a, b]) => {
      const start = a === undefined ? null : minutes(a)
      const end = b === undefined ? null : minutes(b)
      return start === null || end === null || start === end ? [] : [{ start, end }]
    })
}

/** Minutes into the local day at `ms`. */
export function localMinute(ms: number, offsetMin: number): number {
  const m = Math.floor((ms + offsetMin * MINUTE) / MINUTE) % (24 * 60)
  return m < 0 ? m + 24 * 60 : m
}

/** The local working day `ms` falls in, as `YYYY-MM-DD`: before `dayStartsHour` is still yesterday. */
export function dayOf(ms: number, cfg: Pick<Config, 'offsetMin' | 'dayStartsHour'>): string {
  return new Date(ms + cfg.offsetMin * MINUTE - cfg.dayStartsHour * 60 * MINUTE).toISOString().slice(0, 10)
}

function inWindow(minute: number, w: Window): boolean {
  return w.start < w.end ? minute >= w.start && minute < w.end : minute >= w.start || minute < w.end
}

export function isResting(ms: number, cfg: Pick<Config, 'rest' | 'offsetMin'>): boolean {
  const minute = localMinute(ms, cfg.offsetMin)
  return cfg.rest.some(w => inWindow(minute, w))
}

/** When the next rest window begins after `ms` (now, if one is on); null with none. */
export function nextRest(ms: number, cfg: Pick<Config, 'rest' | 'offsetMin'>): number | null {
  if (isResting(ms, cfg)) return ms
  if (!cfg.rest.length) return null
  const minute = localMinute(ms, cfg.offsetMin)
  const waits = cfg.rest.map(w => (w.start - minute + 24 * 60) % (24 * 60))
  const startOfMinute = ms - (ms % MINUTE)
  return startOfMinute + Math.min(...waits) * MINUTE
}

/** When the current rest window ends, for the band's "until 08:00". */
export function restEnd(ms: number, cfg: Pick<Config, 'rest' | 'offsetMin'>): number | null {
  if (!isResting(ms, cfg)) return null
  let t = ms - (ms % MINUTE)
  for (let i = 0; i < 24 * 60 && isResting(t, cfg); i++) t += MINUTE
  return t
}

export function hungerOf(elapsedMs: number, ttlMs: number): Hunger {
  const f = elapsedMs / ttlMs
  if (f >= 1) return 'cold'
  if (f >= 55 / 60) return 'starving'
  if (f >= 45 / 60) return 'hungry'
  if (f >= 30 / 60) return 'peckish'
  return 'full'
}

/** Why the pet is not hungry now, or null when it is minding the cache. */
export type Quiet = 'unfed' | 'side' | 'asleep' | 'break' | 'rest' | 'small'

export function quietOf(f: Feeding, now: number, cfg: Config): Quiet | null {
  if (f.lastFedAt === null) return 'unfed'
  if (f.isSide) return 'side'
  if (f.isAsleep) return 'asleep'
  if (f.breakUntil !== null && now < f.breakUntil) return 'break'
  if (isResting(now, cfg) && !isAwake(f, now)) return 'rest'
  if (f.contextTokens !== null && f.contextTokens < cfg.minContextTokens) return 'small'
  return null
}

function isAwake(f: Feeding, now: number): boolean {
  return f.awakeUntil !== null && now < f.awakeUntil
}

/**
 * The warning due now (`hungry` or `starving`), or null. None while the pet is
 * quiet, and none when a rest or a break begins before the cache would go
 * cold anyway: feeding it then would only move its end into the rest.
 */
export function warningOf(f: Feeding, now: number, cfg: Config): 'hungry' | 'starving' | null {
  if (quietOf(f, now, cfg) || f.lastFedAt === null) return null
  const hunger = hungerOf(now - f.lastFedAt, cfg.ttlMs)
  if (hunger !== 'hungry' && hunger !== 'starving') return null
  const coldAt = f.lastFedAt + cfg.ttlMs
  const rest = nextRest(isAwake(f, now) ? f.awakeUntil! : now, cfg)
  if (rest !== null && rest < coldAt) return null
  if (f.breakUntil !== null && f.breakUntil > now) return null
  return hunger
}

/**
 * Whether coming back at `now` counts as a care mistake: the cache went cold
 * on a working day, nothing excused it (side, sleep, a break, a rest window
 * since the last meal), and this session has none on record for today.
 */
export function isCareMistake(f: Feeding, now: number, cfg: Config, mistakeDays: readonly string[]): boolean {
  if (f.lastFedAt === null || f.isSide || f.isAsleep) return false
  const coldAt = f.lastFedAt + cfg.ttlMs
  if (now < coldAt) return false
  if (f.breakUntil !== null && f.breakUntil > coldAt) return false
  if (f.contextTokens !== null && f.contextTokens < cfg.minContextTokens) return false
  const day = dayOf(now, cfg)
  if (dayOf(f.lastFedAt, cfg) !== day || mistakeDays.includes(day)) return false
  // A rest window between the meal and now: the work stopped, as it does overnight.
  const rest = nextRest(f.lastFedAt, cfg)
  return rest === null || rest > now
}

/** Minutes until the cache goes cold, never below 0. */
export function minutesLeft(f: Feeding, now: number, cfg: Pick<Config, 'ttlMs'>): number {
  return f.lastFedAt === null ? cfg.ttlMs / MINUTE : Math.max(0, (f.lastFedAt + cfg.ttlMs - now) / MINUTE)
}

/** `+0700` (what `date +%z` prints) as minutes; null when it does not parse. */
export function parseOffset(text: string): number | null {
  const m = text.trim().match(/^([+-])(\d{2})(\d{2})$/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null
}

/** `90m`, `2h`, `1h30m` or `until 15:30` as the end of a break from `now`; null when it does not parse. */
export function parseBreak(text: string, now: number, offsetMin: number): number | null {
  const until = text.trim().match(/^until\s+(\d{1,2})(?::(\d{2}))?$/i)
  if (until) {
    const target = Number(until[1]) * 60 + Number(until[2] ?? 0)
    if (target >= 24 * 60) return null
    const wait = (target - localMinute(now, offsetMin) + 24 * 60) % (24 * 60)
    return now - (now % MINUTE) + (wait || 24 * 60) * MINUTE
  }
  const span = text.trim().match(/^(?:(\d+)h)?\s*(?:(\d+)m?)?$/i)
  if (!span || (!span[1] && !span[2])) return null
  const minutes = Number(span[1] ?? 0) * 60 + Number(span[2] ?? 0)
  return minutes > 0 && minutes <= DAY / MINUTE ? now + minutes * MINUTE : null
}

/** `HH:MM`, local. */
export function clockText(ms: number, offsetMin: number): string {
  const m = localMinute(ms, offsetMin)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Whether `cwd` is under one of the side-work globs (`~/work/personal/**`, `/x/*`). */
export function isSidePath(cwd: string, globs: readonly string[], home: string): boolean {
  return globs.some(glob => {
    const g = glob.trim().replace(/^~(?=\/|$)/, home)
    if (!g) return false
    const re = new RegExp(
      `^${g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\/\*\*$/, '(?:/.*)?')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^/]*')}$`,
    )
    return re.test(cwd.replace(/\/$/, ''))
  })
}

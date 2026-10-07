// Everything digi-pet draws, as cell grids: the band above the prompt, the
// pane, and the text of its alerts. Pure, shared by the mod and scripts/preview.ts.
import { blank, canvas, cells, draw, plot, put, textWidth } from './cells'
import type { Canvas, Grid, Style } from './cells'
import { hasPose, pixels } from './sprite'
import type { Pose, Sprite } from './sprite'

export type Hunger = 'full' | 'peckish' | 'hungry' | 'starving' | 'cold'
export type Mood = 'normal' | 'asleep' | 'sick' | 'eating' | 'happy'
/** What the model is doing while a turn runs. */
export type Act = 'think' | 'tool' | 'say' | 'ask'
export type Attribute = 'Vaccine' | 'Data' | 'Virus'

/** What the band needs: the pet, its hunger, and the way to the next stage. */
export type PetView = {
  sprite: Sprite
  hunger: Hunger
  /** Minutes until this session's cache goes cold. */
  minutesLeft: number
  ttlMinutes: number
  mood: Mood
  attribute: Attribute | null
  /** The session's project, as alerts name it. */
  project: string
  /** `day 3/5 → Champion` and how far along, 0..1; null at the last stage, absent while nothing tracks it. */
  next?: { label: string; ratio: number } | null
  /** A digivolution playing: the sprite it becomes and the frame since it began. */
  evolving?: { to: Sprite; t: number }
  /** Why the pet is not minding the cache (`💤 resting until 08:00`), shown in place of its hunger. */
  quiet?: string
  /** A turn is running and this is what it does; absent between turns. */
  act?: Act
  /** The tool the turn is running (`Bash: npm test`), for the bubble. */
  tool?: string
  /** Subagents running (or just finished), each a small Digimon fighting beside the pet. */
  allies?: AllyView[]
}

/** A subagent as an ally: its Digimon, its task in a few words, and whether it is leaving (done or failed). */
export type AllyView = { sprite: Sprite; label: string; leaving?: 'done' | 'failed' }

export const STAT_NAMES = ['STA', 'INT', 'ATK', 'DEF', 'SPD', 'SYN'] as const
export type StatName = (typeof STAT_NAMES)[number]

/** What the pane adds: the stat sheet, the record and the evolution log. */
export type PaneView = PetView & {
  careMistakes: number
  /** More lines under the record: today's turns, the last cache hit. */
  facts?: string[]
  stats?: Record<StatName, number>
  battles?: { won: number; lost: number }
  trophies?: number
  /** Grams, from the context the pet carries. */
  weight?: number
  ageDays?: number
  log?: { name: string; day: string }[]
}

const STAGES: Record<string, string> = {
  egg: 'Digitama',
  baby1: 'Baby I',
  baby2: 'Baby II',
  rookie: 'Rookie',
  champion: 'Champion',
  ultimate: 'Ultimate',
  mega: 'Mega',
  superMega: 'Super Ultimate',
}

export const EVOLVE_FRAMES = 14

const LCD = '#dfe6cf'
const LCD_NIGHT = '#2b3027'
const INK = '#120c00'
const TEXT = '#e6e6e6'
const DIM = '#8a8a8a'
export const HUNGER_COLOR: Record<Hunger, string> = {
  full: '#7bd88f',
  peckish: '#e5c07b',
  hungry: '#ff8f40',
  starving: '#ff5f57',
  cold: DIM,
}
const ATTRIBUTE_COLOR: Record<Attribute, string> = { Vaccine: '#61afef', Data: '#98c379', Virus: '#c678dd' }

// ---- icons on the LCD ----------------------------------------------------

const MEAT = ['.mm...', 'mmmm..', 'mmmm..', '.mmb..', '...bb.', '....bb']
const MEAT_BITES = [MEAT, ['......', '..mm..', '.mmm..', '.mmb..', '...bb.', '....bb'], ['......', '......', '......', '...b..', '...bb.', '....bb']]
const MEAT_COLORS = { m: '#b5562e', b: '#8c826a' }
const BANG = ['b', 'b', 'b', '.', 'b']
const ZZZ = ['zzzz', '..z.', '.z..', 'zzzz']
const SKULL = ['.sss.', 's.s.s', 'sssss', '.s.s.']
const SPARKLE = ['..y..', '..y..', 'yyyyy', '..y..', '..y..']
const HEART = ['h.h', 'hhh', '.h.']

/** `color` taken `f` of the way toward `to`. */
function mix(color: string, to: string, f: number): string {
  const n = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(n(color, i) + (n(to, i) - n(color, i)) * f).toString(16).padStart(2, '0')).join('')}`
}

type Paint = { flip?: boolean; tint?: { to: string; f: number }; silhouette?: string; pose?: Pose }

function drawSprite(cv: Canvas, sprite: Sprite, frame: number, x: number, y: number, paint: Paint = {}): void {
  pixels(sprite, frame, paint.pose).forEach((row, j) =>
    row.forEach((color, i) => {
      if (!color) return
      const shade = paint.silhouette ?? (paint.tint ? mix(color, paint.tint.to, paint.tint.f) : color)
      plot(cv, x + (paint.flip ? 15 - i : i), y + j, shade)
    }),
  )
}

function fill(cv: Canvas, color: string): void {
  cv.px.fill(color)
}

/**
 * The V-Pet screen: `w` pixels across, 16 down, the pet and what it is
 * showing at frame `t`. `walk` moves it about as a V-Pet's idle does.
 */
function lcdCanvas(v: PetView, t: number, w: number, walk: boolean): Canvas {
  const cv = canvas(w, 8)
  const night = v.mood === 'asleep'
  fill(cv, night ? LCD_NIGHT : LCD)
  const icon = w - 7
  const x = walk ? walkX(t, w - 16) : 0
  const flip = walk && walkFlip(t, w - 16)
  const frame = Math.floor(t)

  if (v.evolving) {
    const e = v.evolving.t
    // Flash the old form against its silhouette, then the two silhouettes, then the new form.
    if (e < 6) drawSprite(cv, v.sprite, frame, x, 0, e % 2 ? { silhouette: INK } : {})
    else if (e < 10) drawSprite(cv, e % 2 ? v.evolving.to : v.sprite, 0, x, 0, { silhouette: INK })
    else {
      drawSprite(cv, v.evolving.to, frame, x, 0)
      if (e % 2 === 0) {
        draw(cv, icon, 1, SPARKLE, { y: '#e5a50a' })
        draw(cv, icon + 1, 9, SPARKLE, { y: '#e5a50a' })
      }
    }
    return cv
  }

  if (night) {
    // Its own sleeping frames where the sheet has them, else the first idle one.
    drawSprite(cv, v.sprite, hasPose(v.sprite, 'sleep') ? frame : 0, x, 0, { tint: { to: LCD_NIGHT, f: 0.6 }, pose: 'sleep' })
    draw(cv, icon, 1 + (frame % 3), ZZZ, { z: '#9aa58c' })
    return cv
  }

  switch (v.mood === 'normal' ? v.hunger : v.mood) {
    case 'eating': {
      drawSprite(cv, v.sprite, frame % 2, x, 0, { pose: 'eat' })
      const bite = Math.min(frame, MEAT_BITES.length)
      if (bite < MEAT_BITES.length) draw(cv, icon, 8, MEAT_BITES[bite]!, MEAT_COLORS)
      else draw(cv, icon + 1, 2, HEART, { h: '#e0245e' })
      break
    }
    case 'happy':
      drawSprite(cv, v.sprite, frame, x, 0, { pose: 'happy' })
      if (frame % 2 === 0) draw(cv, icon + 1, 2, HEART, { h: '#e0245e' })
      break
    case 'sick':
      drawSprite(cv, v.sprite, hasPose(v.sprite, 'hurt') ? frame : 0, x + (frame % 2), 0, { pose: 'hurt' })
      if (frame % 2 === 0) draw(cv, icon, 1, SKULL, { s: '#6b4f9e' })
      break
    case 'cold':
      drawSprite(cv, v.sprite, 0, x, 0, { tint: { to: LCD, f: 0.45 } })
      break
    case 'hungry':
      // Stamping about: a pixel either way, every frame.
      drawSprite(cv, v.sprite, frame, x + (frame % 2 ? 1 : 0), 0, { flip, pose: 'angry' })
      if (frame % 2 === 0) draw(cv, icon, 8, MEAT, MEAT_COLORS)
      break
    case 'starving':
      drawSprite(cv, v.sprite, frame, x + (frame % 2 ? 1 : -1) + 1, 0, { flip, pose: 'angry' })
      draw(cv, icon, 8, MEAT, MEAT_COLORS)
      if (frame % 2 === 0) draw(cv, icon + 2, 1, BANG, { b: '#d0021b' })
      break
    default:
      if (v.act) {
        working(cv, v, frame, w, icon)
        break
      }
      // A subagent still out between turns: its ally waits at the left of the screen, the pet walking in front of it.
      const out = v.allies?.find(a => !a.leaving)
      if (out) plotHalf(cv, out.sprite, frame, frame % 4 === 0 ? 'attack' : 'idle', 1, 8)
      // An egg has one frame: it rocks instead.
      drawSprite(cv, v.sprite, frame, x + (v.sprite.stage === 'egg' ? frame % 2 : 0), 0, { flip })
  }
  return cv
}

export function lcd(v: PetView, t: number, w: number, walk = false): Grid {
  return cells(lcdCanvas(v, t, w, walk))
}

/** The device's shell: steel blue, as a Digivice. A pet that needs you colours it instead (loudBand). */
const SHELL = '#55607a'
const SHELL_ASLEEP = '#3e4248'
const BUTTON = '#c9ced6'
/** Rows a Digivice takes: the screen's eight and half a row of shell above and below it. */
export const DEVICE_ROWS = 9

/**
 * The screen in its Digivice: a shell a pixel thick all round (half a row top
 * and bottom), lit along the top and shaded along the bottom, its corners
 * rounded, and the A, B and C buttons down the right side. `w` + 5 cells
 * across, DEVICE_ROWS down: a row less than a box-drawn frame.
 */
export function digivice(v: PetView, t: number, w: number, walk: boolean, shell: string): Grid {
  const screen = lcdCanvas(v, t, w, walk)
  const W = w + 5
  const cv = canvas(W, DEVICE_ROWS)
  const H = cv.h
  cv.px.fill(shell)
  for (let x = 0; x < W; x++) {
    plot(cv, x, 0, mix(shell, '#ffffff', 0.25))
    plot(cv, x, H - 1, mix(shell, '#000000', 0.35))
  }
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]] as const) cv.px[y * W + x] = undefined
  for (let y = 0; y < screen.h; y++) for (let x = 0; x < w; x++) plot(cv, 1 + x, 1 + y, screen.px[y * w + x] ?? LCD)
  // A, B, C: each a pixel pair, lit on top.
  for (const by of [4, 8, 12]) {
    plot(cv, w + 2, by, BUTTON)
    plot(cv, w + 3, by, BUTTON)
    plot(cv, w + 2, by + 1, mix(BUTTON, '#000000', 0.3))
    plot(cv, w + 3, by + 1, mix(BUTTON, '#000000', 0.3))
  }
  return cells(cv)
}

const SHOT = ['.oo.', 'oooo', '.oo.']
const QUESTION = ['qqq.', '...q', '.qq.', '....', '.q..']

/** The pet while a turn runs, as a V-Pet's training screen: pacing as it thinks, firing at the wall as tools run. */
function working(cv: Canvas, v: PetView, frame: number, w: number, icon: number): void {
  const room = w - 16
  switch (v.act) {
    case 'tool': {
      // Faces the wall on the left from the right edge, a shot crossing the screen each loop.
      drawSprite(cv, v.sprite, frame, room, frame % 2 ? 0 : 1, { pose: 'attack' })
      const shot = room - 4 - ((frame * 3) % Math.max(4, room - 2))
      if (shot >= 0) draw(cv, shot, 6, SHOT, { o: '#e5a50a' })
      break
    }
    case 'ask':
      drawSprite(cv, v.sprite, 0, 0, 0)
      if (frame % 2 === 0) draw(cv, icon + 1, 1, QUESTION, { q: '#d0021b' })
      break
    case 'say':
      drawSprite(cv, v.sprite, frame, Math.floor(room / 2), 0)
      break
    default:
      // Thinking: pacing across the screen.
      drawSprite(cv, v.sprite, frame, walkX(frame, room), 0, { flip: walkFlip(frame, room) })
  }
}

/** The pet's x on an idle walk across `room` pixels: there and back, a step a frame. */
function walkX(t: number, room: number): number {
  const p = Math.floor(t) % (room * 2)
  return p < room ? room - p : p - room
}
function walkFlip(t: number, room: number): boolean {
  return Math.floor(t) % (room * 2) >= room
}

function paste(g: Grid, part: Grid, x: number, y: number): void {
  part.forEach((row, j) =>
    row.forEach((cell, i) => {
      if (g[y + j] && x + i < g[y + j]!.length) g[y + j]![x + i] = cell
    }),
  )
}

/** `text` broken into lines of at most `w` cells. */
function wrap(text: string, w: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next) > w && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

// ---- words ---------------------------------------------------------------

export function hearts(v: Pick<PetView, 'minutesLeft' | 'ttlMinutes' | 'hunger'>): string {
  const n = v.hunger === 'cold' ? 0 : Math.max(1, Math.ceil((4 * v.minutesLeft) / v.ttlMinutes))
  return '♥'.repeat(n) + '♡'.repeat(4 - n)
}

function face(v: PetView, t: number): string {
  if (v.evolving) return v.evolving.t % 2 ? '(☆o☆)' : '(*o*)'
  if (v.mood === 'asleep') return '(-_-)zZ'
  if (v.mood === 'eating') return '(^ω^)'
  if (v.mood === 'happy') return '(^‿^)'
  if (v.mood === 'sick') return '(x_x)'
  return { full: '(^▽^)', peckish: '(o_o)', hungry: '(>_<)', starving: Math.floor(t) % 2 ? '(T□T)' : '(>□<)', cold: '(-.-)' }[v.hunger]
}

function stageOf(sprite: Sprite): string {
  return STAGES[sprite.stage] ?? sprite.stage
}

/** What the pet says, or null when it has nothing to say. */
export function speech(v: PetView): string | null {
  if (v.evolving) return v.evolving.t < 10 ? `${v.sprite.name} is digivolving…` : `${v.sprite.name} digivolved to ${v.evolving.to.name}!`
  if (v.mood === 'asleep') return null
  if (v.mood === 'eating') return 'Nom nom! The cache is warm again.'
  if (v.mood === 'happy') return '♥ Thanks for the pat!'
  if (v.mood === 'sick') return 'I got sick waiting… the cache went cold and had to be rebuilt.'
  if (v.hunger === 'hungry') return `I'm hungry! ${v.project}'s cache goes cold in ${Math.ceil(v.minutesLeft)}m.`
  if (v.hunger === 'starving') return `STARVING!! ${Math.ceil(v.minutesLeft)}m until ${v.project}'s cache goes cold!`
  return null
}

/** The macOS notification for a hunger warning; null for states that send none. */
export function notification(v: PetView): { title: string; body: string } | null {
  if (v.hunger !== 'hungry' && v.hunger !== 'starving') return null
  const left = Math.ceil(v.minutesLeft)
  return v.hunger === 'hungry'
    ? { title: `${v.sprite.name} is hungry`, body: `${v.project}: the cache goes cold in ${left}m. Send a prompt to feed it, or /digi sleep if you're done.` }
    : { title: `${v.sprite.name} is starving!`, body: `${v.project}: ${left}m until the cache goes cold and has to be rebuilt.` }
}

export function toast(v: PetView): string | null {
  const n = notification(v)
  return n ? `${n.title} · ${n.body}` : null
}

/** The status-line countdown, while it matters. */
export function statusLine(v: PetView): string | undefined {
  if (v.hunger !== 'starving' || v.mood === 'asleep') return undefined
  return `🍖 ${v.sprite.name}: cache cold in ${Math.ceil(v.minutesLeft)}m`
}

// ---- the band ------------------------------------------------------------

/** Whether the band shows the screen: something is happening the person should see. */
export function isLoud(v: PetView): boolean {
  if (v.evolving || v.mood === 'eating' || v.mood === 'sick') return true
  return v.mood !== 'asleep' && (v.hunger === 'hungry' || v.hunger === 'starving')
}

const LOUD_ROWS = DEVICE_ROWS

const WORK_ROWS = 8
/** The widest the band's block grows; it sits at the band's right edge. */
export const BAND_WIDTH = 72

/**
 * The band above the prompt: the screen in its Digivice and a bubble when the pet has
 * something to say, the bare screen while a turn runs, one row otherwise or
 * when the band has not the room.
 */
export function band(v: PetView, t: number, width: number, maxRows = LOUD_ROWS): Grid {
  if (isLoud(v) && maxRows >= LOUD_ROWS && width >= 60) return loudBand(v, t, width)
  if (maxRows >= WORK_ROWS && width >= 50) return screenBand(v, t, width, maxRows >= DEVICE_ROWS)
  return quietBand(v, t, width)
}

/** What the bubble says: what the turn is doing, or between turns the pet's own state. */
function workSpeech(v: PetView): string {
  if (!v.act) {
    if (v.mood === 'asleep') return 'Zzz…'
    if (v.mood === 'happy') return '♥ Thanks for the pat!'
    const out = v.allies?.find(a => !a.leaving)
    if (out) return `${out.sprite.name} is still out: ${out.label}`
    if (v.hunger === 'cold') return 'The cache went cold. Send a prompt to warm it up.'
    return v.hunger === 'peckish' ? 'Getting a little peckish…' : ''
  }
  switch (v.act) {
    case 'tool':
      return v.tool ?? 'working…'
    case 'ask':
      return 'Waiting for your OK!'
    case 'say':
      return 'Writing the answer…'
    default:
      return 'Thinking…'
  }
}

/** The pet's screen and a few lines beside it: at work during a turn, idling between turns. */
function screenBand(v: PetView, t: number, width: number, isDevice: boolean): Grid {
  const g = blank(width, isDevice ? DEVICE_ROWS : WORK_ROWS)
  const isIdle = !v.act && v.mood === 'normal' && v.hunger !== 'cold'
  // In its Digivice when the band has the row to spare, else the bare screen.
  if (isDevice) paste(g, digivice(v, t, 24, isIdle, v.mood === 'asleep' ? SHELL_ASLEEP : SHELL), width - 29, 0)
  else paste(g, lcd(v, t, 24, isIdle), width - 25, 0)
  const right = width - (isDevice ? 31 : 27)
  const color = v.act === 'ask' ? '#ff5f57' : v.act === 'tool' ? '#e5c07b' : '#61afef'
  putRight(g, right, 1, [[v.sprite.name, { c: TEXT, b: true }], [` · ${stageOf(v.sprite)}`, { c: DIM }]])
  wrap(workSpeech(v), right - 3)
    .slice(0, 2)
    .forEach((line, i) => putRight(g, right, 3 + i, [[`${i === 0 ? '“' : ''}${line}`, { c: color }]]))
  hungerRows(v, right).forEach((row, i) => putRight(g, right, 6 + i, row))
  return g
}

function quietBand(v: PetView, t: number, width: number): Grid {
  const g = blank(width, 1)
  const hungerColor = HUNGER_COLOR[v.hunger]
  const asleep = v.mood === 'asleep'
  const parts: [string, Style, number][] = [
    // [text, style, priority: lower is dropped last]
    [`${face(v, t)} `, { c: asleep ? DIM : hungerColor }, 0],
    [v.sprite.name, { c: TEXT, b: true }, 0],
    [` · ${stageOf(v.sprite)}`, { c: DIM }, 2],
    ...(v.attribute ? ([[` · ${v.attribute}`, { c: ATTRIBUTE_COLOR[v.attribute] }, 3]] as [string, Style, number][]) : []),
    ...((v.quiet
      ? [[`   ${v.quiet}`, { c: DIM }, 0]]
      : [
          [`   ${hearts(v)}`, { c: asleep ? DIM : hungerColor, b: v.hunger === 'starving' && Math.floor(t) % 2 === 0 }, 0],
          [asleep ? ' asleep' : v.hunger === 'cold' ? ' cache cold' : ` ${Math.ceil(v.minutesLeft)}m`, { c: asleep ? DIM : hungerColor }, 1],
        ]) as [string, Style, number][]),
    ...(v.next ? ([[`   ${v.next.label} ${bar(v.next.ratio, 6)}`, { c: DIM }, 2]] as [string, Style, number][]) : []),
  ]
  // Drop the least needed parts until the rest fits.
  let kept = parts
  for (const level of [3, 2, 1]) {
    if (kept.reduce((w, [text]) => w + textWidth(text), 1) <= width) break
    kept = kept.filter(([, , p]) => p < level)
  }
  let x = 0
  for (const [text, style] of kept) {
    put(g, x, 0, text, style)
    x += textWidth(text)
  }
  // Only the cells it used, so the row can sit at the band's right edge.
  return [g[0]!.slice(0, x)]
}

function loudBand(v: PetView, t: number, width: number): Grid {
  const g = blank(width, LOUD_ROWS)
  const color = v.evolving ? '#e5a50a' : v.mood === 'sick' ? '#6b4f9e' : HUNGER_COLOR[v.hunger]
  paste(g, digivice(v, t, 24, false, color), width - 29, 0)
  const right = width - 31
  const shown = v.evolving && v.evolving.t >= 10 ? v.evolving.to : v.sprite
  putRight(g, right, 1, [[shown.name, { c: TEXT, b: true }], [` · ${stageOf(shown)}${v.attribute ? ` · ${v.attribute}` : ''}`, { c: DIM }]])
  wrap(speech(v) ?? '', right - 3)
    .slice(0, 3)
    .forEach((line, i) => putRight(g, right, 3 + i, [[`${i === 0 ? '“' : ''}${line}`, { c: color, b: v.hunger === 'starving' && !v.evolving }]]))
  if (!v.evolving) {
    hungerRows(v, right).forEach((row, i) => putRight(g, right, 7 + i, row))
    if (v.hunger === 'hungry' || v.hunger === 'starving') putRight(g, right, 8, [['Prompt to feed · /digi sleep if done', { c: DIM, d: true }]])
  }
  return g
}

/** `Hunger ♥♥♡♡  12m left`, or why the pet is not minding the cache: in `max` rows of `room` at most, so it never runs into the screen. */
function hungerRows(v: PetView, room: number, max = 2): [string, Style][][] {
  if (v.quiet) return quietRows(v.quiet, room, max).map(row => [[row, { c: DIM }]])
  return [
    [
      [`Hunger ${hearts(v)}`, { c: HUNGER_COLOR[v.hunger] }],
      [v.hunger === 'cold' ? '  cache cold' : `  ${Math.ceil(v.minutesLeft)}m left`, { c: DIM }],
    ],
  ]
}

/** A quiet line in `max` rows of `room`: broken at its ` · ` first, its leading parts dropped when the rows cannot hold the rest. */
function quietRows(text: string, room: number, max: number): string[] {
  const rowsOf = (parts: string[]) =>
    parts.reduce<string[]>((rows, part) => {
      const last = rows[rows.length - 1]
      return last !== undefined && textWidth(`${last} · ${part}`) <= room ? [...rows.slice(0, -1), `${last} · ${part}`] : [...rows, ...wrap(part, room)]
    }, [])
  let parts = text.split(' · ')
  while (parts.length > 1 && rowsOf(parts).length > max) parts = parts.slice(1)
  return rowsOf(parts).slice(0, max)
}

/** Runs written so the last ends at column `right`: the text leans on the pet's screen. */
function putRight(g: Grid, right: number, y: number, parts: [string, Style][]): void {
  let x = Math.max(0, right - parts.reduce((w, [text]) => w + textWidth(text), 0))
  for (const [text, style] of parts) {
    put(g, x, y, text, style)
    x += textWidth(text)
  }
}

function bar(ratio: number, w: number): string {
  const n = Math.round(Math.max(0, Math.min(1, ratio)) * w)
  return '▓'.repeat(n) + '░'.repeat(w - n)
}

// ---- the pane ------------------------------------------------------------

/** The `/digi` pane: the walking pet on its screen, the stat sheet, the record and the log. */
export function pane(v: PaneView, t: number, width: number): Grid {
  const screen = digivice(v, t, 32, !v.evolving && v.mood === 'normal' && v.hunger !== 'cold', v.mood === 'asleep' ? SHELL_ASLEEP : SHELL)
  const info = paneInfo(v)
  const side = width >= 37 + 3 + 34
  const statRows = v.stats ? statLines(v.stats, width - 2) : []
  const logLines = v.log?.length ? wrap(`Evolution: ${v.log.map(e => `${e.name} (${e.day})`).join(' → ')}`, width - 2) : []
  const factLines = (v.facts ?? []).flatMap(fact => wrap(fact, width - 2))
  const h = (side ? Math.max(screen.length, info.length) : screen.length + 1 + info.length) + 1 + statRows.length + 1 + logLines.length + factLines.length
  const g = blank(width, h)
  paste(g, screen, 1, 0)
  const infoX = side ? 40 : 1
  const infoY = side ? 1 : screen.length + 1
  info.forEach(([text, style], i) => put(g, infoX, infoY + i, text, style))
  let y = (side ? Math.max(screen.length, info.length + 1) : infoY + info.length) + 1
  for (const row of statRows) {
    let x = 1
    for (const [text, style] of row) {
      put(g, x, y, text, style)
      x += textWidth(text)
    }
    y++
  }
  factLines.forEach(line => put(g, 1, y++, line, { c: DIM }))
  y++
  logLines.forEach(line => put(g, 1, y++, line, { c: DIM }))
  return g
}

function paneInfo(v: PaneView): [string, Style][] {
  const lines: [string, Style][] = [
    [v.sprite.name, { c: TEXT, b: true }],
    [`${stageOf(v.sprite)}${v.attribute ? ` · ${v.attribute}` : ''}${v.ageDays === undefined ? '' : ` · day ${v.ageDays}`}${v.weight === undefined ? '' : ` · ${v.weight}g`}`, { c: v.attribute ? ATTRIBUTE_COLOR[v.attribute] : DIM }],
    ['', {}],
    v.quiet
      ? [`Hunger  ${v.quiet}`, { c: DIM }]
      : [`Hunger  ${hearts(v)} ${v.mood === 'asleep' ? 'asleep' : v.hunger === 'cold' ? 'cache cold' : `${Math.ceil(v.minutesLeft)}m left`}`, { c: HUNGER_COLOR[v.hunger] }],
    [`Care mistakes  ${v.careMistakes}`, { c: v.careMistakes ? '#e5c07b' : DIM }],
  ]
  if (v.battles) {
    const fought = v.battles.won + v.battles.lost
    lines.push([`Battles  ${v.battles.won}W ${v.battles.lost}L${fought ? ` (${Math.round((100 * v.battles.won) / fought)}%)` : ''}`, { c: DIM }])
  }
  if (v.trophies !== undefined) lines.push([`Trophies  ${v.trophies}`, { c: DIM }])
  if (v.next !== undefined) lines.push([v.next ? `Next  ${v.next.label} ${bar(v.next.ratio, 8)}` : 'Fully digivolved', { c: DIM }])
  return lines
}

const STAT_COLOR: Record<StatName, string> = {
  STA: '#e06c75',
  INT: '#61afef',
  ATK: '#ff8f40',
  DEF: '#98c379',
  SPD: '#e5c07b',
  SYN: '#c678dd',
}

/** The empty part of a stat bar: one grey for every stat, so it never reads as that stat's colour. */
const STAT_TRACK = '#3e4248'

/** The six stats as bars, two to a row when there is room. */
function statLines(stats: Record<StatName, number>, width: number): [string, Style][][] {
  const perRow = width >= 70 ? 2 : 1
  const barW = Math.max(6, Math.min(20, Math.floor(width / perRow) - 12))
  // Against the strongest stat, so the pet's shape shows from its first day; the number says how big.
  const top = Math.max(...STAT_NAMES.map(s => Math.round(stats[s])))
  const one = (name: StatName): [string, Style][] => {
    const n = Math.round(stats[name])
    const filled = top ? Math.round((n / top) * barW) : 0
    return [
      [`${name} `, { c: TEXT, b: true }],
      ['█'.repeat(filled), { c: STAT_COLOR[name] }],
      ['░'.repeat(barW - filled), { c: STAT_TRACK }],
      [` ${String(n).padStart(3)}    `, { c: DIM }],
    ]
  }
  const rows: [string, Style][][] = []
  for (let i = 0; i < STAT_NAMES.length; i += perRow) rows.push(STAT_NAMES.slice(i, i + perRow).flatMap(one))
  return rows
}

// ---- the mini screen ----------------------------------------------------

/**
 * The pet at half size for a band too short for the full screen: each 2×2
 * block of the sprite becomes one pixel of its commonest colour (clear when
 * mostly clear), drawn in half-blocks on the LCD, 10 cells across and 4 rows.
 */
/** A 16-pixel frame at 8: each 2×2 block its commonest colour, clear where under two of its pixels are set. */
function halfSize(px: (string | undefined)[][]): (string | undefined)[][] {
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => {
      const block = [px[2 * y]?.[2 * x], px[2 * y]?.[2 * x + 1], px[2 * y + 1]?.[2 * x], px[2 * y + 1]?.[2 * x + 1]].filter((c): c is string => !!c)
      if (block.length < 2) return undefined
      const counts = new Map<string, number>()
      for (const c of block) counts.set(c, (counts.get(c) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    }),
  )
}

/** A sprite at half size, its top left at (`x`, `y`), each colour through `paint`. */
function plotHalf(cv: Canvas, sprite: Sprite, frame: number, pose: Pose, x: number, y: number, paint: (c: string) => string = c => c): void {
  halfSize(pixels(sprite, frame, pose)).forEach((row, j) => row.forEach((c, i) => c && plot(cv, x + i, y + j, paint(c))))
}

export function miniLcd(v: PetView, t: number): Grid {
  const night = v.mood === 'asleep'
  const bg = night ? LCD_NIGHT : LCD
  const small = halfSize(pixels(v.sprite, night ? 0 : Math.floor(t))).map(row => row.map(c => (c && night ? mix(c, LCD_NIGHT, 0.6) : c)))
  const g = blank(10, 4)
  for (let r = 0; r < 4; r++) {
    g[r]![0] = { ch: ' ', bg }
    g[r]![9] = { ch: ' ', bg }
    for (let x = 0; x < 8; x++) {
      const top = small[2 * r]![x]
      const bottom = small[2 * r + 1]![x]
      g[r]![x + 1] = top || bottom ? { ch: '▀', c: top ?? bg, bg: bottom ?? bg } : { ch: ' ', bg }
    }
  }
  return g
}

const MINI_ROWS = 4

/** The band in four rows: the mini screen at the right, name, words and hunger beside it. */
export function miniBand(v: PetView, t: number, width: number): Grid {
  const g = blank(width, MINI_ROWS)
  paste(g, miniLcd(v, t), width - 10, 0)
  const right = width - 12
  putRight(g, right, 0, [[v.sprite.name, { c: TEXT, b: true }], [` · ${stageOf(v.sprite)}`, { c: DIM }]])
  const say = isLoud(v) ? (speech(v) ?? '') : workSpeech(v)
  const color = isLoud(v) ? HUNGER_COLOR[v.hunger] : v.act === 'ask' ? '#ff5f57' : v.act === 'tool' ? '#e5c07b' : '#61afef'
  if (say) putRight(g, right, 1, [[`“${say.length > right - 2 ? `${say.slice(0, right - 3)}…` : say}`, { c: color }]])
  putRight(g, right, 3, hungerRows(v, right, 1)[0]!)
  return g
}

export const MINI_BAND_ROWS = MINI_ROWS

/** The tool running, on a row of its own under the pet, ending two columns in from its right edge: `⏵ Bash  npm test  12s`. Its command is cut first; no time when `secs` is absent. */
export function toolRow(run: { tool: string; text: string }, width: number, secs?: number): Grid {
  const g = blank(width, 1)
  const time = secs === undefined ? '' : `  ${secs}s`
  const room = width - 2 - textWidth(`⏵ ${run.tool}  `) - textWidth(time)
  const chars = [...run.text]
  const text = textWidth(run.text) <= room ? run.text : room > 1 ? `${chars.slice(0, room - 1).join('')}…` : ''
  putRight(g, width - 2, 0, [
    ['⏵ ', { c: '#e5c07b' }],
    [run.tool, { c: '#e5c07b', b: true }],
    [text ? `  ${text}` : '', { c: TEXT }],
    [time, { c: DIM }],
  ])
  return g
}

// ---- the arena -------------------------------------------------------------

const ENEMIES: { art: string[]; colors: Record<string, string>; flies: boolean }[] = [
  {
    // A virus blob.
    art: ['..v..v..', '.vvvvvv.', 'vvwvvwvv', 'vvkvvkvv', 'vvvvvvvv', '.vvmmvv.', '.v.vv.v.', 'v..vv..v'],
    colors: { v: '#9b59b6', w: '#ffffff', k: '#1d2418', m: '#4a235a' },
    flies: false,
  },
  {
    // A bug.
    art: ['.a....a.', '..a..a..', '.gggggg.', 'ggwggwgg', 'ggkggkgg', 'gggggggg', '.g.gg.g.', 'g..gg..g'],
    colors: { a: '#8c826a', g: '#c0392b', w: '#ffffff', k: '#1d2418' },
    flies: false,
  },
  {
    // A ghost, up in the air.
    art: ['..ssss..', '.ssssss.', 'sswsswss', 'ssksskss', 'ssssssss', 'ssssssss', 's.ss.ss.', '........'],
    colors: { s: '#a9b4c2', w: '#ffffff', k: '#1d2418' },
    flies: true,
  },
]
const BURST = [
  ['...y...', '..yry..', '.yrrry.', 'yrrwrry', '.yrrry.', '..yry..', '...y...'],
  ['y..y..y', '.y.r.y.', '..rwr..', 'yrw.wry', '..rwr..', '.y.r.y.', 'y..y..y'],
  ['y.....y', '...y...', '.......', 'y.....y', '.......', '...y...', 'y.....y'],
]
const BURST_COLORS = { y: '#f1c40f', r: '#e67e22', w: '#ffffff' }
const BOLT = ['.oo.', 'oooo', '.oo.']

/**
 * The fight across the band while a turn runs: monsters come in from the left
 * and the pet, just off the right edge, shoots them down. A function of the
 * frame alone: `t` steps the fight, `w` is its width in cells.
 */
/** The real fight behind the skirmish: checks red right now, battles won this stage, and a win just now. */
export type Fight = { open: number; won: number; flash: boolean }

/** A red check, as the field shows it: the virus blob at twice the size, in red. */
const BOSS = {
  art: ENEMIES[0]!.art.flatMap(row => {
    const wide = [...row].map(ch => ch + ch).join('')
    return [wide, wide]
  }),
  colors: { v: '#d0021b', w: '#ffffff', k: '#1d2418', m: '#5c0010' },
}
const WIN_FRAMES = 12
/** A minion's fight, in frames of the arena (120 ms): it runs in STEP pixels a frame, the pet fires, the fireball lands. */
const FIRE_AT = 2
const FLIGHT = 5
const STEP = 2

export function arena(t: number, w: number, act: Act, fight: Fight = { open: 0, won: 0, flash: false }, allies: readonly AllyView[] = []): Grid {
  const cv = canvas(w, 8)
  for (let x = 0; x < w; x += 2) plot(cv, x, 15, '#3a4034')
  const bossX = Math.max(0, Math.floor(w * 0.25) - 8)
  if (fight.flash && t < WIN_FRAMES) {
    // A check gone green again: the boss blows up.
    for (let i = 0; i < 3; i++) draw(cv, bossX + 2 + i * 4, 2 + ((i * 3) % 6), BURST[Math.min(BURST.length - 1, Math.floor(t / 2) + i) % BURST.length]!, BURST_COLORS)
    const labels = drawAllies(cv, t, w, allies)
    const g = withLabels(cells(cv), labels)
    put(g, Math.min(w - 5, bossX + 18), 2, 'WIN!', { c: '#e5a50a', b: true })
    return withScore(g, w, fight)
  }
  if (fight.open > 0 && act !== 'say') {
    // A check is red: the boss stands its ground and takes the shots.
    const frame = act === 'ask' ? 0 : t
    draw(cv, bossX + (frame % 4 === 0 ? 1 : 0), 0, BOSS.art, BOSS.colors)
    // A fireball every five frames, across the field in three.
    const p = frame % 5
    const from = w - 4
    const to = bossX + 16
    if (p < 3) draw(cv, from - Math.floor(((from - to) * p) / 3), 6, BOLT, { o: '#e5a50a' })
    else if (p === 3) draw(cv, to - 2, 4, BURST[0]!, BURST_COLORS)
    const labels = drawAllies(cv, t, w, allies)
    const g = withLabels(cells(cv), labels)
    const red = w >= 40 ? `${fight.open} check${fight.open > 1 ? 's' : ''} red` : `${fight.open} red`
    // Under the score, right of the boss.
    put(g, w - textWidth(red) - 1, 1, red, { c: '#d0021b', b: true })
    return withScore(g, w, fight)
  }
  if (act === 'say') {
    // The answer is being written: the field is clear, sparkles drift by.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor((t * 2 + i * (w / 4)) % w)
      draw(cv, x, 2 + ((i * 5 + t) % 9), SPARKLE, { y: i % 2 ? '#e5a50a' : '#61afef' })
    }
    const labels = drawAllies(cv, t, w, allies)
    return withLabels(cells(cv), labels)
  }
  const frame = act === 'ask' ? 0 : t
  const lanes = act === 'tool' ? 2 : 1
  // A monster walks in; the pet fires once it is on the field, and the fireball crosses in FLIGHT frames, whatever the width.
  const hit = FIRE_AT + FLIGHT
  const cycle = hit + BURST.length + 2
  for (let lane = 0; lane < lanes; lane++) {
    const at = frame + Math.floor((lane * cycle) / 2)
    const round = Math.floor(at / cycle)
    const p = at % cycle
    const enemy = ENEMIES[(round + lane) % ENEMIES.length]!
    const y = enemy.flies || lane === 1 ? 0 : 7
    const ex = -8 + STEP * p
    if (p < hit) {
      draw(cv, ex, y + (p % 2 && !enemy.flies ? -1 : 0), enemy.art, enemy.colors)
      if (p >= FIRE_AT) {
        const from = w - 4
        const to = -8 + STEP * hit + 8
        draw(cv, from - Math.floor(((from - to) * (p - FIRE_AT)) / FLIGHT), y + 3, BOLT, { o: '#e5a50a' })
      }
    } else if (p < hit + BURST.length) {
      draw(cv, -8 + STEP * hit, y, BURST[p - hit]!, BURST_COLORS)
    }
  }
  const labels = drawAllies(cv, t, w, allies)
  return withScore(withLabels(cells(cv), labels), w, fight)
}

const PELLET = ['bb', 'bb']
const GREY = '#8a8a8a'
/** One ally's place on the field: 12 columns each, from just in front of the pet. */
const ALLY_STEP = 12
const MAX_ALLIES = 3

/**
 * The allies on the field's floor in front of the pet, each with its task above it. Running, one bobs
 * and shoots a pellet every six frames; done, it cheers in a shower of sparkles; failed, it lies grey.
 * As many as fit, up to three, and `+n` for the rest.
 */
function drawAllies(cv: Canvas, t: number, w: number, allies: readonly AllyView[]): [number, string, string][] {
  const fits = Math.min(MAX_ALLIES, Math.max(0, Math.floor((w - 20) / ALLY_STEP)))
  const shown = allies.slice(0, fits)
  const labels: [number, string, string][] = []
  shown.forEach((a, i) => {
    const x = w - 13 - i * ALLY_STEP
    if (a.leaving === 'failed') {
      plotHalf(cv, a.sprite, 0, 'hurt', x, 9, c => mix(mix(c, '#808080', 0.8), '#000000', 0.2))
      labels.push([x - 1, '✗ failed', '#c0392b'])
      return
    }
    if (a.leaving === 'done') {
      plotHalf(cv, a.sprite, 0, 'happy', x, 8 - (t % 4 < 2 ? 1 : 0))
      draw(cv, x - 4 + (t % 3), 4 + (t % 2) * 4, SPARKLE, { y: t % 2 ? '#f1c40f' : '#61afef' })
      draw(cv, x + 8 - (t % 3), 6 - (t % 2) * 3, SPARKLE, { y: t % 2 ? '#61afef' : '#f1c40f' })
      labels.push([x - 1, '✓ done', '#98c379'])
      return
    }
    const p = (t + i * 2) % 6
    plotHalf(cv, a.sprite, Math.floor(t / 3), 'idle', x, 8 + (p === 3 ? -1 : 0))
    if (p >= 1) draw(cv, x - 3 - (p - 1) * 6, 11, PELLET, { b: '#61afef' })
    labels.push([x, [...a.label].slice(0, ALLY_STEP - 2).join(''), GREY])
  })
  const rest = allies.length - shown.length
  if (rest > 0 && shown.length) labels.push([w - 13 - shown.length * ALLY_STEP + 6, `+${rest}`, GREY])
  return labels
}

/** The allies' words, on the row above them. */
function withLabels(g: Grid, labels: readonly [number, string, string][]): Grid {
  for (const [x, text, c] of labels) put(g, Math.max(0, x), 3, text, { c })
  return g
}

/** The stage's real wins, top right. */
function withScore(g: Grid, w: number, fight: Fight): Grid {
  const score = `WINS ${fight.won}`
  if (w > 16) put(g, w - textWidth(score) - 1, 0, score, { c: DIM })
  return g
}

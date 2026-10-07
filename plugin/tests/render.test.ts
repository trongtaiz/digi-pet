import { expect, test } from 'claude-code/testing'

import { HUNGER_COLOR, arena, band, digivice, pane, toolRow } from '../hooks/render'
import { oneLine, toolLabel, toolRun } from '../hooks/activity'
import type { PaneView } from '../hooks/render'
import { SPRITES } from '../hooks/sprites.gen'

const view: PaneView = {
  sprite: SPRITES.koro,
  hunger: 'full',
  minutesLeft: 58,
  ttlMinutes: 60,
  mood: 'normal',
  attribute: null,
  project: 'my-app',
  careMistakes: 0,
  stats: { STA: 7, INT: 5, ATK: 13, DEF: 14, SPD: 18, SYN: 8 },
}

/** How many filled cells each stat's bar has, read off the pane's rows. */
function fills(width: number): Record<string, number> {
  const rows = pane(view, 0, width).map(row => row.map(c => c.ch).join(''))
  const out: Record<string, number> = {}
  for (const row of rows) for (const m of row.matchAll(/(STA|INT|ATK|DEF|SPD|SYN) (█*)░*/g)) out[m[1]!] = m[2]!.length
  return out
}

test('stat bars are drawn against the strongest stat, so small numbers still show their shape', () => {
  const f = fills(80)
  // SPD is the strongest: a full bar of 20; the rest in proportion.
  expect(f).toEqual({ STA: 8, INT: 6, ATK: 14, DEF: 16, SPD: 20, SYN: 9 })
})

test('a pet with no stats yet draws empty bars, not full ones', () => {
  const rows = pane({ ...view, stats: { STA: 0, INT: 0, ATK: 0, DEF: 0, SPD: 0, SYN: 0 } }, 0, 80)
    .map(r => r.map(c => c.ch).join(''))
    .filter(r => /STA |ATK |SPD /.test(r))
  expect(rows).toHaveLength(3)
  for (const r of rows) expect(r).not.toContain('█')
})

test("the pane shows this stage's chaos under the care mistakes", () => {
  const rows = pane({ ...view, chaos: 3 }, 0, 80).map(r => r.map(c => c.ch).join(''))
  expect(rows.some(r => r.includes('Chaos  3 this stage'))).toBe(true)
})

test('the pane forecasts the branches: met in green with a tick, the one it leads to marked', () => {
  const forecast = {
    branches: [
      { name: 'Devimon', attribute: 'Virus', needs: [{ key: 'training', have: 4, min: 48, max: null, isMet: false }], isNow: false, isCatchAll: false },
      { name: 'Meramon', attribute: 'Data', needs: [{ key: 'careMistakes', have: 0, min: 0, max: 3, isMet: true }], isNow: true, isCatchAll: false },
      { name: 'Numemon', attribute: 'Virus', needs: [{ key: 'training', have: 4, min: 8, max: 31, isMet: false }], isNow: false, isCatchAll: true },
    ],
    virus: { name: 'Devimon', have: 2, need: 25 },
  }
  const rows = pane({ ...view, forecast }, 0, 80).map(r => r.map(c => c.ch).join(''))
  const text = rows.join('\n')
  expect(text).toContain('Devimon  training 4/48')
  expect(text).toContain('▸ Meramon  care mistakes 0 (≤3) ✓')
  expect(text).toContain('Numemon  training 4 (8–31) · if none fits')
  expect(text).toContain('Devimon  chaos 2/25')
})

test('a long quiet line wraps beside the Digivice and never runs into it', () => {
  const quiet = { ...view, quiet: 'side session · cache 60m left (cold at 11:49)' }
  for (const [width, rows] of [[72, 9], [72, 8], [54, 9]] as const) {
    const g = band(quiet, 0, width, rows)
    const plain = band({ ...view, quiet: 'side session' }, 0, width, rows)
    // The screen's columns (in its Digivice with nine rows) are as they are with a short line.
    const device = (x: typeof g) => x.map(r => r.slice(width - (rows === 9 ? 29 : 25)).map(c => c.ch).join(''))
    expect(device(g)).toEqual(device(plain))
    const text = g.map(r => r.map(c => c.ch).join('')).join('\n')
    expect(`${width}: ${text.includes('11:49)')}`).toBe(`${width}: true`)
  }
})

/** The first frame a fireball lands (its burst shows), in a fight of `act` at `width`. */
function firstHit(width: number, act: 'think' | 'tool', fight = { open: 0, won: 0, flash: false }): number {
  for (let t = 0; t < 60; t++) if (JSON.stringify(arena(t, width, act, fight)).includes('#f1c40f')) return t
  return Infinity
}

test('a fireball reaches its monster in well under a second, however wide the field', () => {
  // Frames are 120 ms: 8 frames is under a second from the monster walking in.
  for (const width of [30, 60, 100, 150]) expect(`${width}: ${firstHit(width, 'think') <= 8}`).toBe(`${width}: true`)
  // The boss is hit every few frames, not every second.
  expect(firstHit(100, 'tool', { open: 1, won: 0, flash: false }) <= 3).toBe(true)
})

test('the fireball flies long enough to see, and the monster runs onto the field before it lands', () => {
  const t = firstHit(100, 'think')
  // The bolt is in the air for at least five frames (600 ms).
  const flying = Array.from({ length: t }, (_, f) => JSON.stringify(arena(f, 100, 'think'))).filter(s => s.includes('#e5a50a'))
  expect(flying.length).toBeGreaterThanOrEqual(5)
  // The burst lands clear of the left edge: the monster ran in, it did not peek.
  const left = Math.min(...arena(t, 100, 'think').flatMap(row => row.flatMap((c, x) => (c.c === '#f1c40f' || c.bg === '#f1c40f' ? [x] : []))))
  expect(left).toBeGreaterThanOrEqual(4)
})

test('the screen sits in a Digivice: a shell half a row thick, rounded corners, three buttons, one row less than the old frame', () => {
  const g = digivice(view, 0, 24, false, '#55607a')
  expect(g).toHaveLength(9)
  expect(g[0]).toHaveLength(24 + 5)
  // Rounded: the corner cells are only half filled.
  expect([g[0]![0]!.ch, g[0]![28]!.ch, g[8]![0]!.ch, g[8]![28]!.ch]).toEqual(['▄', '▄', '▀', '▀'])
  // A, B and C down the right side.
  const buttons = g.filter(row => row[26]!.c === '#c9ced6' || row[26]!.bg === '#c9ced6')
  expect(buttons).toHaveLength(3)
})

test("the band shows the Digivice when it has nine rows, the bare screen with eight, and a hungry pet's shell turns its colour", () => {
  expect(band(view, 0, 100, 9)).toHaveLength(9)
  expect(band(view, 0, 100, 8)).toHaveLength(8)
  const hungry = band({ ...view, hunger: 'hungry', minutesLeft: 12 }, 0, 100, 12)
  expect(hungry).toHaveLength(9)
  expect(JSON.stringify(hungry)).toContain(HUNGER_COLOR.hungry)
})

test('the tool row under the pet: tool, what it runs and its time, ending at the right edge; a long command is cut first', () => {
  const row = (run: { tool: string; text: string }, width: number, secs?: number) => toolRow(run, width, secs)[0]!.map(c => c.ch).join('')
  const short = row({ tool: 'Bash', text: 'npm test -- --run' }, 60, 12)
  expect(short.trimEnd()).toMatch(/⏵ Bash {2}npm test -- --run {2}12s$/)
  expect(short.trimEnd().length).toBeLessThanOrEqual(58)
  const long = row({ tool: 'Bash', text: 'git commit -m "session store: one write path, and a test for the two-tab race"' }, 50, 2)
  expect(long).toContain('⏵ Bash')
  expect(long).toContain('…')
  expect(long.trimEnd()).toMatch(/2s$/)
  // No time with reduced motion.
  expect(row({ tool: 'Read', text: 'src/a.ts' }, 40).trimEnd()).toMatch(/Read {2}src\/a\.ts$/)
})

test('what a tool runs, cleaned for one row: the first line, no control characters, runs of space collapsed', () => {
  expect(toolRun({ tool: 'Bash', command: 'cat <<EOF > a\nhello\nEOF' })).toEqual({ tool: 'Bash', text: 'cat <<EOF > a' })
  expect(toolRun({ tool: 'Bash', command: "printf '\x1b[31m'\t  red\r" })).toEqual({ tool: 'Bash', text: "printf '[31m' red" })
  expect(toolRun({ tool: 'Read', file_path: '/Users/me/app/src/a.ts' })).toEqual({ tool: 'Read', text: '/Users/me/app/src/a.ts' })
  expect(toolRun({ tool: 'Agent', subagent_type: 'Explore', description: 'find callers' })).toEqual({ tool: 'Agent', text: 'Explore · find callers' })
  expect(toolRun({ tool: 'mcp__github__search', query: 'x' })).toEqual({ tool: 'search', text: 'x' })
})

test('allies stand in front of the pet with their task above them; done they cheer, failed they lie grey; more than fit is +n', () => {
  const text = (g: ReturnType<typeof arena>) => g.map(r => r.map(c => c.ch).join('')).join('\n')
  const koro = { sprite: SPRITES.koro, label: 'find callers of saveSession' }
  // None: the field as it always was.
  expect(arena(3, 62, 'tool', undefined, [])).toEqual(arena(3, 62, 'tool'))
  const one = arena(3, 62, 'tool', undefined, [koro])
  expect(text(one)).toContain('find calle')
  // Its pixels on the floor in front of the pet, the right end of the field.
  const lit = (g: ReturnType<typeof arena>, from: number) => g.slice(4).some(r => r.slice(from, from + 8).some(c => c.ch !== ' ' && c.c !== '#3a4034'))
  expect(lit(one, 62 - 13)).toBe(true)
  expect(text(arena(3, 62, 'tool', undefined, [{ ...koro, leaving: 'done' }]))).toContain('✓ done')
  expect(text(arena(3, 62, 'tool', undefined, [{ ...koro, leaving: 'failed' }]))).toContain('✗ failed')
  // 62 columns hold three; the fourth and fifth are +2. Too narrow a field holds none.
  expect(text(arena(3, 62, 'tool', undefined, [koro, koro, koro, koro, koro]))).toContain('+2')
  expect(text(arena(3, 30, 'tool', undefined, [koro]))).not.toContain('find')
})

test('between turns a subagent still out waits on the pet\'s screen, and the pet says so', () => {
  const v = { ...view, allies: [{ sprite: SPRITES.toko, label: 'exploring the auth flow' }] }
  const words = band(v, 0, 72).map(r => r.map(c => c.ch).join('')).join('\n')
  expect(words).toContain('Tokomon is still out: exploring')
  // No allies: the same band as before.
  expect(band({ ...view, allies: [] }, 0, 72)).toEqual(band(view, 0, 72))
})

test('text from a tool call or a subagent reaches the band with no control characters, C1 ones included', () => {
  const evil = 'a\x1b]8;;https://x\x07b\u009b2Jc\td'
  expect(oneLine(evil)).toBe('a]8;;https://xb2Jc d')
  expect(toolRun({ tool: 'Bash', command: evil }).text).toBe('a]8;;https://xb2Jc d')
  expect(toolLabel({ tool: 'Bash', command: evil })).toBe('Bash: a]8;;https://xb2Jc d')
  expect(toolLabel({ tool: 'Grep', pattern: '\x1b[31mred' })).toBe('Grep: [31mred')
})

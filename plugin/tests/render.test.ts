import { expect, test } from 'claude-code/testing'

import { HUNGER_COLOR, arena, band, digivice, pane } from '../hooks/render'
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

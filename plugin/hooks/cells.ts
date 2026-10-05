// Cells and half-block pixels, copied from hoobnn's spinner mod
// (https://github.com/hoobnn/hoobnn-agent-mods, claude-code/spinner/hooks/cells.ts, MIT © 2026 hoobnn).

export type Style = { c?: string; bg?: string; b?: boolean; d?: boolean }
export type Cell = Style & { ch: string }
export type Seg = Style & { text: string }
export type Grid = Cell[][]

// ---- cells ---------------------------------------------------------------

/** Cells a code point takes: CJK, fullwidth forms and emoji two, the rest one. */
function cpWidth(cp: number): number {
  if (cp < 0x1100) return 1
  if (
    cp <= 0x115f ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += cpWidth(ch.codePointAt(0)!)
  return w
}

/** `text` padded with spaces to `w` cells. */
export function padTo(text: string, w: number): string {
  return text + ' '.repeat(Math.max(0, w - textWidth(text)))
}

export function blank(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ' })))
}

/** Writes `text` at column `x` of row `y`, clipped to the grid; a wide character takes two cells. */
export function put(g: Grid, x: number, y: number, text: string, style: Style = {}): void {
  const row = g[y]
  if (!row) return
  let col = Math.round(x)
  for (const ch of text) {
    const w = cpWidth(ch.codePointAt(0)!)
    if (col >= 0 && col + w <= row.length) {
      // A wide character left half-covered would shift the rest of the row.
      if (row[col]!.ch === '' && col > 0) row[col - 1] = { ch: ' ' }
      row[col] = { ch, ...style }
      if (w === 2) row[col + 1] = { ch: '' }
      else if (col + 1 < row.length && row[col + 1]!.ch === '') row[col + 1] = { ch: ' ' }
    }
    col += w
  }
}

/** A row as runs of one style each, what a Text per run draws. */
export function segments(row: Cell[]): Seg[] {
  const out: Seg[] = []
  for (const cell of row) {
    // The right half of a wide character: drawn by its left half.
    if (cell.ch === '') continue
    const last = out[out.length - 1]
    if (last && last.c === cell.c && last.bg === cell.bg && !!last.b === !!cell.b && !!last.d === !!cell.d) last.text += cell.ch
    else out.push({ text: cell.ch, c: cell.c, bg: cell.bg, b: cell.b || undefined, d: cell.d || undefined })
  }
  return out
}

// ---- pixels --------------------------------------------------------------

/** Two pixels a cell, one above the other: `w` across, `rows * 2` down. */
export type Canvas = { w: number; h: number; px: (string | undefined)[] }

export function canvas(w: number, rows: number): Canvas {
  return { w, h: rows * 2, px: new Array(w * rows * 2) }
}

export function plot(cv: Canvas, x: number, y: number, color: string): void {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px >= 0 && px < cv.w && py >= 0 && py < cv.h) cv.px[py * cv.w + px] = color
}

/** Draws pixel art: each character of `art` a pixel colored by `colors`, `.` left clear. */
export function draw(cv: Canvas, x: number, y: number, art: readonly string[], colors: Record<string, string>): void {
  art.forEach((line, j) => {
    for (let i = 0; i < line.length; i++) {
      const color = colors[line[i]!]
      if (color) plot(cv, x + i, y + j, color)
    }
  })
}

/** The canvas as cells: `▀` in the top pixel's color over the bottom one's. */
export function cells(cv: Canvas): Grid {
  const g = blank(cv.w, cv.h / 2)
  for (let r = 0; r < cv.h / 2; r++) {
    for (let x = 0; x < cv.w; x++) {
      const top = cv.px[2 * r * cv.w + x]
      const bottom = cv.px[(2 * r + 1) * cv.w + x]
      const row = g[r]!
      if (top && bottom) row[x] = top === bottom ? { ch: '█', c: top } : { ch: '▀', c: top, bg: bottom }
      else if (top) row[x] = { ch: '▀', c: top }
      else if (bottom) row[x] = { ch: '▄', c: bottom }
    }
  }
  return g
}

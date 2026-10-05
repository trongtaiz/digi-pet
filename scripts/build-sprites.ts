// Downloads every species' V-Pet sprite (Digital Monster Color, as Digitama Hatchery
// hosts them, both idle frames), decodes them with ffmpeg and writes them as 16×16
// pixel grids to hooks/sprites.gen.ts. Run scripts/crawl-humulos.ts first: it lists them.
// A species with a full sheet in sprites/sheets (scripts/fetch-sheets.ts) takes its
// twelve poses from it instead: idle, eat, sleep, refuse, happy, angry, hurt, attack.
// Usage: bun scripts/build-sprites.ts        (needs ffmpeg; downloads are cached in sprites/raw/humulos/dot)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Pose } from '../plugin/hooks/sprite'
import type { Species } from './crawl-humulos'

const ROOT = join(import.meta.dir, '..')
const RAW = join(ROOT, 'sprites/raw/humulos/dot')
const SIZE = 16
const UA = { 'User-Agent': 'digi-pet sprite builder (personal use; cached, one request at a time)' }
// Pixel characters: index into the species palette; '.' is transparent.
const KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const STAGES: Record<string, string> = { I: 'baby1', II: 'baby2', III: 'rookie', IV: 'champion', V: 'ultimate', VI: 'mega', 'VI+': 'superMega' }

type Entry = { id: string; name: string; stage: string; sources: string[] }
type Built = Entry & { palette: string[]; frames: string[][]; strays: number; poses?: Partial<Record<Pose, number[]>> }

const SHEETS = join(ROOT, 'sprites/sheets')
/** A sheet's twelve cells, three across and four down, as the pack's checklist names them. */
const SHEET_POSES: Pose[] = ['idle', 'idle', 'eat', 'eat', 'sleep', 'sleep', 'refuse', 'happy', 'angry', 'hurt', 'hurt', 'attack']
const sheetIndex = (existsSync(join(SHEETS, 'index.json')) ? await Bun.file(join(SHEETS, 'index.json')).json() : {}) as Record<string, { file: string; url: string }>

const chart = (await Bun.file(join(ROOT, 'data/dmc.json')).json()) as {
  versions: { version: string; chart: string; digitama: string }[]
  species: Record<string, Species>
}
const entries: Entry[] = [
  ...chart.versions.map(v => ({ id: `egg${v.chart.slice(1)}`, name: `${v.version} Digitama`, stage: 'egg', sources: [v.digitama, v.digitama.replace('/dmc/', '/dmc/frame2/')] })),
  ...Object.values(chart.species).map(s => ({ id: s.id, name: s.name, stage: STAGES[s.stage] ?? s.stage, sources: s.sprites })),
]

/** The file at `url`, downloaded once; null when the site has none (a missing second frame). */
async function download(url: string): Promise<string | null> {
  const path = join(RAW, url.split('/dmc/')[1]!.replace('/', '__'))
  if (!existsSync(path)) {
    await Bun.sleep(150)
    const res = await fetch(url, { headers: UA })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    await Bun.write(path, await res.arrayBuffer())
  }
  return path
}

/** The image's real frames (no fps duplication) as RGBA, and its size. */
function decode(path: string): { w: number; h: number; frames: Uint8Array[] } {
  const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path])
  const [w, h] = probe.stdout.toString().trim().split(',').map(Number) as [number, number]
  const out = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', path, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
  if (out.exitCode !== 0) throw new Error(`${path}: ${out.stderr.toString()}`)
  const bytes = new Uint8Array(out.stdout)
  const size = w * h * 4
  return { w, h, frames: Array.from({ length: bytes.length / size }, (_, i) => bytes.subarray(i * size, (i + 1) * size)) }
}

const hex = (b: Uint8Array, i: number) => (b[i + 3]! < 128 ? '' : `#${[b[i]!, b[i + 1]!, b[i + 2]!].map(v => v.toString(16).padStart(2, '0')).join('')}`)

/**
 * One frame's pixel grid: the largest scale whose blocks are one colour, each
 * block read by its centre pixel. A few mixed blocks are retouches in the source
 * art (counted as strays); more mean the scale is wrong, so a smaller one is tried.
 */
function unscale(frame: Uint8Array, w: number, h: number, name: string): { grid: string[][]; strays: number } {
  for (let k = Math.floor(Math.min(w, h) / SIZE); k >= 1; k--) {
    if (w % k || h % k) continue
    const [gw, gh] = [w / k, h / k]
    const mid = Math.floor(k / 2)
    const grid: string[][] = []
    let strays = 0
    for (let by = 0; by < gh; by++) {
      const row: string[] = []
      for (let bx = 0; bx < gw; bx++) {
        const seen = new Set<string>()
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) seen.add(hex(frame, ((by * k + dy) * w + bx * k + dx) * 4))
        if (seen.size > 1) strays++
        row.push(hex(frame, ((by * k + mid) * w + bx * k + mid) * 4))
      }
      grid.push(row)
    }
    if (strays <= gw * gh * 0.05) return { grid, strays }
  }
  throw new Error(`${name}: no scale gives one-colour blocks`)
}

/** The frames cut to the box their pixels share, then set in 16×16: centred across, standing on the bottom. */
function fit(grids: string[][][], name: string): string[][][] {
  let [top, left, bottom, right] = [Infinity, Infinity, -1, -1]
  for (const g of grids)
    g.forEach((row, y) =>
      row.forEach((c, x) => {
        if (!c) return
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
        left = Math.min(left, x)
        right = Math.max(right, x)
      }),
    )
  const [bw, bh] = [right - left + 1, bottom - top + 1]
  if (bw > SIZE || bh > SIZE) throw new Error(`${name}: ${bw}×${bh} pixels do not fit ${SIZE}×${SIZE}`)
  const [ox, oy] = [Math.floor((SIZE - bw) / 2), SIZE - bh]
  return grids.map(g => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => g[y - oy + top]?.[x - ox + left] ?? '')))
}

/** A sheet's cells as 16×16 grids, by pose; an empty cell (a pose not drawn yet) is left out. */
function sheet(entry: Entry): { grids: string[][][]; poses: Pose[]; strays: number } {
  const { w, h, frames } = decode(join(SHEETS, `${entry.id}.png`))
  const { grid, strays } = unscale(frames[0]!, w, h, entry.name)
  const cell = grid[0]!.length / 3
  if (cell !== SIZE || grid.length !== SIZE * 4) throw new Error(`${entry.name}: a ${grid[0]!.length}×${grid.length} sheet is not 3×4 cells of ${SIZE}`)
  const grids: string[][][] = []
  const poses: Pose[] = []
  SHEET_POSES.forEach((pose, i) => {
    const [cx, cy] = [(i % 3) * SIZE, Math.floor(i / 3) * SIZE]
    const g = grid.slice(cy, cy + SIZE).map(row => row.slice(cx, cx + SIZE))
    if (!g.some(row => row.some(Boolean))) return
    grids.push(g)
    poses.push(pose)
  })
  if (poses[0] !== 'idle') throw new Error(`${entry.name}: the sheet has no idle frame`)
  return { grids, poses, strays }
}

async function build(entry: Entry): Promise<Built> {
  const grids: string[][][] = []
  let strays = 0
  let poseOf: Pose[] | undefined
  if (sheetIndex[entry.id]) {
    const s = sheet(entry)
    grids.push(...s.grids)
    strays = s.strays
    poseOf = s.poses
    entry = { ...entry, sources: [sheetIndex[entry.id]!.url] }
  } else for (const url of entry.sources) {
    const path = await download(url)
    if (!path) continue
    const { w, h, frames } = decode(path)
    for (const f of frames) {
      const u = unscale(f, w, h, entry.name)
      grids.push(u.grid)
      strays += u.strays
    }
  }
  if (!grids.length) throw new Error(`${entry.name}: no sprite`)
  const palette: string[] = []
  const encoded: string[][] = []
  const poses: Partial<Record<Pose, number[]>> = {}
  for (const [i, grid] of fit(grids, entry.name).entries()) {
    const rows = grid.map(row =>
      row
        .map(color => {
          if (!color) return '.'
          if (!palette.includes(color)) palette.push(color)
          return KEYS[palette.indexOf(color)]!
        })
        .join(''),
    )
    // A frame the source repeats adds nothing.
    let at = encoded.findIndex(f => f.join() === rows.join())
    if (at < 0) at = encoded.push(rows) - 1
    if (poseOf) (poses[poseOf[i]!] ??= []).push(at)
  }
  if (palette.length > KEYS.length) throw new Error(`${entry.name}: ${palette.length} colours`)
  return { ...entry, palette, frames: encoded, strays, ...(poseOf ? { poses } : {}) }
}

mkdirSync(RAW, { recursive: true })
const built: Built[] = []
for (const entry of entries) {
  const sprite = await build(entry)
  built.push(sprite)
  if ((!sprite.poses && sprite.frames.length !== 2) || sprite.strays) {
    console.log(`! ${sprite.name.padEnd(22)} ${sprite.frames.length} frame(s)${sprite.strays ? ` · ${sprite.strays} stray block(s), centre pixel kept` : ''}`)
  }
}
const posed = built.filter(s => s.poses)
console.log(`✓ ${built.length} sprites, 16×16; ${posed.length} from full sheets (${posed.filter(s => Object.keys(s.poses!).length === 8).length} with all eight poses)`)

const body = built
  .map(s => `  ${JSON.stringify(s.id)}: ${JSON.stringify({ name: s.name, stage: s.stage, source: s.sources[0], palette: s.palette, frames: s.frames, ...(s.poses ? { poses: s.poses } : {}) })},`)
  .join('\n')
writeFileSync(
  join(ROOT, 'plugin/hooks/sprites.gen.ts'),
  `// Generated by scripts/build-sprites.ts from data/dmc.json: do not edit.\n// Sprites © Bandai (Digital Monster Color), via humulos.com (Digitama Hatchery), and full sheets from the\n// community Full Color Digimon Dot Sprites pack (withthewill.net thread 25843); personal use only.\nimport type { Sprite } from './sprite'\n\nexport const SPRITES = {\n${body}\n} satisfies Record<string, Sprite>\n\nexport type SpeciesId = keyof typeof SPRITES\n`,
)
writeFileSync(
  join(ROOT, 'sprites/CREDITS.md'),
  `# Sprite credits\n\nAll sprites © Bandai. Idle frames from Digital Monster Color, as hosted by Digitama Hatchery (https://humulos.com/digimon/dmc/); full twelve-pose sheets from the community \"Full Color Digimon Dot Sprites\" pack (https://withthewill.net/threads/full-color-digimon-dot-sprites.25843/, compiled and coloured by Tortoiseshel; some frames are fan-made, as the pack notes). For personal use only; not for redistribution.\n\n${built.map(s => `- ${s.name}: ${s.sources.join(' , ')}${s.poses ? ` (sheet ${sheetIndex[s.id]!.file})` : ''}`).join('\n')}\n`,
)
console.log(`wrote plugin/hooks/sprites.gen.ts (${built.length} species) and sprites/CREDITS.md`)

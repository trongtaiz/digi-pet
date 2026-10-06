// Shows everything digi-pet draws, from the same grids the mod draws, without
// waiting an hour for a hungry pet or weeks for a digivolution.
//
//   bun scripts/preview.ts --html [--shots]     preview/index.html (+ PNGs of each section in preview/shots)
//   bun scripts/preview.ts --html --readme      also the README's images in docs/images (needs ffmpeg for the GIF)
//   bun scripts/preview.ts --term [species] [state] [width]   the band and the pane as ANSI, in this terminal
//
// States: full peckish hungry starving cold asleep sick eating evolving
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { blank, segments, textWidth } from '../plugin/hooks/cells'
import type { Cell, Grid } from '../plugin/hooks/cells'
import { BAND_WIDTH, EVOLVE_FRAMES, arena, band, lcd, miniBand, notification, pane, speech, statusLine, toast } from '../plugin/hooks/render'
import type { Act, Fight, PaneView } from '../plugin/hooks/render'
import { canvas, cells, plot } from '../plugin/hooks/cells'
import { pixels } from '../plugin/hooks/sprite'
import type { Pose } from '../plugin/hooks/sprite'
import { SPRITES } from '../plugin/hooks/sprites.gen'
import dmc from '../data/dmc.json'
import { CHAOS_PER_DAY, GATES, TRAINING_PER_DAY } from '../plugin/hooks/growth'
import type { Rule } from '../plugin/hooks/growth'
import { SPECIES } from '../plugin/hooks/species.gen'
import type { Range, Requirement, Species } from './crawl-humulos'
import type { SpeciesId } from '../plugin/hooks/sprites.gen'
import type { Sprite } from '../plugin/hooks/sprite'

const ROOT = join(import.meta.dir, '..')
const chart = dmc as unknown as { source: string; versions: { version: string; chart: string; ids: string[] }[]; species: Record<string, Species> }
const OUT = join(ROOT, 'preview')
const STATES = ['working', 'tool', 'asking', 'red', 'win', 'full', 'peckish', 'hungry', 'starving', 'cold', 'asleep', 'sick', 'eating', 'happy', 'evolving'] as const
const ACTS = { working: 'think', tool: 'tool', asking: 'ask', red: 'tool', win: 'tool' } as const
/** The real fight behind each state: a check red, a win just now, or neither. */
const FIGHTS: Partial<Record<string, Fight>> = { red: { open: 1, won: 3, flash: false }, win: { open: 0, won: 4, flash: true } }
type State = (typeof STATES)[number]

const MINUTES: Record<string, number> = { full: 48, peckish: 24, hungry: 12, starving: 4, cold: 0 }

/** A made-up pet in `state`, as the mod would describe it. */
function view(id: SpeciesId, state: State, t = 0): PaneView {
  const hunger = state in MINUTES ? (state as PaneView['hunger']) : 'full'
  return {
    sprite: SPRITES[id],
    hunger,
    minutesLeft: MINUTES[hunger]!,
    ttlMinutes: 60,
    mood: state === 'asleep' || state === 'sick' || state === 'eating' || state === 'happy' ? state : 'normal',
    attribute: 'Vaccine',
    project: 'my-app',
    next: { label: 'day 3/5 → Champion', ratio: 0.6 },
    evolving: state === 'evolving' ? { to: SPRITES.grey, t } : undefined,
    ...(state in ACTS ? { act: ACTS[state as keyof typeof ACTS], tool: 'Bash: npm test' } : {}),
    stats: { STA: 412, INT: 655, ATK: 538, DEF: 301, SPD: 220, SYN: 147 },
    battles: { won: 14, lost: 5 },
    trophies: 23,
    careMistakes: 1,
    ageDays: 9,
    log: [
      { name: 'Digitama', day: 'Sep 27' },
      { name: 'Botamon', day: 'Sep 27' },
      { name: 'Koromon', day: 'Sep 28' },
      { name: 'Agumon', day: 'Oct 1' },
    ],
  }
}

/** How many frames a state's loop has, and how long each shows. */
function timing(state: State): { frames: number; ms: number } {
  if (state === 'evolving') return { frames: EVOLVE_FRAMES + 4, ms: 300 }
  if (state === 'eating') return { frames: 6, ms: 400 }
  return { frames: 8, ms: 500 }
}

// ---- ANSI ----------------------------------------------------------------

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';')

function ansi(g: Grid): string {
  return g
    .map(row =>
      segments(row)
        .map(s => `${s.c ? `\x1b[38;2;${rgb(s.c)}m` : ''}${s.bg ? `\x1b[48;2;${rgb(s.bg)}m` : ''}${s.b ? '\x1b[1m' : ''}${s.d ? '\x1b[2m' : ''}${s.text}\x1b[0m`)
        .join(''),
    )
    .join('\n')
}

async function term(id: SpeciesId, state: State | undefined, width: number) {
  const states = state ? [state] : STATES
  for (const s of states) {
    const { frames, ms } = timing(s)
    console.log(`\x1b[2m── ${SPRITES[id].name} · ${s} · band (${width} cols) ──\x1b[0m`)
    // Play the loop once in place, then leave its last frame up.
    let lines = 0
    for (let t = 0; t < frames; t++) {
      if (lines) process.stdout.write(`\x1b[${lines}A\x1b[J`)
      const out = ansi(band(view(id, s, t), t, width))
      console.log(out)
      lines = out.split('\n').length
      await Bun.sleep(ms)
    }
  }
  console.log(`\x1b[2m── pane (${width} cols) ──\x1b[0m`)
  console.log(ansi(pane(view(id, 'full'), 0, width)))
}

// ---- HTML ----------------------------------------------------------------

// Block elements drawn as quadrants, so pixel art meets edge to edge as a terminal draws it
// (after scripts/spinner-shots.ts in hoobnn-agent-mods).
const QUADS: Record<string, string> = { '█': '11', '▀': '10', '▄': '01' }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function rowHtml(row: Cell[]): string {
  let html = ''
  for (let i = 0; i < row.length; i++) {
    const cell = row[i]!
    if (cell.ch === '') continue
    const quads = QUADS[cell.ch]
    if (quads) {
      const fill = (on: string) => (on === '1' ? (cell.c ?? '#e6e6e6') : (cell.bg ?? 'transparent'))
      html += `<span class="q">${[...quads].map(on => `<i style="background:${fill(on)}"></i>`).join('')}</span>`
      continue
    }
    const wide = textWidth(cell.ch) === 2
    const style = [
      cell.c ? `color:${cell.c}` : '',
      cell.bg ? `background:${cell.bg}` : '',
      cell.b ? 'font-weight:700' : '',
      cell.d ? 'opacity:.6' : '',
      wide ? 'width:2ch' : '',
    ]
      .filter(Boolean)
      .join(';')
    html += `<span${style ? ` style="${style}"` : ''}>${cell.ch === ' ' ? '&nbsp;' : esc(cell.ch)}</span>`
  }
  return `<div class="row">${html}</div>`
}

const gridHtml = (g: Grid) => `<div class="grid">${g.map(rowHtml).join('')}</div>`

/** A loop of grids, one shown at a time; the page's script steps through them. */
function anim(frames: Grid[], ms: number): string {
  return `<div class="anim" data-ms="${ms}">${frames.map((g, i) => `<div class="frame"${i ? ' hidden' : ''}>${gridHtml(g)}</div>`).join('')}</div>`
}

function terminal(title: string, body: string, width: number): string {
  return `<div class="win">
    <div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(title)}</span></div>
    <div class="body">
      <div class="line dim">⏺ Ran the tests: 42 passed.</div>
      <div class="line">&nbsp;</div>
      ${body}
      <div class="prompt">&gt; </div>
    </div></div>`
}

function bandSection(width: number): string {
  const cards = STATES.map(state => {
    const { frames, ms } = timing(state)
    // As the mod lays it out: during a turn the fight on the left and a 54-wide block on the right,
    // else a block of at most BAND_WIDTH, at the band's right edge.
    const act = (ACTS as Record<string, Act | undefined>)[state]
    const inner = width - 2
    const block = Math.min(inner, act ? 54 : BAND_WIDTH)
    const field = inner - block - 2
    const n = act ? 24 : frames
    const grids = Array.from({ length: n }, (_, t) => {
      // The fight steps every frame and the pet's screen every fourth; with no fight, the screen steps every frame.
      const st = act ? Math.floor(t / 4) : t
      const right = band(view('agu', state, st), st, block)
      const left = act && field >= 20 ? arena(t, field, act, FIGHTS[state] ?? { open: 0, won: 3, flash: false }) : null
      // The fight stands on the band's floor, as the mod lines them up (alignItems flex-end).
      const lift = left ? right.length - left.length : 0
      return right.map((row, i) => (left ? [...(left[i - lift] ?? blank(field, 1)[0]!), ...blank(2, 1)[0]!, ...row] : [...blank(width - row.length, 1)[0]!, ...row]))
    })
    return `<h3>${state}</h3><div data-shot="band-${width}-${state}">${terminal(`claude — my-app · ${width} cols`, anim(grids, act ? 120 : ms), width)}</div>`
  })
  return `<section id="band-${width}"><h2>Band · ${width} columns</h2>${cards.join('')}</section>`
}

function miniSection(): string {
  const states: State[] = ['full', 'working', 'hungry', 'asleep']
  const cards = states.map(state => {
    const grids = Array.from({ length: 4 }, (_, t) => miniBand(view('agu', state, t), t, 70).map(row => [...blank(10, 1)[0]!, ...row]))
    return `<h3>${state}</h3>${terminal('short band · 4 rows', anim(grids, 500), 80)}`
  })
  return `<section id="mini"><h2>Short band: the four-row mini screen</h2>${cards.join('')}</section>`
}

function paneSection(width: number): string {
  const states: State[] = ['full', 'hungry', 'asleep']
  const cards = states.map(state => {
    const grids = Array.from({ length: 24 }, (_, t) => pane(view('agu', state, t), t, width))
    return `<h3>${state}</h3><div data-shot="pane-${width}-${state}">${terminal(`/digi pane · ${width} cols`, anim(grids, 400), width)}</div>`
  })
  return `<section id="pane-${width}"><h2>Pane · ${width} columns</h2>${cards.join('')}</section>`
}

function spriteSection(): string {
  const cards = (Object.keys(SPRITES) as SpeciesId[]).map(id => {
    const s = SPRITES[id]
    const raw = s.source.split('/').pop()!
    const grids = [0, 1].map(t => lcd(view(id, 'full'), t, 16))
    return `<div class="card">
      <div class="pair"><img src="../sprites/raw/humulos/dot/${raw}" alt="${esc(s.name)} source"><div class="lcdwrap">${anim(grids, 500)}</div></div>
      <b>${esc(s.name)}</b><small>${s.stage} · ${s.frames.length} frames · ${s.palette.length} colours</small>
      <a href="${s.source}">source</a></div>`
  })
  return `<section id="sprites"><h2>Sprites: source (left) vs decoded 16×16 in half-blocks (right), ${Object.keys(SPRITES).length} in all</h2><div class="cards">${cards.join('')}</div></section>`
}

const POSES: Pose[] = ['idle', 'eat', 'sleep', 'refuse', 'happy', 'angry', 'hurt', 'attack']
const LINE: SpeciesId[] = ['bota', 'koro', 'agu', 'beta', 'grey', 'devi', 'tyrano', 'mera', 'airdra', 'seadra', 'nume', 'metalgrey_vi', 'monzae', 'mame', 'blitzgrey', 'shinmonzae', 'banchomame', 'omega_a']

/** The Ver.1 line's poses from the full sheets, each pose's first frame, beside the sheet itself. */
function posesSection(): string {
  const rows = LINE.map(id => {
    const s = SPRITES[id] as Sprite
    const stills = POSES.map(pose => {
      const cv = canvas(16, 8)
      cv.px.fill('#dfe6cf')
      pixels(s, 0, pose).forEach((row, y) => row.forEach((c, x) => c && plot(cv, x, y, c)))
      const has = !!s.poses?.[pose]
      return `<div class="still"><small>${pose}${has ? '' : ' (idle)'}</small>${gridHtml(cells(cv))}</div>`
    })
    const sheet = s.poses ? `<img class="sheet" src="../sprites/sheets/${id}.png" alt="${esc(s.name)} sheet">` : '<small>no sheet</small>'
    return `<div class="poserow"><b>${esc(s.name)}</b>${sheet}${stills.join('')}</div>`
  })
  return `<section id="poses"><h2>Poses from the full sheets: the Ver.1 line</h2>${rows.join('')}</section>`
}

/** One Ver.1 line, egg to Mega, each on its own screen: the README's lineup. */
function lineupSection(): string {
  const ids: SpeciesId[] = ['egg1', 'bota', 'koro', 'agu', 'grey', 'metalgrey_vi', 'blitzgrey']
  const cards = ids.map(id => `<div class="still"><small>${esc(SPRITES[id].name)}</small>${gridHtml(lcd(view(id, 'full'), 0, 20))}</div>`)
  return `<section id="lineup"><h2>A Ver.1 line, egg to Mega</h2><div class="cards">${cards.join('')}</div></section>`
}

function filmstrip(): string {
  const frames = Array.from({ length: EVOLVE_FRAMES + 2 }, (_, t) => `<div class="still"><small>t=${t}</small>${gridHtml(lcd(view('agu', 'evolving', t), t, 24))}</div>`)
  return `<section id="evolution"><h2>Digivolution, frame by frame (Agumon → Greymon)</h2><div class="cards">${frames.join('')}</div></section>`
}

const STAGE_ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VI+']

/** A requirement as the charts word it, short: `0–3 care · 32+ training`. */
function reqText(r: Requirement): string {
  const range = (x: Range | undefined, unit: string) => (x ? `${x.min}${x.max === null ? '+' : x.max === x.min ? '' : `–${x.max}`}${unit}` : null)
  const parts = [
    range(r.careMistakes, ' care'),
    range(r.training, ' training'),
    range(r.overfeed, ' overfeed'),
    range(r.sleepDisturbances, ' sleep dist.'),
    range(r.battles, ' battles'),
    range(r.winRatio, '% wins'),
    r.jogress ? `jogress with ${r.jogress.with} (${r.jogress.version})` : null,
    ...r.other,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'time only'
}

/** Every version's evolution chart: its Digimon by stage, each with where it can go and what that takes. */
function chartSection(): string {
  const charts = chart.versions.map(v => {
    const ids = v.ids.filter(id => chart.species[id])
    const egg = `egg${v.chart.slice(1)}` as SpeciesId
    const columns = [
      `<div class="stage"><h4>Digitama</h4><div class="still">${gridHtml(lcd(view(egg, 'full'), 0, 16))}</div></div>`,
      ...STAGE_ORDER.map(stage => {
        const here = ids.filter(id => chart.species[id]!.stage === stage)
        if (!here.length) return ''
        const label = chart.species[here[0]!]!.stageLabel.replace(/^Stage [IVX+]+ \((.*)\)$/, '$1')
        const cards = here.map(id => {
          const s = chart.species[id]!
          const evos = s.evolvesTo
            .map(e => `<li><b>→ ${esc(e.name)}</b>${e.options.map(o => `<div>${esc(reqText(o))}</div>`).join('<div class="or">or</div>')}</li>`)
            .join('')
          return `<div class="mon"><div class="head">${gridHtml(lcd(view(id as SpeciesId, 'full'), 0, 16))}<div><b>${esc(s.name)}</b><small class="attr ${s.attribute}">${esc(s.attribute)}</small></div></div><ul>${evos}</ul></div>`
        })
        return `<div class="stage"><h4>${esc(stage)} · ${esc(label)} (${here.length})</h4>${cards.join('')}</div>`
      }),
    ]
    return `<h3>${esc(v.version)} · ${ids.length} Digimon</h3><div class="chart">${columns.join('')}</div>`
  })
  const all = Object.values(chart.species)
  const edges = all.reduce((n, s) => n + s.evolvesTo.length, 0)
  return `<section id="charts"><h2>Evolution charts: Digital Monster Color Ver.1–5 (${all.length} Digimon, ${edges} evolutions)</h2>
    <div class="dim">Crawled from <a href="${chart.source}">Digitama Hatchery</a>. Requirements are the device's own; digi-pet maps them to Claude Code signals in step 5.</div>${charts.join('')}</section>`
}

function alertSection(): string {
  const rows = STATES.map(state => {
    const v = view('agu', state, 12)
    const n = notification(v)
    return `<tr><td>${state}</td><td>${esc(speech(v) ?? '—')}</td><td>${esc(toast(v) ?? '—')}</td><td>${n ? `<b>${esc(n.title)}</b><br>${esc(n.body)}` : '—'}</td><td>${esc(statusLine(v) ?? '—')}</td></tr>`
  })
  return `<section id="alerts"><h2>Alert copy</h2><table><tr><th>state</th><th>bubble</th><th>toast</th><th>macOS notification</th><th>status line</th></tr>${rows.join('')}</table></section>`
}

// ---- the evolution guide ----------------------------------------------------

const GUIDE_STAGES = ['egg', 'baby1', 'baby2', 'rookie', 'champion', 'ultimate', 'mega', 'superMega'] as const
const GUIDE_LABEL: Record<string, string> = { egg: 'Digitama', baby1: 'Baby I', baby2: 'Baby II', rookie: 'Rookie', champion: 'Champion', ultimate: 'Ultimate', mega: 'Mega', superMega: 'Jogress' }

/** How long a stage lasts before the pet can digivolve (GATES, at normal pace), in words. */
function gateText(stage: string): string {
  const g = GATES[stage]
  if (!g) return ''
  const parts = [g.days && `${g.days} active days`, g.turns && `${g.turns} turns`, g.trophies && `${g.trophies} trophies`, g.summons && `${g.summons} summons`].filter(Boolean)
  return parts.length ? `lasts ${parts.join(' + ')}` : ''
}

/** A count's range as the guide words it: `≤3 care mistakes`, `16+ training`, `3–5 sleep disturbances`. */
function amount(r: { min: number; max: number | null }, noun: string): string {
  if (r.max === null) return `${r.min}+ ${noun}`
  if (r.min === r.max) return `${r.min} ${noun}`
  if (r.min === 0) return `≤${r.max} ${noun}`
  return `${r.min}–${r.max} ${noun}`
}

/** One way to digivolve, in digi-pet's terms. */
function ruleText(r: Rule): string {
  if (r.jogress) return `<span class="k">/digi jogress</span> with ${esc(r.jogress)} · 15+ battles · 80%+ wins`
  const parts = [
    r.careMistakes && amount(r.careMistakes, 'care mistakes'),
    r.training && amount(r.training, 'training'),
    r.overfeed && amount(r.overfeed, 'overfeeds'),
    r.sleepDisturbances && amount(r.sleepDisturbances, 'sleep disturbances'),
    r.battles && amount(r.battles, 'battles'),
    r.winRatio && `${r.winRatio.min}%+ wins`,
  ].filter(Boolean) as string[]
  return parts.length ? parts.map(esc).join(' · ') : 'once its stage has lasted'
}

/** Every version as a tree: each Digimon by stage, lines to where it can go, and on each card what it takes to get there. */
function guideSection(): string {
  const versions = chart.versions.map((v, n) => {
    const egg = `egg${v.chart.slice(1)}`
    const roster = new Set([egg, ...v.ids.filter(id => SPECIES[id])])
    // Its own Digimon, and any its rules lead to from outside it.
    for (const id of [...roster]) for (const r of SPECIES[id]!.rules) if (SPECIES[r.to]) roster.add(r.to)
    const ids = [...roster]
    const into = (to: string) => ids.flatMap(from => SPECIES[from]!.rules.filter(r => r.to === to).map(r => ({ from, r })))
    const columns = GUIDE_STAGES.map(stage => {
      const here = ids.filter(id => SPECIES[id]!.stage === stage)
      if (!here.length) return ''
      const cards = here.map(id => {
        const s = SPECIES[id]!
        const ways = into(id)
        const byFrom = [...new Set(ways.map(w => w.from))].map(from => {
          const src = SPECIES[from]!
          const rules = ways.filter(w => w.from === from).map(w => w.r)
          const targets = [...new Set(src.rules.filter(r => !r.jogress).map(r => r.to))]
          const notes: string[] = []
          // The house rules: the Rookie's catch-all, and Chaos taking a Virus branch.
          if (src.stage === 'rookie' && src.rules[src.rules.length - 1]!.to === id) notes.push('or when no other branch fits')
          if (targets.length > 1 && s.attribute === 'Virus' && targets.find(t => SPECIES[t]?.attribute === 'Virus') === id) {
            notes.push(`or ${CHAOS_PER_DAY * (GATES[src.stage]?.days ?? 1)}+ chaos in ${esc(src.name)}'s stage`)
          }
          return `<li><b>from ${esc(src.name)}</b>${rules.map(r => `<div>${ruleText(r)}</div>`).join('<div class="or">or</div>')}${notes.map(t => `<div class="house">${t}</div>`).join('')}</li>`
        })
        // A Digimon no one in this version digivolves into: another version's, met here as a jogress partner.
        const key = (name: string) => name.replace(/\s+/g, '').toLowerCase()
        const partnerOf = ids.find(from => SPECIES[from]!.rules.some(r => r.jogress && key(r.jogress) === key(s.name)))
        if (!byFrom.length && stage !== 'egg') byFrom.push(`<li><b>from another version</b><div>${partnerOf ? `${esc(SPECIES[partnerOf]!.name)}'s jogress partner` : 'a jogress partner, not reached in this one'}</div></li>`)
        const outside = !v.ids.includes(id) && stage !== 'egg'
        const to = [...new Set(s.rules.map(r => r.to))].filter(t => roster.has(t))
        return `<div class="gnode${outside ? ' outside' : ''}" data-id="${id}" data-to="${to.join(',')}">
          <div class="head">${gridHtml(lcd(view(id as SpeciesId, 'full'), 0, 16))}<div><b>${esc(s.name)}</b><small class="attr ${s.attribute}">${esc(s.attribute)}${outside ? ' · another version' : ''}</small></div></div>
          ${byFrom.length ? `<ul>${byFrom.join('')}</ul>` : ''}</div>`
      })
      return `<div class="gcol"><h4>${GUIDE_LABEL[stage]}</h4><div class="gate">${gateText(stage)}</div>${cards.join('')}</div>`
    })
    return `<div class="gver" data-n="${n}"${n ? ' hidden' : ''}><div class="guide"><svg class="edges"></svg>${columns.join('')}</div></div>`
  })
  const tabs = chart.versions.map((v, n) => `<button data-n="${n}"${n ? '' : ' class="on"'}>${esc(v.version)}</button>`).join('')
  return `<section id="guide"><h2>Evolution guide</h2>
    <div class="legend">
      <p>Each card says what it takes to digivolve <b>into</b> that Digimon, counted since the pet entered its current stage. A stage must first last as long as its column says (at normal pace; <code>fast</code> a quarter, <code>slow</code> twice). Then the chart's branches are tried in order and the first that fits wins. Hover a card to light its way in and out.</p>
      <dl>
        <dt>care mistakes</dt><dd>a cache gone cold and picked up again the same day (one a session a day at most)</dd>
        <dt>training</dt><dd>turns where Claude used a tool, up to ${TRAINING_PER_DAY} a day</dd>
        <dt>overfeeds</dt><dd>the context crossing 85% full</dd>
        <dt>sleep disturbances</dt><dd>turns sent during rest hours</dd>
        <dt>battles · wins</dt><dd>a check gone red and green again in one turn is a win; one left red, a loss. The win ratio counts the pet's whole life; from 40% short of 80% a daily roll may let it through</dd>
        <dt>chaos</dt><dd>risky commands (force push, <code>--no-verify</code>, <code>reset --hard</code>, <code>rm -rf</code>) and interrupted turns</dd>
      </dl>
    </div>
    <div class="tabs">${tabs}</div>${versions.join('')}</section>`
}

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #0e0e10; color: #d0d0d4; font: 14px -apple-system, sans-serif; }
  h1 { margin: 0 0 4px; } h2 { margin: 36px 0 12px; color: #fff; } h3 { margin: 18px 0 6px; color: #b8b8be; font-weight: 600; }
  section { width: max-content; max-width: none; padding: 4px 8px 16px; }
  .win { width: max-content; background: #1c1c1f; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px #2a2a2e; }
  .bar { height: 32px; background: #232326; display: flex; align-items: center; gap: 8px; padding: 0 14px; color: #9a9a9e; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; } .bar span { margin-left: 10px; }
  .body { padding: 14px 22px; font: 15px/18px 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #e6e6e6; }
  .line { white-space: pre; height: 18px; } .dim { color: #8a8a8a; }
  .prompt { margin-top: 8px; border: 1px solid #4a4a50; border-radius: 6px; padding: 2px 10px; }
  .grid { font: 15px/18px 'JetBrains Mono', 'SF Mono', Menlo, monospace; }
  .row { white-space: pre; height: 18px; display: flex; }
  .row span { display: inline-block; width: 1ch; flex: none; text-align: center; }
  .row span.q { display: inline-grid; grid-template: 1fr 1fr / 1fr; height: 18px; }
  .row span.q i { display: block; }
  .cards { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; max-width: 1760px; }
  .card { background: #1c1c1f; padding: 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 4px; }
  .pair { display: flex; gap: 12px; align-items: center; }
  .pair img { width: 96px; height: 96px; image-rendering: pixelated; background: #dfe6cf; }
  .still { display: flex; flex-direction: column; gap: 4px; }
  .poserow { display: flex; gap: 14px; align-items: flex-end; margin: 10px 0; } .poserow b { width: 120px; }
  .sheet { width: 72px; image-rendering: pixelated; } small { color: #8a8a8a; } a { color: #61afef; }
  .chart { display: flex; gap: 14px; align-items: flex-start; }
  .stage { display: flex; flex-direction: column; gap: 10px; width: 250px; flex: none; }
  .stage:first-child { width: auto; }
  .stage h4 { margin: 0; color: #9a9a9e; font-weight: 600; }
  .mon { background: #1c1c1f; border-radius: 8px; padding: 8px; }
  .mon .head { display: flex; gap: 8px; align-items: center; }
  .mon .head > div:last-child { display: flex; flex-direction: column; }
  .mon ul { margin: 6px 0 0; padding: 0; list-style: none; font-size: 12px; }
  .mon li { margin-top: 4px; } .mon li div { color: #9a9a9e; } .mon .or { color: #555; font-style: italic; }
  .attr.Vaccine { color: #61afef; } .attr.Data { color: #98c379; } .attr.Virus { color: #c678dd; } .attr.Free { color: #e5c07b; }
  #guide .legend { max-width: 980px; color: #b8b8be; } #guide dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; } #guide dt { color: #e5c07b; } #guide dd { margin: 0; }
  #guide .tabs { display: flex; gap: 8px; margin: 16px 0; } #guide .tabs button { background: #232326; color: #d0d0d4; border: 1px solid #3a3a40; border-radius: 6px; padding: 6px 14px; font: inherit; cursor: pointer; }
  #guide .tabs button.on { background: #61afef; color: #0e0e10; border-color: #61afef; }
  .guide { position: relative; display: flex; gap: 56px; align-items: flex-start; }
  .guide .edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .guide .edges path { fill: none; stroke: #4a4a52; stroke-width: 1.5; } .guide .edges path.lit { stroke: #61afef; stroke-width: 2.5; }
  .gcol { display: flex; flex-direction: column; gap: 12px; width: 230px; flex: none; position: relative; }
  .gcol h4 { margin: 0; color: #fff; } .gcol .gate { color: #8a8a8a; font-size: 12px; margin-top: -8px; min-height: 16px; }
  .gnode { background: #1c1c1f; border: 1px solid #2a2a2e; border-radius: 8px; padding: 8px; position: relative; z-index: 1; }
  .gnode.outside { border-style: dashed; opacity: .8; } .gnode.lit { border-color: #61afef; } .gnode.dim { opacity: .35; }
  .gnode .grid { font-size: 7.5px; line-height: 9px; } .gnode .row, .gnode .row span.q { height: 9px; }
  .gnode .head { display: flex; gap: 8px; align-items: center; } .gnode .head > div:last-child { display: flex; flex-direction: column; }
  .gnode ul { margin: 6px 0 0; padding: 0; list-style: none; font-size: 12px; } .gnode li { margin-top: 6px; } .gnode li div { color: #b8b8be; }
  .gnode .or { color: #555; font-style: italic; } .gnode .house { color: #c678dd; } .gnode .k { color: #e5c07b; }
  table { border-collapse: collapse; } td, th { border: 1px solid #333; padding: 6px 10px; vertical-align: top; text-align: left; max-width: 340px; }
`

// Quadrants are top and bottom halves only (▀ ▄ █), so the grid is one column, two rows.
const SCRIPT = `
  // The guide: version tabs, lines from each card to where it can go, and a hover lighting a card's way in and out.
  const drawEdges = ver => {
    const box = ver.querySelector('.guide'), svg = ver.querySelector('.edges'), at = box.getBoundingClientRect()
    svg.innerHTML = ''
    for (const node of ver.querySelectorAll('.gnode')) for (const to of node.dataset.to.split(',').filter(Boolean)) {
      const dest = ver.querySelector('.gnode[data-id="' + to + '"]'); if (!dest) continue
      const a = node.getBoundingClientRect(), b = dest.getBoundingClientRect()
      const x1 = a.right - at.left, y1 = a.top - at.top + 22, x2 = b.left - at.left, y2 = b.top - at.top + 22, mx = (x1 + x2) / 2
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2)
      path.dataset.from = node.dataset.id; path.dataset.to = to
      svg.append(path)
    }
  }
  for (const b of document.querySelectorAll('#guide .tabs button')) b.onclick = () => {
    for (const x of document.querySelectorAll('#guide .tabs button')) x.classList.toggle('on', x === b)
    for (const v of document.querySelectorAll('.gver')) v.hidden = v.dataset.n !== b.dataset.n
    drawEdges(document.querySelector('.gver[data-n="' + b.dataset.n + '"]'))
  }
  for (const ver of document.querySelectorAll('.gver')) {
    if (!ver.hidden) drawEdges(ver)
    for (const node of ver.querySelectorAll('.gnode')) {
      node.onmouseenter = () => {
        const id = node.dataset.id, near = new Set([id])
        for (const p of ver.querySelectorAll('.edges path')) { const on = p.dataset.from === id || p.dataset.to === id; p.classList.toggle('lit', on); if (on) { near.add(p.dataset.from); near.add(p.dataset.to) } }
        for (const n of ver.querySelectorAll('.gnode')) { n.classList.toggle('lit', n === node); n.classList.toggle('dim', !near.has(n.dataset.id)) }
      }
      node.onmouseleave = () => {
        for (const p of ver.querySelectorAll('.edges path')) p.classList.remove('lit')
        for (const n of ver.querySelectorAll('.gnode')) n.classList.remove('lit', 'dim')
      }
    }
  }
  addEventListener('resize', () => { for (const v of document.querySelectorAll('.gver')) if (!v.hidden) drawEdges(v) })
  for (const a of document.querySelectorAll('.anim')) {
    const frames = [...a.children]; let i = 0
    setInterval(() => { frames[i].hidden = true; i = (i + 1) % frames.length; frames[i].hidden = false }, +a.dataset.ms)
  }
`

function html(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>digi-pet preview</title><style>${CSS}</style></head><body>
  <h1>digi-pet preview</h1><div class="dim">Every grid here is the one the mod draws (hooks/render.ts). Regenerate with <code>bun run preview</code>.</div>
  ${guideSection()}${chartSection()}${lineupSection()}${posesSection()}${spriteSection()}${filmstrip()}${miniSection()}${bandSection(80)}${bandSection(120)}${bandSection(160)}${paneSection(80)}${paneSection(144)}${alertSection()}
  <script>${SCRIPT}</script></body></html>`
}

function findChromium(): string {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  const dir = readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop()
  if (!dir) throw new Error('no Chromium found: set CHROMIUM')
  return join(root, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
}

async function shots(path: string) {
  const { chromium } = await import('playwright-core')
  const dir = join(OUT, 'shots')
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath: findChromium() })
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1 })
  await page.goto(`file://${path}`)
  // Stop the loops on a frame that shows the state at its loudest.
  await page.evaluate(() => {
    for (const a of document.querySelectorAll<HTMLElement>('.anim')) {
      const frames = [...a.children] as HTMLElement[]
      frames.forEach((f, i) => (f.hidden = i !== Math.min(frames.length - 1, 12)))
    }
  })
  for (const id of await page.$$eval('section', s => s.map(e => e.id))) {
    await page.locator(`#${id}`).screenshot({ path: join(dir, `${id}.png`) })
    console.log(`preview/shots/${id}.png`)
  }
  await browser.close()
}

/** The README's images: a still at `frame` (PNG) or the whole loop (GIF), of a card or a section. */
const README_SHOTS: { file: string; at: string; frame?: number }[] = [
  { file: 'fight.gif', at: '[data-shot="band-120-tool"]' },
  { file: 'battle-red.png', at: '[data-shot="band-120-red"]', frame: 2 },
  { file: 'battle-win.png', at: '[data-shot="band-120-win"]', frame: 1 },
  { file: 'hungry.png', at: '[data-shot="band-120-hungry"]', frame: 0 },
  { file: 'evolving.gif', at: '[data-shot="band-120-evolving"]' },
  { file: 'pane.png', at: '[data-shot="pane-144-full"]', frame: 0 },
  { file: 'lineup.png', at: '#lineup .cards' },
]

async function readmeShots(path: string) {
  const { chromium } = await import('playwright-core')
  const dir = join(ROOT, 'docs/images')
  const tmp = join(OUT, 'frames')
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath: findChromium() })
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1 })
  // Every loop stopped on frame `i` (its last, when it has fewer).
  const showFrame = (i: number) =>
    page.evaluate(i => {
      for (const a of document.querySelectorAll<HTMLElement>('.anim')) {
        const frames = [...a.children] as HTMLElement[]
        frames.forEach((f, j) => (f.hidden = j !== Math.min(frames.length - 1, i)))
      }
    }, i)
  for (const shot of README_SHOTS) {
    // The card alone on the page, so nothing around it moves while its frames change.
    await page.goto(`file://${path}`)
    await page.evaluate(at => {
      const card = document.querySelector(at)!
      document.body.replaceChildren(card)
      document.body.style.padding = '0'
      ;(card as HTMLElement).style.width = 'max-content'
      // The page's own loops would step the frames under the camera.
      for (let id = 0; id < 10_000; id++) clearInterval(id)
    }, shot.at)
    const el = page.locator('body > *').first()
    if (!shot.file.endsWith('.gif')) {
      await showFrame(shot.frame ?? 0)
      await el.screenshot({ path: join(dir, shot.file) })
    } else {
      const { n, ms } = await el.evaluate(e => {
        const a = e.querySelector<HTMLElement>('.anim')!
        return { n: a.children.length, ms: Number(a.dataset.ms) }
      })
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      for (let i = 0; i < n; i++) {
        await showFrame(i)
        await el.screenshot({ path: join(tmp, `${String(i).padStart(3, '0')}.png`) })
      }
      const ff = Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', String(1000 / ms), '-i', join(tmp, '%03d.png'), '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', join(dir, shot.file)])
      if (ff.exitCode !== 0) throw new Error(`ffmpeg: ${ff.stderr.toString()}`)
      rmSync(tmp, { recursive: true, force: true })
    }
    console.log(`docs/images/${shot.file}`)
  }
  await browser.close()
}

const args = process.argv.slice(2)
if (args[0] === '--term') {
  const [, id = 'agu', state, width] = args
  if (!(id in SPRITES)) throw new Error(`species: ${Object.keys(SPRITES).join(' ')}`)
  if (state && !STATES.includes(state as State)) throw new Error(`state: ${STATES.join(' ')}`)
  await term(id as SpeciesId, state as State | undefined, Number(width) || process.stdout.columns || 100)
} else if (args.includes('--html')) {
  mkdirSync(OUT, { recursive: true })
  const path = join(OUT, 'index.html')
  await Bun.write(path, html())
  console.log(`wrote ${path}`)
  if (args.includes('--shots')) await shots(path)
  if (args.includes('--readme')) await readmeShots(path)
} else {
  console.log('usage: bun scripts/preview.ts --html [--shots] | --term [species] [state] [width]')
}

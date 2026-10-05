// Crawls the Digital Monster Color evolution charts (Ver.1–5) from humulos.com's
// Digitama Hatchery into data/dmc.json: every species, its stage and attribute,
// which versions it belongs to, and each evolution with its requirements.
// Usage: bun scripts/crawl-humulos.ts        (pages are cached in sprites/raw/humulos; delete to refetch)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const CACHE = join(ROOT, 'sprites/raw/humulos')
const BASE = 'https://humulos.com/digimon'
const DEVICE = '15' // the site's number for Digital Monster Color
const UA = { 'User-Agent': 'digi-pet chart crawler (personal use; cached, one request at a time)' }

/** A requirement range: inclusive, `max` null when open ("16+"). */
export type Range = { min: number; max: number | null }
/** One way to meet an evolution: every listed requirement at once. */
export type Requirement = {
  careMistakes?: Range
  training?: Range
  overfeed?: Range
  sleepDisturbances?: Range
  battles?: Range
  winRatio?: Range
  jogress?: { with: string; version: string }
  /** What the parser did not recognise, word for word. */
  other: string[]
  raw: string
}
export type Evolution = { to: string; name: string; options: Requirement[] }
export type Species = {
  id: string
  name: string
  stage: string
  stageLabel: string
  attribute: string
  versions: string[]
  from: string[]
  evolvesTo: Evolution[]
  power: number | null
  hungerLossMinutes: number | null
  sprites: string[]
}

async function cached(name: string, url: string): Promise<string> {
  const path = join(CACHE, name)
  if (existsSync(path)) return readFileSync(path, 'utf8')
  await Bun.sleep(400)
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  writeFileSync(path, text)
  return text
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&bull;/g, '•').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const FIELDS: Record<string, keyof Omit<Requirement, 'jogress' | 'other' | 'raw'>> = {
  'care mistakes': 'careMistakes',
  'care mistake': 'careMistakes',
  training: 'training',
  overfeed: 'overfeed',
  overfeeds: 'overfeed',
  'sleep disturbances': 'sleepDisturbances',
  'sleep disturbance': 'sleepDisturbances',
  battles: 'battles',
  battle: 'battles',
  'win ratio': 'winRatio',
}

export function parseRequirement(raw: string): Requirement {
  const req: Requirement = { other: [], raw }
  for (const clause of raw.replace(/\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(Boolean)) {
    const jogress = clause.match(/^Jogress with (.+?) from (Ver\.\d+)$/i)
    if (jogress) {
      req.jogress = { with: jogress[1]!, version: jogress[2]! }
      continue
    }
    if (/^No requirements$/i.test(clause)) continue
    const m = clause.match(/^(\d+)%?\s*(?:-\s*(\d+)%?|(\+))?\s+(.+)$/)
    const field = m && FIELDS[m[4]!.toLowerCase()]
    if (!m || !field) {
      req.other.push(clause)
      continue
    }
    const min = Number(m[1])
    req[field] = { min, max: m[3] ? null : m[2] ? Number(m[2]) : min }
  }
  return req
}

function parseDetails(id: string, html: string): Omit<Species, 'versions'> {
  const name = text(html.match(/<p class="dub">([\s\S]*?)<\/p>/)?.[1] ?? id)
  const stageLabel = text(html.match(/<div class="text_center"><div>([\s\S]*?)<\/div>/)?.[1] ?? '')
  const attribute = html.match(/attribute="([^"]*)"/)?.[1] ?? ''
  const section = (title: string) => {
    const start = html.indexOf(`<h2>${title}</h2>`)
    if (start < 0) return ''
    const end = html.indexOf('<h2>', start + 4)
    return html.slice(start, end < 0 ? undefined : end)
  }
  const evolutions = (part: string): Evolution[] =>
    part
      .split('<div class="evolutions"')
      .slice(1)
      .map(chunk => {
        const to = chunk.match(/digimonShinkaUnified\('([^']+)'/)?.[1] ?? ''
        const evoName = text(chunk.match(/<h3 class="names">([\s\S]*?)<\/h3>/)?.[1] ?? to)
        const list = [...chunk.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1]!))
        const deets = text(chunk.match(/<p class="deets">([\s\S]*?)<\/p>/)?.[1] ?? '')
        const raws = list.length ? list : deets ? [deets] : []
        return { to, name: evoName, options: raws.map(parseRequirement) }
      })
  const num = (label: string) => {
    const m = html.match(new RegExp(`${label}:\\s*(\\d+)`))
    return m ? Number(m[1]) : null
  }
  return {
    id,
    name,
    stage: stageLabel.match(/Stage ([IVX+]+)/)?.[1] ?? '',
    stageLabel,
    attribute,
    from: evolutions(section('Evolves From')).map(e => e.to),
    evolvesTo: evolutions(section('Evolves To')),
    power: num('Power'),
    hungerLossMinutes: num('Hunger Loss'),
    sprites: [`${BASE}/images/dot/dmc/${id}.gif`, `${BASE}/images/dot/dmc/frame2/${id}.gif`],
  }
}

mkdirSync(CACHE, { recursive: true })
const page = await cached('dmc.html', `${BASE}/dmc/`)

// Each chart is one version's roster: its Digitama and every Digimon card under it.
const charts = page.split(/<div id="(c\d+)_anchor"/).slice(1)
const versions: { chart: string; version: string; digitama: string; ids: string[] }[] = []
for (let i = 0; i < charts.length; i += 2) {
  const chart = charts[i]!
  const body = charts[i + 1]!
  versions.push({
    chart,
    version: body.match(/<h4 class="rdisplay">([^<]*)<\/h4>/)?.[1] ?? chart,
    digitama: `${BASE}/images/dot/dmc/digitama_${chart}.gif`,
    ids: [...new Set([...body.matchAll(/digimonDetailsUnified\('([^']+)'/g)].map(m => m[1]!))],
  })
}

const species = new Map<string, Species>()
for (const v of versions) {
  for (const id of v.ids) {
    if (!species.has(id)) {
      const html = await cached(`${id}.html`, `${BASE}/php/details.php?digimon=${id}&device=${DEVICE}&version=`)
      species.set(id, { ...parseDetails(id, html), versions: [] })
    }
    species.get(id)!.versions.push(v.version)
  }
}

const out = {
  source: `${BASE}/dmc/`,
  note: 'Digital Monster Color evolution charts as Digitama Hatchery (humulos.com) documents them. Sprites © Bandai. Personal use only.',
  versions: versions.map(({ version, chart, digitama, ids }) => ({ version, chart, digitama, ids })),
  species: Object.fromEntries(species),
}
mkdirSync(join(ROOT, 'data'), { recursive: true })
writeFileSync(join(ROOT, 'data/dmc.json'), `${JSON.stringify(out, null, 2)}\n`)

// A report to check the crawl against the site.
const all = [...species.values()]
const byStage = Object.groupBy(all, s => s.stageLabel || '(none)')
console.log(`${all.length} species in ${versions.length} versions`)
for (const v of versions) console.log(`  ${v.version}: ${v.ids.length} Digimon`)
for (const [stage, list] of Object.entries(byStage)) console.log(`  ${stage}: ${list!.length}`)
const edges = all.flatMap(s => s.evolvesTo.map(e => ({ from: s, e })))
const branching = all.filter(s => s.evolvesTo.length > 1)
console.log(`${edges.length} evolution edges; ${branching.length} Digimon branch (2+ ways)`)
const unknown = new Set(edges.flatMap(({ e }) => e.options.flatMap(o => o.other)))
console.log(unknown.size ? `unparsed requirement clauses:\n  ${[...unknown].join('\n  ')}` : 'every requirement clause parsed')
const dangling = edges.filter(({ e }) => !species.has(e.to))
if (dangling.length) console.log(`evolutions to Digimon outside the charts: ${[...new Set(dangling.map(d => `${d.from.name}→${d.e.name}`))].join(', ')}`)
console.log('wrote data/dmc.json')

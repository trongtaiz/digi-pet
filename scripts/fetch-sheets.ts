// Downloads the full-colour dot sprite sheets (twelve poses each) of every species
// the chart has, from the community pack on Google Drive (withthewill.net thread
// 25843, "Full Color Digimon Dot Sprites"), to sprites/sheets/<id>.png. Species
// with no sheet keep the device's two idle frames. Run build-sprites.ts after.
// Usage: bun scripts/fetch-sheets.ts         (downloads are cached; sprites/sheets is gitignored)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Species } from './crawl-humulos'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'sprites/sheets')
const UA = { 'User-Agent': 'digi-pet sheet fetcher (personal use; cached, one request at a time)' }
/** The pack's folders by stage. */
const FOLDERS = {
  'Baby I': '1fIkCd1O51DAIFiptGOvq7FUrVdsLiRAD',
  'Baby II': '1oG_33fKaEVEywaNORokkcMMrxOu_GYTm',
  Child: '1vEM7Mx7s3-gJdkaH0G6DNHHcsz2llPAw',
  Adult: '1YMqbJpIob0fVKXbCrVuVD1q471mU7VTp',
  Perfect: '1rR1XNwE9-xg_zITn7xo2yN9527kF1_z8',
  'Ultimate/Super Ultimate': '1faVdHU3yKRuHOA_MFX41RaRNqwhkQsQt',
}
/** Where the chart's species is not the pack's plain name: the device's own variant. */
const ALIASES: Record<string, string> = { metalgrey_vi: 'MetalGreymon_Virus', omega_a: 'Omegamon_Alter-S' }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A folder's files, as Drive's embedded view lists them: name → file id. */
async function list(folder: string): Promise<Map<string, string>> {
  const html = await (await fetch(`https://drive.google.com/embeddedfolderview?id=${folder}`, { headers: UA })).text()
  const files = new Map<string, string>()
  for (const m of html.matchAll(/href="https:\/\/drive\.google\.com\/file\/d\/([^/]+)\/view[^"]*"[^>]*>[\s\S]*?flip-entry-title">([^<]+)</g)) files.set(m[2]!, m[1]!)
  return files
}

const chart = (await Bun.file(join(ROOT, 'data/dmc.json')).json()) as { species: Record<string, Species> }
const pack = new Map<string, { name: string; id: string }>()
for (const [stage, folder] of Object.entries(FOLDERS)) {
  const files = await list(folder)
  console.log(`${stage}: ${files.size} sheets`)
  for (const [name, id] of files) if (name.endsWith('.png')) pack.set(norm(name.replace(/\.png$/, '')), { name, id })
}

mkdirSync(OUT, { recursive: true })
const index: Record<string, { file: string; url: string }> = {}
const missing: string[] = []
for (const s of Object.values(chart.species)) {
  // The chart's English name, else its id as the Japanese name (vegi → Vegimon, piyo → Piyomon).
  const found = [ALIASES[s.id], s.name, `${s.id}mon`, s.id].filter((n): n is string => !!n).map(n => pack.get(norm(n))).find(Boolean)
  if (!found) {
    missing.push(s.name)
    continue
  }
  const url = `https://drive.google.com/uc?export=download&id=${found.id}`
  const path = join(OUT, `${s.id}.png`)
  if (!existsSync(path)) {
    await Bun.sleep(200)
    const res = await fetch(url, { headers: UA })
    if (!res.ok) throw new Error(`${found.name}: HTTP ${res.status}`)
    await Bun.write(path, await res.arrayBuffer())
  }
  index[s.id] = { file: found.name, url }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
console.log(`✓ ${Object.keys(index).length} of ${Object.keys(chart.species).length} species have a sheet; none for: ${missing.join(', ')}`)

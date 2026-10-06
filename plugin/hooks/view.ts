// The pet as plain data, what the hooks hand a drawing (a Client module's props
// must be JSON): the species by id instead of its sprite.
import { EVOLVE_FRAMES } from './render'
import type { Act, AllyView, Attribute, Hunger, Mood, PaneView, PetView } from './render'
import { SPRITES } from './sprites.gen'
import type { Sprite } from './sprite'

export type ViewJson = {
  species: string
  hunger: Hunger
  minutesLeft: number
  ttlMinutes: number
  mood: Mood
  attribute: Attribute | null
  project: string
  quiet?: string
  /** A digivolution to show (`/digi sim … evolving <to>`). */
  evolvingTo?: string
  act?: Act
  tool?: string
  next?: { label: string; ratio: number } | null
  allies?: AllyJson[]
}

/** An ally as a drawing's props carry it: the species by id. */
export type AllyJson = { species: string; label: string; leaving?: 'done' | 'failed' }

export function allyViews(allies: readonly AllyJson[]): AllyView[] {
  return allies.map(({ species, ...rest }) => ({ ...rest, sprite: spriteOf(species) }))
}

export type PaneJson = ViewJson & { careMistakes: number; facts: string[] } & Pick<PaneView, 'stats' | 'battles' | 'ageDays' | 'log' | 'trophies' | 'weight'>

export function spriteOf(id: string): Sprite {
  return (SPRITES as Record<string, Sprite>)[id] ?? SPRITES.bota
}

export function isSpecies(id: string): boolean {
  return id in SPRITES
}

/** The view at frame `t`; a digivolution loops, holding its end a while. */
export function petView(v: ViewJson, t: number): PetView {
  const { species, evolvingTo, allies, ...rest } = v
  return {
    ...rest,
    ...(allies ? { allies: allyViews(allies) } : {}),
    sprite: spriteOf(species),
    evolving: evolvingTo ? { to: spriteOf(evolvingTo), t: t % (EVOLVE_FRAMES + 8) } : undefined,
  }
}

export function paneView(v: PaneJson, t: number): PaneView {
  return { ...petView(v, t), careMistakes: v.careMistakes, facts: v.facts, stats: v.stats, battles: v.battles, ageDays: v.ageDays, log: v.log, trophies: v.trophies, weight: v.weight }
}

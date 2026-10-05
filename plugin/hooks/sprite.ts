/** What the pet is doing in a frame: a full sheet has frames for each, the device's own sprite only the idle two. */
export type Pose = 'idle' | 'eat' | 'sleep' | 'refuse' | 'happy' | 'angry' | 'hurt' | 'attack'

/** A species' sprite as build-sprites.ts writes it: each frame 16 rows of palette keys, `.` clear. */
export type Sprite = {
  name: string
  stage: string
  source: string
  palette: string[]
  frames: string[][]
  /** Which frames each pose shows; without it every frame is idle. */
  poses?: Partial<Record<Pose, number[]>>
}

/** Whether the sprite has frames of its own for `pose`. */
export function hasPose(sprite: Sprite, pose: Pose): boolean {
  return !!sprite.poses?.[pose]?.length
}

const KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A frame of a pose as colours, `undefined` where clear; a pose the sprite has no frames for shows idle. */
export function pixels(sprite: Sprite, frame: number, pose: Pose = 'idle'): (string | undefined)[][] {
  const list = sprite.poses?.[pose] ?? sprite.poses?.idle ?? sprite.frames.map((_, i) => i)
  const rows = sprite.frames[list[((frame % list.length) + list.length) % list.length]!]!
  return rows.map(row => [...row].map(ch => (ch === '.' ? undefined : sprite.palette[KEYS.indexOf(ch)])))
}

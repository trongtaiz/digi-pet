// The fight across the band while a turn runs, on the drawing thread: a frame
// every 120 ms, faster than the pet's screen, so the shots fly. A check gone red
// is a boss on the field until it passes again; reduced motion holds it still.
import type { ClientModule } from 'claude-code'

import { segments } from './cells'
import { arena } from './render'
import type { Act, Fight } from './render'

export const ARENA_MS = 120

export type ArenaProps = { width: number; act: Act; fight: Fight; isStill: boolean }

const Arena: ClientModule<ArenaProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let tick = 0
    if (!props.isStill) surface.every(ARENA_MS, () => surface.setState(++tick))
    surface.setState(0)
  }
  const width = Math.max(8, Math.min(surface.columns || props.width, props.width))
  const rows = arena(surface.state ?? 0, width, props.act, props.fight)

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">
          {segments(row).map(seg => (
            <Text color={seg.c} backgroundColor={seg.bg} bold={seg.b} dimColor={seg.d}>
              {seg.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Arena

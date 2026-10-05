// The pet's screen, animated on the drawing thread: the loud band (a hungry pet,
// a meal, a digivolution) and the pane. A frame every half second, as a V-Pet's;
// with reduced motion, the first frame only.
import type { ClientModule } from 'claude-code'

import { segments } from './cells'
import { band, pane } from './render'
import { paneView, petView } from './view'
import type { PaneJson, ViewJson } from './view'

export const FRAME_MS = 500

export type ScreenProps = ({ kind: 'band'; width: number; maxRows: number; view: ViewJson } | { kind: 'pane'; width: number; view: PaneJson }) & { isStill: boolean }

const Screen: ClientModule<ScreenProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    let tick = 0
    if (!props.isStill) surface.every(FRAME_MS, () => surface.setState(++tick))
    surface.setState(0)
  }
  const t = surface.state ?? 0
  const width = props.kind === 'band' ? props.width : Math.max(40, Math.min(surface.columns || props.width, props.width))
  const rows = props.kind === 'pane' ? pane(paneView(props.view, t), t, width) : band(petView(props.view, t), t, width, props.maxRows)

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

export default Screen

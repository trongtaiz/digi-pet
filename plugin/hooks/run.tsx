// The tool running, on its row under the pet: what it runs and, once a second,
// how long it has been at it. Keyed by the call, so the time starts with it;
// with reduced motion, no time.
import type { ClientModule } from 'claude-code'

import { segments } from './cells'
import { toolRow } from './render'

export type RunProps = { width: number; tool: string; text: string; isStill: boolean }

const Run: ClientModule<RunProps, number> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    let secs = 0
    if (!props.isStill) surface.every(1000, () => surface.setState(++secs))
    surface.setState(0)
  }
  const width = Math.max(20, Math.min(surface.columns || props.width, props.width))
  const [row] = toolRow(props, width, props.isStill ? undefined : (surface.state ?? 0))
  return (
    <Text wrap="truncate">
      {segments(row!).map(seg => (
        <Text color={seg.c} backgroundColor={seg.bg} bold={seg.b} dimColor={seg.d}>
          {seg.text}
        </Text>
      ))}
    </Text>
  )
}

export default Run

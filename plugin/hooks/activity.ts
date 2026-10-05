// What a running turn is doing, for the pet's bubble. `toolLabel` and
// `busyLabel` are after hoobnn's spinner mod (claude-code/spinner/hooks/pet.ts,
// https://github.com/hoobnn/hoobnn-agent-mods, MIT © 2026 hoobnn).
import { textWidth } from './cells'

/** What a tool call is about, short: `Bash: npm test`, `Edit: render.ts`, `WebSearch`. */
export function toolLabel(e: { tool: string } & Record<string, unknown>): string {
  const clip = (s: string) => (textWidth(s) > 32 ? `${Array.from(s).slice(0, 31).join('')}…` : s)
  if (typeof e.command === 'string') return clip(`${e.tool}: ${e.command.split('\n')[0]!.trim()}`)
  const path = [e.file_path, e.notebook_path, e.path].find(p => typeof p === 'string') as string | undefined
  if (path) return clip(`${e.tool}: ${path.split('/').pop()}`)
  if (typeof e.pattern === 'string') return clip(`${e.tool}: ${e.pattern}`)
  if (typeof e.description === 'string' && e.description.trim()) return clip(`${e.tool}: ${e.description.trim()}`)
  return clip(e.tool.replace(/^mcp__[^_]+__/, ''))
}

/** The bubble for the calls running now: subagents side by side are counted, else the latest call. */
export function busyLabel(labels: readonly string[]): string | undefined {
  const agents = labels.filter(label => /^(?:Agent|Task)\b/.test(label))
  return agents.length > 1 ? `Agent ×${agents.length}` : labels[labels.length - 1]
}

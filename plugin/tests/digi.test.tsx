import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MIN = 60_000
// The machine's clock is UTC here (`date +%z` answers +0000): Monday 2026-10-05 at hh:mm.
const at = (hm: string, day = '2026-10-05') => Date.parse(`${day}T${hm}:00Z`)

const START = { cwd: '/Users/me/work/my-app', surface: 'terminal', isInteractive: true } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const
const HIT = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 500, model: 'claude' }
const MISS = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 90_000, model: 'claude' }

let toasts: string[] = []
let notes: string[][] = []
let status: (string | undefined)[] = []
// What a tool call answers; a test sets it to fail or pass a check.
let toolAnswer: (e: { tool: string; command?: string }) => { result: string; text: string } = () => ({ result: 'out', text: 'out' })
// The plugin's store, kept here so a test can read what it wrote.
let kept = new Map<string, unknown>()
// The session's id: a /clear goes on under another.
let sessionId = 's1'

function host(on: On, now: number, stored: Record<string, unknown> = {}) {
  toasts = []
  notes = []
  status = []
  toolAnswer = () => ({ result: 'out', text: 'out' })
  const clock = mock.clock(on, { now })
  // A Botamon unless the test keeps another pet (or none: an egg).
  kept = new Map(Object.entries({ pet: { species: 'bota' }, ...stored }))
  sessionId = 's1'
  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.set', ($, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    kept.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...kept.keys()] }))
  mock.env(on, { HOME: '/Users/me' })
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: START.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'osascript') notes.push([...e.argv])
    const stdout = e.argv[0] === 'date' ? '+0000\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.edit', ($, e) => ({ text: e.text, cursor: e.cursor }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', async ($, e) => {
    await clock.sleep(1000)
    return toolAnswer(e as never)
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="core">
        <Text>core</Text>
      </Box>
    )
  })
  return clock
}

/** The pet's own screen among the band's Clients (the arena is another). */
function petScreen(list: unknown): { key?: string } {
  return (list as { key?: string }[]).find(c => c.key?.startsWith('band-'))!
}

/** A turn of the main loop: the prompt, one request (answered as `stepWith` says), the end. */
async function turn($: Engine) {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude', messageCount: 3 } as never)
  // The request's answer, as the engine's stream would end it.
  for await (const _ of stream) void _
  await stream.result
  await $.turn.complete({ turnId: 't', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false } as never)
}

function stepWith(on: On, usage: () => typeof HIT) {
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: 'done', toolUses: [], stopReason: 'end_turn' as const, usage: usage() }
  })
}

async function start($: Engine) {
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 100_000, window: 200_000 }, rateLimits: [], changed: ['context'] } as never)
}

test('a hungry pet yells once per level, then a cold cache picked up the same day is one care mistake', async ($, on) => {
  const clock = host(on, at('09:00'))
  let usage = HIT
  stepWith(on, () => usage)
  await start($)
  await turn($)

  await clock.advance(44 * MIN)
  expect(toasts).toHaveLength(0)
  await clock.advance(1 * MIN + 15_000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Botamon is hungry')
  expect(toasts[0]).toContain('my-app')
  // The notification carries title and body as arguments, never inside the script.
  expect(notes).toHaveLength(1)
  expect(notes[0]!.slice(0, 7)).toEqual(['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run'])
  expect(notes[0]![7]).toBe('Botamon is hungry')

  await clock.advance(10 * MIN)
  expect(toasts).toHaveLength(2)
  expect(toasts[1]).toContain('starving')
  expect(notes).toHaveLength(2)
  expect(status.some(s => s?.includes('cache cold in'))).toBe(true)

  // Cold: no more yelling.
  await clock.advance(20 * MIN)
  expect(toasts).toHaveLength(2)
  expect(status[status.length - 1]).toBeUndefined()

  // Back at 10:30 to a cache that had to be rebuilt: sick, one care mistake.
  await clock.set(at('10:30'))
  usage = MISS
  await turn($)
  expect(toasts.some(t => t.includes('got sick'))).toBe(true)
  const ledger = (kept.get('ledger:s1')) as Record<string, { careMistakes: number; turns: number; cacheMisses: number }>
  expect(ledger['2026-10-05']!.careMistakes).toBe(1)
  expect(ledger['2026-10-05']!.cacheMisses).toBe(1)
  expect(ledger['2026-10-05']!.turns).toBe(2)

  // Cold again before lunch, picked up at 11:40: no second mistake today.
  await clock.set(at('11:40'))
  await turn($)
  const again = (kept.get('ledger:s1')) as Record<string, { careMistakes: number }>
  expect(again['2026-10-05']!.careMistakes).toBe(1)
})

test('a meal while hungry feeds it: no starving alert for the old cache', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  await clock.advance(46 * MIN)
  expect(toasts).toHaveLength(1)
  await turn($)
  await clock.advance(10 * MIN)
  expect(toasts).toHaveLength(1)
  // The new meal's own hunger comes 45 minutes after it.
  await clock.advance(36 * MIN)
  expect(toasts).toHaveLength(2)
  expect(toasts[1]).toContain('hungry')
})

test('quiet before lunch, napping through it, and no mistake after it', async ($, on) => {
  const clock = host(on, at('11:10'))
  let usage = HIT
  stepWith(on, () => usage)
  await start($)
  await turn($)
  // Lunch starts before the cache would go cold at 12:10: no yelling.
  await clock.advance(50 * MIN)
  expect(toasts).toHaveLength(0)
  expect(notes).toHaveLength(0)

  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  const screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(JSON.stringify(await ui.drawn({ in: screens[0]!.key! }))).toContain('resting until 14:00')
  await ui.unmount()

  await clock.set(at('14:20'))
  usage = MISS
  await turn($)
  expect(toasts.some(t => t.includes('got sick'))).toBe(false)
})

test('a side session never gets hungry, and a break ends with the next prompt', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'side' })).text).toContain('Side session')
  await turn($)
  // Not hungry, but it still says when the cache goes cold.
  await clock.advance(18 * MIN)
  expect((await $.command.run({ ...RUN, command: 'digi', args: '' })).text).toContain('Hunger: side session · cache 42m left (cold at 10:00)')
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn({ in: ((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key! }))).toContain('cache 42m left')
  await ui.unmount()
  await clock.advance(40 * MIN)
  expect(toasts).toHaveLength(0)
  expect(kept.get('side:s1')).toBe(true)
  await clock.advance(3 * MIN)
  expect((await $.command.run({ ...RUN, command: 'digi', args: '' })).text).toContain('Hunger: side session · cache cold')
  expect(toasts).toHaveLength(0)

  await $.command.run({ ...RUN, command: 'digi', args: 'side off' })
  await turn($)
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'break 90m' })).text).toContain('On break until 11:31')
  await clock.advance(58 * MIN)
  expect(toasts).toHaveLength(0)
  expect(notes).toHaveLength(0)
})

test('a side session from sidePaths, and the hungry band draws the pet on its screen', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  await clock.advance(46 * MIN)

  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  const screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(screens).toHaveLength(1)
  const drawn = JSON.stringify(await ui.drawn({ in: screens[0]!.key! }))
  expect(drawn).toContain("I'm hungry!")
  expect(drawn).toContain('▀')
  await ui.unmount()

  // Too short a band: one row, no screen.
  const small = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 4 } })
  expect(await small.findAll({ type: 'Client' })).toHaveLength(0)
  expect(JSON.stringify(await small.findAll({ type: 'Text' }))).toContain('Botamon')
  await small.unmount()
})

test('sidePaths makes a session under them a side session', { options: { sidePaths: '~/work/**' } }, async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  await clock.advance(58 * MIN)
  expect(toasts).toHaveLength(0)
  expect((await $.command.run({ ...RUN, command: 'digi', args: '' })).text).toContain('side session')
  const stats = (await $.command.run({ ...RUN, command: 'digi', args: 'stats' })).text
  expect(stats).toContain('Today here: 1 turns')
  expect(stats).toContain('All time: 1 turns')
})

test('/digi sim shows any species in any state, and debug ttl shortens the cache', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'sim grey starving' })).text).toContain('Greymon')
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  const screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(JSON.stringify(await ui.drawn({ in: screens[0]!.key! }))).toContain('STARVING')
  await ui.unmount()
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'sim nobody' })).text).toContain('No species')
  await $.command.run({ ...RUN, command: 'digi', args: 'sim off' })

  // A 2-minute TTL starves for only 10 s: the tick still lands in it.
  await $.command.run({ ...RUN, command: 'digi', args: 'debug ttl 2' })
  await turn($)
  await clock.advance(105_000)
  expect(toasts[0]).toContain('hungry')
  await clock.advance(10_000)
  expect(toasts[1]).toContain('starving')
  await clock.advance(10_000)
  expect(toasts).toHaveLength(2)
  await $.command.run({ ...RUN, command: 'digi', args: 'debug ttl off' })
  expect(kept.get('debugTtlMinutes')).toBe(null)
})

test('the pet is on its screen at all times: at work during a turn, idling between turns', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  const WORKING = { ...BAND, props: { ...BAND.props, isWorking: true } }

  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  let ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING })
  let screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  // The fight on the left, the pet on the right.
  expect(screens.map(c => c.key)).toEqual(['arena-think-0', 'band-bota-think'])
  expect(JSON.stringify(await ui.drawn({ in: 'arena-think-0' }))).toContain('WINS 0')
  expect(JSON.stringify(await ui.drawn({ in: 'band-bota-think' }))).toContain('Thinking')
  await ui.unmount()

  // A tool running: what it runs on a row of its own under the pet, the pet's own words in the bubble, two lanes of monsters.
  const call = $.tool.call({ tool: 'Bash', command: 'npm test -- --run src/session', description: 'run tests' } as never)
  await clock.advance(10)
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING })
  screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(JSON.stringify(await ui.drawn({ in: petScreen(screens).key! }))).toContain('Fighting!')
  expect(screens.some(c => c.key === 'arena-tool-0')).toBe(true)
  const run = screens.find(c => c.key?.startsWith('run-'))!
  expect(JSON.stringify(await ui.drawn({ in: run.key! }))).toContain('npm test -- --run src/session')
  await ui.unmount()

  // Nine rows: no room for the row under the Digivice, so the bubble says it, as before.
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING, props: { ...WORKING.props, maxRows: 9 } })
  screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(screens.some(c => c.key?.startsWith('run-'))).toBe(false)
  expect(JSON.stringify(await ui.drawn({ in: petScreen(screens).key! }))).toContain('Bash: npm test')
  await ui.unmount()

  // Too narrow for a fight worth seeing: the pet alone, what it runs still under it.
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING, props: { ...WORKING.props, bodyColumns: 70 } })
  screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(screens.map(c => c.key?.replace(/^run-.*/, 'run'))).toEqual(['band-bota-tool', 'run'])
  await ui.unmount()
  await clock.advance(1000)
  await call

  // The turn over: the pet stays on its screen, idling, with no bubble about work.
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false } as never)
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  expect(screens).toHaveLength(1)
  const idle = JSON.stringify(await ui.drawn({ in: screens[0]!.key! }))
  expect(idle).toContain('Botamon')
  expect(idle).toContain('▀')
  expect(idle).not.toContain('Bash: npm test')
  await ui.unmount()

  // A short band (a long prompt takes rows from it): the four-row mini screen, the pet still there.
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 5 } })
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  const mini = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(mini).toContain('Botamon')
  expect(mini).toContain('▀')
  await ui.unmount()

  // Typing a slash command: one row, never gone.
  // The engine raises prompt.edit as the person types; a test raises it the same way.
  const typed = $.prompt as unknown as { edit: (e: object) => Promise<unknown> }
  await typed.edit({ origin: { kind: 'composer' }, text: '/dig', cursor: 4, start: 4, end: 4, inputText: 'g' })
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('Botamon')
  await ui.unmount()
})

test('a meal between two ticks: the screen still draws (the drawing clock never lags the last meal)', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  // Less than a tick: the clock the band draws from still says 09:00 when the meal lands.
  await clock.advance(10_000)
  await turn($)
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  const screens = (await ui.findAll({ type: 'Client' })) as { key?: string }[]
  const drawn = JSON.stringify(await ui.drawn({ in: screens[0]!.key! }))
  expect(drawn).toContain('Botamon')
  expect(drawn).toContain('♥♥♥♥')
  await ui.unmount()
})

/** Yesterday's counters for a session that is not this one: what the pet grew from. */
const yesterday = (c: Record<string, number>) => ({ 'ledger:old': { '2026-10-04': c } })

test('the pet digivolves after a turn once its stage has lasted: the band plays it, a toast and a notification say it', async ($, on) => {
  const clock = host(on, at('09:00'), yesterday({ turns: 24, toolTurns: 10 }))
  stepWith(on, () => HIT)
  await start($)
  expect(kept.get('pet')).toEqual({ species: 'bota' })
  await turn($)
  expect(toasts).toContain('Botamon digivolved to Koromon!')
  expect(notes.some(n => n.includes('Botamon digivolved to Koromon!'))).toBe(true)
  const pet = kept.get('pet') as { species: string; base: { turns: number }; log: { id: string }[] }
  expect(pet.species).toBe('koro')
  expect(pet.base.turns).toBe(25)
  expect(pet.log).toEqual([{ id: 'koro', day: '2026-10-05' }])

  let ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe('band-bota-loud')
  expect(JSON.stringify(await ui.drawn({ in: 'band-bota-loud' }))).toContain('digivolving')
  await ui.unmount()
  // The digivolution over: Koromon, and the way on to Rookie.
  await clock.advance(30_000)
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await ui.drawn({ in: 'band-koro-idle' }))
  expect(drawn).toContain('Koromon')
  await ui.unmount()

  const stats = (await $.command.run({ ...RUN, command: 'digi', args: 'stats' })).text!
  expect(stats).toContain('Koromon (baby2)')
  expect(stats).toContain('Next: day 0/2 · turns 0/100 → Rookie')
  expect(stats).toContain('Evolution: Koromon (2026-10-05)')
  // One stage a turn: the next turn does not take it further.
  await turn($)
  expect((kept.get('pet') as { species: string }).species).toBe('koro')
})

test('a second session draws the pet the first one digivolved, at start and on its next tick', async ($, on) => {
  const base = { turns: 30, activeDays: 1, careMistakes: 0, training: 10, overfeed: 0, sleepDisturbances: 0, battles: 0, wins: 0 }
  const clock = host(on, at('09:00'), { ...yesterday({ turns: 30, toolTurns: 10 }), pet: { species: 'koro', enteredDay: '2026-10-04', base, log: [{ id: 'koro', day: '2026-10-04' }] } })
  stepWith(on, () => HIT)
  await start($)
  let ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe('band-koro-idle')
  await ui.unmount()
  // Another session writes Agumon: this one follows on its next tick, with no digivolution of its own.
  kept.set('pet', { species: 'agu', enteredDay: '2026-10-05', base: { ...base, turns: 130, activeDays: 3 }, log: [] })
  await clock.advance(15_000)
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe('band-agu-idle')
  await ui.unmount()
  expect(toasts.filter(t => t.includes('digivolved'))).toHaveLength(0)
})

test('battles: a check gone red and green again in a turn is won, one left red is lost, an interrupted turn counts neither', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  const runs: string[] = []
  toolAnswer = () => ({ result: 'out', text: runs.shift() ?? 'out' })
  const fight = async (outputs: string[], reason = 'answer') => {
    runs.push(...outputs)
    await $.turn.start({ text: 'go', turnId: 't' } as never)
    for (const _ of outputs) {
      const call = $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail', description: 'test' } as never)
      await clock.advance(1000)
      await call
    }
    await $.turn.complete({ turnId: 't', reason, answer: 'done', durationMs: 60_000, isAborted: reason === 'aborted' } as never)
  }
  await fight(['Tests: 2 failed, 8 passed', 'Tests: 10 passed'])
  await fight(['Tests: 1 failed, 9 passed'])
  await fight(['Tests: 1 failed, 9 passed'], 'aborted')
  await fight(['Tests: 10 passed'])
  const day = (kept.get('ledger:s1') as Record<string, Record<string, number>>)['2026-10-05']!
  expect([day.battlesWon, day.battlesLost, day.checksPassed, day.toolTurns, day.activeMs]).toEqual([1, 1, 2, 4, 4 * 60_000])
  const stats = (await $.command.run({ ...RUN, command: 'digi', args: 'stats' })).text!
  expect(stats).toContain('Battles this stage: 1W 1L · win ratio 50% over every battle')
  expect(stats).toContain('DEF 4')
})

test('an overfeed is the context crossing 85%, once until it has dropped again', async ($, on) => {
  host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  const fill = (percent: number) => $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] } as never)
  for (const p of [80, 86, 90, 84, 88, 40, 87]) await fill(p)
  const day = (kept.get('ledger:s1') as Record<string, Record<string, number>>)['2026-10-05']!
  expect(day.overfeeds).toBe(2)
})

test('/digi pane draws the growth: stats, the way to the next stage, and the evolution so far', async ($, on) => {
  const clock = host(on, at('09:00'), yesterday({ turns: 24, toolTurns: 10, research: 40, prompts: 20, battlesWon: 2, battlesLost: 1 }))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  // Past the digivolution the band plays.
  await clock.advance(30_000)
  const pane = { component: 'Pane', requestId: 'digi', props: { title: 'digi-pet', isFocused: true, bodyColumns: 100, placement: 'inline' } }
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...pane } as never)
  const drawn = JSON.stringify(await ui.drawn({ in: 'pane' }))
  for (const text of ['Koromon', 'Baby II', 'INT', 'SYN', 'Next', 'turns 0/100', 'Evolution: Koromon (2026-10-05)']) expect(drawn).toContain(text)
  await ui.unmount()
})

/** A turn of tool calls, each answered as `answers` says, the mock clock moved along for each. */
async function toolTurn($: Engine, clock: { advance: (ms: number) => Promise<void> }, calls: [Record<string, unknown>, string][], reason = 'answer', durationMs = 120_000) {
  const answers = calls.map(([, text]) => text)
  toolAnswer = () => ({ result: 'out', text: answers.shift() ?? 'out' })
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  for (const [call] of calls) {
    const done = $.tool.call(call as never)
    await clock.advance(1000)
    await done
  }
  await $.turn.complete({ turnId: 't', reason, answer: 'done', durationMs, isAborted: reason === 'aborted' } as never)
}

const today = () => (kept.get('ledger:s1') as Record<string, Record<string, number>>)['2026-10-05']!

test('no pet yet is a random egg, kept as soon as it is drawn; it hatches into its version\'s baby after three turns', async ($, on) => {
  const clock = host(on, at('09:00'), { pet: null })
  stepWith(on, () => HIT)
  await start($)
  const egg = (kept.get('pet') as { species: string }).species
  expect(['egg1', 'egg2', 'egg3', 'egg4', 'egg5']).toContain(egg)
  const baby = { egg1: ['Ver.1', 'Botamon', 'bota'], egg2: ['Ver.2', 'Punimon', 'puni'], egg3: ['Ver.3', 'Poyomon', 'poyo'], egg4: ['Ver.4', 'Yuramon', 'yura'], egg5: ['Ver.5', 'Zurumon', 'zuru'] }[egg]!
  let ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe(`band-${egg}-idle`)
  await ui.unmount()
  await turn($)
  await turn($)
  // The same egg turn after turn: drawn once, never re-rolled.
  expect((kept.get('pet') as { species: string }).species).toBe(egg)
  expect(toasts.some(t => t.includes('hatched'))).toBe(false)
  await turn($)
  expect(toasts).toContain(`${baby[0]} Digitama hatched into ${baby[1]}!`)
  await clock.advance(30_000)
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe(`band-${baby[2]}-idle`)
  await ui.unmount()
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'stats' })).text).toContain('turns 3/25 → Baby II')
})

test('trophies need proof, summons count, risky moves and interrupts are chaos, a quick turn is speed', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  await toolTurn(
    $,
    clock,
    [
      [{ tool: 'Bash', command: 'git commit -m "x"' }, '[main 1a2b3c4] x'],
      [{ tool: 'Bash', command: 'git commit -m "y"' }, 'nothing to commit, working tree clean'],
      [{ tool: 'Bash', command: 'gh pr create --fill' }, 'https://github.com/me/app/pull/7'],
      [{ tool: 'Bash', command: 'git -C /Users/me/app commit -m "z" && glab mr create --fill --yes' }, '[feat/z 5e6f7a8] z\n https://gitlab.com/me/app/-/merge_requests/12'],
      [{ tool: 'mcp__gitlab__create_merge_request', title: 'z' }, '{"iid":13}'],
      [{ tool: 'Agent', prompt: 'look around', description: 'look' }, 'found it'],
      [{ tool: 'Bash', command: 'git push --force' }, ''],
      [{ tool: 'Bash', command: 'rm -rf /tmp/scratch' }, ''],
    ],
    'answer',
    30_000,
  )
  await toolTurn($, clock, [[{ tool: 'Read', file_path: '/a' }, 'x']], 'aborted')
  expect([today().trophies, today().summons, today().chaos, today().quickTurns, today().research]).toEqual([5, 1, 2, 1, 1])
  const stats = (await $.command.run({ ...RUN, command: 'digi', args: 'stats' })).text!
  expect(stats).toContain('2 chaos · 5 trophies · 1 summons')
  expect(stats).toContain('5 trophies ever')
})

test('/digi pet makes it happy and counts for SYN; /digi log lists its forms; /digi jogress waits for a Mega', async ($, on) => {
  host(on, at('09:00'), { pet: { species: 'koro', enteredDay: '2026-10-04', base: {}, log: [{ id: 'bota', day: '2026-10-03' }, { id: 'koro', day: '2026-10-04' }] } })
  stepWith(on, () => HIT)
  await start($)
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'pet' })).text).toContain('Koromon is happy!')
  expect(today().pats).toBe(1)
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn({ in: 'band-koro-idle' }))).toContain('Thanks for the pat')
  await ui.unmount()
  const log = (await $.command.run({ ...RUN, command: 'digi', args: 'log' })).text!
  expect(log).toContain('2026-10-03  Botamon')
  expect(log).toContain('2026-10-04  Koromon')
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'jogress' })).text).toContain('no jogress partner')
})

test('a Mega that has fought enough jogresses with its partner', async ($, on) => {
  const life = { 'ledger:old': { '2026-09-01': { turns: 400, battlesWon: 20, battlesLost: 2 } } }
  host(on, at('09:00'), { ...life, pet: { species: 'blitzgrey', enteredDay: '2026-08-01', base: {}, log: [] } })
  // Fourteen active days in its stage.
  for (let d = 10; d < 24; d++) (kept.get('ledger:old') as Record<string, unknown>)[`2026-09-${d}`] = { turns: 5 }
  stepWith(on, () => HIT)
  await start($)
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'jogress' })).text).toBe('BlitzGreymon and Cres Garurumon jogressed into Omnimon Alter-S!')
  expect((kept.get('pet') as { species: string }).species).toBe('omega_a')
  expect(notes.some(n => n.includes('BlitzGreymon and Cres Garurumon jogressed into Omnimon Alter-S!'))).toBe(true)
})

test('a red check is a boss on the field until it passes; the win blows it up', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  await start($)
  const WORKING = { ...BAND, props: { ...BAND.props, isWorking: true } }
  toolAnswer = () => ({ result: 'out', text: 'Tests: 2 failed, 8 passed' })
  await $.turn.start({ text: 'go', turnId: 't' } as never)
  let call = $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail', description: 'test' } as never)
  await clock.advance(1000)
  await call
  let ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING })
  expect(JSON.stringify(await ui.drawn({ in: 'arena-think-0' }))).toContain('1 check red')
  await ui.unmount()
  toolAnswer = () => ({ result: 'out', text: 'Tests: 10 passed' })
  call = $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail', description: 'test' } as never)
  await clock.advance(1000)
  await call
  ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING })
  const won = JSON.stringify(await ui.drawn({ in: 'arena-think-1' }))
  expect(won).toContain('WIN!')
  expect(won).toContain('WINS 1')
  await ui.unmount()
})

test('a pat does not cure a pet sick from a care mistake', async ($, on) => {
  const clock = host(on, at('09:00'))
  let usage = HIT
  stepWith(on, () => usage)
  await start($)
  await turn($)
  await clock.advance(61 * MIN)
  usage = MISS
  await turn($)
  expect(toasts.some(t => t.includes('got sick'))).toBe(true)
  await $.command.run({ ...RUN, command: 'digi', args: 'pet' })
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn({ in: 'band-bota-loud' }))).toContain('I got sick')
  await ui.unmount()
})

test('after /clear the pet is itself at once, and a side session stays one', async ($, on) => {
  const base = { turns: 30, activeDays: 1, careMistakes: 0, training: 10, overfeed: 0, sleepDisturbances: 0, battles: 0, wins: 0 }
  host(on, at('09:00'), { pet: { species: 'koro', enteredDay: '2026-10-04', base, log: [{ id: 'koro', day: '2026-10-04' }] } })
  // The session's state, as the engine keeps it: a /clear starts the new conversation with none, and raises no session.start.
  let state = new Map<string, unknown>()
  on('state.get', ($, e) => ({ value: { value: state.get(e.key), version: 0 } }))
  on('state.set', ($, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true as const, version: 0 } }
  })
  on('session.end', ($, e) => {
    state = new Map()
    sessionId = 's2'
    return { sessionId: e.sessionId }
  })
  on('classic.SessionStart', () => ({}))
  stepWith(on, () => HIT)
  await start($)
  await $.command.run({ ...RUN, command: 'digi', args: 'side' })

  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  await $.classic.SessionStart({ source: 'clear' } as never)
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
  expect(((await ui.findAll({ type: 'Client' })) as { key?: string }[])[0]!.key).toBe('band-koro-idle')
  await ui.unmount()
  expect((await $.command.run({ ...RUN, command: 'digi', args: '' })).text).toContain('side session: yes')
})

test('/digi wake gets the pet up: through the rest window it is in, and out of /digi sleep', async ($, on) => {
  const clock = host(on, at('12:20'))
  stepWith(on, () => HIT)
  await start($)
  await turn($)
  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND })
    const drawn = JSON.stringify(await ui.drawn({ in: petScreen(await ui.findAll({ type: 'Client' })).key! }))
    await ui.unmount()
    return drawn
  }
  expect(await band()).toContain('resting until 14:00')

  expect((await $.command.run({ ...RUN, command: 'digi', args: 'wake' })).text).toContain('awake until 14:00')
  expect(await band()).not.toContain('resting')
  // Awake, it minds the cache as in working hours: hungry 45 minutes after the meal.
  await clock.advance(46 * MIN)
  expect(toasts.some(t => t.includes('Botamon is hungry'))).toBe(true)

  await $.command.run({ ...RUN, command: 'digi', args: 'sleep' })
  expect(await band()).toContain('asleep until your next prompt')
  expect((await $.command.run({ ...RUN, command: 'digi', args: 'wake' })).text).toContain('awake')
  expect(await band()).not.toContain('asleep')
})

test('a subagent is an ally on the field while it runs: in on its start, cheering on its stop, out a moment later; a failed one lies grey', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  let agents = [{ id: 'a1', description: 'find callers of saveSession', type: 'Explore', status: 'running' }]
  on('agent.list', () => ({ value: agents as never }))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  await start($)
  const WORKING = { ...BAND, props: { ...BAND.props, isWorking: true } }
  const field = async () => {
    const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...WORKING })
    const arenaKey = ((await ui.findAll({ type: 'Client' })) as { key?: string }[]).find(c => c.key?.startsWith('arena-'))!.key!
    const drawn = JSON.stringify(await ui.drawn({ in: arenaKey }))
    await ui.unmount()
    return drawn
  }
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' } as never)
  expect(await field()).toContain('find calle')

  agents = [{ ...agents[0]!, status: 'completed' }]
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'Explore', stop_hook_active: false, agent_transcript_path: '/t' } as never)
  expect(await field()).toContain('✓ done')
  await clock.advance(3000)
  expect(await field()).not.toContain('done')

  // A failed one.
  agents = [{ id: 'a2', description: 'run the e2e suite', type: 'general-purpose', status: 'running' }]
  await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'general-purpose' } as never)
  agents = [{ ...agents[0]!, status: 'failed' }]
  await $.classic.SubagentStop({ agent_id: 'a2', agent_type: 'general-purpose', stop_hook_active: false, agent_transcript_path: '/t' } as never)
  expect(await field()).toContain('✗ failed')
})

test('an ally whose stop was missed leaves on the next tick, once its subagent is no longer listed', async ($, on) => {
  const clock = host(on, at('09:00'))
  stepWith(on, () => HIT)
  let agents = [{ id: 'a1', description: 'plan the migration', type: 'Plan', status: 'running' }]
  on('agent.list', () => ({ value: agents as never }))
  on('classic.SubagentStart', () => ({}))
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Plan' } as never)
  const field = async () => {
    const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
    const arenaKey = ((await ui.findAll({ type: 'Client' })) as { key?: string }[]).find(c => c.key?.startsWith('arena-'))!.key!
    const drawn = JSON.stringify(await ui.drawn({ in: arenaKey }))
    await ui.unmount()
    return drawn
  }
  // Still running: it stays through a tick.
  await clock.advance(15_000)
  expect(await field()).toContain('plan the m')
  agents = []
  await clock.advance(15_000)
  expect(await field()).toContain('✓ done')
  await clock.advance(3000)
  expect(await field()).not.toContain('plan the m')
})

test('a subagent\'s description reaches the field with no control characters', async ($, on) => {
  host(on, at('09:00'))
  stepWith(on, () => HIT)
  on('agent.list', () => ({ value: [{ id: 'a1', description: '\x1b]8;;https://x\x07go\u009b2J', type: 'Explore', status: 'running' }] as never }))
  on('classic.SubagentStart', () => ({}))
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: '\x1bExplore' } as never)
  const ui = await $.ui.mount({ plugin: 'digi-pet', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
  const arenaKey = ((await ui.findAll({ type: 'Client' })) as { key?: string }[]).find(c => c.key?.startsWith('arena-'))!.key!
  const drawn = JSON.stringify(await ui.drawn({ in: arenaKey }))
  await ui.unmount()
  expect(drawn).toContain(']8;;https:')
  expect(/\\u001b|\\u0007|\\u009b|[\u001b\u0007\u009b]/.test(drawn)).toBe(false)
})

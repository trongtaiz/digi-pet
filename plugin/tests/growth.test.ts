import { expect, test } from 'claude-code/testing'

import { CHAOS_PER_DAY, GATES, PACES, TRAINING_PER_DAY, ZERO_COUNTS, asPet, eggOf, countsOf, evolveTo, jogressOf, minus, progressOf, rollOf, statsOf } from '../hooks/growth'
import type { Counts, Rule } from '../hooks/growth'
import { ZERO } from '../hooks/ledger'
import type { Counters } from '../hooks/ledger'
import { isRisky, isTrophy, signalOf } from '../hooks/signals'
import { SPECIES } from '../hooks/species.gen'

const day = (c: Partial<Counters>): Counters => ({ ...ZERO, ...c })

const at = (n: number | undefined, pace: number) => (n ? Math.max(1, Math.ceil(n * pace)) : 0)

/** The counts a rule asks for at its lowest, on the day the stage's gate opens at `pace`. */
function meeting(stage: string, r: Rule, pace = 1): Counts {
  const gate = GATES[stage]!
  const battles = r.battles?.min ?? (r.winRatio ? 10 : 0)
  return {
    ...ZERO_COUNTS,
    activeDays: at(gate.days, pace),
    turns: at(gate.turns, pace),
    trophies: at(gate.trophies, pace),
    summons: at(gate.summons, pace),
    careMistakes: r.careMistakes?.min ?? 0,
    training: r.training?.min ?? 0,
    overfeed: r.overfeed?.min ?? 0,
    sleepDisturbances: r.sleepDisturbances?.min ?? 0,
    battles,
    wins: Math.ceil((battles * (r.winRatio?.min ?? 0)) / 100),
  }
}

test('every branch from the egg can be taken at every pace: some rule for it is met, within what a stage can train', () => {
  for (const pace of Object.values(PACES)) {
    const seen = new Set<string>()
    const queue = ['egg1']
    while (queue.length) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      const s = SPECIES[id]!
      const days = at(GATES[s.stage]?.days, pace)
      for (const to of new Set(s.rules.filter(r => !r.jogress).map(r => r.to))) {
        queue.push(to)
        const taken = s.rules.filter(r => r.to === to).some(r => {
          const c = meeting(s.stage, r, pace)
          return c.training <= Math.ceil(TRAINING_PER_DAY / pace) * Math.max(1, days) && evolveTo(id, c, SPECIES, { life: c, day: '2026-10-05', pace }) === to
        })
        expect(`${pace}: ${id} → ${to}: ${taken}`).toBe(`${pace}: ${id} → ${to}: true`)
      }
    }
    // The Ver.1 line, Mega included.
    for (const id of ['bota', 'koro', 'agu', 'beta', 'grey', 'devi', 'tyrano', 'mera', 'airdra', 'seadra', 'nume', 'metalgrey_vi', 'monzae', 'mame', 'blitzgrey', 'shinmonzae', 'banchomame']) {
      expect(seen.has(id)).toBe(true)
    }
  }
})

test('Chaos turns a branch Virus; the win ratio is every battle ever, and short of 80% a daily roll may still let it through', () => {
  const agu = { ...ZERO_COUNTS, activeDays: 5, training: 40 }
  expect(evolveTo('agu', { ...agu, chaos: CHAOS_PER_DAY * 5 - 1 }, SPECIES)).toBe('grey')
  expect(evolveTo('agu', { ...agu, chaos: CHAOS_PER_DAY * 5 }, SPECIES)).toBe('devi')
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 100, activeDays: 2, chaos: 10 }, SPECIES)).toBe('beta')

  const grey = { ...ZERO_COUNTS, activeDays: 10, trophies: 30, battles: 15, wins: 0 }
  // Fifteen battles this stage, all lost, but 90% won ever: it digivolves.
  expect(evolveTo('grey', grey, SPECIES, { life: { battles: 100, wins: 90 }, day: '2026-10-05', pace: 1 })).toBe('metalgrey_vi')
  expect(evolveTo('grey', grey, SPECIES, { life: { battles: 100, wins: 39 }, day: '2026-10-05', pace: 1 })).toBe(null)
  // At 60% the chance is half: some days yes, some no, and the same answer all day.
  const days = Array.from({ length: 40 }, (_, i) => `2026-11-${String((i % 28) + 1).padStart(2, '0')}`)
  const yes = days.filter(day => evolveTo('grey', grey, SPECIES, { life: { battles: 100, wins: 60 }, day, pace: 1 }) === 'metalgrey_vi')
  expect(yes.length > 5 && yes.length < 35).toBe(true)
  expect(rollOf('grey', '2026-11-01')).toBe(rollOf('grey', '2026-11-01'))
  for (const day of yes) expect(rollOf('grey', day) < 0.5).toBe(true)
})

test('trophies and summons gate the Ultimate and the Mega; a Mega jogresses with its partner on call', () => {
  const grey = { ...ZERO_COUNTS, activeDays: 10, battles: 15, wins: 15 }
  expect(evolveTo('grey', { ...grey, trophies: 29 }, SPECIES)).toBe(null)
  expect(evolveTo('grey', { ...grey, trophies: 30 }, SPECIES)).toBe('metalgrey_vi')
  const metal = { ...ZERO_COUNTS, activeDays: 21, battles: 15, wins: 15, trophies: 60 }
  expect(evolveTo('metalgrey_vi', { ...metal, summons: 9 }, SPECIES)).toBe(null)
  expect(evolveTo('metalgrey_vi', { ...metal, summons: 10 }, SPECIES)).toBe('blitzgrey')
  expect(progressOf('metalgrey_vi', { ...metal, summons: 4 }, SPECIES)!.label).toBe('day 21/21 · trophies 60/60 · summons 4/10 · battles 15/15 · win 100%/80% → Mega')

  const blitz = { ...ZERO_COUNTS, activeDays: 14, battles: 15, wins: 13 }
  const ctx = { life: blitz, day: '2026-12-01', pace: 1 }
  expect(evolveTo('blitzgrey', blitz, SPECIES, ctx)).toBe(null)
  expect(jogressOf('blitzgrey', blitz, SPECIES, ctx)).toEqual({ to: 'omega_a', partner: 'Cres Garurumon' })
  expect('missing' in jogressOf('blitzgrey', { ...blitz, activeDays: 3 }, SPECIES, ctx)).toBe(true)
  expect('missing' in jogressOf('grey', grey, SPECIES, ctx)).toBe(true)
  expect(progressOf('blitzgrey', { ...blitz, activeDays: 3 }, SPECIES)!.label).toBe('day 3/14 · battles 15/15 · win 86%/80% → Jogress')
  expect(progressOf('omega_a', blitz, SPECIES)).toBe(null)
})

test('pace scales every stage, and training a day the other way', () => {
  const fast = { life: ZERO_COUNTS, day: '', pace: PACES.fast! }
  expect(evolveTo('egg1', { ...ZERO_COUNTS, turns: 1 }, SPECIES, fast)).toBe('bota')
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 25, activeDays: 1 }, SPECIES, fast)).toBe('agu')
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 199, activeDays: 4 }, SPECIES, { ...fast, pace: PACES.slow! })).toBe(null)
  const days = { '2026-10-01': day({ turns: 60, toolTurns: 60 }) }
  expect(countsOf(days, '2026-10-02', PACES.fast).training).toBe(48)
  expect(countsOf(days, '2026-10-02', PACES.slow).training).toBe(6)
})

test('a stage lasts its gate, then the first rule met wins, and a Rookie no rule takes becomes Numemon', () => {
  const agu = { ...ZERO_COUNTS, activeDays: 5, training: 40 }
  expect(evolveTo('bota', { ...ZERO_COUNTS, turns: 24 }, SPECIES)).toBe(null)
  expect(evolveTo('bota', { ...ZERO_COUNTS, turns: 25 }, SPECIES)).toBe('koro')
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 100, activeDays: 1 }, SPECIES)).toBe(null)
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 100, activeDays: 2 }, SPECIES)).toBe('agu')
  expect(evolveTo('koro', { ...ZERO_COUNTS, turns: 100, activeDays: 2, careMistakes: 4 }, SPECIES)).toBe('beta')
  expect(evolveTo('agu', { ...agu, activeDays: 4 }, SPECIES)).toBe(null)
  expect(evolveTo('agu', agu, SPECIES)).toBe('grey')
  expect(evolveTo('agu', { ...agu, training: 31 }, SPECIES)).toBe('devi')
  expect(evolveTo('agu', { ...agu, careMistakes: 4, training: 10, overfeed: 3, sleepDisturbances: 4 }, SPECIES)).toBe('tyrano')
  expect(evolveTo('agu', { ...agu, careMistakes: 4, training: 10, overfeed: 3, sleepDisturbances: 9 }, SPECIES)).toBe('nume')
  // Past a Champion, no catch-all: it keeps fighting until it wins enough.
  const grey = { ...ZERO_COUNTS, activeDays: 10, trophies: 30, battles: 15, wins: 11 }
  expect(evolveTo('grey', grey, SPECIES)).toBe(null)
  expect(evolveTo('grey', { ...grey, wins: 12 }, SPECIES)).toBe('metalgrey_vi')
  const metal = { ...ZERO_COUNTS, activeDays: 21, trophies: 60, summons: 10, battles: 15, wins: 15 }
  expect(evolveTo('metalgrey_vi', { ...metal, careMistakes: 2 }, SPECIES)).toBe(null)
  expect(evolveTo('metalgrey_vi', { ...metal, careMistakes: 1 }, SPECIES)).toBe('blitzgrey')
  expect(evolveTo('blitzgrey', { ...ZERO_COUNTS, activeDays: 99, battles: 99, wins: 99 }, SPECIES)).toBe(null)
  expect(evolveTo('egg1', { ...ZERO_COUNTS, turns: 3 }, SPECIES)).toBe('bota')
  expect(progressOf('koro', { ...ZERO_COUNTS, activeDays: 1, turns: 80 }, SPECIES)).toEqual({ label: 'day 1/2 · turns 80/100 → Rookie', ratio: 0.5 })
  expect(progressOf('grey', { ...ZERO_COUNTS, activeDays: 10, battles: 6, wins: 5 }, SPECIES)!.label).toBe('day 10/10 · trophies 0/30 · battles 6/15 · win 83%/80% → Ultimate')
})

test('counts: active days before today, training capped a day, battles; a stage counts from its base', () => {
  const days = {
    '2026-10-01': day({ turns: 30, toolTurns: 20, careMistakes: 1, battlesWon: 3, battlesLost: 1, restTurns: 2, overfeeds: 1 }),
    '2026-10-02': day({ turns: 4, toolTurns: 4 }),
    '2026-10-03': day({ turns: 9, toolTurns: 9 }),
  }
  const c = countsOf(days, '2026-10-03')
  expect(c).toEqual({ ...ZERO_COUNTS, turns: 43, activeDays: 1, careMistakes: 1, training: 12 + 4 + 9, overfeed: 1, sleepDisturbances: 2, battles: 4, wins: 3 })
  expect(countsOf(days, '2026-10-04').activeDays).toBe(2)
  expect(minus(c, { ...ZERO_COUNTS, turns: 40, training: 30 })).toEqual({ ...c, turns: 3, training: 0 })
})

test('stats: a day past 20 points gains a quarter as fast; pats and a week of showing up raise SYN', () => {
  const s = statsOf({ '2026-10-01': day({ activeMs: 60 * 60_000, research: 40, linesWritten: 1000, checksPassed: 5, parallelSteps: 3, quickTurns: 2, prompts: 10 }) })
  expect(s).toEqual({ STA: 10, INT: 10, ATK: 20 + 5, DEF: 10, SPD: 5, SYN: 5 })
  // Three pats count a day; the third active day in a row adds two for the two before it.
  const week = statsOf({
    '2026-10-01': day({ turns: 5 }),
    '2026-10-02': day({ turns: 5 }),
    '2026-10-03': day({ turns: 5, pats: 9 }),
  })
  expect(week.SYN).toBe(0 + 1 + 2 + 3 * 2)
})

test('signals: research, lines written, and checks read from their output, piped or not', () => {
  expect(signalOf('Grep', { pattern: 'x' }, false, '')).toEqual({ kind: 'research' })
  expect(signalOf('Grep', { pattern: 'x' }, true, '')).toEqual({ kind: 'other' })
  expect(signalOf('Edit', { new_string: 'a\nb\nc' }, false, '')).toEqual({ kind: 'write', lines: 3 })
  expect(signalOf('Write', { content: 'x\n'.repeat(500) }, false, '')).toEqual({ kind: 'write', lines: 200 })
  const run = (command: string, text: string, isError = false) => signalOf('Bash', { command }, isError, text)
  expect(run('npm run test 2>&1 | tail', 'Tests:  2 failed, 8 passed')).toEqual({ kind: 'check', runner: 'npm test', isPass: false })
  expect(run('npm test 2>&1 | tail', 'Tests:  10 passed, 0 failed')).toEqual({ kind: 'check', runner: 'npm test', isPass: true })
  expect(run('npx tsc --noEmit | head', "src/a.ts(3,1): error TS2322: Type 'x'")).toEqual({ kind: 'check', runner: 'tsc', isPass: false })
  expect(run('npx eslint . | tail -3', '✖ 30 problems (0 errors, 30 warnings)')).toEqual({ kind: 'check', runner: 'eslint', isPass: true })
  expect(run('npx eslint . | tail -3', '✖ 3 problems (2 errors, 1 warning)')).toEqual({ kind: 'check', runner: 'eslint', isPass: false })
  expect(run('claude plugin test . 2>&1 | tail -4', ' 14 pass\n 1 fail')).toEqual({ kind: 'check', runner: 'claude plugin test', isPass: false })
  expect(run('cargo test', '', true)).toEqual({ kind: 'check', runner: 'cargo test', isPass: false })
  expect(run('git status', '')).toEqual({ kind: 'other' })
  expect(signalOf('Bash', { command: 'npm test', run_in_background: true }, false, '')).toEqual({ kind: 'other' })
  // Trophies need proof in the output.
  expect(isTrophy('git commit -m "x"', '[main 1a2b3c4] x\n 1 file changed', false)).toBe(true)
  expect(isTrophy('npm test && git commit -m "x"', 'Tests: 3 passed\n[main 1a2b3c4] x', false)).toBe(true)
  expect(isTrophy('git commit -m "x"', 'nothing to commit, working tree clean', false)).toBe(false)
  expect(isTrophy('gh pr create --fill', 'https://github.com/me/repo/pull/42', false)).toBe(true)
  expect(isTrophy('gh pr create --fill', 'a pull request for branch "x" already exists', false)).toBe(false)
  expect(signalOf('Agent', { prompt: 'look' }, false, '')).toEqual({ kind: 'summon' })
})

test('risky moves: a forced push, a skipped hook, a hard reset, an rm -rf of anything but scratch', () => {
  for (const c of ['git push --force', 'git push -f origin main', 'git commit --no-verify -m x', 'git reset --hard HEAD~1', 'rm -rf src', 'rm -fr ~/work', 'cd /tmp/x && rm -rf build ../app']) expect(`${c}: ${isRisky(c)}`).toBe(`${c}: true`)
  for (const c of ['git push --force-with-lease', 'git push', 'rm -rf /tmp/claude-501/x', 'rm -rf node_modules dist', 'rm -rf /private/tmp/a', 'rm -rf $SP/x "$D"', 'rm file.txt', 'git reset HEAD']) expect(`${c}: ${isRisky(c)}`).toBe(`${c}: false`)
})

test('a pet kept before growth existed starts its stage from nothing; no pet at all is an egg', () => {
  expect(asPet({ species: 'bota' })).toEqual({ species: 'bota', enteredDay: '', base: ZERO_COUNTS, log: [] })
  expect(asPet(undefined).species).toBe('egg1')
})

test('an egg drawn at random: any of the five versions, each as likely', () => {
  expect([0, 0.2, 0.4, 0.6, 0.8, 0.999].map(roll => eggOf(SPECIES, roll))).toEqual(['egg1', 'egg2', 'egg3', 'egg4', 'egg5', 'egg5'])
})

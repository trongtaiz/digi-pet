import { expect, test } from 'claude-code/testing'

import {
  dayOf,
  hungerOf,
  isCareMistake,
  isResting,
  isSidePath,
  minutesLeft,
  nextRest,
  parseBreak,
  parseOffset,
  parseRest,
  quietOf,
  restEnd,
  warningOf,
} from '../hooks/hunger'
import type { Config, Feeding } from '../hooks/hunger'

const MIN = 60_000
// Local time is UTC here (offset 0): Monday 2026-10-05 at hh:mm.
const at = (hm: string, day = '2026-10-05') => Date.parse(`${day}T${hm}:00Z`)

const CFG: Config = { ttlMs: 60 * MIN, rest: parseRest('12:00-14:00,18:00-08:00'), dayStartsHour: 4, minContextTokens: 20_000, offsetMin: 0 }
const FED = (hm: string, more: Partial<Feeding> = {}): Feeding => ({
  lastFedAt: at(hm),
  isSide: false,
  isAsleep: false,
  breakUntil: null,
  awakeUntil: null,
  contextTokens: 100_000,
  ...more,
})

test('rest windows parse, and one past midnight wraps', () => {
  expect(CFG.rest).toEqual([
    { start: 720, end: 840 },
    { start: 1080, end: 480 },
  ])
  expect(parseRest('nonsense, 9-9, 25:00-01:00')).toEqual([])
  expect(isResting(at('12:30'), CFG)).toBe(true)
  expect(isResting(at('14:00'), CFG)).toBe(false)
  expect(isResting(at('19:00'), CFG)).toBe(true)
  expect(isResting(at('07:59'), CFG)).toBe(true)
  expect(isResting(at('08:00'), CFG)).toBe(false)
  expect(nextRest(at('11:10'), CFG)).toBe(at('12:00'))
  expect(nextRest(at('15:00'), CFG)).toBe(at('18:00'))
  expect(restEnd(at('12:30'), CFG)).toBe(at('14:00'))
  expect(restEnd(at('23:00'), CFG)).toBe(at('08:00', '2026-10-06'))
})

test('hunger by the share of the TTL gone', () => {
  expect(hungerOf(29 * MIN, CFG.ttlMs)).toBe('full')
  expect(hungerOf(30 * MIN, CFG.ttlMs)).toBe('peckish')
  expect(hungerOf(45 * MIN, CFG.ttlMs)).toBe('hungry')
  expect(hungerOf(55 * MIN, CFG.ttlMs)).toBe('starving')
  expect(hungerOf(60 * MIN, CFG.ttlMs)).toBe('cold')
  expect(hungerOf(4 * MIN, 5 * MIN)).toBe('hungry')
  expect(minutesLeft(FED('09:00'), at('09:45'), CFG)).toBe(15)
})

test('it yells while feeding can still save the cache, and only then', () => {
  expect(warningOf(FED('09:00'), at('09:44'), CFG)).toBe(null)
  expect(warningOf(FED('09:00'), at('09:45'), CFG)).toBe('hungry')
  expect(warningOf(FED('09:00'), at('09:56'), CFG)).toBe('starving')
  expect(warningOf(FED('09:00'), at('10:00'), CFG)).toBe(null)
  // Lunch begins before the cache would go cold: a meal now would die in it anyway.
  expect(warningOf(FED('11:10'), at('11:55'), CFG)).toBe(null)
  // The end of the day the same.
  expect(warningOf(FED('17:10'), at('17:56'), CFG)).toBe(null)
  // Quiet: a side session, /digi sleep, a break, a small context, before any meal.
  expect(warningOf(FED('09:00', { isSide: true }), at('09:50'), CFG)).toBe(null)
  expect(warningOf(FED('09:00', { isAsleep: true }), at('09:50'), CFG)).toBe(null)
  expect(warningOf(FED('09:00', { breakUntil: at('10:30') }), at('09:50'), CFG)).toBe(null)
  expect(warningOf(FED('09:00', { contextTokens: 5_000 }), at('09:50'), CFG)).toBe(null)
  expect(warningOf({ ...FED('09:00'), lastFedAt: null }, at('09:50'), CFG)).toBe(null)
  expect(quietOf(FED('09:00'), at('12:30'), CFG)).toBe('rest')
  expect(quietOf(FED('09:00', { breakUntil: at('10:30') }), at('09:50'), CFG)).toBe('break')
})

test('/digi wake keeps the pet up through the rest window it woke in, and warns as in working hours', () => {
  const awake = FED('12:10', { awakeUntil: at('14:00') })
  expect(quietOf(awake, at('12:30'), CFG)).toBe(null)
  expect(warningOf(awake, at('12:58'), CFG)).toBe('hungry')
  // That window over, the next one rests as ever.
  expect(quietOf(awake, at('18:30'), CFG)).toBe('rest')
})

test('a care mistake: cold on a working day, at most once per session per day', () => {
  // Gone cold mid-morning and picked up again: a mistake.
  expect(isCareMistake(FED('09:00'), at('10:30'), CFG, [])).toBe(true)
  // Not cold yet: none.
  expect(isCareMistake(FED('09:00'), at('09:59'), CFG, [])).toBe(false)
  // One already today: no second.
  expect(isCareMistake(FED('09:00'), at('10:30'), CFG, ['2026-10-05'])).toBe(false)
  // Lunch between the meal and the return: none.
  expect(isCareMistake(FED('11:30'), at('14:30'), CFG, [])).toBe(false)
  expect(isCareMistake(FED('10:30'), at('14:10'), CFG, [])).toBe(false)
  // The next morning: none.
  expect(isCareMistake(FED('16:30'), at('09:00', '2026-10-06'), CFG, [])).toBe(false)
  // Excused: a side session, sleep, a break over the moment it went cold, a small context.
  expect(isCareMistake(FED('09:00', { isSide: true }), at('10:30'), CFG, [])).toBe(false)
  expect(isCareMistake(FED('09:00', { isAsleep: true }), at('10:30'), CFG, [])).toBe(false)
  expect(isCareMistake(FED('09:00', { breakUntil: at('10:15') }), at('10:30'), CFG, [])).toBe(false)
  expect(isCareMistake(FED('09:00', { contextTokens: 1_000 }), at('10:30'), CFG, [])).toBe(false)
})

test('the day turns at dayStartsHour, so 03:30 is still the evening before', () => {
  expect(dayOf(at('03:30', '2026-10-06'), CFG)).toBe('2026-10-05')
  expect(dayOf(at('04:00', '2026-10-06'), CFG)).toBe('2026-10-06')
  expect(dayOf(at('09:00'), { ...CFG, offsetMin: 7 * 60 })).toBe('2026-10-05')
  expect(dayOf(at('22:00'), { ...CFG, offsetMin: 7 * 60 })).toBe('2026-10-06')
})

test('breaks, offsets and side-work globs parse', () => {
  expect(parseBreak('90m', at('14:00'), 0)).toBe(at('15:30'))
  expect(parseBreak('1h30m', at('14:00'), 0)).toBe(at('15:30'))
  expect(parseBreak('2h', at('14:00'), 0)).toBe(at('16:00'))
  expect(parseBreak('until 15:30', at('14:00'), 0)).toBe(at('15:30'))
  expect(parseBreak('until 08:00', at('14:00'), 0)).toBe(at('08:00', '2026-10-06'))
  expect(parseBreak('until 15:30', at('08:00'), 7 * 60)).toBe(at('08:30'))
  expect(parseBreak('soon', at('14:00'), 0)).toBe(null)
  expect(parseOffset('+0700\n')).toBe(420)
  expect(parseOffset('-0330')).toBe(-210)
  expect(parseOffset('UTC')).toBe(null)
  const home = '/Users/me'
  expect(isSidePath('/Users/me/work/personal/x', ['~/work/personal/**'], home)).toBe(true)
  expect(isSidePath('/Users/me/work/personal', ['~/work/personal/**'], home)).toBe(true)
  expect(isSidePath('/Users/me/work/my-app', ['~/work/personal/**'], home)).toBe(false)
  expect(isSidePath('/Users/me/play/a', ['~/play/*'], home)).toBe(true)
  expect(isSidePath('/Users/me/play/a/b', ['~/play/*'], home)).toBe(false)
  expect(isSidePath('/x', [], home)).toBe(false)
})

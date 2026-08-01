import { expect, test } from 'vitest'
import { computeStats, isDoneColumn, lastNDays, weekdayIndex, weekRange } from './home'

test('isDoneColumn matches done/complete case-insensitively', () => {
  expect(isDoneColumn('Done')).toBe(true)
  expect(isDoneColumn('COMPLETED')).toBe(true)
  expect(isDoneColumn('In Review')).toBe(false)
  expect(isDoneColumn('Backlog')).toBe(false)
})

test('computeStats splits active vs done by column title', () => {
  const columns = [
    { title: 'Backlog', cards: [{ id: 'a' }, { id: 'b' }] },
    { title: 'In Review', cards: [{ id: 'c' }] },
    { title: 'Done', cards: [{ id: 'd' }, { id: 'e' }, { id: 'f' }] },
  ]
  expect(computeStats(columns)).toEqual({ total: 6, active: 3, done: 3 })
})

test('computeStats handles empty input', () => {
  expect(computeStats([])).toEqual({ total: 0, active: 0, done: 0 })
})

test('weekdayIndex is Monday-start (0=Mon..6=Sun)', () => {
  expect(weekdayIndex('2026-07-13')).toBe(0) // Monday
  expect(weekdayIndex('2026-07-14')).toBe(1) // Tuesday
  expect(weekdayIndex('2026-07-19')).toBe(6) // Sunday
})

test('weekRange returns the local Mon..Sun dates for the week containing dateStr', () => {
  expect(weekRange('2026-07-14')).toEqual([
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-18', '2026-07-19',
  ])
})

test('weekRange on a Sunday stays in that same week (does not roll into the next one)', () => {
  expect(weekRange('2026-07-19')).toEqual([
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-18', '2026-07-19',
  ])
})

test('lastNDays is a sliding window ending on dateStr, oldest first', () => {
  expect(lastNDays(7, '2026-07-14')).toEqual([
    '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11',
    '2026-07-12', '2026-07-13', '2026-07-14',
  ])
})

test('lastNDays crosses a month boundary correctly', () => {
  expect(lastNDays(3, '2026-08-01')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01'])
})

test('lastNDays of 1 is just today', () => {
  expect(lastNDays(1, '2026-07-14')).toEqual(['2026-07-14'])
})

import { expect, test } from 'vitest'
import { computeWeekProgress, computeHeatmap, computeWeeklyCompletions } from './dashboard'

test('computeWeekProgress computes % done per weekday for the week containing todayStr', () => {
  const cards = [
    { due_date: '2026-07-13', done: true },  // Mon
    { due_date: '2026-07-13', done: false }, // Mon
    { due_date: '2026-07-14', done: true },  // Tue
    { due_date: '2026-07-20', done: true },  // next week, ignored
    { due_date: null, done: true },          // no due date, ignored
  ]
  expect(computeWeekProgress(cards, '2026-07-14')).toEqual([
    { d: 'Mon', v: 50 },
    { d: 'Tue', v: 100 },
    { d: 'Wed', v: 0 },
    { d: 'Thu', v: 0 },
    { d: 'Fri', v: 0 },
    { d: 'Sat', v: 0 },
    { d: 'Sun', v: 0 },
  ])
})

test('computeWeekProgress returns all zeros for an empty card list', () => {
  const result = computeWeekProgress([], '2026-07-14')
  expect(result.every((d) => d.v === 0)).toBe(true)
  expect(result.map((d) => d.d)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
})

test('computeHeatmap buckets task volume into a 5x7 Mon-start grid, scaled to the busiest day', () => {
  const cards = [
    { due_date: '2026-07-01' }, // Wed, week 1
    { due_date: '2026-07-01' },
    { due_date: '2026-07-08' }, // Wed, week 2 (busiest: 4)
    { due_date: '2026-07-08' },
    { due_date: '2026-07-08' },
    { due_date: '2026-07-08' },
    { due_date: '2026-06-30' }, // different month, ignored
  ]
  const grid = computeHeatmap(cards, '2026-07-14')
  expect(grid).toHaveLength(5)
  expect(grid[0]).toHaveLength(7)
  expect(grid[0][2]).toBe(50)  // week 1, Wed: 2/4 busiest
  expect(grid[1][2]).toBe(100) // week 2, Wed: 4/4 busiest
  expect(grid[0][0]).toBe(0)   // week 1, Mon: no cards
})

test('computeHeatmap returns an all-zero 5x7 grid for an empty card list', () => {
  const grid = computeHeatmap([], '2026-07-14')
  expect(grid).toHaveLength(5)
  expect(grid.every((row) => row.every((v) => v === 0))).toBe(true)
})

test('computeWeeklyCompletions buckets by the local day a card was completed', () => {
  // Times chosen mid-day WIB (this suite's timezone) so the local calendar
  // day can't slip a day from a UTC offset near midnight.
  const cards = [
    { completed_at: '2026-07-14T02:00:00Z' }, // today, 09:00 WIB
    { completed_at: '2026-07-14T09:00:00Z' }, // today, later, 16:00 WIB
    { completed_at: '2026-07-12T03:00:00Z' }, // two days ago, 10:00 WIB
    { completed_at: null },                   // never completed, ignored
  ]
  const counts = computeWeeklyCompletions(cards, '2026-07-14')
  expect(counts).toEqual([0, 0, 0, 0, 1, 0, 2]) // Jul 8..14: 12th at index 4, today (14th) at index 6
})

test('computeWeeklyCompletions drops completions outside the 7-day window', () => {
  const counts = computeWeeklyCompletions([{ completed_at: '2026-06-01T00:00:00Z' }], '2026-07-14')
  expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0])
})

test('computeWeeklyCompletions returns an all-zero week for an empty card list', () => {
  expect(computeWeeklyCompletions([], '2026-07-14')).toEqual([0, 0, 0, 0, 0, 0, 0])
})

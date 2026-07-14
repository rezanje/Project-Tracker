import { expect, test } from 'vitest'
import { computeWeekProgress, computeHeatmap } from './dashboard'

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

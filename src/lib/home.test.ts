import { expect, test } from 'vitest'
import { computeStats, isDoneColumn } from './home'

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

import { expect, test } from 'vitest'
import { kpiTrendBars, pickFeaturedKpi } from './goals'

test('pickFeaturedKpi prefers the one with the most recently approved check-in', () => {
  const stale = { id: 'a', kpi_checkins: [{ status: 'approved', reviewed_at: '2026-01-01T00:00:00Z' }] }
  const fresh = { id: 'b', kpi_checkins: [{ status: 'approved', reviewed_at: '2026-07-01T00:00:00Z' }] }
  expect(pickFeaturedKpi([stale, fresh])?.id).toBe('b')
  expect(pickFeaturedKpi([fresh, stale])?.id).toBe('b')
})

test('pickFeaturedKpi falls back to the list order when nothing has been approved yet', () => {
  const a = { id: 'a', kpi_checkins: [] }
  const b = { id: 'b', kpi_checkins: [{ status: 'pending', reviewed_at: null }] }
  expect(pickFeaturedKpi([a, b])?.id).toBe('a')
})

test('pickFeaturedKpi returns null for an empty list', () => {
  expect(pickFeaturedKpi([])).toBeNull()
})

test('kpiTrendBars uses approved check-ins in chronological order, scaled to target', () => {
  const checkins = [
    { proposed_value: 50, status: 'approved', reviewed_at: '2026-07-03T00:00:00Z' },
    { proposed_value: 25, status: 'approved', reviewed_at: '2026-07-01T00:00:00Z' }, // out of order on purpose
    { proposed_value: 999, status: 'pending', reviewed_at: null }, // not yet decided, excluded
    { proposed_value: 10, status: 'rejected', reviewed_at: '2026-07-02T00:00:00Z' }, // decided against, excluded
  ]
  expect(kpiTrendBars(checkins, 50, 100)).toEqual([25, 50])
})

test('kpiTrendBars keeps only the last 7 approved check-ins', () => {
  const checkins = Array.from({ length: 10 }, (_, i) => ({
    proposed_value: i,
    status: 'approved',
    reviewed_at: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }))
  expect(kpiTrendBars(checkins, 9, 10)).toEqual([30, 40, 50, 60, 70, 80, 90])
})

test('kpiTrendBars falls back to the current value alone when nothing has been approved', () => {
  expect(kpiTrendBars([], 30, 100)).toEqual([30])
})

test('kpiTrendBars never divides by a zero or negative target', () => {
  expect(kpiTrendBars([], 30, 0)).toEqual([0])
  expect(kpiTrendBars([], 30, -5)).toEqual([0])
})

test('kpiTrendBars clamps a value past target at 100', () => {
  expect(kpiTrendBars([], 150, 100)).toEqual([100])
})

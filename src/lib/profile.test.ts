import { expect, test } from 'vitest'
import { normalizeName } from './profile'

test('normalizeName trims and collapses whitespace', () => {
  expect(normalizeName('  Reza   Rahman ')).toBe('Reza Rahman')
  expect(normalizeName('Reza\n\tRahman')).toBe('Reza Rahman')
})

test('normalizeName turns a blank name into null so email fallbacks still fire', () => {
  expect(normalizeName('')).toBeNull()
  expect(normalizeName('    ')).toBeNull()
})

test('normalizeName caps length at 60', () => {
  expect(normalizeName('a'.repeat(80))).toHaveLength(60)
})

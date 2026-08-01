import { expect, test } from 'vitest'
import { dragVerdict } from './WorkspaceSwitcher'

// The sheet body has to share one finger with its own scrolling and with the
// horizontal swipe on list rows. dragVerdict is where that is decided, so the
// three ways it can be wrong are worth pinning: stealing a tap, stealing a
// scroll, stealing a swipe.

test('a barely-moved finger is still undecided', () => {
  expect(dragVerdict(0, 0)).toBe('wait')
  expect(dragVerdict(5, 5)).toBe('wait')
  expect(dragVerdict(-5, 0)).toBe('wait')
})

test('a downward pull claims the drag', () => {
  expect(dragVerdict(10, 0)).toBe('claim')
  expect(dragVerdict(40, 12)).toBe('claim')
})

test('an upward pull is the body scrolling, not a dismiss', () => {
  expect(dragVerdict(-10, 0)).toBe('release')
  expect(dragVerdict(-60, 3)).toBe('release')
})

test('a mostly-sideways drag belongs to the row swipe', () => {
  expect(dragVerdict(8, 40)).toBe('release')
  expect(dragVerdict(8, -40)).toBe('release')
})

test('a diagonal that is more down than across still counts as a dismiss', () => {
  expect(dragVerdict(30, 20)).toBe('claim')
})

test('exactly diagonal goes to the swipe — ties are not worth stealing', () => {
  expect(dragVerdict(20, 20)).toBe('release')
})

import { describe, expect, it } from 'vitest'
import { segFill } from './progress'

describe('segFill', () => {
  it('fills zero blocks at 0%', () => {
    expect(segFill(0, 10)).toBe(0)
  })
  it('fills all blocks at 100%', () => {
    expect(segFill(100, 10)).toBe(10)
  })
  it('rounds to nearest block', () => {
    expect(segFill(68, 10)).toBe(7)
  })
  it('clamps out-of-range input', () => {
    expect(segFill(-20, 8)).toBe(0)
    expect(segFill(150, 8)).toBe(8)
  })
})

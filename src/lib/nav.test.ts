import { describe, expect, it, vi } from 'vitest'
import { dedupeInFlight } from './nav'

// Pure unit tests against the generic dedupe helper — no network, no
// Supabase. `fetchNavDeduped` itself is just `dedupeInFlight(fetchNav)`, so
// exercising the wrapper here covers its behaviour without hitting the real
// remote DB that this repo's other `.test.ts` files rely on.
describe('dedupeInFlight', () => {
  it('coalesces concurrent calls into a single underlying request', async () => {
    let calls = 0
    const fn = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          calls++
          setTimeout(() => resolve(calls), 10)
        }),
    )
    const deduped = dedupeInFlight(fn)

    const [a, b, c] = await Promise.all([deduped(), deduped(), deduped()])

    expect(fn).toHaveBeenCalledTimes(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(c).toBe(1)
  })

  it('issues a fresh request after the previous one has resolved (no stale caching)', async () => {
    const fn = vi.fn(async () => 'result')
    const deduped = dedupeInFlight(fn)

    await deduped()
    await deduped()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('starts a new request for a call made after the in-flight one resolves, even if a rejection occurred', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')
    const deduped = dedupeInFlight(fn)

    await expect(deduped()).rejects.toThrow('boom')
    await expect(deduped()).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

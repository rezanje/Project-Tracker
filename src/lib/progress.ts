/** Number of filled blocks for a segmented progress bar.
 *  pct is 0-100 (clamped); blocks is the total segment count. */
export function segFill(pct: number, blocks: number): number {
  const clamped = Math.max(0, Math.min(100, pct))
  return Math.round((clamped / 100) * blocks)
}

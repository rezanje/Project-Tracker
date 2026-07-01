/** A column counts as "done" when its title reads like a done/complete state. */
export function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

/** Aggregate card counts across a user's columns. active = total - done. */
export function computeStats(
  columns: { title: string; cards: { id: string }[] }[],
): { total: number; active: number; done: number } {
  let total = 0
  let done = 0
  for (const c of columns) {
    const n = c.cards.length
    total += n
    if (isDoneColumn(c.title)) done += n
  }
  return { total, active: total - done, done }
}

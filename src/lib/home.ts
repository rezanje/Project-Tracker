/** A column counts as "done" when its title reads like a done/complete state. */
export function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

/** Local (not UTC) calendar date as YYYY-MM-DD. Due dates are stored as plain
 *  calendar dates, so comparisons must use the local day — `toISOString()` would
 *  return the UTC day and mis-bucket tasks for non-UTC users up to ~half a day. */
export function localDateStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Monday-start weekday index (0=Mon..6=Sun) for a local `YYYY-MM-DD` date string. */
export function weekdayIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  return (d.getDay() + 6) % 7
}

/** Local `YYYY-MM-DD` dates for the Monday..Sunday week containing `dateStr`. */
export function weekRange(dateStr: string): string[] {
  const d = new Date(dateStr + 'T00:00:00')
  const monday = new Date(d)
  monday.setDate(d.getDate() - weekdayIndex(dateStr))
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return localDateStr(day)
  })
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

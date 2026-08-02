/** A column counts as "done" when its title reads like a done/complete state. */
export function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

/** A column counts as "in progress" when its title reads like an active/doing state. */
export function isInProgressColumn(title: string): boolean {
  return /in.?progress|doing|active/i.test(title)
}

/** Local (not UTC) calendar date as YYYY-MM-DD. Due dates are stored as plain
 *  calendar dates, so comparisons must use the local day — `toISOString()` would
 *  return the UTC day and mis-bucket tasks for non-UTC users up to ~half a day. */
export function localDateStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A deadline's hour, as `HH:MM`, or null when the task never got one.
 *  Postgres renders a `time` as `HH:MM:SS`; nothing in the UI wants the seconds.
 *  A task with no `due_time` is treated as 17:00 by the reminder trigger, but
 *  that default is deliberately NOT shown on list surfaces — only the detail
 *  sheets say it, where there is room to explain it. Elsewhere an absent hour
 *  should read as "no particular time", not as a 17:00 the user never chose. */
export function dueHour(dueTime: string | null | undefined): string | null {
  return dueTime ? dueTime.slice(0, 5) : null
}

/** Monday-start weekday index (0=Mon..6=Sun) for a local `YYYY-MM-DD` date string. */
export function weekdayIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  return (d.getDay() + 6) % 7
}

/** The `n` local calendar dates ending on (and including) `dateStr`, oldest
 *  first — a sliding window, unlike weekRange's fixed Mon-start week. */
export function lastNDays(n: number, dateStr: string): string[] {
  const base = new Date(dateStr + 'T00:00:00')
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() - (n - 1 - i))
    return localDateStr(d)
  })
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

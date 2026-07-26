import { localDateStr } from './home'

export type Task = {
  id: string
  title: string
  boardId: string | null
  boardTitle: string
  colTitle: string
  workspaceId: string | null
  workspaceName: string
  due: string | null
}

/** One rendered section of the My Tasks list. Every grouping mode produces this
 *  same shape so the route renders them all through one loop. */
export type Group = { key: string; label: string; tint: string; tasks: Task[] }

export function bucketize(tasks: Task[]): Group[] {
  const today = localDateStr()
  const in7 = localDateStr(new Date(Date.now() + 7 * 86_400_000))
  const buckets: Group[] = [
    { key: 'overdue', label: 'Overdue', tint: 'var(--danger)', tasks: [] },
    { key: 'today', label: 'Today', tint: '#d97706', tasks: [] },
    { key: 'week', label: 'This week', tint: '#2563eb', tasks: [] },
    { key: 'later', label: 'Later', tint: 'var(--ink3)', tasks: [] },
    { key: 'none', label: 'No due date', tint: 'var(--ink3)', tasks: [] },
  ]
  const by = Object.fromEntries(buckets.map((b) => [b.key, b])) as Record<string, Group>
  for (const t of tasks) {
    if (!t.due) by.none.tasks.push(t)
    else if (t.due < today) by.overdue.tasks.push(t)
    else if (t.due === today) by.today.tasks.push(t)
    else if (t.due <= in7) by.week.tasks.push(t)
    else by.later.tasks.push(t)
  }
  for (const b of buckets) b.tasks.sort((a, z) => (a.due ?? '') < (z.due ?? '') ? -1 : 1)
  return buckets.filter((b) => b.tasks.length > 0)
}

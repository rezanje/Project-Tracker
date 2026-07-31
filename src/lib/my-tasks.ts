import { accentFor } from './accent'
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
    { key: 'today', label: 'Today', tint: 'var(--pop)', tasks: [] },
    { key: 'week', label: 'This week', tint: 'var(--ink)', tasks: [] },
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

/** How a task maps onto a group. Named Grouper, not Pick, because `Pick` would
 *  shadow TypeScript's built-in Pick<T,K> utility inside this module.
 *  Keyed by id rather than label so two boards
 *  that happen to share a title stay separate; standalone tasks (null ids)
 *  collapse into one 'personal' group. */
export type Grouper = (t: Task) => { key: string; label: string }

export const byProject: Grouper = (t) => ({ key: t.boardId ?? 'personal', label: t.boardTitle })
export const byWorkspace: Grouper = (t) => ({ key: t.workspaceId ?? 'personal', label: t.workspaceName })

/** Undated tasks sort last within a group, and all-undated groups sort last
 *  overall — an absent due date is "whenever", not "now". */
const FAR_FUTURE = '9999-12-31'

export function groupBy(tasks: Task[], pick: Grouper): Group[] {
  const groups = new Map<string, Group>()
  for (const t of tasks) {
    const { key, label } = pick(t)
    let g = groups.get(key)
    if (!g) {
      g = { key, label, tint: accentFor(key), tasks: [] }
      groups.set(key, g)
    }
    g.tasks.push(t)
  }
  const out = [...groups.values()]
  for (const g of out) g.tasks.sort((a, z) => (a.due ?? FAR_FUTURE).localeCompare(z.due ?? FAR_FUTURE))
  out.sort((a, z) => {
    const ea = a.tasks[0]?.due ?? FAR_FUTURE
    const ez = z.tasks[0]?.due ?? FAR_FUTURE
    return ea === ez ? a.label.localeCompare(z.label) : ea.localeCompare(ez)
  })
  return out
}

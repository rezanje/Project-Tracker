import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { isDoneColumn, localDateStr, weekdayIndex, weekRange } from './home'

// One aggregation feeding both dashboards (Command Center + Pixel Home). Panels
// that need history or event data we don't store (timeline times, sparkline
// trends, weekly bars, heatmaps) stay static in the UI — this returns only what
// the schema can back.

export type DashWorkspace = {
  id: string
  name: string
  projects: number
  tasks: number
  progress: number
  status: 'Healthy' | 'Need attention' | 'Behind schedule'
}
export type DashProjectMember = { id: string; name: string; avatar_url: string | null }
export type DashProject = {
  id: string
  title: string
  wsName: string
  progress: number
  done: number
  total: number
  members: DashProjectMember[]
}
export type DashPriority = {
  id: string
  title: string
  boardTitle: string
  wsName: string
  bucket: 'Overdue' | 'Due today' | 'Due tomorrow' | 'Due soon'
}
export type DashTask = { id: string; title: string; boardTitle: string }

export type DashboardData = {
  name: string | null
  approvals: number
  stats: {
    workspaces: number
    projects: number
    totalTasks: number
    dueToday: number
    overdue: number
    completed: number
  }
  myStats: {
    total: number
    dueToday: number
    overdue: number
    completed: number
  }
  workspaces: DashWorkspace[]
  projects: DashProject[]
  priority: DashPriority[]
  myPriority: DashPriority[]
  today: DashTask[]
  myToday: DashTask[]
  weekProgress: Array<{ d: string; v: number }>
  heatmap: number[][]
  monthLabel: string
  projectProgress: { total: number; completed: number; inProgress: number }
  revenue: number
  notes: Array<{ id: string; body: string; category: string | null; created_at: string }>
  announcements: Array<{ id: string; body: string; author: string | null }>
}

function statusFor(progress: number): DashWorkspace['status'] {
  if (progress >= 80) return 'Healthy'
  if (progress >= 45) return 'Need attention'
  return 'Behind schedule'
}

function dayDiff(due: string, today: string): number {
  const a = Date.parse(due + 'T00:00:00Z')
  const b = Date.parse(today + 'T00:00:00Z')
  return Math.round((a - b) / 86_400_000)
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** % of cards due each weekday (Mon..Sun) of the week containing `todayStr` that are done. */
export function computeWeekProgress(
  cards: Array<{ due_date: string | null; done: boolean }>,
  todayStr: string,
): Array<{ d: string; v: number }> {
  const days = weekRange(todayStr)
  const totals = days.map(() => ({ total: 0, done: 0 }))
  const indexOf = new Map(days.map((d, i) => [d, i]))
  for (const c of cards) {
    if (!c.due_date) continue
    const i = indexOf.get(c.due_date)
    if (i === undefined) continue
    totals[i].total++
    if (c.done) totals[i].done++
  }
  return totals.map((t, i) => ({ d: WEEKDAY_LABELS[i], v: t.total ? Math.round((t.done / t.total) * 100) : 0 }))
}

/** Task volume per day of the month containing `todayStr`, grouped into Mon-start
 *  week rows (`grid[week][weekday]`), intensity 0-100 relative to the busiest day. */
export function computeHeatmap(cards: Array<{ due_date: string | null }>, todayStr: string): number[][] {
  const [y, m] = todayStr.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const counts = new Map<string, number>()
  const monthPrefix = todayStr.slice(0, 7)
  for (const c of cards) {
    if (!c.due_date || !c.due_date.startsWith(monthPrefix)) continue
    counts.set(c.due_date, (counts.get(c.due_date) ?? 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  const grid: number[][] = Array.from({ length: 5 }, () => Array(7).fill(0))
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`
    const count = counts.get(dateStr) ?? 0
    const week = Math.ceil(day / 7) - 1
    grid[week][weekdayIndex(dateStr)] = Math.round((count / max) * 100)
  }
  return grid
}

export const fetchDashboard = createServerFn({ method: 'GET' }).handler(async (): Promise<DashboardData> => {
  const headers = new Headers()
  // requireUser throws a redirect (to /login or /pending) for unauthenticated or
  // unapproved users — keep it OUTSIDE the try so that control-flow redirect is
  // not swallowed by the data-error fallback below.
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const [{ data: me }, { data: workspaces }, { data: boards }, { data: notes }, { data: anns }, { data: finance }] =
      await Promise.all([
        supabase.from('profiles').select('name, is_super_admin').eq('id', user.id).single(),
        supabase.from('workspaces').select('id,name').order('created_at'),
        supabase
          .from('boards')
          .select('id,title,priority,workspace_id,columns(title,cards(id,title,due_date,assignee_id))')
          .neq('status', 'archived'),
        supabase.from('notes').select('id,body,category,created_at').order('created_at', { ascending: false }).limit(50),
        supabase
          .from('announcements')
          .select('id,body,created_at,profiles:author_id(name)')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('project_finance').select('value_idr'),
      ])

    const revenue = ((finance ?? []) as Array<{ value_idr: number | null }>).reduce(
      (sum, f) => sum + (f.value_idr ?? 0),
      0,
    )

    // Project-card avatars: real board members (not task assignees), matching
    // the board detail page's "who's on this project" meaning.
    const boardIds = (boards ?? []).map((b) => b.id as string)
    const { data: boardMembers } = boardIds.length
      ? await supabase.from('board_members').select('board_id, profiles(id,name,avatar_url)').in('board_id', boardIds)
      : { data: [] as Array<{ board_id: string; profiles: unknown }> }
    const membersByBoard = new Map<string, DashProjectMember[]>()
    for (const m of (boardMembers ?? []) as Array<{ board_id: string; profiles: unknown }>) {
      const p = (m.profiles as unknown) as { id: string; name: string; avatar_url: string | null } | null
      if (!p) continue
      const list = membersByBoard.get(m.board_id) ?? []
      list.push({ id: p.id, name: p.name, avatar_url: p.avatar_url })
      membersByBoard.set(m.board_id, list)
    }

    const isSuperAdmin = me?.is_super_admin === true
    const approvals = isSuperAdmin
      ? ((await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count ?? 0)
      : 0

    const today = localDateStr()
    const wsName = new Map<string, string>((workspaces ?? []).map((w) => [w.id as string, w.name as string]))
    const wsStat = new Map<string, { total: number; done: number; projects: number }>()

    let totalTasks = 0
    let doneTasks = 0
    let dueToday = 0
    let overdue = 0
    let myTotal = 0
    let myDone = 0
    let myDueToday = 0
    let myOverdue = 0
    const projects: DashProject[] = []
    const priority: DashPriority[] = []
    const myPriority: DashPriority[] = []
    const today_: DashTask[] = []
    const myToday_: DashTask[] = []
    const allCards: Array<{ due_date: string | null; done: boolean }> = []
    let pDone = 0
    let pInProgress = 0

    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      priority: string | null
      workspace_id: string | null
      columns?: unknown[]
    }>) {
      const ws = b.workspace_id
      const s = ws ? wsStat.get(ws) ?? { total: 0, done: 0, projects: 0 } : null
      if (s) s.projects++

      let bTotal = 0
      let bDone = 0
      for (const col of (b.columns ?? []) as Array<{ title: string; cards?: unknown[] }>) {
        const isDone = isDoneColumn(col.title)
        for (const c of (col.cards ?? []) as Array<{
          id: string
          title: string
          due_date: string | null
          assignee_id: string | null
        }>) {
          totalTasks++
          bTotal++
          allCards.push({ due_date: c.due_date, done: isDone })
          const mine = c.assignee_id === user.id
          if (mine) myTotal++
          if (isDone) {
            doneTasks++
            bDone++
            if (mine) myDone++
          }
          if (s) {
            s.total++
            if (isDone) s.done++
          }
          if (!isDone && c.due_date) {
            const d = dayDiff(c.due_date, today)
            if (d < 0) {
              overdue++
              if (mine) myOverdue++
              const p: DashPriority = { id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Overdue' }
              priority.push(p)
              if (mine) myPriority.push(p)
            } else if (d === 0) {
              dueToday++
              today_.push({ id: c.id, title: c.title, boardTitle: b.title })
              if (mine) {
                myDueToday++
                myToday_.push({ id: c.id, title: c.title, boardTitle: b.title })
              }
              const p: DashPriority = { id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due today' }
              priority.push(p)
              if (mine) myPriority.push(p)
            } else if (d === 1) {
              const p: DashPriority = { id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due tomorrow' }
              priority.push(p)
              if (mine) myPriority.push(p)
            } else if (d <= 5) {
              const p: DashPriority = { id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due soon' }
              priority.push(p)
              if (mine) myPriority.push(p)
            }
          }
        }
      }
      if (ws && s) wsStat.set(ws, s)
      const bProgress = bTotal ? Math.round((bDone / bTotal) * 100) : 0
      projects.push({
        id: b.id,
        title: b.title,
        wsName: (ws && wsName.get(ws)) || '',
        progress: bProgress,
        done: bDone,
        total: bTotal,
        members: membersByBoard.get(b.id) ?? [],
      })
      if (bTotal > 0 && bDone === bTotal) pDone++
      else if (bDone > 0) pInProgress++
    }

    const wsList: DashWorkspace[] = (workspaces ?? []).map((w) => {
      const s = wsStat.get(w.id as string) ?? { total: 0, done: 0, projects: 0 }
      const progress = s.total ? Math.round((s.done / s.total) * 100) : 0
      return { id: w.id as string, name: w.name as string, projects: s.projects, tasks: s.total, progress, status: statusFor(progress) }
    })

    const bucketRank = { Overdue: 0, 'Due today': 1, 'Due tomorrow': 2, 'Due soon': 3 }
    priority.sort((a, b) => bucketRank[a.bucket] - bucketRank[b.bucket])
    myPriority.sort((a, b) => bucketRank[a.bucket] - bucketRank[b.bucket])

    const weekProgress = computeWeekProgress(allCards, today)
    const heatmap = computeHeatmap(allCards, today)
    const monthLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })

    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return {
      name: (me?.name as string | null) ?? null,
      approvals,
      stats: {
        workspaces: (workspaces ?? []).length,
        projects: (boards ?? []).length,
        totalTasks,
        dueToday,
        overdue,
        completed: doneTasks,
      },
      myStats: {
        total: myTotal,
        dueToday: myDueToday,
        overdue: myOverdue,
        completed: myDone,
      },
      workspaces: wsList,
      projects: projects.sort((a, b) => b.progress - a.progress),
      priority: priority.slice(0, 6),
      myPriority: myPriority.slice(0, 6),
      today: today_.slice(0, 6),
      myToday: myToday_.slice(0, 6),
      weekProgress,
      heatmap,
      monthLabel,
      projectProgress: { total: (boards ?? []).length, completed: pDone, inProgress: pInProgress },
      revenue,
      notes: (notes ?? []).map((n) => ({
        id: n.id as string,
        body: n.body as string,
        category: (n.category as string | null) ?? null,
        created_at: n.created_at as string,
      })),
      announcements: (anns ?? []).map((a) => {
        const raw = (a as { profiles: unknown }).profiles
        const p = (Array.isArray(raw) ? raw[0] : raw) as { name: string | null } | null
        return { id: a.id as string, body: a.body as string, author: p?.name ?? null }
      }),
    }
  } catch {
    return {
      name: null,
      approvals: 0,
      stats: { workspaces: 0, projects: 0, totalTasks: 0, dueToday: 0, overdue: 0, completed: 0 },
      myStats: { total: 0, dueToday: 0, overdue: 0, completed: 0 },
      workspaces: [],
      projects: [],
      priority: [],
      myPriority: [],
      today: [],
      myToday: [],
      weekProgress: WEEKDAY_LABELS.map((d) => ({ d, v: 0 })),
      heatmap: Array.from({ length: 5 }, () => Array(7).fill(0)),
      monthLabel: '',
      projectProgress: { total: 0, completed: 0, inProgress: 0 },
      revenue: 0,
      notes: [],
      announcements: [],
    }
  }
})

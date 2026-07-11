import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { isDoneColumn } from './home'

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
export type DashProject = { id: string; title: string; wsName: string; progress: number; done: number; total: number }
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
  workspaces: DashWorkspace[]
  projects: DashProject[]
  priority: DashPriority[]
  today: DashTask[]
  projectProgress: { total: number; completed: number; inProgress: number }
  revenue: number
  notes: Array<{ id: string; body: string }>
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

export const fetchDashboard = createServerFn({ method: 'GET' }).handler(async (): Promise<DashboardData> => {
  const headers = new Headers()
  try {
    const { user, supabase } = await requireUser(getRequest(), headers)
    const [{ data: me }, { data: workspaces }, { data: boards }, { data: notes }, { data: anns }, { data: finance }] =
      await Promise.all([
        supabase.from('profiles').select('name, is_super_admin').eq('id', user.id).single(),
        supabase.from('workspaces').select('id,name').order('created_at'),
        supabase
          .from('boards')
          .select('id,title,priority,workspace_id,columns(title,cards(id,title,due_date))')
          .neq('status', 'archived'),
        supabase.from('notes').select('id,body,created_at').order('created_at', { ascending: false }).limit(6),
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

    const isSuperAdmin = me?.is_super_admin === true
    const approvals = isSuperAdmin
      ? ((await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count ?? 0)
      : 0

    const today = new Date().toISOString().slice(0, 10)
    const wsName = new Map<string, string>((workspaces ?? []).map((w) => [w.id as string, w.name as string]))
    const wsStat = new Map<string, { total: number; done: number; projects: number }>()

    let totalTasks = 0
    let doneTasks = 0
    let dueToday = 0
    let overdue = 0
    const projects: DashProject[] = []
    const priority: DashPriority[] = []
    const today_: DashTask[] = []
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
        for (const c of (col.cards ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
          totalTasks++
          bTotal++
          if (isDone) {
            doneTasks++
            bDone++
          }
          if (s) {
            s.total++
            if (isDone) s.done++
          }
          if (!isDone && c.due_date) {
            const d = dayDiff(c.due_date, today)
            if (d < 0) {
              overdue++
              priority.push({ id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Overdue' })
            } else if (d === 0) {
              dueToday++
              today_.push({ id: c.id, title: c.title, boardTitle: b.title })
              priority.push({ id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due today' })
            } else if (d === 1) {
              priority.push({ id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due tomorrow' })
            } else if (d <= 5) {
              priority.push({ id: c.id, title: c.title, boardTitle: b.title, wsName: (ws && wsName.get(ws)) || '', bucket: 'Due soon' })
            }
          }
        }
      }
      if (ws && s) wsStat.set(ws, s)
      const bProgress = bTotal ? Math.round((bDone / bTotal) * 100) : 0
      projects.push({ id: b.id, title: b.title, wsName: (ws && wsName.get(ws)) || '', progress: bProgress, done: bDone, total: bTotal })
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
      workspaces: wsList,
      projects: projects.sort((a, b) => b.progress - a.progress),
      priority: priority.slice(0, 6),
      today: today_.slice(0, 6),
      projectProgress: { total: (boards ?? []).length, completed: pDone, inProgress: pInProgress },
      revenue,
      notes: (notes ?? []).map((n) => ({ id: n.id as string, body: n.body as string })),
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
      workspaces: [],
      projects: [],
      priority: [],
      today: [],
      projectProgress: { total: 0, completed: 0, inProgress: 0 },
      revenue: 0,
      notes: [],
      announcements: [],
    }
  }
})

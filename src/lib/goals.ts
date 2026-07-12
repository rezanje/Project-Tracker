import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

// Assignable, time-bound KPIs/Objectives (migration 0023) — replaces the old
// freeform personal_kpis/personal_objectives split. A goal's `current` value
// only moves through an approved check-in (see submitKpiCheckinFn /
// reviewKpiCheckinFn below), never a direct edit.

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export type Pending = { id: string; proposedValue: number; note: string | null } | null

export type Kpi = {
  id: string
  name: string
  target: number
  current: number
  unit: string | null
  startDate: string | null
  endDate: string | null
  status: 'active' | 'completed' | 'archived'
  pending: Pending
}
export type AssignedKpi = Kpi & { assigneeId: string; assigneeName: string | null }

export type Kr = { id: string; title: string; target: number; current: number; pending: Pending }
export type Objective = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  status: 'active' | 'completed' | 'archived'
  krs: Kr[]
  progress: number
}
export type AssignedObjective = Objective & { assigneeId: string; assigneeName: string | null }

export type MyGoals = { kpis: Kpi[]; objectives: Objective[] }
export type AssignedGoals = { kpis: AssignedKpi[]; objectives: AssignedObjective[] }

function krProgress(krs: Kr[]): number {
  if (!krs.length) return 0
  return Math.round(
    (krs.reduce((a, k) => a + (k.target ? Math.min(1, k.current / k.target) : 0), 0) / krs.length) * 100,
  )
}

type KpiRow = {
  id: string
  name: string
  target: number
  current: number
  unit: string | null
  start_date: string | null
  end_date: string | null
  status: 'active' | 'completed' | 'archived'
  assignee_id: string
  kpi_checkins: Array<{ id: string; proposed_value: number; note: string | null; status: string }>
  profiles?: { name: string | null } | { name: string | null }[] | null
}
type KrRow = {
  id: string
  title: string
  target: number
  current: number
  kr_checkins: Array<{ id: string; proposed_value: number; note: string | null; status: string }>
}
type ObjRow = {
  id: string
  title: string
  start_date: string | null
  end_date: string | null
  status: 'active' | 'completed' | 'archived'
  assignee_id: string
  key_results: KrRow[]
  profiles?: { name: string | null } | { name: string | null }[] | null
}

function pendingOf(checkins: Array<{ id: string; proposed_value: number; note: string | null; status: string }>): Pending {
  const p = checkins.find((c) => c.status === 'pending')
  return p ? { id: p.id, proposedValue: Number(p.proposed_value), note: p.note } : null
}

function nameOf(raw: KpiRow['profiles']): string | null {
  const p = Array.isArray(raw) ? raw[0] : raw
  return p?.name ?? null
}

function toKpi(r: KpiRow): Kpi {
  return {
    id: r.id, name: r.name, target: Number(r.target) || 0, current: Number(r.current) || 0,
    unit: r.unit, startDate: r.start_date, endDate: r.end_date, status: r.status,
    pending: pendingOf(r.kpi_checkins ?? []),
  }
}

function toKr(r: KrRow): Kr {
  return {
    id: r.id, title: r.title, target: Number(r.target) || 0, current: Number(r.current) || 0,
    pending: pendingOf(r.kr_checkins ?? []),
  }
}

function toObjective(r: ObjRow): Objective {
  const krs = (r.key_results ?? []).map(toKr)
  return {
    id: r.id, title: r.title, startDate: r.start_date, endDate: r.end_date, status: r.status,
    krs, progress: krProgress(krs),
  }
}

const KPI_SELECT = 'id,name,target,current,unit,start_date,end_date,status,assignee_id,kpi_checkins(id,proposed_value,note,status)'
const OBJ_SELECT = 'id,title,start_date,end_date,status,assignee_id,key_results(id,title,target,current,kr_checkins(id,proposed_value,note,status))'

/** Goals assigned TO userId — the assignee's own view (e.g. Pixel Home). */
export async function listMyGoals(supabase: SupabaseClient, userId: string): Promise<MyGoals> {
  const [{ data: kpis }, { data: objectives }] = await Promise.all([
    supabase.from('kpis').select(KPI_SELECT).eq('assignee_id', userId).neq('status', 'archived').order('created_at'),
    supabase.from('objectives').select(OBJ_SELECT).eq('assignee_id', userId).neq('status', 'archived').order('created_at'),
  ])
  return {
    kpis: ((kpis ?? []) as KpiRow[]).map(toKpi),
    objectives: ((objectives ?? []) as ObjRow[]).map(toObjective),
  }
}

/**
 * Goals assigned BY ownerId — the owner's review/dashboard view. Pass
 * workspaceId to scope to one workspace (TeamPanel); pass null for every
 * goal this owner has ever assigned (including workspace-less self-goals).
 */
export async function listAssignedGoals(
  supabase: SupabaseClient,
  ownerId: string,
  workspaceId: string | null,
): Promise<AssignedGoals> {
  let kpiQuery = supabase
    .from('kpis')
    .select(`${KPI_SELECT},profiles!assignee_id(name)`)
    .eq('assigned_by', ownerId)
    .neq('status', 'archived')
    .order('created_at')
  let objQuery = supabase
    .from('objectives')
    .select(`${OBJ_SELECT},profiles!assignee_id(name)`)
    .eq('assigned_by', ownerId)
    .neq('status', 'archived')
    .order('created_at')
  if (workspaceId) {
    kpiQuery = kpiQuery.eq('workspace_id', workspaceId)
    objQuery = objQuery.eq('workspace_id', workspaceId)
  }
  const [{ data: kpis }, { data: objectives }] = await Promise.all([kpiQuery, objQuery])
  return {
    kpis: ((kpis ?? []) as KpiRow[]).map((r) => ({ ...toKpi(r), assigneeId: r.assignee_id, assigneeName: nameOf(r.profiles) })),
    objectives: ((objectives ?? []) as ObjRow[]).map((r) => ({ ...toObjective(r), assigneeId: r.assignee_id, assigneeName: nameOf(r.profiles) })),
  }
}

export const fetchMyGoalsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<MyGoals> => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const goals = await listMyGoals(supabase, user.id)
    flush(headers)
    return goals
  } catch {
    return { kpis: [], objectives: [] }
  }
})

export const fetchAssignedGoalsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const workspaceId = (d as { workspaceId?: unknown })?.workspaceId
    return { workspaceId: typeof workspaceId === 'string' ? workspaceId : null }
  })
  .handler(async ({ data }): Promise<AssignedGoals> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    try {
      const goals = await listAssignedGoals(supabase, user.id, data.workspaceId)
      flush(headers)
      return goals
    } catch {
      return { kpis: [], objectives: [] }
    }
  })

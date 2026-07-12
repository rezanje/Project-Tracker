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

export const assignKpiFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    const assigneeId = typeof f.assigneeId === 'string' ? f.assigneeId : ''
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!assigneeId || !name) throw new Error('assigneeId and name required')
    return {
      assigneeId,
      workspaceId: typeof f.workspaceId === 'string' ? f.workspaceId : null,
      name,
      target: Number(f.target) || 0,
      unit: typeof f.unit === 'string' && f.unit.trim() ? f.unit.trim() : null,
      startDate: typeof f.startDate === 'string' && f.startDate ? f.startDate : null,
      endDate: typeof f.endDate === 'string' && f.endDate ? f.endDate : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('kpis').insert({
      name: data.name, target: data.target, unit: data.unit, current: 0,
      assignee_id: data.assigneeId, assigned_by: user.id, workspace_id: data.workspaceId,
      start_date: data.startDate, end_date: data.endDate,
    })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const assignObjectiveFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    const assigneeId = typeof f.assigneeId === 'string' ? f.assigneeId : ''
    const title = typeof f.title === 'string' ? f.title.trim() : ''
    if (!assigneeId || !title) throw new Error('assigneeId and title required')
    return {
      assigneeId,
      workspaceId: typeof f.workspaceId === 'string' ? f.workspaceId : null,
      title,
      startDate: typeof f.startDate === 'string' && f.startDate ? f.startDate : null,
      endDate: typeof f.endDate === 'string' && f.endDate ? f.endDate : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('objectives').insert({
      title: data.title, assignee_id: data.assigneeId, assigned_by: user.id,
      workspace_id: data.workspaceId, start_date: data.startDate, end_date: data.endDate,
    })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const addKeyResultFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    const objectiveId = typeof f.objectiveId === 'string' ? f.objectiveId : ''
    const title = typeof f.title === 'string' ? f.title.trim() : ''
    if (!objectiveId || !title) throw new Error('objectiveId and title required')
    return { objectiveId, title, target: Number(f.target) || 100 }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase
      .from('key_results')
      .insert({ objective_id: data.objectiveId, title: data.title, target: data.target, current: 0 })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const deleteGoalFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { kind, id } = (d ?? {}) as { kind?: unknown; id?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { kind: kind === 'objective' ? ('objective' as const) : ('kpi' as const), id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from(data.kind === 'objective' ? 'objectives' : 'kpis').delete().eq('id', data.id)
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const setGoalStatusFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { kind, id, status } = (d ?? {}) as { kind?: unknown; id?: unknown; status?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    if (status !== 'active' && status !== 'completed' && status !== 'archived') throw new Error('invalid status')
    return { kind: kind === 'objective' ? ('objective' as const) : ('kpi' as const), id, status }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from(data.kind === 'objective' ? 'objectives' : 'kpis').update({ status: data.status }).eq('id', data.id)
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const submitKpiCheckinFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    const kpiId = typeof f.kpiId === 'string' ? f.kpiId : ''
    if (!kpiId) throw new Error('kpiId required')
    if (f.proposedValue == null || Number.isNaN(Number(f.proposedValue))) throw new Error('proposedValue required')
    return {
      kpiId,
      proposedValue: Number(f.proposedValue),
      note: typeof f.note === 'string' && f.note.trim() ? f.note.trim() : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('kpi_checkins').insert({
      kpi_id: data.kpiId, submitted_by: user.id, proposed_value: data.proposedValue, note: data.note,
    })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const submitKrCheckinFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    const krId = typeof f.krId === 'string' ? f.krId : ''
    if (!krId) throw new Error('krId required')
    if (f.proposedValue == null || Number.isNaN(Number(f.proposedValue))) throw new Error('proposedValue required')
    return {
      krId,
      proposedValue: Number(f.proposedValue),
      note: typeof f.note === 'string' && f.note.trim() ? f.note.trim() : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('kr_checkins').insert({
      kr_id: data.krId, submitted_by: user.id, proposed_value: data.proposedValue, note: data.note,
    })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

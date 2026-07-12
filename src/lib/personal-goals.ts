import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

// Personal KPIs/OKRs — scoped to the individual user (personal_kpis /
// personal_objectives / personal_key_results, migration 0019), shown on the
// Pixel Home dashboard. Mirrors the workspace KPI/OKR shape and RLS pattern
// but the owner is always the row's own user_id (see requireUser).

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export type PersonalKpi = { id: string; name: string; target: number; current: number; unit: string | null }
export type PersonalKr = { id: string; title: string; target: number; current: number }
export type PersonalObjective = { id: string; title: string; krs: PersonalKr[]; progress: number }
export type PersonalGoals = { kpis: PersonalKpi[]; okrs: PersonalObjective[] }

export const fetchPersonalGoals = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PersonalGoals> => {
    const headers = new Headers()
    // requireUser redirects unauthenticated/unapproved users — keep it outside
    // the try so the redirect is not swallowed by the empty-list fallback.
    const { user, supabase } = await requireUser(getRequest(), headers)
    try {
      const [{ data: kpis }, { data: objectives }] = await Promise.all([
        supabase
          .from('personal_kpis')
          .select('id,name,target,current,unit')
          .eq('user_id', user.id)
          .order('created_at'),
        supabase
          .from('personal_objectives')
          .select('id,title,personal_key_results(id,title,target,current)')
          .eq('user_id', user.id)
          .order('created_at'),
      ])
      for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
      return {
        kpis: (kpis ?? []) as PersonalKpi[],
        okrs: (objectives ?? []).map((o) => {
          const raw = (o as { personal_key_results?: unknown }).personal_key_results
          const krs = (Array.isArray(raw) ? raw : []) as PersonalKr[]
          const progress = krs.length
            ? Math.round(
                (krs.reduce((a, k) => a + (k.target ? Math.min(1, k.current / k.target) : 0), 0) / krs.length) * 100,
              )
            : 0
          return { id: o.id as string, title: o.title as string, krs, progress }
        }),
      }
    } catch {
      return { kpis: [], okrs: [] }
    }
  },
)

export const personalKpiSaveFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    return {
      id: typeof f.id === 'string' ? f.id : null,
      name: typeof f.name === 'string' ? f.name.trim() : '',
      target: Number(f.target) || 0,
      current: Number(f.current) || 0,
      unit: typeof f.unit === 'string' && f.unit.trim() ? f.unit.trim() : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    if (data.id) {
      await supabase
        .from('personal_kpis')
        .update({ name: data.name, target: data.target, current: data.current, unit: data.unit })
        .eq('id', data.id)
    } else {
      const { error } = await supabase
        .from('personal_kpis')
        .insert({ user_id: user.id, name: data.name || 'KPI', target: data.target, current: data.current, unit: data.unit })
      if (error) throw error
    }
    flush(headers)
  })

export const personalKpiDeleteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await supabase.from('personal_kpis').delete().eq('id', data.id)
    flush(headers)
  })

export const personalObjAddFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const title = (d as { title?: unknown })?.title
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    return { title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('personal_objectives').insert({ user_id: user.id, title: data.title })
    if (error) throw error
    flush(headers)
  })

export const personalObjDeleteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await supabase.from('personal_objectives').delete().eq('id', data.id)
    flush(headers)
  })

export const personalKrSaveFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    return {
      id: typeof f.id === 'string' ? f.id : null,
      objectiveId: typeof f.objectiveId === 'string' ? f.objectiveId : null,
      title: typeof f.title === 'string' ? f.title.trim() : '',
      target: Number(f.target) || 0,
      current: Number(f.current) || 0,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    if (data.id) {
      await supabase
        .from('personal_key_results')
        .update({ title: data.title, target: data.target, current: data.current })
        .eq('id', data.id)
    } else if (data.objectiveId) {
      const { error } = await supabase
        .from('personal_key_results')
        .insert({ objective_id: data.objectiveId, title: data.title || 'Key result', target: data.target || 100, current: data.current })
      if (error) throw error
    }
    flush(headers)
  })

export const personalKrDeleteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await supabase.from('personal_key_results').delete().eq('id', data.id)
    flush(headers)
  })

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from './auth'
import { localDateStr } from './home'

export type EventItem = { id: string; time: string; title: string; sub: string; type: string; people: number }

/** Local HH:MM for a timestamptz string, e.g. '2026-07-14T09:00:00+00' -> '09:00'. */
function timeOf(startsAt: string): string {
  const d = new Date(startsAt)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Events starting today (local day) across whatever workspaces `supabase`'s
 *  RLS-scoped caller belongs to, earliest first. No explicit workspace
 *  filter — same pattern as fetchDashboard's boards query, RLS does the scoping. */
export async function listTodayEvents(supabase: SupabaseClient, todayStr: string = localDateStr()): Promise<EventItem[]> {
  const { data } = await supabase
    .from('events')
    .select('id,title,sub,event_type,starts_at,attendee_ids')
    .gte('starts_at', `${todayStr}T00:00:00`)
    .lte('starts_at', `${todayStr}T23:59:59`)
    .order('starts_at')
  return ((data ?? []) as Array<{
    id: string
    title: string
    sub: string | null
    event_type: string
    starts_at: string
    attendee_ids: string[]
  }>).map((r) => ({
    id: r.id,
    time: timeOf(r.starts_at),
    title: r.title,
    sub: r.sub ?? '',
    type: r.event_type,
    people: r.attendee_ids.length,
  }))
}

export const fetchTodayEventsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<EventItem[]> => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  try {
    const list = await listTodayEvents(supabase)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return list
  } catch {
    return []
  }
})

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type Notification = {
  id: string
  kind: 'assignment' | 'reminder' | 'approval'
  message: string
  boardId: string | null
  read: boolean
  createdAt: string
}

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

// Merges two sources into one feed: card-assignment notifications (pushed by
// the on_card_assignee_change DB trigger) and reminders whose remind_at has
// passed (no cron/push — a due reminder just surfaces next time this loads).
export const fetchNotificationsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Notification[]> => {
    const headers = new Headers()
    const { supabase, profile } = await requireUser(getRequest(), headers)
    const nowIso = new Date().toISOString()
    const [{ data: notifs }, { data: reminders }, { data: pending }] = await Promise.all([
      supabase
        .from('notifications')
        .select('id,message,board_id,read_at,created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('reminders')
        .select('id,message,remind_at')
        .is('dismissed_at', null)
        .lte('remind_at', nowIso)
        .order('remind_at', { ascending: false })
        .limit(20),
      profile.is_super_admin
        ? supabase
            .from('profiles')
            .select('id,name,created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    flush(headers)

    const fromNotifs: Notification[] = ((notifs ?? []) as Array<{
      id: string
      message: string
      board_id: string | null
      read_at: string | null
      created_at: string
    }>).map((n) => ({
      id: n.id,
      kind: 'assignment',
      message: n.message,
      boardId: n.board_id,
      read: n.read_at != null,
      createdAt: n.created_at,
    }))

    const fromReminders: Notification[] = ((reminders ?? []) as Array<{
      id: string
      message: string
      remind_at: string
    }>).map((r) => ({
      id: r.id,
      kind: 'reminder',
      message: `Reminder: ${r.message}`,
      boardId: null,
      read: false,
      createdAt: r.remind_at,
    }))

    const fromApprovals: Notification[] = ((pending ?? []) as Array<{
      id: string
      name: string | null
      created_at: string
    }>).map((p) => ({
      id: p.id,
      kind: 'approval',
      message: `${p.name ?? 'Someone'} wants to join — approve their request`,
      boardId: null,
      read: false,
      createdAt: p.created_at,
    }))

    return [...fromNotifs, ...fromReminders, ...fromApprovals]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
  },
)

export const markNotificationReadFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, kind } = (d ?? {}) as { id?: unknown; kind?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id, kind: kind === 'reminder' ? ('reminder' as const) : ('assignment' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const now = new Date().toISOString()
    if (data.kind === 'reminder') {
      await supabase.from('reminders').update({ dismissed_at: now }).eq('id', data.id)
    } else {
      await supabase.from('notifications').update({ read_at: now }).eq('id', data.id)
    }
    flush(headers)
    return { ok: true }
  })

export const markAllNotificationsReadFn = createServerFn({ method: 'POST' }).handler(async () => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  const now = new Date().toISOString()
  await Promise.all([
    supabase.from('notifications').update({ read_at: now }).is('read_at', null),
    supabase.from('reminders').update({ dismissed_at: now }).is('dismissed_at', null).lte('remind_at', now),
  ])
  flush(headers)
  return { ok: true }
})

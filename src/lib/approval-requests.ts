import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from './auth'

export type ApprovalKind = 'budget' | 'leave' | 'content'
export type ApprovalRequest = { id: string; kind: ApprovalKind; title: string; sub: string; meta: string }

/** Rp / date-range / count copy per request kind, from the request's jsonb `meta`. */
export function formatApprovalMeta(kind: ApprovalKind, meta: Record<string, unknown>): string {
  if (kind === 'budget') return `Rp ${(Number(meta.amount) || 0).toLocaleString('id-ID')}`
  if (kind === 'leave') return `${meta.from ?? ''} - ${meta.to ?? ''}`
  return `${Number(meta.count) || 0} Konten`
}

/** Pending requests across workspaces `userId` owns — what they're personally
 *  authorized to act on (narrower than the events_read-style "any member can
 *  see it exists" RLS read policy). */
export async function listPendingApprovals(supabase: SupabaseClient, userId: string): Promise<ApprovalRequest[]> {
  const { data } = await supabase
    .from('approval_requests')
    .select('id,kind,title,meta,workspaces!inner(name,owner_id)')
    .eq('workspaces.owner_id', userId)
    .eq('status', 'pending')
    .order('created_at')
  return ((data ?? []) as Array<{
    id: string
    kind: ApprovalKind
    title: string
    meta: Record<string, unknown>
    workspaces: { name: string; owner_id: string } | { name: string; owner_id: string }[]
  }>).map((r) => {
    const ws = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces
    return { id: r.id, kind: r.kind, title: r.title, sub: ws?.name ?? '', meta: formatApprovalMeta(r.kind, r.meta) }
  })
}

/** Resolve a pending request. RLS (`approval_requests_resolve`) restricts this to
 *  workspace owners; the `.eq('status','pending')` guard stops a second click
 *  from re-resolving an already-decided row. */
export async function resolveApproval(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('approval_requests')
    .update({ status: decision, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw error
}

export const fetchPendingApprovalsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<ApprovalRequest[]> => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const list = await listPendingApprovals(supabase, user.id)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return list
  } catch {
    return []
  }
})

export const resolveApprovalFn = createServerFn({ method: 'POST' })
  .validator((d: unknown): { id: string; decision: 'approved' | 'rejected' } => {
    const { id, decision } = (d ?? {}) as { id?: unknown; decision?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('decision must be approved or rejected')
    return { id, decision }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await resolveApproval(supabase, user.id, data.id, data.decision)
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return { ok: true }
  })

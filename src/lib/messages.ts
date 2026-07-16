import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type Thread = {
  id: string
  kind: 'dm' | 'group'
  title: string
  lastMessage: string | null
  lastAt: string | null
  unread: number
}

export type Message = {
  id: string
  threadId: string
  senderId: string
  senderName: string
  body: string
  createdAt: string
}

export type MessageableMember = { id: string; name: string }

/**
 * Find the existing 1-on-1 DM thread between `meId` and `otherUserId`, or create
 * one in a workspace they share. Returns the thread id.
 * ponytail: a race can create a duplicate DM thread — very rare; add a unique
 * index on a canonical sorted-pair key if it ever happens.
 */
export async function openDm(
  supabase: SupabaseClient,
  meId: string,
  otherUserId: string,
): Promise<string> {
  // RLS on message_threads.select returns only threads I'm in, so a 'dm' thread
  // that also contains otherUserId is our existing DM.
  const { data: myDmThreads } = await supabase
    .from('message_threads')
    .select('id')
    .eq('kind', 'dm')
  const ids = (myDmThreads ?? []).map((t) => t.id as string)
  if (ids.length) {
    const { data: withOther } = await supabase
      .from('thread_participants')
      .select('thread_id')
      .eq('user_id', otherUserId)
      .in('thread_id', ids)
    if (withOther && withOther.length) return withOther[0].thread_id as string
  }

  // Pick a workspace both users belong to.
  const [{ data: myWs }, { data: theirWs }] = await Promise.all([
    supabase.from('workspace_members').select('workspace_id').eq('user_id', meId),
    supabase.from('workspace_members').select('workspace_id').eq('user_id', otherUserId),
  ])
  const theirs = new Set((theirWs ?? []).map((r) => r.workspace_id as string))
  const shared = (myWs ?? []).map((r) => r.workspace_id as string).find((w) => theirs.has(w))
  if (!shared) throw new Error('No shared workspace with that member')

  const { data: thread, error } = await supabase
    .from('message_threads')
    .insert({ workspace_id: shared, kind: 'dm', created_by: meId })
    .select('id')
    .single()
  if (error) throw error
  const threadId = thread!.id as string

  const { error: pErr } = await supabase.from('thread_participants').insert([
    { thread_id: threadId, user_id: meId },
    { thread_id: threadId, user_id: otherUserId },
  ])
  if (pErr) throw pErr
  return threadId
}

export async function sendMessage(
  supabase: SupabaseClient,
  threadId: string,
  senderId: string,
  body: string,
): Promise<string> {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Message body required')
  const { data, error } = await supabase
    .from('messages')
    .insert({ thread_id: threadId, sender_id: senderId, body: trimmed })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
}

/** Raw ascending messages for a thread (RLS restricts to participants). */
export async function fetchThreadMessages(supabase: SupabaseClient, threadId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('id,thread_id,sender_id,body,created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    thread_id: string
    sender_id: string
    body: string
    created_at: string
  }>
}

export async function markThreadRead(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
): Promise<void> {
  await supabase
    .from('thread_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', userId)
}

/**
 * Threads the user participates in, newest-activity first. Title for a DM is the
 * other participant's name; `unread` counts messages from other senders newer
 * than the user's last_read_at.
 * ponytail: pulls all messages for the user's threads to derive previews +
 * unread in memory; fine at team scale, move to an RPC if volume grows.
 */
export async function listThreads(
  supabase: SupabaseClient,
  userId: string,
): Promise<Thread[]> {
  const { data: myParts } = await supabase
    .from('thread_participants')
    .select('thread_id, last_read_at')
    .eq('user_id', userId)
  const lastRead = new Map<string, string>(
    (myParts ?? []).map((p) => [p.thread_id as string, p.last_read_at as string]),
  )
  const threadIds = [...lastRead.keys()]
  if (!threadIds.length) return []

  const [{ data: threads }, { data: parts }, { data: msgs }] = await Promise.all([
    supabase.from('message_threads').select('id,kind,name').in('id', threadIds),
    supabase
      .from('thread_participants')
      .select('thread_id, user_id, profiles(name)')
      .in('thread_id', threadIds),
    supabase
      .from('messages')
      .select('thread_id, body, created_at, sender_id')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false }),
  ])

  const lastMsg = new Map<string, { body: string; created_at: string }>()
  const unread = new Map<string, number>()
  for (const m of msgs ?? []) {
    const tid = m.thread_id as string
    if (!lastMsg.has(tid)) lastMsg.set(tid, { body: m.body as string, created_at: m.created_at as string })
    const lr = lastRead.get(tid)
    if (m.sender_id !== userId && (!lr || (m.created_at as string) > lr)) {
      unread.set(tid, (unread.get(tid) ?? 0) + 1)
    }
  }

  const otherName = new Map<string, string>()
  for (const p of parts ?? []) {
    if (p.user_id !== userId) {
      const name = ((p.profiles as unknown) as { name: string } | null)?.name ?? 'Unknown'
      otherName.set(p.thread_id as string, name)
    }
  }

  return (threads ?? [])
    .map((t) => ({
      id: t.id as string,
      kind: t.kind as 'dm' | 'group',
      title: (t.name as string | null) ?? otherName.get(t.id as string) ?? 'Direct message',
      lastMessage: lastMsg.get(t.id as string)?.body ?? null,
      lastAt: lastMsg.get(t.id as string)?.created_at ?? null,
      unread: unread.get(t.id as string) ?? 0,
    }))
    .sort((a, b) =>
      (a.lastAt ?? '') < (b.lastAt ?? '') ? 1 : (a.lastAt ?? '') > (b.lastAt ?? '') ? -1 : 0,
    )
}

export async function countInboxUnread(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const threads = await listThreads(supabase, userId)
  return threads.reduce((n, t) => n + t.unread, 0)
}

/** Distinct members across the caller's workspaces, excluding self. */
export async function listMessageableMembers(
  supabase: SupabaseClient,
  userId: string,
): Promise<MessageableMember[]> {
  const { data: myWs } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
  const wsIds = (myWs ?? []).map((r) => r.workspace_id as string)
  if (!wsIds.length) return []
  const { data: members } = await supabase
    .from('workspace_members')
    .select('user_id, profiles(id,name)')
    .in('workspace_id', wsIds)
  const seen = new Map<string, string>()
  for (const m of members ?? []) {
    const p = (m.profiles as unknown) as { id: string; name: string } | null
    const id = p?.id ?? (m.user_id as string)
    if (id !== userId) seen.set(id, p?.name ?? 'Unknown')
  }
  return [...seen].map(([id, name]) => ({ id, name }))
}

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export const fetchThreadsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Thread[]> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const threads = await listThreads(supabase, user.id)
    flush(headers)
    return threads
  },
)

export const fetchInboxUnreadFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<number> => {
    const headers = new Headers()
    try {
      const { user, supabase } = await requireUser(getRequest(), headers)
      const n = await countInboxUnread(supabase, user.id)
      flush(headers)
      return n
    } catch {
      return 0
    }
  },
)

export const fetchMessageableMembersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MessageableMember[]> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const members = await listMessageableMembers(supabase, user.id)
    flush(headers)
    return members
  },
)

export const openDmFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const otherUserId = (d as { otherUserId?: unknown })?.otherUserId
    if (typeof otherUserId !== 'string' || !otherUserId) throw new Error('otherUserId required')
    return { otherUserId }
  })
  .handler(async ({ data }): Promise<{ threadId: string }> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const threadId = await openDm(supabase, user.id, data.otherUserId)
    flush(headers)
    return { threadId }
  })

export const fetchMessagesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const threadId = (d as { threadId?: unknown })?.threadId
    if (typeof threadId !== 'string' || !threadId) throw new Error('threadId required')
    return { threadId }
  })
  .handler(async ({ data }): Promise<Message[]> => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { data: rows } = await supabase
      .from('messages')
      .select('id,thread_id,sender_id,body,created_at, profiles(name)')
      .eq('thread_id', data.threadId)
      .order('created_at', { ascending: true })
    flush(headers)
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      threadId: r.thread_id as string,
      senderId: r.sender_id as string,
      senderName: ((r.profiles as { name?: string } | null)?.name) ?? 'Unknown',
      body: r.body as string,
      createdAt: r.created_at as string,
    }))
  })

export const sendMessageFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { threadId, body } = (d ?? {}) as { threadId?: unknown; body?: unknown }
    if (typeof threadId !== 'string' || !threadId) throw new Error('threadId required')
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    return { threadId, body: body.trim() }
  })
  .handler(async ({ data }): Promise<{ id: string }> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const id = await sendMessage(supabase, data.threadId, user.id, data.body)
    flush(headers)
    return { id }
  })

export const markThreadReadFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const threadId = (d as { threadId?: unknown })?.threadId
    if (typeof threadId !== 'string' || !threadId) throw new Error('threadId required')
    return { threadId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await markThreadRead(supabase, data.threadId, user.id)
    flush(headers)
    return { ok: true }
  })

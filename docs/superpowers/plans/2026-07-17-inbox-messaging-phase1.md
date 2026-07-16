# Inbox Messaging (Phase 1: 1-on-1 DM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the placeholder `Inbox` nav item into a real one-on-one, realtime direct-messaging page between workspace members, with a live unread badge.

**Architecture:** New Postgres tables (`message_threads`, `thread_participants`, `messages`) with RLS mirroring the workspace security-definer pattern. Core DB logic lives as pure helper functions in `src/lib/messages.ts` (RLS-tested against the real remote DB with anon clients), wrapped by thin `createServerFn` handlers. A new `/inbox` route renders a two-pane UI and subscribes to Supabase Realtime for live message append, reusing the `Comments.tsx` channel pattern.

**Tech Stack:** TanStack Start (React), `@supabase/supabase-js`, Supabase Postgres + RLS + Realtime, Vitest (integration tests hit the real remote DB), dotto/shadcn UI components.

**Spec:** `docs/superpowers/specs/2026-07-17-inbox-messaging-design.md`

---

## File Structure

- **Create** `supabase/migrations/0030_messaging.sql` — tables, realtime publication, RLS + `is_thread_participant` helper.
- **Create** `src/lib/messages.ts` — pure helpers (`openDm`, `sendMessage`, `fetchThreadMessages`, `markThreadRead`, `listThreads`, `countInboxUnread`, `listMessageableMembers`) + server-fn wrappers (`openDmFn`, `sendMessageFn`, `fetchMessagesFn`, `markThreadReadFn`, `fetchThreadsFn`, `fetchInboxUnreadFn`, `fetchMessageableMembersFn`).
- **Create** `src/lib/messages.test.ts` — RLS integration tests for the pure helpers.
- **Create** `src/routes/inbox.tsx` — the `/inbox` page (thread list + conversation + composer + realtime).
- **Modify** `src/components/Sidebar.tsx` — nav item → `/inbox`, real unread badge.
- **Modify** `src/components/MobileNav.tsx` — Inbox link → `/inbox`, real unread badge.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0030_messaging.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0030_messaging.sql`:

```sql
-- Inbox messaging: threads, participants, messages. Schema carries a `kind`
-- and nullable `name` so Phase 2 group threads reuse these tables unchanged.
create table message_threads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null check (kind in ('dm','group')),
  name         text,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

create table thread_participants (
  thread_id    uuid not null references message_threads(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references message_threads(id) on delete cascade,
  sender_id  uuid not null references profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);

create index messages_thread_created_idx on messages (thread_id, created_at);
create index thread_participants_user_idx on thread_participants (user_id);

-- Security-definer membership check (same pattern as is_workspace_member in 0012).
create function is_thread_participant(t uuid) returns boolean
  language sql security definer stable as $$
  select exists (
    select 1 from thread_participants
    where thread_id = t and user_id = auth.uid()
  );
$$;

alter table message_threads    enable row level security;
alter table thread_participants enable row level security;
alter table messages            enable row level security;

-- Threads: read if participant; create if a workspace member creating your own.
create policy mt_read on message_threads for select
  using (is_thread_participant(id));
create policy mt_insert on message_threads for insert
  with check (is_workspace_member(workspace_id) and created_by = auth.uid());

-- Participants: read if you're in the thread; write rows for a thread you created.
create policy tp_read on thread_participants for select
  using (is_thread_participant(thread_id));
create policy tp_write on thread_participants for all
  using (exists (select 1 from message_threads t
                 where t.id = thread_id and t.created_by = auth.uid()))
  with check (exists (select 1 from message_threads t
                      where t.id = thread_id and t.created_by = auth.uid()));

-- Messages: read if participant; insert your own into threads you're in. Immutable.
create policy msg_read on messages for select
  using (is_thread_participant(thread_id));
create policy msg_insert on messages for insert
  with check (is_thread_participant(thread_id) and sender_id = auth.uid());

-- Realtime: broadcast message INSERTs (idempotent, same shape as 0006_realtime.sql).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
```

- [ ] **Step 2: Apply the migration to the remote DB**

The remote DB has no local Docker (see `CLAUDE.md`). Apply via the Supabase MCP tool (uses OAuth, not the DB password):

- Call `mcp__807b22d2-3761-4301-bdb2-1317fb5086ac__apply_migration` with `project_id: "tzhquesopfxevsucoapb"`, `name: "0030_messaging"`, and `query` set to the full SQL above.

If the MCP tool is unavailable, STOP and ask the user to apply `0030_messaging.sql` via the Supabase Dashboard SQL Editor before continuing — the integration tests in Task 2 hit the real remote DB and will fail until the tables exist.

- [ ] **Step 3: Verify the tables exist**

Call `mcp__807b22d2-3761-4301-bdb2-1317fb5086ac__list_tables` with `project_id: "tzhquesopfxevsucoapb"`, `schemas: ["public"]`.
Expected: `message_threads`, `thread_participants`, `messages` present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0030_messaging.sql
git commit -m "feat(db): add messaging tables + RLS for Inbox (0030)"
```

---

## Task 2: Core DB helpers (`messages.ts`) — TDD

**Files:**
- Create: `src/lib/messages.ts`
- Test: `src/lib/messages.test.ts`

- [ ] **Step 1: Write the pure helpers (no server fns yet)**

Create `src/lib/messages.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type { SupabaseClient } from '@supabase/supabase-js'
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

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

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
    .sort((a, b) => ((a.lastAt ?? '') < (b.lastAt ?? '') ? 1 : -1))
}

export async function countInboxUnread(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const threads = await listThreads(supabase, userId)
  return threads.reduce((n, t) => n + t.unread, 0)
}

/** Distinct approved members across the caller's workspaces, excluding self. */
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
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/messages.test.ts`. Reuse the `.dev.vars` + `makeSignedInUser` harness from `src/lib/notes.test.ts`, and add a helper that puts two users in the same workspace:

```ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import {
  openDm,
  sendMessage,
  fetchThreadMessages,
  markThreadRead,
  countInboxUnread,
} from './messages'

const env = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function makeSignedInUser(prefix: string) {
  const email = `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: prefix },
  })
  const uid = u.user!.id
  const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
  await userClient.auth.signInWithPassword({ email, password })
  return { uid, userClient, email }
}

/** Create a workspace owned by `ownerUid` and add `memberUid` to it (admin path). */
async function sharedWorkspace(ownerUid: string, memberUid: string) {
  const { data: ws } = await admin
    .from('workspaces')
    .insert({ name: `ws-${Date.now()}`, owner_id: ownerUid })
    .select('id')
    .single()
  const wsId = ws!.id as string
  // owner_id trigger inserts the owner row; add the member explicitly.
  await admin.from('workspace_members').insert({ workspace_id: wsId, user_id: memberUid, role: 'member' })
  return wsId
}

async function cleanup(wsId: string, ...uids: string[]) {
  await admin.from('workspaces').delete().eq('id', wsId) // cascades threads/messages
  for (const uid of uids) await admin.auth.admin.deleteUser(uid)
}

test('openDm creates one thread and returns the same id on a second call', async () => {
  const a = await makeSignedInUser('dm-a')
  const b = await makeSignedInUser('dm-b')
  const wsId = await sharedWorkspace(a.uid, b.uid)
  try {
    const t1 = await openDm(a.userClient, a.uid, b.uid)
    const t2 = await openDm(a.userClient, a.uid, b.uid)
    expect(t1).toBe(t2)
    const { count } = await admin
      .from('message_threads')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
    expect(count).toBe(1)
  } finally {
    await cleanup(wsId, a.uid, b.uid)
  }
}, 30000)

test('sendMessage + fetchThreadMessages round-trip in order', async () => {
  const a = await makeSignedInUser('msg-a')
  const b = await makeSignedInUser('msg-b')
  const wsId = await sharedWorkspace(a.uid, b.uid)
  try {
    const tid = await openDm(a.userClient, a.uid, b.uid)
    await sendMessage(a.userClient, tid, a.uid, 'hello')
    await sendMessage(b.userClient, tid, b.uid, 'hi back')
    const msgs = await fetchThreadMessages(a.userClient, tid)
    expect(msgs.map((m) => m.body)).toEqual(['hello', 'hi back'])
  } finally {
    await cleanup(wsId, a.uid, b.uid)
  }
}, 30000)

test('countInboxUnread counts other-sender messages then clears after markThreadRead', async () => {
  const a = await makeSignedInUser('unread-a')
  const b = await makeSignedInUser('unread-b')
  const wsId = await sharedWorkspace(a.uid, b.uid)
  try {
    const tid = await openDm(a.userClient, a.uid, b.uid)
    await sendMessage(b.userClient, tid, b.uid, 'ping')
    await sendMessage(b.userClient, tid, b.uid, 'ping 2')
    expect(await countInboxUnread(a.userClient, a.uid)).toBe(2)
    await markThreadRead(a.userClient, tid, a.uid)
    expect(await countInboxUnread(a.userClient, a.uid)).toBe(0)
  } finally {
    await cleanup(wsId, a.uid, b.uid)
  }
}, 30000)

test('RLS: a non-participant cannot read a thread\'s messages', async () => {
  const a = await makeSignedInUser('rls-a')
  const b = await makeSignedInUser('rls-b')
  const c = await makeSignedInUser('rls-c')
  const wsId = await sharedWorkspace(a.uid, b.uid)
  await admin.from('workspace_members').insert({ workspace_id: wsId, user_id: c.uid, role: 'member' })
  try {
    const tid = await openDm(a.userClient, a.uid, b.uid)
    await sendMessage(a.userClient, tid, a.uid, 'secret')
    // c is in the workspace but NOT a participant of the a<->b DM.
    const msgs = await fetchThreadMessages(c.userClient, tid)
    expect(msgs).toHaveLength(0)
  } finally {
    await cleanup(wsId, a.uid, b.uid, c.uid)
  }
}, 30000)

test('openDm throws when the two users share no workspace', async () => {
  const a = await makeSignedInUser('nows-a')
  const b = await makeSignedInUser('nows-b')
  // a has a workspace; b is not a member of it.
  const { data: ws } = await admin
    .from('workspaces')
    .insert({ name: `ws-${Date.now()}`, owner_id: a.uid })
    .select('id')
    .single()
  const wsId = ws!.id as string
  try {
    await expect(openDm(a.userClient, a.uid, b.uid)).rejects.toThrow()
  } finally {
    await cleanup(wsId, a.uid, b.uid)
  }
}, 30000)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- messages`
Expected: FAIL — the assertions run but at least the suite executes; if the migration from Task 1 is not applied, tests fail with a Postgres "relation ... does not exist" error. If you see that, apply the migration (Task 1 Step 2) first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- messages`
Expected: PASS (5 tests). Fix helper logic if any fail; do not weaken the tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Commit**

```bash
git add src/lib/messages.ts src/lib/messages.test.ts
git commit -m "feat(messages): core DM helpers with RLS integration tests"
```

---

## Task 3: Server-fn wrappers

**Files:**
- Modify: `src/lib/messages.ts` (append server fns)

- [ ] **Step 1: Append the server fns to `src/lib/messages.ts`**

Add at the end of the file:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Commit**

```bash
git add src/lib/messages.ts
git commit -m "feat(messages): add server-fn wrappers"
```

---

## Task 4: `/inbox` route

**Files:**
- Create: `src/routes/inbox.tsx`
- Run: `npm run generate-routes` (regenerates `src/routeTree.gen.ts`)

- [ ] **Step 1: Create the route component**

Create `src/routes/inbox.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import {
  fetchThreadsFn,
  fetchMessagesFn,
  sendMessageFn,
  openDmFn,
  markThreadReadFn,
  fetchMessageableMembersFn,
  type Thread,
  type Message,
  type MessageableMember,
} from '#/lib/messages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function InboxPage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState('')
  const [picking, setPicking] = useState(false)
  const [members, setMembers] = useState<MessageableMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const active = threads.find((t) => t.id === activeId) ?? null

  useEffect(() => {
    getBrowserSupabase()
      .auth.getUser()
      .then((res) => setMeId(res.data.user?.id ?? ''))
    fetchThreadsFn().then(setThreads).catch(() => {})
  }, [])

  // Load messages + realtime for the active thread.
  useEffect(() => {
    if (!activeId) return
    let alive = true
    fetchMessagesFn({ data: { threadId: activeId } }).then((m) => {
      if (alive) setMessages(m)
    })
    markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
    setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t)))

    const otherName = active?.title ?? 'Unknown'
    const supabase = getBrowserSupabase()
    const channel = supabase
      .channel(`messages:${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${activeId}` },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as { id: string; sender_id: string; body: string; created_at: string }
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev
            return [
              ...prev,
              {
                id: row.id,
                threadId: activeId,
                senderId: row.sender_id,
                senderName: row.sender_id === meId ? 'Me' : otherName,
                body: row.body,
                createdAt: row.created_at,
              },
            ]
          })
          if (row.sender_id !== meId) markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
        },
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, meId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || !activeId) return
    setDraft('')
    setError(null)
    try {
      await sendMessageFn({ data: { threadId: activeId, body } })
      fetchThreadsFn().then(setThreads).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
      setDraft(body)
    }
  }

  async function startDm(member: MessageableMember) {
    setPicking(false)
    try {
      const { threadId } = await openDmFn({ data: { otherUserId: member.id } })
      const list = await fetchThreadsFn()
      setThreads(list)
      setActiveId(threadId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat')
    }
  }

  function openPicker() {
    setPicking(true)
    fetchMessageableMembersFn().then(setMembers).catch(() => {})
  }

  return (
    <div className="page-wrap grid gap-4 py-6 md:grid-cols-[280px_1fr]">
      {/* Thread list */}
      <aside className="card p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">Messages</p>
          <Button size="sm" variant="secondary" onClick={openPicker}>New</Button>
        </div>
        {threads.length === 0 && (
          <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No conversations yet.</p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveId(t.id)}
            className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--col)] ${
              t.id === activeId ? 'bg-[var(--accent-soft)]' : ''
            }`}
          >
            <span className="flex w-full items-center justify-between">
              <span className={`text-[13px] ${t.unread ? 'font-extrabold text-[var(--ink)]' : 'font-semibold text-[var(--ink)]'}`}>
                {t.title}
              </span>
              {t.unread > 0 && (
                <span className="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-white">
                  {t.unread}
                </span>
              )}
            </span>
            {t.lastMessage && <span className="truncate text-[11px] text-[var(--ink3)]">{t.lastMessage}</span>}
          </button>
        ))}
      </aside>

      {/* Conversation */}
      <section className="card flex min-h-[60vh] flex-col p-0">
        {!active ? (
          <div className="grid flex-1 place-items-center text-[13px] text-[var(--ink3)]">
            Pick a conversation, or start a new one.
          </div>
        ) : (
          <>
            <div className="border-b-2 border-[var(--ink)] px-4 py-2.5">
              <p className="display-title text-lg font-extrabold text-[var(--ink)]">{active.title}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.senderId === meId ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-lg border-2 border-[var(--ink)] px-3 py-1.5 text-[13px] ${
                      m.senderId === meId ? 'bg-[var(--accent-soft)]' : 'bg-[var(--card)]'
                    }`}
                  >
                    {m.body}
                  </div>
                  <span className="mt-0.5 text-[10px] text-[var(--ink3)]">{timeAgo(m.createdAt)}</span>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {error && <p className="px-4 pb-1 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
              className="flex gap-2 border-t-2 border-[var(--ink)] p-3"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message"
                className="flex-1"
              />
              <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                <Send size={16} />
              </Button>
            </form>
          </>
        )}
      </section>

      {/* Member picker */}
      {picking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setPicking(false)}>
          <div className="card w-full max-w-sm p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">New message</p>
            {members.length === 0 && (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No members to message.</p>
            )}
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => startDm(m)}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
})
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run generate-routes`
Expected: `src/routeTree.gen.ts` updates to include `/inbox` (no errors).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add src/routes/inbox.tsx src/routeTree.gen.ts
git commit -m "feat(inbox): add /inbox route with realtime DM UI"
```

---

## Task 5: Wire the sidebar + mobile nav

**Files:**
- Modify: `src/components/Sidebar.tsx:44-51` (nav type + item), and the mount effect + render (`:64-75`, `:144-164`)
- Modify: `src/components/MobileNav.tsx` (Inbox link `to` + badge)

- [ ] **Step 1: Point the Sidebar nav item at `/inbox` and drop the hardcoded badge**

In `src/components/Sidebar.tsx`, update the `MAIN_NAV` type union and the Inbox entry:

```ts
const MAIN_NAV: Array<{
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  to: '/home' | '/' | '/inbox' | '/my-tasks' | '/calendar' | '/reports'
  badge?: number
}> = [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Command Center', icon: LayoutDashboard, to: '/' },
  { label: 'Inbox', icon: Inbox, to: '/inbox' },
  { label: 'My Tasks', icon: CheckSquare, to: '/my-tasks' },
  { label: 'Calendar', icon: Calendar, to: '/calendar' },
  { label: 'Reports', icon: BarChart3, to: '/reports' },
]
```

(Note: `/coming-soon` is no longer referenced by this array. Leave the rest of the file's imports as-is.)

- [ ] **Step 2: Load the real unread count on mount**

In `src/components/Sidebar.tsx`, add the import near the other lib imports:

```ts
import { fetchInboxUnreadFn } from '#/lib/messages'
```

Add state alongside the other `useState` hooks in `Sidebar` (near `const [pendingApprovals, setPendingApprovals] = useState(0)`):

```ts
const [inboxUnread, setInboxUnread] = useState(0)
```

Inside the existing mount `useEffect` (the one that calls `fetchNav().then(...)`), add after the `fetchNav` call:

```ts
fetchInboxUnreadFn().then(setInboxUnread).catch(() => {})
```

- [ ] **Step 3: Render the real badge for Inbox**

In `src/components/Sidebar.tsx`, in the `MAIN_NAV.map(...)` render (around line 144), replace the destructure + badge line so Inbox uses the live count:

```tsx
        {MAIN_NAV.map(({ label, icon: Icon, to, badge }) => {
          const active = pathname === to
          const count = label === 'Inbox' ? inboxUnread : badge
          return (
            <Link
              key={label}
              to={to}
              title={label}
              className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold no-underline ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${active ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--ink2)] hover:bg-[var(--col)]'}`}
            >
              <Icon size={16} className="shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{label}</span>}
              {!collapsed && count != null && count > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </Link>
          )
        })}
```

- [ ] **Step 4: Point MobileNav's Inbox link at `/inbox`**

In `src/components/MobileNav.tsx`, find the Inbox link (`to="/coming-soon"` next to `<Inbox ... /> Inbox`, around line 153) and change `to="/coming-soon"` to `to="/inbox"`. Leave the second `/coming-soon` reference (a different nav item) unchanged. Also update the `morePages` array (line 87) to include `/inbox` so the "More" tab highlights correctly:

```ts
const morePages = ['/reports', '/inbox', '/admin/approvals']
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/MobileNav.tsx
git commit -m "feat(inbox): wire sidebar + mobile nav to /inbox with live unread badge"
```

---

## Task 6: End-to-end verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Ensure the dev server is running**

Use the preview tool (`preview_start` with `{ name: "rakit-dev" }`) if not already up. Navigate to `http://localhost:4321/inbox`.

- [ ] **Step 2: Verify the page renders and lists members**

- `read_console_messages` (onlyErrors) and `preview_logs` (error) → expect no errors.
- Click **New** → the member picker should list workspace members (not yourself).
- Pick a member → a conversation opens (empty state).

- [ ] **Step 3: Verify send + persistence**

- Type a message and send → it appears right-aligned; the composer clears.
- Reload `/inbox`, reopen the thread → the message is still there (persisted).
- Confirm the thread appears in the left list with a preview.

- [ ] **Step 4: Verify the unread badge**

- With a second signed-in user (or via the admin client inserting a message from the other participant), confirm the sidebar **Inbox** badge shows a count, and that opening the thread clears it.

- [ ] **Step 5: Screenshot for proof**

Take a `computer{action:"screenshot"}` of the `/inbox` page with a conversation open and share it.

---

## Self-review notes

- **Spec coverage:** tables + RLS + realtime (Task 1); all seven server fns + pure helpers (Tasks 2–3); `/inbox` two-pane UI + realtime + composer + member picker (Task 4); badge replacing hardcoded `8` in Sidebar + MobileNav (Task 5); RLS + round-trip + unread tests (Task 2); browser verification (Task 6). Out-of-scope items (groups, mentions) are intentionally excluded.
- **Type consistency:** `Thread`, `Message`, `MessageableMember` defined once in Task 2 and referenced unchanged in Tasks 3–4. Server fns (`openDmFn`, `fetchMessagesFn`, etc.) return the shapes the route consumes.
- **Realtime senderName:** Phase 1 is DM-only, so an incoming message's sender is either me (`'Me'`) or the single other participant (`active.title`) — no per-message name lookup needed. Revisit in Phase 2 (groups).

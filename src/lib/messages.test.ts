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

test('a non-creator recipient can mark their own thread read', async () => {
  const a = await makeSignedInUser('recip-a')
  const b = await makeSignedInUser('recip-b')
  const wsId = await sharedWorkspace(a.uid, b.uid)
  try {
    // a creates the DM (a is created_by), a sends a message to b.
    const tid = await openDm(a.userClient, a.uid, b.uid)
    await sendMessage(a.userClient, tid, a.uid, 'hey b')
    // b (the NON-creator) has 1 unread, then clears it via markThreadRead.
    expect(await countInboxUnread(b.userClient, b.uid)).toBe(1)
    await markThreadRead(b.userClient, tid, b.uid)
    expect(await countInboxUnread(b.userClient, b.uid)).toBe(0)
  } finally {
    await cleanup(wsId, a.uid, b.uid)
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

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createStandaloneTask, completeStandaloneTask } from './standalone-tasks'

// Creds from gitignored .dev.vars (keeps service_role key out of the repo).
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
  const email = `${prefix}.${Date.now()}@gmail.com`
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
  // Every standalone task carries a workspace, so each test user needs one.
  // The on_workspace_created trigger adds the owner as a member.
  const { data: ws } = await admin.from('workspaces').insert({ owner_id: uid, name: 'WS' }).select('id').single()
  return { uid, userClient, wsId: ws!.id as string }
}

test('createStandaloneTask inserts a task with a workspace and due date for its author (RLS path)', async () => {
  const { uid, userClient, wsId } = await makeSignedInUser('standalone-create')
  try {
    await createStandaloneTask(userClient, uid, 'Renew domain', wsId, '2026-08-01')

    const { data: rows } = await admin
      .from('standalone_tasks')
      .select('user_id, title, due_date, done, workspace_id')
      .eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].title).toBe('Renew domain')
    expect(rows![0].due_date).toBe('2026-08-01')
    expect(rows![0].done).toBe(false)
    expect(rows![0].user_id).toBe(uid)
    expect(rows![0].workspace_id).toBe(wsId)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('createStandaloneTask defaults due date to null when omitted', async () => {
  const { uid, userClient, wsId } = await makeSignedInUser('standalone-nodue')
  try {
    await createStandaloneTask(userClient, uid, 'Call accountant', wsId)

    const { data: rows } = await admin.from('standalone_tasks').select('due_date').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].due_date).toBeNull()
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('createStandaloneTask rejects a workspace the author is not a member of', async () => {
  const { uid, userClient } = await makeSignedInUser('standalone-outsider')
  const { uid: otherUid, wsId: otherWsId } = await makeSignedInUser('standalone-otherws')
  try {
    await expect(createStandaloneTask(userClient, uid, 'Sneak in', otherWsId)).rejects.toThrow()

    const { data: rows } = await admin.from('standalone_tasks').select('id').eq('user_id', uid)
    expect(rows).toHaveLength(0)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
    await admin.auth.admin.deleteUser(otherUid)
  }
}, 25000)

test('completeStandaloneTask marks a task done for its owning user (RLS path)', async () => {
  const { uid, userClient, wsId } = await makeSignedInUser('standalone-complete')
  try {
    await createStandaloneTask(userClient, uid, 'Pay invoice', wsId)
    const { data: created } = await admin.from('standalone_tasks').select('id').eq('user_id', uid).single()

    await completeStandaloneTask(userClient, uid, created!.id as string)

    const { data: rows } = await admin.from('standalone_tasks').select('done').eq('id', created!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].done).toBe(true)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test("completeStandaloneTask does not mark another user's task done", async () => {
  const { uid: ownerUid, userClient: ownerClient, wsId } = await makeSignedInUser('standalone-owner')
  const { uid: otherUid, userClient: otherClient } = await makeSignedInUser('standalone-other')
  try {
    await createStandaloneTask(ownerClient, ownerUid, 'Owner only task', wsId)
    const { data: created } = await admin.from('standalone_tasks').select('id').eq('user_id', ownerUid).single()

    await completeStandaloneTask(otherClient, otherUid, created!.id as string)

    const { data: rows } = await admin.from('standalone_tasks').select('done').eq('id', created!.id)
    expect(rows![0].done).toBe(false)
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', ownerUid)
    await admin.from('standalone_tasks').delete().eq('user_id', otherUid)
    await admin.auth.admin.deleteUser(ownerUid)
    await admin.auth.admin.deleteUser(otherUid)
  }
}, 25000)

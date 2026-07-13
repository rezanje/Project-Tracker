import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createNote, updateNote } from './notes'

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
  return { uid, userClient }
}

test('createNote inserts a note with a category for its author (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('note-create')
  try {
    await createNote(userClient, uid, 'Remember the thing', 'Ideas')

    const { data: rows } = await admin.from('notes').select('user_id, body, category').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].body).toBe('Remember the thing')
    expect(rows![0].category).toBe('Ideas')
    expect(rows![0].user_id).toBe(uid)
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('createNote defaults category to null when omitted', async () => {
  const { uid, userClient } = await makeSignedInUser('note-nocat')
  try {
    await createNote(userClient, uid, 'No tag here')

    const { data: rows } = await admin.from('notes').select('category').eq('user_id', uid)
    expect(rows).toHaveLength(1)
    expect(rows![0].category).toBeNull()
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('updateNote edits body and category for the owning user (RLS path)', async () => {
  const { uid, userClient } = await makeSignedInUser('note-update')
  try {
    await createNote(userClient, uid, 'Original body', 'Work')
    const { data: created } = await admin.from('notes').select('id').eq('user_id', uid).single()

    await updateNote(userClient, created!.id as string, 'Edited body', 'Personal')

    const { data: rows } = await admin.from('notes').select('body, category').eq('id', created!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].body).toBe('Edited body')
    expect(rows![0].category).toBe('Personal')
  } finally {
    await admin.from('notes').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

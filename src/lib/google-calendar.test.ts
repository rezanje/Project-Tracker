import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'

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

test('a user can insert and read their own google_calendar_connections row', async () => {
  const { uid, userClient } = await makeSignedInUser('gcal-owner')
  try {
    const { error: insertError } = await userClient.from('google_calendar_connections').insert({
      user_id: uid,
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    expect(insertError).toBeNull()

    const { data: rows } = await userClient.from('google_calendar_connections').select('user_id, access_token')
    expect(rows).toHaveLength(1)
    expect(rows![0].user_id).toBe(uid)
    expect(rows![0].access_token).toBe('a')
  } finally {
    await admin.from('google_calendar_connections').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test("a user cannot read another user's google_calendar_connections row", async () => {
  const { uid: ownerUid } = await makeSignedInUser('gcal-owner2')
  const { uid: otherUid, userClient: otherClient } = await makeSignedInUser('gcal-other')
  try {
    await admin.from('google_calendar_connections').insert({
      user_id: ownerUid,
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })

    const { data: rows } = await otherClient.from('google_calendar_connections').select('user_id')
    expect(rows).toHaveLength(0)
  } finally {
    await admin.from('google_calendar_connections').delete().eq('user_id', ownerUid)
    await admin.auth.admin.deleteUser(ownerUid)
    await admin.auth.admin.deleteUser(otherUid)
  }
}, 25000)

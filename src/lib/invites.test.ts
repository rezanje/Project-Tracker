import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { acceptInvite } from './invites'

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

async function mkUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user
}

test('acceptInvite converts a pending invite into a client membership', async () => {
  const owner = await mkUser('owner')
  const client = await mkUser('client')
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: owner.id, title: 'Invite Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: inv } = await admin
      .from('pending_invites')
      .insert({ board_id: boardId, email: 'someone@gmail.com' })
      .select('token')
      .single()

    await acceptInvite(admin, inv!.token, client.id)

    const { data: m } = await admin
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('user_id', client.id)
      .single()
    expect(m?.role).toBe('client')

    const { data: left } = await admin
      .from('pending_invites')
      .select('token')
      .eq('token', inv!.token)
    expect(left?.length).toBe(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(client.id)
  }
}, 20000)

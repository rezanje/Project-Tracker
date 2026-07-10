import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { acceptWorkspaceInvite } from './workspaces'

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

test('acceptWorkspaceInvite converts a pending invite into a member and approves the profile', async () => {
  const owner = await mkUser('wsowner')
  const member = await mkUser('wsmember')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Invite Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    const { data: inv } = await admin
      .from('pending_workspace_invites')
      .insert({ workspace_id: workspaceId, email: 'someone@gmail.com' })
      .select('token')
      .single()

    const ok = await acceptWorkspaceInvite(admin, inv!.token, member.id)
    expect(ok).toBe(true)

    const { data: m } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id)
      .single()
    expect(m?.role).toBe('member')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', member.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(member.id)
  }
}, 20000)

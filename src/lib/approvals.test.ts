import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { approveToBoard, approveToWorkspace, listPendingProfiles } from './approvals'

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

test('listPendingProfiles includes a fresh self-signup', async () => {
  const user = await mkUser('pending')
  try {
    const pending = await listPendingProfiles(admin)
    expect(pending.some((p) => p.id === user.id)).toBe(true)
  } finally {
    await admin.auth.admin.deleteUser(user.id)
  }
}, 20000)

test('approveToWorkspace grants membership and approves the profile', async () => {
  const owner = await mkUser('gwsowner')
  const applicant = await mkUser('applicant')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Grant Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    await approveToWorkspace(admin, applicant.id, workspaceId!, 'member')

    const { data: m } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', applicant.id)
      .single()
    expect(m?.role).toBe('member')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', applicant.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(applicant.id)
  }
}, 20000)

test('approveToBoard grants membership and approves the profile', async () => {
  const owner = await mkUser('gbowner')
  const applicant = await mkUser('bapplicant')
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: owner.id, title: 'Grant Board' })
      .select('id')
      .single()
    boardId = board!.id

    await approveToBoard(admin, applicant.id, boardId!, 'client')

    const { data: m } = await admin
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('user_id', applicant.id)
      .single()
    expect(m?.role).toBe('client')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', applicant.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(applicant.id)
  }
}, 20000)

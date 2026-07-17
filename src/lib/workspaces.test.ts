import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { acceptWorkspaceInvite, searchAddableAccounts, addExistingWorkspaceMember } from './workspaces'

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

async function makeApprovedUser(prefix: string, name: string) {
  const email = `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name },
  })
  const uid = u.user!.id
  await admin.from('profiles').update({ status: 'approved', name }).eq('id', uid)
  return { uid, email }
}

async function makeWorkspace(ownerId: string) {
  const { data: ws } = await admin
    .from('workspaces')
    .insert({ name: `ws-${Date.now()}`, owner_id: ownerId })
    .select('id')
    .single()
  return ws!.id as string
}

async function cleanup(wsId: string, ...uids: string[]) {
  await admin.from('workspaces').delete().eq('id', wsId)
  for (const uid of uids) await admin.auth.admin.deleteUser(uid)
}

test('searchAddableAccounts finds an approved user by partial name match', async () => {
  const owner = await makeApprovedUser('search-owner', 'Search Owner')
  const target = await makeApprovedUser('search-target', 'ZzzSearchTarget Testerson')
  const wsId = await makeWorkspace(owner.uid)
  try {
    const results = await searchAddableAccounts(admin, wsId, 'zzzsearchtarget')
    expect(results.some((r) => r.id === target.uid)).toBe(true)
    expect(results.some((r) => r.id === target.uid && r.name === 'ZzzSearchTarget Testerson')).toBe(true)
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

test('searchAddableAccounts excludes a user already a member of the workspace', async () => {
  const owner = await makeApprovedUser('search-owner2', 'Search Owner2')
  const target = await makeApprovedUser('search-member', 'ZzzAlreadyMember Testerson')
  const wsId = await makeWorkspace(owner.uid)
  try {
    await admin.from('workspace_members').insert({ workspace_id: wsId, user_id: target.uid, role: 'member' })
    const results = await searchAddableAccounts(admin, wsId, 'zzzalreadymember')
    expect(results.some((r) => r.id === target.uid)).toBe(false)
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

test('searchAddableAccounts returns [] for a 1-character query', async () => {
  const owner = await makeApprovedUser('search-owner3', 'Search Owner3')
  const wsId = await makeWorkspace(owner.uid)
  try {
    const results = await searchAddableAccounts(admin, wsId, 'z')
    expect(results).toEqual([])
  } finally {
    await cleanup(wsId, owner.uid)
  }
}, 30000)

test('searchAddableAccounts finds an approved user by partial email match', async () => {
  const owner = await makeApprovedUser('email-owner', 'Email Owner')
  const target = await makeApprovedUser('zzzemailmatch', 'Regular Name')
  const wsId = await makeWorkspace(owner.uid)
  try {
    const results = await searchAddableAccounts(admin, wsId, 'zzzemailmatch')
    expect(results.some((r) => r.id === target.uid)).toBe(true)
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

test('searchAddableAccounts excludes a non-approved (pending) profile even if the name matches', async () => {
  const owner = await makeApprovedUser('pending-owner', 'Pending Owner')
  const wsId = await makeWorkspace(owner.uid)
  const email = `pending-search.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'ZzzPendingUser Testerson' },
  })
  const pendingUid = u.user!.id
  try {
    const results = await searchAddableAccounts(admin, wsId, 'zzzpendinguser')
    expect(results.some((r) => r.id === pendingUid)).toBe(false)
  } finally {
    await cleanup(wsId, owner.uid, pendingUid)
  }
}, 30000)

test('addExistingWorkspaceMember inserts a workspace_members row with role member', async () => {
  const owner = await makeApprovedUser('add-owner', 'Add Owner')
  const target = await makeApprovedUser('add-target', 'Add Target')
  const wsId = await makeWorkspace(owner.uid)
  try {
    await addExistingWorkspaceMember(admin, wsId, target.uid)
    const { data: row } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsId)
      .eq('user_id', target.uid)
      .single()
    expect(row?.role).toBe('member')
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

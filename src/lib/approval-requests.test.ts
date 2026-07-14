import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { formatApprovalMeta, listPendingApprovals, resolveApproval } from './approval-requests'

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

// ─── Unit tests (no DB) ─────────────────────────────────────────────────────

test('formatApprovalMeta formats budget as Rupiah', () => {
  expect(formatApprovalMeta('budget', { amount: 2300000 })).toBe('Rp 2.300.000')
})

test('formatApprovalMeta formats leave as a date range', () => {
  expect(formatApprovalMeta('leave', { from: '2026-07-12', to: '2026-07-14' })).toBe('2026-07-12 - 2026-07-14')
})

test('formatApprovalMeta formats content as a count', () => {
  expect(formatApprovalMeta('content', { count: 8 })).toBe('8 Konten')
})

// ─── DB-backed tests ────────────────────────────────────────────────────────

test('listPendingApprovals returns only pending requests for workspaces the user owns', async () => {
  const owner = await mkUser('apowner')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Approval Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    await admin.from('approval_requests').insert([
      { workspace_id: workspaceId, requested_by: owner.id, kind: 'budget', title: 'Pending one', meta: { amount: 500000 }, status: 'pending' },
      { workspace_id: workspaceId, requested_by: owner.id, kind: 'leave', title: 'Already resolved', meta: {}, status: 'approved' },
    ])

    const list = await listPendingApprovals(admin, owner.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({
      id: expect.any(String),
      kind: 'budget',
      title: 'Pending one',
      sub: 'Approval Test Workspace',
      meta: 'Rp 500.000',
    })
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('resolveApproval sets status, resolved_by, and resolved_at', async () => {
  const owner = await mkUser('apresolve')
  let workspaceId: string | undefined
  let requestId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Resolve Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    const { data: req } = await admin
      .from('approval_requests')
      .insert({ workspace_id: workspaceId, requested_by: owner.id, kind: 'content', title: 'Resolve me', meta: { count: 3 } })
      .select('id')
      .single()
    requestId = req!.id

    await resolveApproval(admin, owner.id, requestId!, 'approved')

    const { data: row } = await admin
      .from('approval_requests')
      .select('status,resolved_by,resolved_at')
      .eq('id', requestId)
      .single()
    expect(row?.status).toBe('approved')
    expect(row?.resolved_by).toBe(owner.id)
    expect(row?.resolved_at).toBeTruthy()
  } finally {
    if (requestId) await admin.from('approval_requests').delete().eq('id', requestId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('approval_requests_resolve RLS policy blocks a non-owner update', async () => {
  const owner = await mkUser('rlsowner')
  const member = await mkUser('rlsmember')
  let workspaceId: string | undefined
  let requestId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'RLS Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: member.id, role: 'member' })
    const { data: req } = await admin
      .from('approval_requests')
      .insert({ workspace_id: workspaceId, requested_by: owner.id, kind: 'budget', title: 'Owner only', meta: { amount: 1 } })
      .select('id')
      .single()
    requestId = req!.id

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(member.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    await anon.from('approval_requests').update({ status: 'approved' }).eq('id', requestId)
    const { data: row } = await admin.from('approval_requests').select('status').eq('id', requestId).single()
    expect(row?.status).toBe('pending') // RLS silently matched 0 rows — update didn't apply
  } finally {
    if (requestId) await admin.from('approval_requests').delete().eq('id', requestId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(member.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

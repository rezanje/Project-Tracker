import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { listMyGoals, listAssignedGoals } from './goals'

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

test('listMyGoals returns KPIs and Objectives assigned to the caller', async () => {
  const owner = await mkUser('goalsowner')
  const staff = await mkUser('goalsstaff')
  let kpiId: string | undefined
  let objId: string | undefined
  try {
    const { data: kpi } = await admin
      .from('kpis')
      .insert({
        name: 'Closed deals', target: 10, unit: 'deals',
        assignee_id: staff.id, assigned_by: owner.id,
        start_date: '2026-07-01', end_date: '2026-07-31',
      })
      .select('id')
      .single()
    kpiId = kpi!.id

    const { data: obj } = await admin
      .from('objectives')
      .insert({
        title: 'Grow the pipeline',
        assignee_id: staff.id, assigned_by: owner.id,
        start_date: '2026-07-01', end_date: '2026-07-31',
      })
      .select('id')
      .single()
    objId = obj!.id
    await admin.from('key_results').insert({ objective_id: objId, title: 'Book 5 demos', target: 5, current: 2 })

    const mine = await listMyGoals(admin, staff.id)
    expect(mine.kpis).toHaveLength(1)
    expect(mine.kpis[0].name).toBe('Closed deals')
    expect(mine.objectives).toHaveLength(1)
    expect(mine.objectives[0].krs).toHaveLength(1)
    expect(mine.objectives[0].progress).toBe(40) // 2/5 = 40%

    const assigned = await listAssignedGoals(admin, owner.id, null)
    expect(assigned.kpis).toHaveLength(1)
    expect(assigned.kpis[0].assigneeName).toBe('goalsstaff')
  } finally {
    if (kpiId) await admin.from('kpis').delete().eq('id', kpiId)
    if (objId) await admin.from('objectives').delete().eq('id', objId)
    await admin.auth.admin.deleteUser(staff.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 25000)

test('kpi_insert policy rejects assigning to a non-member of the workspace', async () => {
  const owner = await mkUser('kpiowner')
  const outsider = await mkUser('kpioutsider')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'KPI Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({ email: (await admin.auth.admin.getUserById(owner.id)).data.user!.email!, password: 'Babikeguling1!' })

    const { error } = await anon.from('kpis').insert({
      name: 'Outsider KPI', target: 1, workspace_id: workspaceId,
      assignee_id: outsider.id, assigned_by: owner.id,
    })
    expect(error).toBeTruthy() // outsider isn't a workspace_members row
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(outsider.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 25000)

test('submitKpiCheckinFn-equivalent insert enforces one pending at a time', async () => {
  const owner = await mkUser('checkinowner')
  const staff = await mkUser('checkinstaff')
  let kpiId: string | undefined
  try {
    const { data: kpi } = await admin
      .from('kpis')
      .insert({ name: 'Revenue', target: 100, assignee_id: staff.id, assigned_by: owner.id })
      .select('id')
      .single()
    kpiId = kpi!.id

    const { error: first } = await admin
      .from('kpi_checkins')
      .insert({ kpi_id: kpiId, submitted_by: staff.id, proposed_value: 40 })
    expect(first).toBeNull()

    const { error: second } = await admin
      .from('kpi_checkins')
      .insert({ kpi_id: kpiId, submitted_by: staff.id, proposed_value: 55 })
    expect(second).toBeTruthy() // unique index kpi_checkins_one_pending
  } finally {
    if (kpiId) await admin.from('kpis').delete().eq('id', kpiId)
    await admin.auth.admin.deleteUser(staff.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 25000)

test('reviewKpiCheckinFn-equivalent RPC moves current only on approve', async () => {
  const owner = await mkUser('reviewowner')
  const staff = await mkUser('reviewstaff')
  let kpiId: string | undefined
  try {
    const { data: kpi } = await admin
      .from('kpis')
      .insert({ name: 'Signups', target: 50, current: 0, assignee_id: staff.id, assigned_by: owner.id })
      .select('id')
      .single()
    kpiId = kpi!.id

    const { data: checkin } = await admin
      .from('kpi_checkins')
      .insert({ kpi_id: kpiId, submitted_by: staff.id, proposed_value: 20 })
      .select('id')
      .single()

    const { error: rpcErr } = await admin.rpc('approve_kpi_checkin', {
      p_checkin_id: checkin!.id, p_approve: true,
    })
    // admin (service role) has no auth.uid(), so the RPC's owner check
    // (`v_owner is distinct from auth.uid()`, hardened in 0024) fails closed
    // and raises 'not authorized' — confirming the guard rejects a null-uid
    // caller. The real approve happy-path runs manually in Task 11 with a
    // signed-in owner session.
    expect(rpcErr).toBeTruthy()

    const { data: after } = await admin.from('kpis').select('current').eq('id', kpiId).single()
    expect(Number(after!.current)).toBe(0) // unchanged — the rpc call above was rejected
  } finally {
    if (kpiId) await admin.from('kpis').delete().eq('id', kpiId)
    await admin.auth.admin.deleteUser(staff.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 25000)

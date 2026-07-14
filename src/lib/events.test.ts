import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { listTodayEvents } from './events'

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

test('listTodayEvents returns only events starting today, earliest first, with attendee count', async () => {
  const owner = await mkUser('evowner')
  let workspaceId: string | undefined
  let eventIds: string[] = []
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Events Test Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    const { data: rows } = await admin
      .from('events')
      .insert([
        { workspace_id: workspaceId, title: 'Late meeting', sub: 'Team', event_type: 'Meeting', starts_at: '2026-07-14T15:00:00+00', attendee_ids: [owner.id] },
        { workspace_id: workspaceId, title: 'Early call', sub: 'Client', event_type: 'Call', starts_at: '2026-07-14T09:00:00+00', attendee_ids: [] },
        { workspace_id: workspaceId, title: 'Tomorrow review', sub: 'Design', event_type: 'Review', starts_at: '2026-07-15T09:00:00+00', attendee_ids: [] },
      ])
      .select('id')
    eventIds = (rows ?? []).map((r) => r.id as string)

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(owner.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    const list = await listTodayEvents(anon, '2026-07-14')
    expect(list.map((e) => e.title)).toEqual(['Early call', 'Late meeting'])
    expect(list[0]).toMatchObject({ time: '09:00', title: 'Early call', sub: 'Client', type: 'Call', people: 0 })
    expect(list[1]).toMatchObject({ time: '15:00', title: 'Late meeting', sub: 'Team', type: 'Meeting', people: 1 })
  } finally {
    if (eventIds.length) await admin.from('events').delete().in('id', eventIds)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

test('events_read RLS policy hides events from non-members', async () => {
  const owner = await mkUser('evowner2')
  const outsider = await mkUser('evoutsider')
  let workspaceId: string | undefined
  let eventId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Events RLS Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id
    const { data: ev } = await admin
      .from('events')
      .insert({ workspace_id: workspaceId, title: 'Private meeting', event_type: 'Meeting', starts_at: '2026-07-14T10:00:00+00' })
      .select('id')
      .single()
    eventId = ev!.id

    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    await anon.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(outsider.id)).data.user!.email!,
      password: 'Babikeguling1!',
    })

    const list = await listTodayEvents(anon, '2026-07-14')
    expect(list.find((e) => e.id === eventId)).toBeUndefined()
  } finally {
    if (eventId) await admin.from('events').delete().eq('id', eventId)
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(outsider.id)
    await admin.auth.admin.deleteUser(owner.id)
  }
}, 20000)

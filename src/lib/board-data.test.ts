import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { distinctCategories, groupByCategory, loadBoard } from './board-data'

test('distinctCategories returns sorted unique non-null categories', () => {
  const cards = [
    { category: 'Design' }, { category: null }, { category: 'Dev' }, { category: 'Design' },
  ]
  expect(distinctCategories(cards)).toEqual(['Design', 'Dev'])
})

test('groupByCategory buckets by category with an Uncategorised bucket', () => {
  const mk = (id: string, category: string | null) => ({
    id, title: id, description: null, due_date: null, assignee_id: null,
    category, contact: null, phone: null, source: null, deal_value: null,
    pillar_id: null, content_status: null, channels: null, format: null,
    position: 0, card_labels: [],
  })
  const groups = groupByCategory([mk('a', 'Design'), mk('b', null), mk('c', 'Design')])
  expect(groups.find((g) => g.category === 'Design')!.cards.map((c) => c.id)).toEqual(['a', 'c'])
  expect(groups.find((g) => g.category === 'Uncategorised')!.cards.map((c) => c.id)).toEqual(['b'])
})

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

test('loadBoard returns columns with position-sorted cards + caller role', async () => {
  const email = `view.${Date.now()}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Viewer' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'View Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'To Do', position: 0 })
      .select('id')
      .single()
    // insert out of order to prove the sort
    await admin.from('cards').insert([
      { column_id: col!.id, title: 'Second', position: 1 },
      { column_id: col!.id, title: 'First', position: 0 },
    ])

    // sign in as the owner to get an RLS-scoped client
    const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
    await userClient.auth.signInWithPassword({ email, password })

    const result = await loadBoard(userClient, boardId!)
    expect(result.title).toBe('View Board')
    expect(result.role).toBe('owner')
    // The on_board_created trigger seeds Backlog/In Progress/Done, plus our "To Do".
    expect(result.columns).toHaveLength(4)
    const todo = result.columns.find((c) => c.title === 'To Do')!
    expect(todo.cards.map((c) => c.title)).toEqual(['First', 'Second'])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

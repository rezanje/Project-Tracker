import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { addComment } from './comments'

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

test('addComment inserts a comment a board member can post (RLS path)', async () => {
  const email = `comment.${Date.now()}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Commenter' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Comment Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'To Do', position: 0 })
      .select('id')
      .single()
    const { data: card } = await admin
      .from('cards')
      .insert({ column_id: col!.id, title: 'Card', position: 0 })
      .select('id')
      .single()

    // Sign in as the member to exercise the real RLS insert policy.
    const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
    await userClient.auth.signInWithPassword({ email, password })

    await addComment(userClient, card!.id, uid, 'Hello from a member')

    // Re-read with admin to confirm the row persisted with the right fields.
    const { data: rows } = await admin
      .from('comments')
      .select('card_id, author_id, body')
      .eq('card_id', card!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].body).toBe('Hello from a member')
    expect(rows![0].author_id).toBe(uid)
    expect(rows![0].card_id).toBe(card!.id)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createBoard } from './boards'

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

test('createBoard creates board + owner membership', async () => {
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: `board.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Board Tester' },
  })
  if (uErr) throw uErr
  const uid = u.user.id
  let boardId: string | undefined
  try {
    const board = await createBoard(admin, uid, 'Test Board')
    boardId = board.id
    expect(board.id).toBeTruthy()

    const { data: m } = await admin
      .from('board_members')
      .select('role')
      .eq('board_id', board.id)
      .eq('user_id', uid)
      .single()
    expect(m?.role).toBe('owner')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 20000)

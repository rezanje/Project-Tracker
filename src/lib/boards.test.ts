import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createBoard, deleteBoard } from './boards'

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
  let wsId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: uid, name: 'WS' })
      .select('id')
      .single()
    wsId = ws!.id
    const board = await createBoard(admin, uid, 'Test Board', wsId!)
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
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 20000)

test('deleteBoard removes the board, cascades children, and clears storage files', async () => {
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: `del.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Delete Tester' },
  })
  if (uErr) throw uErr
  const uid = u.user.id
  let wsId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: uid, name: 'WS' })
      .select('id')
      .single()
    wsId = ws!.id
    const { id: boardId } = await createBoard(admin, uid, 'Delete Me', wsId!)

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'Todo' })
      .select('id')
      .single()
    const { data: card } = await admin
      .from('cards')
      .insert({ column_id: col!.id, title: 'Task' })
      .select('id')
      .single()
    const path = `${boardId}/${card!.id}/${crypto.randomUUID()}-note.txt`
    await admin.storage.from('card-files').upload(path, new Blob(['hi']))
    await admin
      .from('attachments')
      .insert({ card_id: card!.id, path, filename: 'note.txt', uploaded_by: uid })

    // File exists before delete.
    const before = await admin.storage.from('card-files').list(`${boardId}/${card!.id}`)
    expect(before.data?.length ?? 0).toBe(1)

    await deleteBoard(admin, boardId)

    const { data: gone } = await admin.from('boards').select('id').eq('id', boardId).maybeSingle()
    expect(gone).toBeNull()
    const { data: cardGone } = await admin.from('cards').select('id').eq('id', card!.id).maybeSingle()
    expect(cardGone).toBeNull() // cascade
    const after = await admin.storage.from('card-files').list(`${boardId}/${card!.id}`)
    expect(after.data?.length ?? 0).toBe(0) // storage cleared
  } finally {
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 30000)

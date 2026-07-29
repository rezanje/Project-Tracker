import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { listBoardPicIds, myPicBoardIds, setBoardPics } from './board-pics'

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

/** Board + a column, with `owner` as owner and `others` as plain members. */
async function mkBoard(ownerId: string, others: string[]) {
  const { data: b, error } = await admin
    .from('boards')
    .insert({ owner_id: ownerId, title: 'PIC Test Board' })
    .select('id')
    .single()
  if (error) throw error
  // The owner membership row is added by a trigger (0004_board_owner_trigger).
  if (others.length) {
    await admin
      .from('board_members')
      .insert(others.map((id) => ({ board_id: b!.id, user_id: id, role: 'member' })))
  }
  const { data: col } = await admin
    .from('columns')
    .insert({ board_id: b!.id, title: 'To Do', position: 0 })
    .select('id')
    .single()
  return { boardId: b!.id as string, columnId: col!.id as string }
}

// ─── Unit tests (no DB) ─────────────────────────────────────────────────────

test('myPicBoardIds returns only boards where this user is flagged PIC', () => {
  const rows = [
    { board_id: 'b1', user_id: 'me', is_pic: true },
    { board_id: 'b2', user_id: 'me', is_pic: false },  // member, not PIC
    { board_id: 'b3', user_id: 'other', is_pic: true }, // someone else's PIC
  ]
  expect(myPicBoardIds(rows, 'me')).toEqual(new Set(['b1']))
})

test('myPicBoardIds is empty when the user is PIC of nothing', () => {
  const rows = [{ board_id: 'b1', user_id: 'other', is_pic: true }]
  expect(myPicBoardIds(rows, 'me')).toEqual(new Set())
})

// ─── DB-backed tests ────────────────────────────────────────────────────────

test('setBoardPics marks exactly the given members, and clears the rest', async () => {
  const owner = await mkUser('picowner')
  const a = await mkUser('pica')
  const b = await mkUser('picb')
  let boardId: string | undefined
  try {
    const board = await mkBoard(owner.id, [a.id, b.id])
    boardId = board.boardId

    await setBoardPics(admin, boardId, [a.id, b.id])
    expect((await listBoardPicIds(admin, boardId)).sort()).toEqual([a.id, b.id].sort())

    // Re-setting with a smaller list must clear the one left out.
    await setBoardPics(admin, boardId, [a.id])
    expect(await listBoardPicIds(admin, boardId)).toEqual([a.id])

    await setBoardPics(admin, boardId, [])
    expect(await listBoardPicIds(admin, boardId)).toEqual([])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(a.id)
    await admin.auth.admin.deleteUser(b.id)
  }
}, 30000)

test('removing a member drops their PIC status', async () => {
  const owner = await mkUser('picrmowner')
  const a = await mkUser('picrm')
  let boardId: string | undefined
  try {
    const board = await mkBoard(owner.id, [a.id])
    boardId = board.boardId
    await setBoardPics(admin, boardId, [a.id])
    expect(await listBoardPicIds(admin, boardId)).toEqual([a.id])

    await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', a.id)

    expect(await listBoardPicIds(admin, boardId)).toEqual([])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(a.id)
  }
}, 30000)

test('creating a task notifies the PICs of that board', async () => {
  const owner = await mkUser('picnotifowner')
  const pic = await mkUser('picnotif')
  let boardId: string | undefined
  try {
    const board = await mkBoard(owner.id, [pic.id])
    boardId = board.boardId
    await setBoardPics(admin, boardId, [pic.id])

    const { error } = await admin
      .from('cards')
      .insert({ column_id: board.columnId, title: 'Notify the PIC', position: 0 })
    expect(error).toBeNull()

    const { data: notes } = await admin
      .from('notifications')
      .select('user_id, kind, message')
      .eq('board_id', boardId)
      .eq('kind', 'pic')

    expect(notes).toHaveLength(1)
    expect(notes![0].user_id).toBe(pic.id)
    expect(notes![0].message).toContain('Notify the PIC')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(pic.id)
  }
}, 30000)

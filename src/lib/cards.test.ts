import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { reorderPositions, createCard, moveCard } from './cards'

// ─── Unit test (no DB) ────────────────────────────────────────────────────────

test('reorderPositions maps ids to sequential positions', () => {
  expect(reorderPositions(['a', 'b', 'c'])).toEqual([
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ])
})

test('reorderPositions handles empty array', () => {
  expect(reorderPositions([])).toEqual([])
})

// ─── DB-backed tests ──────────────────────────────────────────────────────────

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

test('createCard inserts a card at the next position', async () => {
  const email = `cards.create.${Date.now()}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Card Creator' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Card Test Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'Col A', position: 0 })
      .select('id')
      .single()
    const colId = col!.id

    const card = await createCard(admin, colId, 'First Card')
    expect(card).toBeTruthy()
    expect(card.title).toBe('First Card')
    expect(card.position).toBe(0)

    const card2 = await createCard(admin, colId, 'Second Card')
    expect(card2.position).toBe(1)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('moveCard reorders cards within the same column', async () => {
  const email = `cards.move.${Date.now()}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Card Mover' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Move Test Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'Col A', position: 0 })
      .select('id')
      .single()
    const colId = col!.id

    // Insert 3 cards: positions 0, 1, 2
    const { data: cards } = await admin
      .from('cards')
      .insert([
        { column_id: colId, title: 'Alpha', position: 0 },
        { column_id: colId, title: 'Beta', position: 1 },
        { column_id: colId, title: 'Gamma', position: 2 },
      ])
      .select('id,title')
    const [alpha, beta, gamma] = cards!

    // Move alpha to last: new order is Beta, Gamma, Alpha
    await moveCard(admin, alpha.id, colId, [beta.id, gamma.id, alpha.id])

    const { data: result } = await admin
      .from('cards')
      .select('id,position')
      .eq('column_id', colId)
      .order('position')

    expect(result!.map((c: { id: string; position: number }) => c.id)).toEqual([
      beta.id,
      gamma.id,
      alpha.id,
    ])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('moveCard moves a card to a different column', async () => {
  const email = `cards.xmove.${Date.now()}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Cross Mover' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'XMove Test Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: cols } = await admin
      .from('columns')
      .insert([
        { board_id: boardId, title: 'Col A', position: 0 },
        { board_id: boardId, title: 'Col B', position: 1 },
      ])
      .select('id')
    const [colA, colB] = cols!

    // Col A has 3 cards; we'll move the middle one to Col B.
    const { data: aCards } = await admin
      .from('cards')
      .insert([
        { column_id: colA.id, title: 'A0', position: 0 },
        { column_id: colA.id, title: 'A1-mover', position: 1 },
        { column_id: colA.id, title: 'A2', position: 2 },
      ])
      .select('id,title')
    const a0 = aCards!.find((c: { title: string }) => c.title === 'A0')!
    const mover = aCards!.find((c: { title: string }) => c.title === 'A1-mover')!
    const a2 = aCards!.find((c: { title: string }) => c.title === 'A2')!

    const { data: existingB } = await admin
      .from('cards')
      .insert({ column_id: colB.id, title: 'Resident', position: 0 })
      .select('id')
      .single()

    // Move mover (index 1 in Col A) to Col B after Resident.
    // Source Col A remainder: [a0, a2]. Dest Col B: [Resident, mover].
    await moveCard(
      admin,
      mover.id,
      colB.id,
      [existingB!.id, mover.id],
      [a0.id, a2.id],
    )

    const { data: colBCards } = await admin
      .from('cards')
      .select('id,column_id,position')
      .eq('column_id', colB.id)
      .order('position')

    expect(colBCards!.map((c: { id: string }) => c.id)).toEqual([existingB!.id, mover.id])
    // All colB cards should have column_id = colB.id
    expect(colBCards!.every((c: { column_id: string }) => c.column_id === colB.id)).toBe(true)

    // SOURCE column (Col A) must stay contiguous 0,1 with no gap left behind.
    const { data: colACards } = await admin
      .from('cards')
      .select('id,position')
      .eq('column_id', colA.id)
      .order('position')
    expect(colACards!.map((c: { position: number }) => c.position)).toEqual([0, 1])
    expect(colACards!.map((c: { id: string }) => c.id)).toEqual([a0.id, a2.id])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

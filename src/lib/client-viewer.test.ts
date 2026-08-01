import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'

/**
 * The `client` board role is Rakit's read-only viewer for people outside the
 * team: an owner invites them to one project and they can follow it without
 * being able to change it. Nothing exercised this end to end, so the guarantee
 * we sell to an outside client rested on reading the policies rather than on
 * running them.
 *
 * These tests pin the four promises separately, each through a real signed-in
 * client so RLS is what answers — not a service-role query that would bypass it.
 */

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

/** Copied from board-members.test.ts: an anon client that never authenticated
 * matches zero rows everywhere, which is indistinguishable from RLS correctly
 * denying access — so a swallowed sign-in error would let these assertions pass
 * vacuously. Throw loudly, then re-check the session independently. */
async function makeSignedInUser(prefix: string) {
  const email = `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: prefix },
  })
  if (error) throw error
  const uid = u.user!.id
  const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password })
  if (signInErr) throw signInErr
  const { data: check, error: checkErr } = await userClient.auth.getUser()
  if (checkErr || check.user?.id !== uid) {
    throw new Error(`makeSignedInUser(${prefix}): not authenticated as ${uid}`)
  }
  return { uid, userClient }
}

/** Owner + a board holding one card in one column, plus a signed-in viewer
 * carrying the board role given by `viewerRole`. The board deliberately has NO
 * workspace: workspace membership makes someone an editor on every board in it
 * (is_board_editor, 0012), which is a different situation from the outside
 * client this role exists for. */
async function scenario(viewerRole: 'client' | 'member') {
  const owner = await makeSignedInUser('cvowner')
  const viewer = await makeSignedInUser('cvviewer')

  const { data: board, error: bErr } = await admin
    .from('boards')
    .insert({ owner_id: owner.uid, title: 'CV Test Board', workspace_id: null })
    .select('id')
    .single()
  if (bErr) throw bErr
  const boardId = board!.id as string

  await admin.from('board_members').insert({ board_id: boardId, user_id: viewer.uid, role: viewerRole })

  const { data: col, error: cErr } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'Todo', position: 0 })
    .select('id')
    .single()
  if (cErr) throw cErr

  const { data: card, error: kErr } = await admin
    .from('cards')
    .insert({ column_id: col!.id as string, title: 'Original title', position: 0 })
    .select('id')
    .single()
  if (kErr) throw kErr

  await admin.from('project_finance').insert({ board_id: boardId, value_idr: 75_000_000 })

  return { owner, viewer, boardId, cardId: card!.id as string, columnId: col!.id as string }
}

async function cleanup(boardId: string | undefined, workspaceId?: string) {
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
}

/** Owner + workspace + a board inside it holding one card. The owner's
 * workspace_members and board_members rows both arrive by trigger. */
async function workspaceScenario() {
  const owner = await makeSignedInUser('cvwsowner')

  const { data: ws, error: wErr } = await admin
    .from('workspaces')
    .insert({ owner_id: owner.uid, name: 'CV Test Workspace' })
    .select('id')
    .single()
  if (wErr) throw wErr
  const workspaceId = ws!.id as string

  const { data: board, error: bErr } = await admin
    .from('boards')
    .insert({ owner_id: owner.uid, title: 'CV WS Board', workspace_id: workspaceId })
    .select('id')
    .single()
  if (bErr) throw bErr
  const boardId = board!.id as string

  const { data: col, error: cErr } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'Todo', position: 0 })
    .select('id')
    .single()
  if (cErr) throw cErr

  const { data: card, error: kErr } = await admin
    .from('cards')
    .insert({ column_id: col!.id as string, title: 'Original title', position: 0 })
    .select('id')
    .single()
  if (kErr) throw kErr

  return { owner, workspaceId, boardId, cardId: card!.id as string }
}

async function joinWorkspace(workspaceId: string, prefix: string, role = 'member') {
  const user = await makeSignedInUser(prefix)
  const { error } = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: user.uid, role })
  if (error) throw error
  return user
}

async function titleOf(cardId: string): Promise<string> {
  const { data } = await admin.from('cards').select('title').eq('id', cardId).single()
  return data!.title as string
}

test('a workspace member marked client on a board cannot edit that board', async () => {
  let boardId: string | undefined
  let workspaceId: string | undefined
  try {
    const s = await workspaceScenario()
    boardId = s.boardId
    workspaceId = s.workspaceId

    const insider = await joinWorkspace(workspaceId, 'cvinsider')
    await admin.from('board_members').insert({ board_id: boardId, user_id: insider.uid, role: 'client' })

    await insider.userClient.from('cards').update({ title: 'Hijacked by insider' }).eq('id', s.cardId)

    expect(await titleOf(s.cardId)).toBe('Original title')
  } finally {
    await cleanup(boardId, workspaceId)
  }
})

test('a workspace member with no board row still edits every board in the workspace', async () => {
  let boardId: string | undefined
  let workspaceId: string | undefined
  try {
    const s = await workspaceScenario()
    boardId = s.boardId
    workspaceId = s.workspaceId

    const insider = await joinWorkspace(workspaceId, 'cvplain')
    await insider.userClient.from('cards').update({ title: 'Edited by workspace member' }).eq('id', s.cardId)

    expect(await titleOf(s.cardId)).toBe('Edited by workspace member')
  } finally {
    await cleanup(boardId, workspaceId)
  }
})

test('a workspace owner is not locked out by a stray client row on their own board', async () => {
  let boardId: string | undefined
  let workspaceId: string | undefined
  try {
    const s = await workspaceScenario()
    boardId = s.boardId
    workspaceId = s.workspaceId

    // Overwrite the owner row the board trigger created.
    await admin
      .from('board_members')
      .update({ role: 'client' })
      .eq('board_id', boardId)
      .eq('user_id', s.owner.uid)

    await s.owner.userClient.from('cards').update({ title: 'Edited by workspace owner' }).eq('id', s.cardId)

    expect(await titleOf(s.cardId)).toBe('Edited by workspace owner')
  } finally {
    await cleanup(boardId, workspaceId)
  }
})

test('a client sees the project and its cards', async () => {
  let boardId: string | undefined
  try {
    const s = await scenario('client')
    boardId = s.boardId

    const { data: boards } = await s.viewer.userClient.from('boards').select('id').eq('id', boardId)
    expect(boards?.map((b) => b.id)).toEqual([boardId])

    const { data: cards } = await s.viewer.userClient.from('cards').select('id,title').eq('id', s.cardId)
    expect(cards?.[0]?.title).toBe('Original title')
  } finally {
    await cleanup(boardId)
  }
})

test('a client cannot edit a card, and cannot create or delete one', async () => {
  let boardId: string | undefined
  try {
    const s = await scenario('client')
    boardId = s.boardId

    await s.viewer.userClient.from('cards').update({ title: 'Hijacked' }).eq('id', s.cardId)
    await s.viewer.userClient.from('cards').delete().eq('id', s.cardId)
    await s.viewer.userClient
      .from('cards')
      .insert({ column_id: s.columnId, title: 'Snuck in', position: 1 })

    // Re-read with the service role: RLS silently matches zero rows on a denied
    // write, so the only trustworthy check is what the table actually holds.
    const { data: after } = await admin.from('cards').select('id,title').eq('column_id', s.columnId)
    expect(after?.map((c) => c.title)).toEqual(['Original title'])
  } finally {
    await cleanup(boardId)
  }
})

test('a client can comment', async () => {
  let boardId: string | undefined
  try {
    const s = await scenario('client')
    boardId = s.boardId

    const { error } = await s.viewer.userClient
      .from('comments')
      .insert({ card_id: s.cardId, author_id: s.viewer.uid, body: 'Kapan ini selesai?' })
    expect(error).toBeNull()

    const { data } = await admin.from('comments').select('body,author_id').eq('card_id', s.cardId)
    expect(data?.[0]?.body).toBe('Kapan ini selesai?')
    expect(data?.[0]?.author_id).toBe(s.viewer.uid)
  } finally {
    await cleanup(boardId)
  }
})

test("a client cannot read the project's money", async () => {
  let boardId: string | undefined
  try {
    const s = await scenario('client')
    boardId = s.boardId

    const { data } = await s.viewer.userClient
      .from('project_finance')
      .select('value_idr')
      .eq('board_id', boardId)
    expect(data ?? []).toEqual([])

    // Same query as the owner, to prove the row exists and the empty result
    // above is RLS denying it rather than a missing row.
    const { data: asOwner } = await s.owner.userClient
      .from('project_finance')
      .select('value_idr')
      .eq('board_id', boardId)
    expect(asOwner?.[0]?.value_idr).toBe(75_000_000)
  } finally {
    await cleanup(boardId)
  }
})

test('a board member CAN edit the same card — the client restriction is the role, not the board', async () => {
  let boardId: string | undefined
  try {
    const s = await scenario('member')
    boardId = s.boardId

    await s.viewer.userClient.from('cards').update({ title: 'Edited by member' }).eq('id', s.cardId)

    const { data: after } = await admin.from('cards').select('title').eq('id', s.cardId)
    expect(after?.[0]?.title).toBe('Edited by member')
  } finally {
    await cleanup(boardId)
  }
})

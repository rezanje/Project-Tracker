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

/** Same shape as notifications.test.ts's helper: an admin-created user plus
 * their own signed-in (anon-key, RLS-scoped) client, for tests that need to
 * act as that user rather than as the service role.
 *
 * Unlike notifications.test.ts's version, this one does NOT ignore
 * signInWithPassword's result: if sign-in fails, an anon-key client that
 * never authenticated still "works" for RLS-scoped queries — it just matches
 * zero rows everywhere, which is indistinguishable from RLS correctly
 * blocking a non-owner. That would let the "plain member cannot change PICs"
 * test below pass vacuously even if the underlying RLS policy were removed
 * entirely. So this throws loudly on a sign-in error, and then independently
 * re-checks (via userClient.auth.getUser(), not the sign-in response) that
 * the client actually holds a session for the intended user before handing
 * it back — so a future change that swallows the sign-in error again still
 * can't produce an anonymous client here. */
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
    throw new Error(
      `makeSignedInUser(${prefix}): client is not authenticated as ${uid} (got ${
        check?.user?.id ?? 'anonymous'
      })`,
    )
  }
  return { uid, userClient }
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
// User creation happens INSIDE each try so that if the second or third
// mkUser/makeSignedInUser call fails (auth rate limits are real here — see
// vitest.config.ts's fileParallelism: false), the ones already created are
// still cleaned up in `finally` rather than leaked.

test('setBoardPics marks exactly the given members, and clears the rest', async () => {
  let owner: Awaited<ReturnType<typeof mkUser>> | undefined
  let a: Awaited<ReturnType<typeof mkUser>> | undefined
  let b: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await mkUser('picowner')
    a = await mkUser('pica')
    b = await mkUser('picb')
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
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (a) await admin.auth.admin.deleteUser(a.id)
    if (b) await admin.auth.admin.deleteUser(b.id)
  }
}, 30000)

test('removing a member drops their PIC status', async () => {
  let owner: Awaited<ReturnType<typeof mkUser>> | undefined
  let a: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await mkUser('picrmowner')
    a = await mkUser('picrm')
    const board = await mkBoard(owner.id, [a.id])
    boardId = board.boardId
    await setBoardPics(admin, boardId, [a.id])
    expect(await listBoardPicIds(admin, boardId)).toEqual([a.id])

    await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', a.id)

    expect(await listBoardPicIds(admin, boardId)).toEqual([])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (a) await admin.auth.admin.deleteUser(a.id)
  }
}, 30000)

test('creating a task notifies the PICs of that board', async () => {
  let owner: Awaited<ReturnType<typeof mkUser>> | undefined
  let pic: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await mkUser('picnotifowner')
    pic = await mkUser('picnotif')
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
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (pic) await admin.auth.admin.deleteUser(pic.id)
  }
}, 30000)

// Every test above inserts cards with the service-role client, where
// auth.uid() is null — the trigger's `bm.user_id is distinct from auth.uid()`
// clause excludes nobody in that case, so this suite would still pass even if
// that clause were deleted. This test has a signed-in PIC create the card
// through their OWN client, so auth.uid() is actually their id, and proves
// they are excluded from their own notification while another PIC still gets one.
test('a PIC who creates the task is excluded from their own pic notification (self-exclusion)', async () => {
  let owner: Awaited<ReturnType<typeof mkUser>> | undefined
  let creatorPic: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let otherPic: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await mkUser('selfexcl-owner')
    creatorPic = await makeSignedInUser('selfexcl-creator')
    otherPic = await mkUser('selfexcl-other')
    const board = await mkBoard(owner.id, [creatorPic.uid, otherPic.id])
    boardId = board.boardId
    await setBoardPics(admin, boardId, [creatorPic.uid, otherPic.id])

    const { error } = await creatorPic.userClient
      .from('cards')
      .insert({ column_id: board.columnId, title: 'Self-exclusion task', position: 0 })
    expect(error).toBeNull()

    const { data: notes } = await admin
      .from('notifications')
      .select('user_id')
      .eq('board_id', boardId)
      .eq('kind', 'pic')

    const notifiedIds = (notes ?? []).map((n) => n.user_id)
    expect(notifiedIds).not.toContain(creatorPic.uid)
    expect(notifiedIds).toContain(otherPic.id)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (creatorPic) await admin.auth.admin.deleteUser(creatorPic.uid)
    if (otherPic) await admin.auth.admin.deleteUser(otherPic.id)
  }
}, 30000)

// setBoardPics and setBoardPicsFn both carry comments asserting that RLS
// (members_owner_write) restricts writes to the board owner — this is the
// branch's central security claim, and nothing else in this suite exercises
// it, since every other test calls setBoardPics with the service-role client,
// which bypasses RLS entirely. Here a plain (non-owner) member calls it with
// their own RLS-scoped client. PostgREST reports zero rows updated as success,
// not an error, so this must assert on the resulting PIC list, not on a throw.
test('setBoardPics as a non-owner member leaves the PIC list unchanged (RLS enforced)', async () => {
  let owner: Awaited<ReturnType<typeof mkUser>> | undefined
  let member: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let otherPic: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await mkUser('rls-owner')
    member = await makeSignedInUser('rls-member')
    otherPic = await mkUser('rls-otherpic')
    const board = await mkBoard(owner.id, [member.uid, otherPic.id])
    boardId = board.boardId
    await setBoardPics(admin, boardId, [otherPic.id])
    expect(await listBoardPicIds(admin, boardId)).toEqual([otherPic.id])

    // Plain member tries to make themselves PIC via their own client.
    await setBoardPics(member.userClient, boardId, [member.uid])

    // RLS should have silently matched zero rows on both the clear and set
    // steps — the PIC list must be exactly what it was before.
    expect(await listBoardPicIds(admin, boardId)).toEqual([otherPic.id])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (member) await admin.auth.admin.deleteUser(member.uid)
    if (otherPic) await admin.auth.admin.deleteUser(otherPic.id)
  }
}, 30000)

// The test above proves RLS blocks a non-owner. Nothing else in this suite
// exercises the actual production path in the other direction: every other
// test calls setBoardPics with the service-role client, which bypasses RLS
// entirely, so a policy change that broke real owners while still blocking
// non-owners would pass the whole suite. Here the board OWNER calls
// setBoardPics through their own RLS-scoped client and the PIC list must
// actually change.
test('setBoardPics as the board owner changes the PIC list through their own RLS-scoped client', async () => {
  let owner: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let a: Awaited<ReturnType<typeof mkUser>> | undefined
  let boardId: string | undefined
  try {
    owner = await makeSignedInUser('rls-owner-write')
    a = await mkUser('rls-owner-write-member')
    const board = await mkBoard(owner.uid, [a.id])
    boardId = board.boardId

    // mkBoard passes owner.uid as boards.owner_id, and the
    // on_board_created trigger (0004_board_owner_trigger.sql) inserts a
    // board_members row for owner_id with role='owner' as a side effect of
    // the board insert. is_board_owner()/members_owner_write RLS depends on
    // that row existing, so verify it rather than assume it.
    const { data: ownerMembership, error: ownerMembershipErr } = await admin
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('user_id', owner.uid)
      .single()
    expect(ownerMembershipErr).toBeNull()
    expect(ownerMembership?.role).toBe('owner')

    await setBoardPics(owner.userClient, boardId, [a.id])
    expect(await listBoardPicIds(admin, boardId)).toEqual([a.id])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (owner) await admin.auth.admin.deleteUser(owner.uid)
    if (a) await admin.auth.admin.deleteUser(a.id)
  }
}, 30000)

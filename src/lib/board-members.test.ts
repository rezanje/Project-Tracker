import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import {
  addWorkspaceMemberForCaller,
  addWorkspaceMemberToBoard,
  callerOwnsBoard,
  listAddableWorkspaceMembers,
} from './board-members'

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
    email: `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user!
}

/** Copied from board-pics.test.ts: does NOT ignore signInWithPassword's error.
 * An anon-key client that never authenticated still "works" for RLS-scoped
 * queries — it just matches zero rows everywhere, which is indistinguishable
 * from RLS correctly denying access, so a swallowed sign-in error would let an
 * RLS assertion pass vacuously. Throws loudly, then independently re-checks the
 * session via getUser() rather than trusting the sign-in response. */
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

/** Workspace owned by ownerId. The owner's workspace_members row is added by a
 * trigger (0012_workspaces.sql), so it is not inserted here. */
async function mkWorkspace(ownerId: string, name = 'BM Test Workspace') {
  const { data, error } = await admin
    .from('workspaces')
    .insert({ owner_id: ownerId, name })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
}

/** Board owned by ownerId. Its owner board_members row is added by a trigger
 * (0004_board_owner_trigger.sql), so it is not inserted here. */
async function mkBoard(ownerId: string, workspaceId: string | null, title = 'BM Test Board') {
  const { data, error } = await admin
    .from('boards')
    .insert({ owner_id: ownerId, title, workspace_id: workspaceId })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
}

async function addToWorkspace(workspaceId: string, userId: string, role = 'member') {
  const { error } = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role })
  if (error) throw error
}

async function boardMemberRoles(boardId: string): Promise<Record<string, string>> {
  const { data } = await admin.from('board_members').select('user_id, role').eq('board_id', boardId)
  return Object.fromEntries((data ?? []).map((r) => [r.user_id as string, r.role as string]))
}

test('listAddableWorkspaceMembers excludes people already on the board', async () => {
  let owner, onBoard, notYet, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmowner')
    onBoard = await mkUser('bmon')
    notYet = await mkUser('bmoff')
    wsId = await mkWorkspace(owner.id)
    await addToWorkspace(wsId, onBoard.id)
    await addToWorkspace(wsId, notYet.id)
    boardId = await mkBoard(owner.id, wsId)
    // onBoard already has an explicit board row; owner has one from the trigger.
    await admin.from('board_members').insert({ board_id: boardId, user_id: onBoard.id, role: 'member' })

    const addable = await listAddableWorkspaceMembers(admin, boardId)
    expect(addable.map((m) => m.id)).toEqual([notYet.id])
    expect(addable[0]?.name).toBe('bmoff')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    for (const u of [owner, onBoard, notYet]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 30000)

test('listAddableWorkspaceMembers returns nothing for a board with no workspace', async () => {
  let owner, boardId: string | undefined
  try {
    owner = await mkUser('bmnows')
    boardId = await mkBoard(owner.id, null)
    expect(await listAddableWorkspaceMembers(admin, boardId)).toEqual([])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
  }
}, 30000)

test('addWorkspaceMemberToBoard inserts a member row and clears them from the addable list', async () => {
  let owner, joiner, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmaddowner')
    joiner = await mkUser('bmaddjoin')
    wsId = await mkWorkspace(owner.id)
    await addToWorkspace(wsId, joiner.id)
    boardId = await mkBoard(owner.id, wsId)

    expect((await listAddableWorkspaceMembers(admin, boardId)).map((m) => m.id)).toEqual([joiner.id])

    await addWorkspaceMemberToBoard(admin, boardId, joiner.id)

    expect((await boardMemberRoles(boardId))[joiner.id]).toBe('member')
    expect(await listAddableWorkspaceMembers(admin, boardId)).toEqual([])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    for (const u of [owner, joiner]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 30000)

test('addWorkspaceMemberToBoard never downgrades an existing board role', async () => {
  let owner, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmnodown')
    wsId = await mkWorkspace(owner.id)
    boardId = await mkBoard(owner.id, wsId)
    // owner has role 'owner' from the board trigger, and is a workspace member
    // via the workspace trigger — so they satisfy the workspace check.
    await addWorkspaceMemberToBoard(admin, boardId, owner.id)
    expect((await boardMemberRoles(boardId))[owner.id]).toBe('owner')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
  }
}, 30000)

test('addWorkspaceMemberToBoard mirrors a workspace owner’s role instead of demoting them', async () => {
  // Reproduces finding #1: wsOwner owns the workspace but the board is created
  // by someone else, so wsOwner gets NO board_members row from the board-owner
  // trigger. board-data.ts resolves their role to 'owner' via the workspace
  // fallback, so the "add from workspace" picker offers them as a candidate.
  // Adding them through this path must NOT leave them as a plain 'member' —
  // that would silently demote a workspace owner the next time board-data.ts
  // reads their (now-explicit) board_members row, since that row wins over the
  // derived workspace role.
  let wsOwner, boardCreator, wsId: string | undefined, boardId: string | undefined
  try {
    wsOwner = await mkUser('bmmirrorwsown')
    boardCreator = await mkUser('bmmirrorcreator')
    wsId = await mkWorkspace(wsOwner.id)
    await addToWorkspace(wsId, boardCreator.id)
    boardId = await mkBoard(boardCreator.id, wsId)
    expect((await boardMemberRoles(boardId))[wsOwner.id]).toBeUndefined()

    await addWorkspaceMemberToBoard(admin, boardId, wsOwner.id)

    expect((await boardMemberRoles(boardId))[wsOwner.id]).toBe('owner')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    for (const u of [wsOwner, boardCreator]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 30000)

test('addWorkspaceMemberToBoard rejects a user who is not in the board workspace', async () => {
  let owner, outsider, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmrejowner')
    outsider = await mkUser('bmrejout')
    wsId = await mkWorkspace(owner.id)
    boardId = await mkBoard(owner.id, wsId)

    await expect(addWorkspaceMemberToBoard(admin, boardId, outsider.id)).rejects.toThrow()
    expect((await boardMemberRoles(boardId))[outsider.id]).toBeUndefined()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    for (const u of [owner, outsider]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 30000)

test('leaving a workspace removes every board membership in it, including PIC status', async () => {
  let owner, joiner, wsId: string | undefined, boardA: string | undefined, boardB: string | undefined
  try {
    owner = await mkUser('bmcasowner')
    joiner = await mkUser('bmcasjoin')
    wsId = await mkWorkspace(owner.id)
    await addToWorkspace(wsId, joiner.id)
    boardA = await mkBoard(owner.id, wsId, 'Cascade A')
    boardB = await mkBoard(owner.id, wsId, 'Cascade B')
    await addWorkspaceMemberToBoard(admin, boardA, joiner.id)
    await addWorkspaceMemberToBoard(admin, boardB, joiner.id)
    await admin
      .from('board_members')
      .update({ is_pic: true })
      .eq('board_id', boardA)
      .eq('user_id', joiner.id)

    await admin.from('workspace_members').delete().eq('workspace_id', wsId).eq('user_id', joiner.id)

    expect((await boardMemberRoles(boardA))[joiner.id]).toBeUndefined()
    expect((await boardMemberRoles(boardB))[joiner.id]).toBeUndefined()
    const { data: pics } = await admin
      .from('board_members')
      .select('user_id')
      .eq('board_id', boardA)
      .eq('is_pic', true)
    expect(pics ?? []).toEqual([])
  } finally {
    for (const b of [boardA, boardB]) if (b) await admin.from('boards').delete().eq('id', b)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    for (const u of [owner, joiner]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 40000)

test('leaving one workspace does not touch board memberships in another', async () => {
  let owner, joiner
  let wsOne: string | undefined, wsTwo: string | undefined
  let boardOne: string | undefined, boardTwo: string | undefined
  try {
    owner = await mkUser('bmisoowner')
    joiner = await mkUser('bmisojoin')
    wsOne = await mkWorkspace(owner.id, 'Iso One')
    wsTwo = await mkWorkspace(owner.id, 'Iso Two')
    await addToWorkspace(wsOne, joiner.id)
    await addToWorkspace(wsTwo, joiner.id)
    boardOne = await mkBoard(owner.id, wsOne, 'Iso Board One')
    boardTwo = await mkBoard(owner.id, wsTwo, 'Iso Board Two')
    await addWorkspaceMemberToBoard(admin, boardOne, joiner.id)
    await addWorkspaceMemberToBoard(admin, boardTwo, joiner.id)

    await admin.from('workspace_members').delete().eq('workspace_id', wsOne).eq('user_id', joiner.id)

    expect((await boardMemberRoles(boardOne))[joiner.id]).toBeUndefined()
    expect((await boardMemberRoles(boardTwo))[joiner.id]).toBe('member')
  } finally {
    for (const b of [boardOne, boardTwo]) if (b) await admin.from('boards').delete().eq('id', b)
    for (const w of [wsOne, wsTwo]) if (w) await admin.from('workspaces').delete().eq('id', w)
    for (const u of [owner, joiner]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 40000)

test('leaving the workspace drops the board creator’s own owner row too', async () => {
  // The cascade trigger (0036_workspace_member_cascade.sql) deletes by user_id
  // across every board in the workspace — it doesn't special-case the board's
  // creator. This is the spec's explicitly accepted consequence, not a
  // regression: unlike the earlier cascade tests, which use a plain 'member'
  // row, this one exercises the creator's 'owner' row (added by
  // 0004_board_owner_trigger.sql).
  let owner, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmcreatorcascade')
    wsId = await mkWorkspace(owner.id)
    boardId = await mkBoard(owner.id, wsId)
    expect((await boardMemberRoles(boardId))[owner.id]).toBe('owner')

    await admin.from('workspace_members').delete().eq('workspace_id', wsId).eq('user_id', owner.id)

    expect((await boardMemberRoles(boardId))[owner.id]).toBeUndefined()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
  }
}, 30000)

test('deleting a whole workspace cascades to its workspace_members and boards', async () => {
  let owner, joiner, wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmwscascadeowner')
    joiner = await mkUser('bmwscascadejoin')
    wsId = await mkWorkspace(owner.id)
    await addToWorkspace(wsId, joiner.id)
    boardId = await mkBoard(owner.id, wsId)
    await addWorkspaceMemberToBoard(admin, boardId, joiner.id)

    const { error: delErr } = await admin.from('workspaces').delete().eq('id', wsId)
    expect(delErr).toBeNull()

    const { data: wsMembers } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', wsId)
    expect(wsMembers ?? []).toEqual([])

    const { data: boards } = await admin.from('boards').select('id').eq('id', boardId)
    expect(boards ?? []).toEqual([])
  } finally {
    // The workspace, its boards and its workspace_members rows are already
    // gone via cascade — only the auth users still need cleanup.
    for (const u of [owner, joiner]) if (u) await admin.auth.admin.deleteUser(u.id)
  }
}, 30000)

test('callerOwnsBoard is true for a workspace owner with no board row, false for a plain member', async () => {
  let wsOwner: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let plain: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let boardCreator
  let wsId: string | undefined, boardId: string | undefined
  try {
    wsOwner = await makeSignedInUser('bmwsown')
    plain = await makeSignedInUser('bmplain')
    boardCreator = await mkUser('bmcreator')
    wsId = await mkWorkspace(wsOwner.uid)
    await addToWorkspace(wsId, plain.uid)
    await addToWorkspace(wsId, boardCreator.id)
    // The board is created by someone else, so wsOwner gets NO board_members row.
    boardId = await mkBoard(boardCreator.id, wsId)

    const roles = await boardMemberRoles(boardId)
    expect(roles[wsOwner.uid]).toBeUndefined() // the case this test exists for

    expect(await callerOwnsBoard(wsOwner.userClient, boardId, wsOwner.uid)).toBe(true)
    expect(await callerOwnsBoard(plain.userClient, boardId, plain.uid)).toBe(false)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    if (boardCreator) await admin.auth.admin.deleteUser(boardCreator.id)
    for (const u of [wsOwner, plain]) if (u) await admin.auth.admin.deleteUser(u.uid)
  }
}, 40000)

test('callerOwnsBoard is true for an explicit board owner who is not the workspace owner', async () => {
  // Exercises arm 1 of callerOwnsBoard (the explicit board_members role='owner' row)
  // in isolation from arm 2 (workspace ownership): wsOwner owns the workspace, but
  // the board is created by boardCreator, a plain workspace member, so boardCreator
  // gets a board_members 'owner' row from the board trigger while remaining a
  // 'member' (not 'owner') of the workspace.
  let wsOwner
  let boardCreator: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let wsId: string | undefined, boardId: string | undefined
  try {
    wsOwner = await mkUser('bmarm1wsown')
    boardCreator = await makeSignedInUser('bmarm1creator')
    wsId = await mkWorkspace(wsOwner.id)
    await addToWorkspace(wsId, boardCreator.uid, 'member')
    boardId = await mkBoard(boardCreator.uid, wsId)

    const { data: wsRow, error: wsErr } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsId)
      .eq('user_id', boardCreator.uid)
      .single()
    if (wsErr) throw wsErr
    expect(wsRow!.role).toBe('member') // proves arm 2 cannot be what grants access below

    const roles = await boardMemberRoles(boardId)
    expect(roles[boardCreator.uid]).toBe('owner') // arm 1's explicit board row

    expect(await callerOwnsBoard(boardCreator.userClient, boardId, boardCreator.uid)).toBe(true)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    if (wsOwner) await admin.auth.admin.deleteUser(wsOwner.id)
    if (boardCreator) await admin.auth.admin.deleteUser(boardCreator.uid)
  }
}, 40000)

test('addWorkspaceMemberForCaller rejects a plain workspace member and leaves membership unchanged', async () => {
  // Finding #2: nothing previously asserted that the gate (callerOwnsBoard) ran
  // before the act (addWorkspaceMemberToBoard) — deleting the gate line from the
  // route handler left every existing test passing. addWorkspaceMemberForCaller
  // composes gate-then-act so that ordering is testable outside the route file.
  // Uses the caller's own signed-in, RLS-scoped client (via makeSignedInUser) —
  // an unauthenticated client would match zero rows everywhere and pass this
  // test vacuously regardless of whether the gate ran.
  let owner
  let plain: Awaited<ReturnType<typeof makeSignedInUser>> | undefined
  let target
  let wsId: string | undefined, boardId: string | undefined
  try {
    owner = await mkUser('bmgateowner')
    plain = await makeSignedInUser('bmgateplain')
    target = await mkUser('bmgatetarget')
    wsId = await mkWorkspace(owner.id)
    await addToWorkspace(wsId, plain.uid)
    await addToWorkspace(wsId, target.id)
    boardId = await mkBoard(owner.id, wsId)

    await expect(
      addWorkspaceMemberForCaller(plain.userClient, admin, boardId, target.id, plain.uid),
    ).rejects.toThrow()

    expect((await boardMemberRoles(boardId))[target.id]).toBeUndefined()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (wsId) await admin.from('workspaces').delete().eq('id', wsId)
    if (owner) await admin.auth.admin.deleteUser(owner.id)
    if (target) await admin.auth.admin.deleteUser(target.id)
    if (plain) await admin.auth.admin.deleteUser(plain.uid)
  }
}, 40000)

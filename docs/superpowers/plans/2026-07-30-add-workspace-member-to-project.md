# Add Workspace Member To Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner add someone who is already in the workspace straight onto the project from a dropdown, instead of typing their email, and make removal from the workspace revoke those project rows.

**Architecture:** Workspace members already have read/edit access to every board in their workspace via the workspace arm of `is_board_member` / `is_board_editor` (`supabase/migrations/0012_workspaces.sql:33-44`). Adding them therefore grants no new access — it writes the explicit `board_members` row that makes them show up in the project's member list, which is what enables @-mentions, task assignment, and PIC eligibility. Because that explicit row independently grants access, a trigger on `workspace_members` delete removes those rows so workspace removal stays a single, complete revocation.

**Tech Stack:** TanStack Start (React) server functions, Supabase Postgres + RLS, vitest (integration tests hit the real remote DB via `.dev.vars`), Tailwind.

## Global Constraints

- Migrations live in `supabase/migrations/`. The next free number is `0036`. Do NOT apply migrations — the DB password is the user's secret and they apply them themselves.
- Tests hit the **real remote DB** via `.dev.vars` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`). No mocks, no local Docker. Every DB-backed test must create its users **inside** `try` and clean up in `finally` with null guards.
- Any test asserting an RLS outcome must use a genuinely signed-in client whose sign-in error is checked. Copy the hardened `makeSignedInUser` from `src/lib/board-pics.test.ts:44-69` — the un-hardened copy in `src/lib/notifications.test.ts` silently degrades to an anonymous client and makes such tests pass vacuously.
- Workspace members are added with `board_members.role = 'member'`. There is **no role picker** for them: `is_board_editor`'s workspace arm passes regardless of the row's role, so `'client'` would not restrict them.
- Adding must never change an existing `board_members` row. If the user already has one (any role), the add is a no-op — an upsert would silently downgrade a board owner to `member`.
- The email invite form and `inviteClient` behaviour stay as they are. The only change to that path is the authorisation fix in Task 3.
- Typecheck (`npx tsc --noEmit -p .`) is the only automated code-quality gate; there is no ESLint.
- The test-user password used throughout this repo's suites is `Babikeguling1!`.
- The suite runs with `fileParallelism: false` (`vitest.config.ts`) because parallel files trip Supabase auth rate limits and produce misleading "row-level security" errors. Do not change that.
- Note the `$` in `src/routes/board.$boardId.tsx` — quote or escape the path in shell commands. That file is ~1300 lines; use targeted edits, never a wholesale rewrite.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0036_workspace_member_cascade.sql` (create) | Trigger removing a user's `board_members` rows when they leave a workspace |
| `src/lib/board-members.ts` (create) | The only module that reads/writes board membership for this feature: list addable people, add one, and answer "does this caller own this board?" |
| `src/lib/board-members.test.ts` (create) | Integration tests for all three, plus the cascade |
| `src/routes/board.$boardId.tsx` (modify) | Two owner-gated server functions, the `inviteFn` authorisation fix, and the dropdown UI |

`callerOwnsBoard` lives in `board-members.ts` rather than inline in the route file specifically so it is testable — the route file imports server-only modules and cannot be imported from a test.

---

### Task 1: Cascade trigger for workspace removal

**Files:**
- Create: `supabase/migrations/0036_workspace_member_cascade.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: trigger `on_workspace_member_delete` on `workspace_members`, backed by `drop_board_memberships_on_workspace_leave()`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0036_workspace_member_cascade.sql`:

```sql
-- supabase/migrations/0036_workspace_member_cascade.sql
-- Projects can now be staffed by picking someone already in the workspace, which
-- writes an explicit board_members row. That row grants access on its own via
-- is_board_member()'s first arm — so without this trigger, removing someone from
-- a workspace would leave every such row behind and they would keep being able to
-- open and edit those projects. PIC is a flag on the board_members row, so their
-- PIC status is dropped along with it.
--
-- Boards with workspace_id is null are untouched: `b.workspace_id = old.workspace_id`
-- never matches null.
-- Idempotent throughout so a partial re-run can't fail halfway.

create or replace function drop_board_memberships_on_workspace_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from board_members bm
   where bm.user_id = old.user_id
     and bm.board_id in (
       select b.id from boards b where b.workspace_id = old.workspace_id
     );
  return old;
end $$;

drop trigger if exists on_workspace_member_delete on workspace_members;
create trigger on_workspace_member_delete
  after delete on workspace_members
  for each row execute function drop_board_memberships_on_workspace_leave();
```

- [ ] **Step 2: Verify the SQL parses**

There is no local DB, so this is a syntax-only check. Run:

```bash
grep -c "create or replace function drop_board_memberships_on_workspace_leave" "supabase/migrations/0036_workspace_member_cascade.sql"
```

Expected output: `1`

Then confirm by eye that the function body is wrapped in `$$ … $$` and every `begin` has a matching `end`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0036_workspace_member_cascade.sql
git commit -m "feat(db): drop board memberships when a user leaves a workspace"
```

- [ ] **Step 4: Hand the migration to the user**

Do NOT apply it. Report this to the controller verbatim:

> Migration `0036_workspace_member_cascade.sql` is ready. Apply via Supabase Dashboard → SQL Editor (paste the file, Run), then `npx supabase migration repair --status applied 0036 --db-url "<pooler-url>"`.

**Task 2 cannot pass until this is applied** — two of its tests assert the cascade. Stop here and wait for confirmation.

---

### Task 2: `board-members.ts` — list, add, and the owner check

**Files:**
- Create: `src/lib/board-members.ts`
- Test: `src/lib/board-members.test.ts`

**Interfaces:**
- Consumes: the Task 1 trigger (for the two cascade tests).
- Produces:
  - `type AddableMember = { id: string; name: string; avatar_url: string | null }`
  - `listAddableWorkspaceMembers(svc: SupabaseClient, boardId: string): Promise<AddableMember[]>`
  - `addWorkspaceMemberToBoard(svc: SupabaseClient, boardId: string, userId: string): Promise<void>`
  - `callerOwnsBoard(supabase: SupabaseClient, boardId: string, userId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/board-members.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/board-members.test.ts`
Expected: FAIL — `Failed to resolve import "./board-members"`. All 8 tests fail because the module does not exist yet.

If the repo's `rtk` shell hook makes output look truncated or stale, re-run as `rtk proxy npx vitest run src/lib/board-members.test.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/board-members.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type AddableMember = { id: string; name: string; avatar_url: string | null }

/** Read the board's workspace id, or null when it has none. */
async function boardWorkspaceId(svc: SupabaseClient, boardId: string): Promise<string | null> {
  const { data, error } = await svc
    .from('boards')
    .select('workspace_id')
    .eq('id', boardId)
    .maybeSingle()
  if (error) throw error
  return (data?.workspace_id as string | null) ?? null
}

/**
 * People in the board's workspace who have no `board_members` row yet — the
 * candidates for the project's "add from workspace" picker. Empty when the board
 * has no workspace.
 *
 * Takes a service-role client: the caller may legitimately be a workspace owner
 * with no `board_members` row, and `members_read` RLS on `board_members` would
 * hide rows from them. Callers MUST authorise with `callerOwnsBoard` first.
 */
export async function listAddableWorkspaceMembers(
  svc: SupabaseClient,
  boardId: string,
): Promise<AddableMember[]> {
  const workspaceId = await boardWorkspaceId(svc, boardId)
  if (!workspaceId) return []

  const [{ data: wsRows, error: wErr }, { data: bmRows, error: mErr }] = await Promise.all([
    svc
      .from('workspace_members')
      .select('user_id, profiles(id,name,avatar_url)')
      .eq('workspace_id', workspaceId),
    svc.from('board_members').select('user_id').eq('board_id', boardId),
  ])
  if (wErr) throw wErr
  if (mErr) throw mErr

  const already = new Set((bmRows ?? []).map((r) => r.user_id as string))
  const out: AddableMember[] = []
  for (const r of wsRows ?? []) {
    const uid = r.user_id as string
    if (already.has(uid)) continue
    const p = (r.profiles as unknown) as
      | { id: string; name: string | null; avatar_url: string | null }
      | null
    out.push({ id: uid, name: p?.name ?? 'Unknown', avatar_url: p?.avatar_url ?? null })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Register an existing workspace member on the board as a plain `member`.
 *
 * This grants no new access — `is_board_editor`'s workspace arm already covers
 * them (`0012_workspaces.sql`). The row is what makes them appear in the
 * project's member list, so they can be mentioned, assigned, and made PIC.
 *
 * Verifies the user really is in the board's workspace, because `svc` bypasses
 * RLS and `userId` arrives from the client. Callers MUST also authorise the
 * caller with `callerOwnsBoard` first.
 */
export async function addWorkspaceMemberToBoard(
  svc: SupabaseClient,
  boardId: string,
  userId: string,
): Promise<void> {
  const workspaceId = await boardWorkspaceId(svc, boardId)
  if (!workspaceId) throw new Error('board has no workspace')

  const { data: wm, error: wErr } = await svc
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (wErr) throw wErr
  if (!wm) throw new Error('user is not a member of this board’s workspace')

  // Check-then-insert rather than upsert: an upsert would overwrite an existing
  // row and silently downgrade a board owner to 'member'.
  const { data: existing, error: eErr } = await svc
    .from('board_members')
    .select('user_id')
    .eq('board_id', boardId)
    .eq('user_id', userId)
    .maybeSingle()
  if (eErr) throw eErr
  if (existing) return

  const { error } = await svc
    .from('board_members')
    .insert({ board_id: boardId, user_id: userId, role: 'member' })
  if (error) throw error
}

/**
 * Whether `userId` may administer this board: an explicit `board_members` row
 * with role `owner`, OR ownership of the workspace the board lives in. Mirrors
 * both arms of `is_board_owner()` (`0012_workspaces.sql`).
 *
 * The UI derives "owner" the same two ways (`board-data.ts`), so an endpoint
 * that only checked the board row would reject workspace owners the UI had
 * already offered the control to.
 *
 * Pass the caller's own RLS-scoped client — this is an authorisation check and
 * must not be run with service-role privileges.
 */
export async function callerOwnsBoard(
  supabase: SupabaseClient,
  boardId: string,
  userId: string,
): Promise<boolean> {
  const { data: m } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('user_id', userId)
    .maybeSingle()
  if (m?.role === 'owner') return true

  const { data: b } = await supabase
    .from('boards')
    .select('workspace_id')
    .eq('id', boardId)
    .maybeSingle()
  const workspaceId = (b?.workspace_id as string | null) ?? null
  if (!workspaceId) return false

  const { data: wm } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return wm?.role === 'owner'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/board-members.test.ts`
Expected: PASS, 8 tests.

If the two cascade tests fail with the joiner's row still present, the Task 1 migration has not been applied — stop and report BLOCKED rather than weakening the assertions.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/lib/board-members.ts src/lib/board-members.test.ts
git commit -m "feat: list and add workspace members as project members"
```

Expected typecheck output: `TypeScript: No errors found`

---

### Task 3: Server functions and the `inviteFn` authorisation fix

**Files:**
- Modify: `src/routes/board.$boardId.tsx` — imports; `inviteFn` (~lines 85-109); add two new server functions after `inviteFn`

**Interfaces:**
- Consumes: `listAddableWorkspaceMembers`, `addWorkspaceMemberToBoard`, `callerOwnsBoard`, `type AddableMember` from Task 2.
- Produces:
  - `fetchAddableMembersFn({ data: { boardId: string } }): Promise<AddableMember[]>`
  - `addBoardMemberFn({ data: { boardId: string; userId: string } }): Promise<void>`

- [ ] **Step 1: Add the imports**

In `src/routes/board.$boardId.tsx`, alongside the existing `#/lib/*` imports (near the `import { inviteClient } from '#/lib/invites'` line):

```ts
import {
  addWorkspaceMemberToBoard,
  callerOwnsBoard,
  listAddableWorkspaceMembers,
  type AddableMember,
} from '#/lib/board-members'
```

- [ ] **Step 2: Fix `inviteFn`'s authorisation**

`inviteFn`'s handler currently reads:

```ts
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: m } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', data.boardId)
      .eq('user_id', user.id)
      .single()
    if (m?.role !== 'owner') throw new Error('forbidden')
```

Replace those statements with:

```ts
    const { user, supabase } = await requireUser(getRequest(), headers)
    // Workspace owners see this form too (board-data.ts maps their workspace
    // role onto the board), so checking only the board_members row rejected
    // callers the UI had already offered the control to.
    if (!(await callerOwnsBoard(supabase, data.boardId, user.id))) throw new Error('forbidden')
```

Leave the rest of `inviteFn` — the `inviteClient(getServiceSupabase(), …)` call, `flush(headers)`, and the return — exactly as it is.

- [ ] **Step 3: Add the two server functions**

Insert immediately after `inviteFn`:

```ts
const fetchAddableMembersFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const boardId = (d as { boardId?: unknown })?.boardId
    if (typeof boardId !== 'string' || !boardId) throw new Error('boardId required')
    return { boardId }
  })
  .handler(async ({ data }): Promise<AddableMember[]> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    if (!(await callerOwnsBoard(supabase, data.boardId, user.id))) throw new Error('forbidden')
    const list = await listAddableWorkspaceMembers(getServiceSupabase(), data.boardId)
    flush(headers)
    return list
  })

const addBoardMemberFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, userId } = (d ?? {}) as { boardId?: unknown; userId?: unknown }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (typeof boardId !== 'string' || !uuid.test(boardId)) throw new Error('valid boardId required')
    if (typeof userId !== 'string' || !uuid.test(userId)) throw new Error('valid userId required')
    return { boardId, userId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    if (!(await callerOwnsBoard(supabase, data.boardId, user.id))) throw new Error('forbidden')
    await addWorkspaceMemberToBoard(getServiceSupabase(), data.boardId, data.userId)
    flush(headers)
  })
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: one error only —
`error TS6133: 'fetchAddableMembersFn' is declared but its value is never read.`
and the same for `addBoardMemberFn`. Both are consumed by Task 4's UI in this same file. Do NOT silence them with `export` or a fake call; Task 4 wires the real call sites.

If any OTHER error appears, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/board.\$boardId.tsx"
git commit -m "feat: endpoints to list and add workspace members, and accept workspace owners"
```

---

### Task 4: The dropdown UI

**Files:**
- Modify: `src/routes/board.$boardId.tsx` — component state (~line 473-477); a loader effect; the header form block (~lines 983-1024)

**Interfaces:**
- Consumes: `fetchAddableMembersFn`, `addBoardMemberFn` from Task 3; `type AddableMember` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add component state**

In the `BoardView` component, beside the existing invite state (`const [email, setEmail] = useState('')` and friends), add:

```ts
  const [addable, setAddable] = useState<AddableMember[]>([])
  const [addUserId, setAddUserId] = useState('')
```

- [ ] **Step 2: Load the candidate list**

Add this effect near the existing `boardMeta` effect. `isOwner` already exists in this component at `src/routes/board.$boardId.tsx:472` (`const isOwner = initialBoard.role === 'owner'`) and is the same flag the header uses to gate the invite form — reuse it, do not redefine it. `board` also already exists (line 521, `{ ...initialBoard, columns }`). The list is owner-only, so do not fetch it for anyone else.

```ts
  // Owner-only: the endpoint rejects non-owners, so don't even ask.
  useEffect(() => {
    if (!isOwner) return
    let alive = true
    fetchAddableMembersFn({ data: { boardId: board.id } })
      .then((list) => {
        if (alive) setAddable(list)
      })
      .catch(() => {
        if (alive) setAddable([])
      })
    return () => {
      alive = false
    }
  }, [isOwner, board.id])
```

- [ ] **Step 3: Add the submit handler**

Beside `onInvite`:

```ts
  async function onAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!addUserId) return
    const picked = addable.find((m) => m.id === addUserId)
    setResult(null)
    setInviteLink(null)
    try {
      await addBoardMemberFn({ data: { boardId: board.id, userId: addUserId } })
      setResult(`Added ${picked?.name ?? 'member'} to this project.`)
      setAddUserId('')
      // Refresh both lists: the dropdown drops the added person, and the
      // project's member list (which feeds PIC and mentions) gains them.
      // boardMeta is only refetched when null — see the effect that guards on it.
      setAddable(await fetchAddableMembersFn({ data: { boardId: board.id } }))
      setBoardMeta(null)
    } catch {
      setResult('Failed to add member.')
    }
  }
```

- [ ] **Step 4: Add the dropdown to the header**

Inside the existing `{isOwner && (<> … </>)}` block in the header — immediately after the closing `</form>` of the invite form and before the `{result && …}` line — insert:

```tsx
                {addable.length > 0 && (
                  <form onSubmit={onAddMember} className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:flex-nowrap">
                    <select
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                      aria-label="Add someone from this workspace"
                      className="field w-auto rounded-full px-3 py-2.5 text-[13px]"
                    >
                      <option value="">Add from workspace…</option>
                      {addable.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={!addUserId} className="btn btn-primary shrink-0">
                      Add
                    </button>
                  </form>
                )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found` — the two TS6133 errors from Task 3 are now resolved by these call sites.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the 8 from Task 2. The suite takes roughly 2 minutes and runs with `fileParallelism: false` — a slow run is not a hang.

Report the real counts. If a pre-existing test fails for reasons unrelated to this change, say so explicitly and show the failure rather than glossing over it.

- [ ] **Step 7: Commit**

```bash
git add "src/routes/board.\$boardId.tsx"
git commit -m "feat: add a workspace member to a project from a dropdown"
```

---

## Manual verification (controller + user, not the implementer)

The app is login-gated and an implementer cannot sign in, so do not attempt browser verification and do not claim it. These are for the user, logged in at `localhost:4321` (the port `.claude/launch.json` uses):

1. As a project owner in a workspace with other members, open a project — a "Add from workspace…" dropdown sits beside the email invite.
2. Pick someone, press Add — the confirmation names them, they vanish from the dropdown, and they now appear as a PIC candidate under Edit project.
3. Type `@` in a task comment — the newly added person appears in the autocomplete.
4. As a **workspace** owner who did not create the project, confirm both Add and the email invite succeed (this is the authorisation fix).
5. Remove that person from the workspace via the team panel, then reopen the project — they are gone from the member list and from the PIC candidates.

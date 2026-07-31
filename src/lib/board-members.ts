import type { SupabaseClient } from '@supabase/supabase-js'

export type AddableMember = { id: string; name: string }

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

  // Not filtered on profiles.status = 'approved' like searchAddableAccounts'
  // sibling query: a pending account can only reach this list by already being a
  // workspace_members row (added there by an owner, vetted independently of
  // approval), and requireUser (src/lib/auth.ts) redirects any unapproved user
  // to /pending on every route regardless, so an unapproved candidate showing
  // up here has no access consequence — they still can't use the app.
  const [{ data: wsRows, error: wErr }, { data: bmRows, error: mErr }] = await Promise.all([
    svc
      .from('workspace_members')
      .select('user_id, profiles(id,name)')
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
    const p = (r.profiles as unknown) as { id: string; name: string | null } | null
    out.push({ id: uid, name: p?.name ?? 'Unknown' })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Register an existing workspace member on the board, mirroring their
 * workspace role: a workspace `owner` is inserted as board `owner`, everyone
 * else as plain `member`.
 *
 * Mirroring rather than hardcoding `'member'` matters because a workspace
 * owner can always administer every board in the workspace anyway —
 * `is_board_owner()`'s workspace arm already passes for them
 * (`supabase/migrations/0012_workspaces.sql`) — so inserting them as `'member'`
 * would grant nothing new but would silently demote them the moment this
 * explicit row starts winning over that implicit access (`board-data.ts`
 * prefers a `board_members` row over the derived workspace role). Mirroring
 * the role keeps the operation a no-op for owners while still registering
 * plain members. `workspace_members.role` is constrained to `'owner' |
 * 'member'` (`0012_workspaces.sql`), so those are the only two cases.
 *
 * Verifies the user really is in the board's workspace, because `svc` bypasses
 * RLS and `userId` arrives from the client. Callers MUST also authorise the
 * caller with `callerOwnsBoard` first — see `addWorkspaceMemberForCaller`.
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
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (wErr) throw wErr
  if (!wm) throw new Error('user is not a member of this board’s workspace')
  const role = (wm.role as string) === 'owner' ? 'owner' : 'member'

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

  const { error } = await svc.from('board_members').insert({ board_id: boardId, user_id: userId, role })
  if (error) {
    // A double-click (or any concurrent retry) can pass the existence check
    // above twice before either insert lands, so the second insert hits the
    // board_members primary key. Treat that race as success — the row exists,
    // which is what the caller actually wants — instead of surfacing a false
    // "failed to add" for an add that in fact succeeded.
    if ((error as { code?: string }).code === '23505') return
    throw error
  }
}

/**
 * Gate-then-act wrapper: authorises `callerId` with `callerOwnsBoard` against
 * their own RLS-scoped client, then delegates to `addWorkspaceMemberToBoard`
 * with the service-role client. Pulled out of the route handler so the
 * ordering (authorise before acting) is unit-testable — the route file
 * (`src/routes/board.$boardId.tsx`) cannot be imported from a test.
 */
export async function addWorkspaceMemberForCaller(
  callerClient: SupabaseClient,
  svc: SupabaseClient,
  boardId: string,
  userId: string,
  callerId: string,
): Promise<void> {
  if (!(await callerOwnsBoard(callerClient, boardId, callerId))) throw new Error('forbidden')
  await addWorkspaceMemberToBoard(svc, boardId, userId)
}

/**
 * Gate-then-act wrapper for the addable-members list — same rationale as
 * `addWorkspaceMemberForCaller`.
 */
export async function listAddableWorkspaceMembersForCaller(
  callerClient: SupabaseClient,
  svc: SupabaseClient,
  boardId: string,
  callerId: string,
): Promise<AddableMember[]> {
  if (!(await callerOwnsBoard(callerClient, boardId, callerId))) throw new Error('forbidden')
  return listAddableWorkspaceMembers(svc, boardId)
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

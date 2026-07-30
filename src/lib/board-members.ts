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

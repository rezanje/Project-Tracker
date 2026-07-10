import type { SupabaseClient } from '@supabase/supabase-js'

export type PendingProfile = {
  id: string
  name: string | null
  email: string | null
  created_at: string
}

/** Self-signups waiting on the super admin. Needs a service-role client. */
export async function listPendingProfiles(svc: SupabaseClient): Promise<PendingProfile[]> {
  const { data: profiles } = await svc
    .from('profiles')
    .select('id, name, created_at')
    .eq('status', 'pending')
    .order('created_at')
  const { data: users } = await svc.auth.admin.listUsers()
  const emailById = new Map(users.users.map((u) => [u.id, u.email ?? null]))
  return (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string | null,
    email: emailById.get(p.id as string) ?? null,
    created_at: p.created_at as string,
  }))
}

export type WorkspaceOption = { id: string; name: string }

/** Every workspace, regardless of the caller's membership. Service-role only. */
export async function listAllWorkspaces(svc: SupabaseClient): Promise<WorkspaceOption[]> {
  const { data } = await svc.from('workspaces').select('id, name').order('name')
  return data ?? []
}

export type BoardOption = { id: string; title: string }

/** Every board, regardless of the caller's membership. Service-role only. */
export async function listAllBoards(svc: SupabaseClient): Promise<BoardOption[]> {
  const { data } = await svc.from('boards').select('id, title').order('title')
  return data ?? []
}

/** Grant a pending user a workspace role and approve their profile. */
export async function approveToWorkspace(
  svc: SupabaseClient,
  userId: string,
  workspaceId: string,
  role: 'owner' | 'member',
): Promise<void> {
  const { error: mErr } = await svc
    .from('workspace_members')
    .upsert(
      { workspace_id: workspaceId, user_id: userId, role },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true },
    )
  if (mErr) throw mErr
  const { error: pErr } = await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  if (pErr) throw pErr
}

/** Grant a pending user a board role and approve their profile. */
export async function approveToBoard(
  svc: SupabaseClient,
  userId: string,
  boardId: string,
  role: 'member' | 'client',
): Promise<void> {
  const { error: mErr } = await svc
    .from('board_members')
    .upsert(
      { board_id: boardId, user_id: userId, role },
      { onConflict: 'board_id,user_id', ignoreDuplicates: true },
    )
  if (mErr) throw mErr
  const { error: pErr } = await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  if (pErr) throw pErr
}

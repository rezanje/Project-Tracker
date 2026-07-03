import type { SupabaseClient } from '@supabase/supabase-js'

export type Workspace = { id: string; name: string; owner_id: string; created_at: string }

/** Workspaces the caller is a member of — RLS already limits the rows. */
export async function listMyWorkspaces(supabase: SupabaseClient): Promise<Workspace[]> {
  const { data } = await supabase.from('workspaces').select('*').order('created_at')
  return data ?? []
}

/**
 * Create a workspace. The owner `workspace_members` row is added by the
 * `on_workspace_created` trigger. Generate the id client-side and skip
 * RETURNING — same RLS pitfall as boards (is_workspace_member is `stable`, so
 * the trigger's membership row isn't visible to a RETURNING select).
 */
export async function createWorkspace(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('workspaces').insert({ id, name, owner_id: userId })
  if (error) throw error
  return { id }
}

/**
 * Invite an email to a workspace as a member.
 * Existing user → straight into workspace_members. Otherwise a pending invite
 * with a token (the signup link carries it). Needs a service-role client.
 */
export async function inviteWorkspaceMember(
  svc: SupabaseClient,
  workspaceId: string,
  email: string,
): Promise<{ status: 'added' } | { status: 'invited'; token: string }> {
  const { data } = await svc.auth.admin.listUsers()
  const existing = data.users.find((u) => u.email === email)

  if (existing) {
    await svc
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: existing.id, role: 'member' })
    return { status: 'added' }
  }

  const { data: inv, error } = await svc
    .from('pending_workspace_invites')
    .insert({ workspace_id: workspaceId, email })
    .select('token')
    .single()
  if (error) throw error
  return { status: 'invited', token: inv.token }
}

/** Convert a pending workspace invite into a member row. */
export async function acceptWorkspaceInvite(
  svc: SupabaseClient,
  token: string,
  userId: string,
): Promise<boolean> {
  const { data: inv } = await svc
    .from('pending_workspace_invites')
    .select('workspace_id')
    .eq('token', token)
    .maybeSingle()
  if (!inv) return false
  await svc
    .from('workspace_members')
    .insert({ workspace_id: inv.workspace_id, user_id: userId, role: 'member' })
  await svc.from('pending_workspace_invites').delete().eq('token', token)
  return true
}

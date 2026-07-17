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

export type TeamMember = {
  user_id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  role: string
}

/** List a workspace's members with profile + email. Needs a service client. */
export async function listWorkspaceMembers(
  svc: SupabaseClient,
  workspaceId: string,
): Promise<TeamMember[]> {
  const { data: rows } = await svc
    .from('workspace_members')
    .select('user_id, role, profiles(name, avatar_url)')
    .eq('workspace_id', workspaceId)
  const { data: users } = await svc.auth.admin.listUsers()
  const emailById = new Map(users.users.map((u) => [u.id, u.email ?? null]))
  return (rows ?? []).map((r) => {
    const raw = (r as { profiles: unknown }).profiles
    const p = (Array.isArray(raw) ? raw[0] : raw) as
      | { name: string | null; avatar_url: string | null }
      | null
    return {
      user_id: r.user_id as string,
      name: p?.name ?? null,
      email: emailById.get(r.user_id as string) ?? null,
      avatar_url: p?.avatar_url ?? null,
      role: r.role as string,
    }
  })
}

/** Change a member's workspace role. RLS restricts to the workspace owner. */
export async function setWorkspaceMemberRole(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: 'owner' | 'member',
): Promise<void> {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
}

/** Remove a member from a workspace. RLS restricts to the workspace owner. */
export async function removeWorkspaceMember(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
}

export type AddableAccount = { id: string; name: string; avatar_url: string | null }

/**
 * Approved accounts matching `query` by name or email, excluding anyone already
 * a member of `workspaceId`. Needs a service-role client (email lives in Auth,
 * not `profiles`, same as `inviteWorkspaceMember`/`listWorkspaceMembers`).
 * ponytail: auth.admin.listUsers() scans every account for the email match —
 * fine at this app's user count; paginate or add a server-side email index if
 * it ever gets slow.
 */
export async function searchAddableAccounts(
  svc: SupabaseClient,
  workspaceId: string,
  query: string,
): Promise<AddableAccount[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const { data: memberRows } = await svc
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
  const existingIds = new Set((memberRows ?? []).map((m) => m.user_id as string))

  const { data: byName } = await svc
    .from('profiles')
    .select('id,name,avatar_url')
    .eq('status', 'approved')
    .ilike('name', `%${q}%`)
    .limit(8)

  const { data: users } = await svc.auth.admin.listUsers()
  const emailMatchIds = users.users
    .filter((u) => u.email?.toLowerCase().includes(q.toLowerCase()))
    .map((u) => u.id)
  const { data: byEmail } = emailMatchIds.length
    ? await svc
        .from('profiles')
        .select('id,name,avatar_url')
        .eq('status', 'approved')
        .in('id', emailMatchIds)
        .limit(8)
    : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> }

  const merged = new Map<string, AddableAccount>()
  for (const p of [...(byName ?? []), ...(byEmail ?? [])]) {
    if (existingIds.has(p.id as string)) continue
    if (!merged.has(p.id as string)) {
      merged.set(p.id as string, { id: p.id as string, name: (p.name as string | null) ?? 'Unknown', avatar_url: (p.avatar_url as string | null) ?? null })
    }
  }
  return [...merged.values()].slice(0, 8)
}

/** Add an existing account straight into a workspace (no token/email round-trip). */
export async function addExistingWorkspaceMember(
  svc: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await svc
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role: 'member' })
  if (error) throw error
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
  // Invited-by-owner accounts are pre-vetted — skip the approval gate.
  await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  return true
}

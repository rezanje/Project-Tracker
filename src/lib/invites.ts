import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Invite an email to a board as a client.
 * If the email already has an account, add them straight to board_members.
 * Otherwise stash a pending_invites row with a token (the signup link carries
 * it; Task 13 emails the link). Needs a service-role client for the cross-user
 * email lookup.
 */
export type InviteRole = 'member' | 'client'

export async function inviteClient(
  svc: SupabaseClient,
  boardId: string,
  email: string,
  role: InviteRole = 'client',
): Promise<
  { status: 'added' } | { status: 'invited'; token: string }
> {
  // ponytail: listUsers scan is O(users) — fine at small scale; add an indexed
  // email lookup table if the user count grows.
  const { data } = await svc.auth.admin.listUsers()
  const existing = data.users.find((u) => u.email === email)

  if (existing) {
    await svc
      .from('board_members')
      .insert({ board_id: boardId, user_id: existing.id, role })
    return { status: 'added' }
  }

  const { data: inv, error } = await svc
    .from('pending_invites')
    .insert({ board_id: boardId, email, role })
    .select('token')
    .single()
  if (error) throw error
  return { status: 'invited', token: inv.token }
}

/** Convert a pending invite into a board_members row with its stored role. */
export async function acceptInvite(
  svc: SupabaseClient,
  token: string,
  userId: string,
): Promise<void> {
  const { data: inv } = await svc
    .from('pending_invites')
    .select('board_id, role')
    .eq('token', token)
    .single()
  if (!inv) throw new Error('invalid invite')
  await svc
    .from('board_members')
    .insert({ board_id: inv.board_id, user_id: userId, role: inv.role ?? 'client' })
  await svc.from('pending_invites').delete().eq('token', token)
}

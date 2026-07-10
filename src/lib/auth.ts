import { redirect } from '@tanstack/react-router'
import { getServerSupabase } from './supabase/server'

export type ApprovalProfile = { status: string; is_super_admin: boolean }

/**
 * Session-only guard: throws a redirect to /login when there's no session.
 * Does NOT check approval status — use this for /pending itself, which must
 * not redirect back to /pending (that would loop).
 */
export async function getSessionUser(request: Request, headers: Headers) {
  const supabase = getServerSupabase(request, headers)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw redirect({ to: '/login' })
  return { user, supabase }
}

/**
 * Pure gate: throws a redirect to /pending unless the profile is approved or
 * belongs to the super admin. No DB/request access, so it's cheap to test.
 */
export function assertApproved(profile: ApprovalProfile): void {
  if (profile.is_super_admin) return
  if (profile.status !== 'approved') throw redirect({ to: '/pending' })
}

/**
 * Server-side guard for protected loaders/actions.
 * Throws a redirect to /login when there's no valid session, or to /pending
 * when the account hasn't been approved yet.
 */
export async function requireUser(request: Request, headers: Headers) {
  const { user, supabase } = await getSessionUser(request, headers)
  const { data, error } = await supabase
    .from('profiles')
    .select('status, is_super_admin')
    .eq('id', user.id)
    .single()
  if (error) console.error('requireUser: profile fetch failed', error)
  const profile = (data as ApprovalProfile | null) ?? { status: 'pending', is_super_admin: false }
  assertApproved(profile)
  return { user, supabase, profile }
}

/** Guard for super-admin-only routes (the approvals dashboard). */
export async function requireSuperAdmin(request: Request, headers: Headers) {
  const { user, supabase, profile } = await requireUser(request, headers)
  if (!profile.is_super_admin) throw redirect({ to: '/' })
  return { user, supabase }
}

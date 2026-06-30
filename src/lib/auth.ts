import { redirect } from '@tanstack/react-router'
import { getServerSupabase } from './supabase/server'

/**
 * Server-side guard for protected loaders/actions.
 * Throws a redirect to /login when there's no valid session.
 * Returns the user plus a request-scoped client so the caller can keep querying.
 */
export async function requireUser(request: Request, headers: Headers) {
  const supabase = getServerSupabase(request, headers)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw redirect({ to: '/login' })
  return { user, supabase }
}

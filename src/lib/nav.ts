import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type NavWorkspace = { id: string; name: string }
export type NavBoard = { id: string; title: string; workspaceId: string | null }

/** Sidebar nav data: every workspace + active board the user can see.
 * Swallows auth errors so it can be called from any page, including bare
 * (unauthenticated) ones, without redirecting. */
export const fetchNav = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  try {
    const { supabase, profile } = await requireUser(getRequest(), headers)
    const [{ data: workspaces }, { data: boards }, pendingCount] = await Promise.all([
      supabase.from('workspaces').select('id,name').order('created_at'),
      supabase
        .from('boards')
        .select('id,title,workspace_id')
        .neq('status', 'archived')
        .order('created_at'),
      profile.is_super_admin
        ? supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        : Promise.resolve({ count: 0 }),
    ])
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return {
      workspaces: (workspaces ?? []) as NavWorkspace[],
      boards: (boards ?? []).map((b) => ({
        id: b.id as string,
        title: b.title as string,
        workspaceId: (b.workspace_id as string | null) ?? null,
      })),
      isSuperAdmin: profile.is_super_admin,
      pendingApprovalsCount: pendingCount.count ?? 0,
    }
  } catch {
    return {
      workspaces: [] as NavWorkspace[],
      boards: [] as NavBoard[],
      isSuperAdmin: false,
      pendingApprovalsCount: 0,
    }
  }
})

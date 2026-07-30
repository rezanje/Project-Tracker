import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type NavWorkspace = { id: string; name: string }
export type NavBoard = { id: string; title: string; workspaceId: string | null }
export type BoardAssignee = { id: string; name: string }

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

/**
 * Wrap an async factory so overlapping calls share a single in-flight
 * promise instead of each triggering their own request. Deliberately does
 * NOT cache the resolved value beyond that in-flight window: as soon as the
 * shared promise settles, the reference is cleared, so the very next call
 * always starts a brand-new request.
 *
 * That does NOT mean an invalidation-triggered refetch is always guaranteed
 * to see fresh state: if a mutation completes and calls `router.invalidate()`
 * while an earlier `onResolved`-triggered fetch is still pending, the new
 * call joins that pre-mutation in-flight promise instead of starting a fresh
 * one, so the data it resolves to is one step behind until the next
 * navigation. The window is roughly one nav round trip and nav data rarely
 * changes inside it, so this is accepted rather than solved (closing it
 * would need a generation counter, which isn't worth the complexity here).
 */
export function dedupeInFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null
  return () => {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }
}

/**
 * `Sidebar` and `MobileNav` are both mounted at once (hidden by CSS
 * breakpoints, not unmounted — see `src/routes/__root.tsx`), and both
 * subscribe their nav reload to the router's `onResolved` event so the
 * pending-approvals badge stays fresh after actions elsewhere. Left
 * unguarded, every resolved navigation fires `fetchNav()` twice. Route
 * through this deduped wrapper instead of calling `fetchNav` directly so
 * concurrent calls (the common case: both components react to the same
 * event in the same tick) coalesce into one server round trip.
 *
 * Client-only: this is a module-scope, process-wide singleton wrapping a
 * per-user server function. Both current call sites are inside `useEffect`,
 * so it's safe today — but this must never be called from a route loader
 * (loaders also run on the server): two concurrent users' loader requests
 * could then share this one in-flight promise, and one user could receive
 * another user's workspaces and boards.
 */
export const fetchNavDeduped = dedupeInFlight(fetchNav)

/** Board members for the assignee picker on the quick "New task" form, plus
 * the caller's own id so the client can label their own entry "Me" and
 * default to it. */
export const fetchBoardAssigneesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const boardId = (d as { boardId?: unknown })?.boardId
    if (typeof boardId !== 'string' || !boardId) throw new Error('boardId required')
    return { boardId }
  })
  .handler(async ({ data }): Promise<{ meId: string; members: BoardAssignee[] }> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    try {
      const { data: members, error } = await supabase
        .from('board_members')
        .select('user_id, profiles(id,name)')
        .eq('board_id', data.boardId)
      if (error) throw error
      const list = (members ?? []).map((m) => {
        const p = (m.profiles as unknown) as { id: string; name: string } | null
        return { id: p?.id ?? (m.user_id as string), name: p?.name ?? 'Unknown' }
      })
      // The caller may see/edit this board via workspace membership alone,
      // without an explicit board_members row — make sure "assign to me" is
      // always offered even then.
      if (!list.some((m) => m.id === user.id)) {
        const { data: me } = await supabase.from('profiles').select('name').eq('id', user.id).single()
        list.unshift({ id: user.id, name: me?.name ?? 'Me' })
      }
      for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
      return { meId: user.id, members: list }
    } catch {
      return { meId: user.id, members: [] }
    }
  })

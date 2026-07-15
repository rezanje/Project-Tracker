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

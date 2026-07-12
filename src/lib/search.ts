import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type SearchResults = {
  workspaces: Array<{ id: string; name: string }>
  boards: Array<{ id: string; title: string }>
  tasks: Array<{ id: string; title: string; boardId: string }>
}

const EMPTY: SearchResults = { workspaces: [], boards: [], tasks: [] }

// RLS already scopes every table to what the caller can see (board/workspace
// membership), so a plain ilike search returns only visible rows.
export const searchFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const q = (d as { q?: unknown })?.q
    return { q: typeof q === 'string' ? q.trim() : '' }
  })
  .handler(async ({ data }): Promise<SearchResults> => {
    if (data.q.length < 2) return EMPTY
    const { supabase } = await requireUser(getRequest(), new Headers())
    const like = `%${data.q}%`

    const [{ data: workspaces }, { data: boards }, { data: cards }] = await Promise.all([
      supabase.from('workspaces').select('id,name').ilike('name', like).limit(5),
      supabase.from('boards').select('id,title').ilike('title', like).neq('status', 'archived').limit(5),
      supabase
        .from('cards')
        .select('id,title,columns!inner(board_id)')
        .ilike('title', like)
        .limit(5),
    ])

    return {
      workspaces: (workspaces ?? []) as SearchResults['workspaces'],
      boards: (boards ?? []) as SearchResults['boards'],
      tasks: ((cards ?? []) as Array<{ id: string; title: string; columns: { board_id: string }[] }>)
        .filter((c) => c.columns[0])
        .map((c) => ({
          id: c.id,
          title: c.title,
          boardId: c.columns[0].board_id,
        })),
    }
  })

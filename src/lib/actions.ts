import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { createNote, deleteNote } from './notes'
import { createWorkspace } from './workspaces'
import { createBoard } from './boards'
import { createCard } from './cards'

// Shared client-callable mutations used by the chrome (sidebar / dashboards).

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export const createNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const body = (d as { body?: unknown })?.body
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    return { body: body.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createNote(supabase, user.id, data.body)
    flush(headers)
    return { ok: true }
  })

export const deleteNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await deleteNote(supabase, data.id)
    flush(headers)
    return { ok: true }
  })

// Header "+ New" quick-create: drop the task into the target board's first
// column (its leftmost/"To Do"-equivalent lane) rather than making the user
// pick one.
export const quickCreateTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, title } = (d ?? {}) as { boardId?: unknown; title?: unknown }
    if (typeof boardId !== 'string' || !boardId) throw new Error('boardId required')
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    return { boardId, title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { data: col, error: colErr } = await supabase
      .from('columns')
      .select('id')
      .eq('board_id', data.boardId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (colErr) throw colErr
    if (!col) throw new Error('Board has no columns yet')
    const card = await createCard(supabase, col.id as string, data.title)
    flush(headers)
    return { cardId: card.id, boardId: data.boardId }
  })

// Header/Home "+ New Project" quick-create: title + target workspace, always
// a 'tasks' kind board (the Leads kind is chosen from inside a workspace today).
export const createBoardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, title } = (d ?? {}) as { workspaceId?: unknown; title?: unknown }
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId required')
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    return { workspaceId, title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const board = await createBoard(supabase, user.id, data.title, data.workspaceId)
    flush(headers)
    return { boardId: board.id }
  })

export const createWorkspaceFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const name = (d as { name?: unknown })?.name
    if (typeof name !== 'string' || !name.trim()) throw new Error('name required')
    return { name: name.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const ws = await createWorkspace(supabase, user.id, data.name)
    flush(headers)
    return { id: ws.id, name: data.name }
  })

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { createNote, deleteNote, updateNote } from './notes'
import { createWorkspace } from './workspaces'
import { createBoard } from './boards'
import { createCard } from './cards'
import { createStandaloneTask, completeStandaloneTask } from './standalone-tasks'

// Shared client-callable mutations used by the chrome (sidebar / dashboards).

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export const createNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { body, category } = (d ?? {}) as { body?: unknown; category?: unknown }
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    const cat = typeof category === 'string' && category.trim() ? category.trim() : null
    return { body: body.trim(), category: cat }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createNote(supabase, user.id, data.body, data.category)
    flush(headers)
    return { ok: true }
  })

export const updateNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, body, category } = (d ?? {}) as { id?: unknown; body?: unknown; category?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    const cat = typeof category === 'string' && category.trim() ? category.trim() : null
    return { id, body: body.trim(), category: cat }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await updateNote(supabase, data.id, data.body, data.category)
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
    const { boardId, title, assigneeId, columnId, dueDate } = (d ?? {}) as {
      boardId?: unknown; title?: unknown; assigneeId?: unknown; columnId?: unknown; dueDate?: unknown
    }
    if (typeof boardId !== 'string' || !boardId) throw new Error('boardId required')
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    return {
      boardId,
      title: title.trim(),
      assigneeId: typeof assigneeId === 'string' && assigneeId ? assigneeId : null,
      columnId: typeof columnId === 'string' && columnId ? columnId : null,
      dueDate: typeof dueDate === 'string' && dueDate ? dueDate : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    // A caller-supplied lane is only honoured when it really belongs to this
    // board; otherwise the task falls into the first lane as before.
    const { data: cols, error: colErr } = await supabase
      .from('columns')
      .select('id')
      .eq('board_id', data.boardId)
      .order('position', { ascending: true })
    if (colErr) throw colErr
    const ids = (cols ?? []).map((c) => c.id as string)
    if (ids.length === 0) throw new Error('Board has no columns yet')
    const columnId = data.columnId && ids.includes(data.columnId) ? data.columnId : ids[0]
    const card = await createCard(supabase, columnId, data.title, {
      assignee_id: data.assigneeId,
      due_date: data.dueDate,
    })
    flush(headers)
    return { cardId: card.id, boardId: data.boardId }
  })

// QuickTaskForm "No project" branch: a personal task with no board at all.
export const createStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { title, workspaceId, dueDate } = (d ?? {}) as {
      title?: unknown
      workspaceId?: unknown
      dueDate?: unknown
    }
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required')
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspace required')
    return {
      title: title.trim(),
      workspaceId,
      dueDate: typeof dueDate === 'string' && dueDate ? dueDate : null,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await createStandaloneTask(supabase, user.id, data.title, data.workspaceId, data.dueDate)
    flush(headers)
    return { ok: true }
  })

export const completeStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await completeStandaloneTask(supabase, user.id, data.id)
    flush(headers)
    return { ok: true }
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

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { createNote, deleteNote, updateNote } from './notes'
import { createWorkspace } from './workspaces'
import { createBoard } from './boards'
import { createCard } from './cards'
import {
  createStandaloneTask,
  completeStandaloneTask,
  updateStandaloneTask,
  deleteStandaloneTask,
} from './standalone-tasks'
import { isDoneColumn } from './home'

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

export const updateStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, fields } = (d ?? {}) as { id?: unknown; fields?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    const f = (fields ?? {}) as Record<string, unknown>
    return {
      id,
      fields: {
        ...(typeof f.due_date === 'string' || f.due_date === null
          ? { due_date: f.due_date as string | null }
          : {}),
        ...(typeof f.due_time === 'string' || f.due_time === null
          ? { due_time: f.due_time as string | null }
          : {}),
        ...((Array.isArray(f.reminder_offsets) && f.reminder_offsets.every((x) => typeof x === 'number')) ||
        f.reminder_offsets === null
          ? { reminder_offsets: f.reminder_offsets as number[] | null }
          : {}),
      },
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await updateStandaloneTask(supabase, user.id, data.id, data.fields)
    flush(headers)
    return { ok: true }
  })

export const deleteStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await deleteStandaloneTask(supabase, user.id, data.id)
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

/** The lanes of the board a card belongs to, in order. Shared by the two
 *  functions below so "which board is this card on" is written once. */
async function boardLanes(
  supabase: Parameters<typeof createCard>[0],
  cardId: string,
): Promise<Array<{ id: string; title: string }>> {
  const { data: card, error: cardErr } = await supabase
    .from('cards')
    .select('id, columns(board_id)')
    .eq('id', cardId)
    .single()
  if (cardErr) throw cardErr
  const boardId = ((card?.columns as unknown) as { board_id: string } | null)?.board_id
  if (!boardId) throw new Error('Card has no board')
  const { data: cols, error: colErr } = await supabase
    .from('columns')
    .select('id,title')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
  if (colErr) throw colErr
  return (cols ?? []) as Array<{ id: string; title: string }>
}

// Move a card to another lane from outside the board — the status chip in My
// tasks. The target must belong to the card's own board; RLS still decides
// whether the caller may touch the card at all.
export const setCardColumnFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { cardId, columnId } = (d ?? {}) as { cardId?: unknown; columnId?: unknown }
    if (typeof cardId !== 'string' || !cardId) throw new Error('cardId required')
    if (typeof columnId !== 'string' || !columnId) throw new Error('columnId required')
    return { cardId, columnId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const lanes = await boardLanes(supabase, data.cardId)
    if (!lanes.some((c) => c.id === data.columnId))
      throw new Error('That column belongs to another project')
    const { error } = await supabase
      .from('cards')
      .update({ column_id: data.columnId })
      .eq('id', data.cardId)
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

// The dashboards' "due today" checkbox. RLS decides whether the caller may
// touch the card; this only resolves *which* lane counts as done, using the
// same title heuristic the stats do.
export const completeCardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const cardId = (d as { cardId?: unknown })?.cardId
    if (typeof cardId !== 'string' || !cardId) throw new Error('cardId required')
    return { cardId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const done = (await boardLanes(supabase, data.cardId)).find((c) => isDoneColumn(c.title))
    if (!done) throw new Error('This project has no Done column')

    const { error } = await supabase
      .from('cards')
      .update({ column_id: done.id })
      .eq('id', data.cardId)
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

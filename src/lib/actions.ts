import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import { createNote, deleteNote } from './notes'
import { createWorkspace } from './workspaces'

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

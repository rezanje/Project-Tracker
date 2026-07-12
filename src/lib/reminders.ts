import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

export const createReminderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { message, remindAt } = (d ?? {}) as { message?: unknown; remindAt?: unknown }
    if (typeof message !== 'string' || !message.trim()) throw new Error('message required')
    if (typeof remindAt !== 'string' || Number.isNaN(Date.parse(remindAt))) throw new Error('remindAt required')
    return { message: message.trim(), remindAt }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase
      .from('reminders')
      .insert({ user_id: user.id, message: data.message, remind_at: data.remindAt })
    if (error) throw error
    flush(headers)
    return { ok: true }
  })

export const dismissReminderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await supabase.from('reminders').update({ dismissed_at: new Date().toISOString() }).eq('id', data.id)
    flush(headers)
    return { ok: true }
  })

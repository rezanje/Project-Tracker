import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'

export type Profile = {
  name: string | null
  email: string | null
  emailReminders: boolean
}

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

/** Trim, collapse runs of whitespace, cap length. An all-blank name becomes
 *  null rather than '' so the display-name fallbacks (Header's firstName /
 *  initials) keep reaching for the email local part instead of rendering
 *  an empty pill. */
export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 60)
  return name || null
}

export const fetchProfileFn = createServerFn({ method: 'GET' }).handler(async (): Promise<Profile> => {
  const headers = new Headers()
  const { supabase, user } = await requireUser(getRequest(), headers)
  const { data } = await supabase
    .from('profiles')
    .select('name,email_reminders')
    .eq('id', user.id)
    .single()
  flush(headers)
  return {
    name: (data?.name as string | null) ?? null,
    email: user.email ?? null,
    // Missing row (shouldn't happen) reads as opted-in, matching the column default.
    emailReminders: (data?.email_reminders as boolean | null) ?? true,
  }
})

export const updateProfileFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { name, emailReminders } = (d ?? {}) as { name?: unknown; emailReminders?: unknown }
    if (typeof name !== 'string') throw new Error('name required')
    if (typeof emailReminders !== 'boolean') throw new Error('emailReminders required')
    return { name: normalizeName(name), emailReminders }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase, user } = await requireUser(getRequest(), headers)
    const { error } = await supabase
      .from('profiles')
      .update({ name: data.name, email_reminders: data.emailReminders })
      .eq('id', user.id)
    flush(headers)
    if (error) throw error
    return { ok: true, name: data.name }
  })

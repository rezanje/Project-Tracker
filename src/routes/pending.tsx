import { useEffect } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { getSessionUser } from '#/lib/auth'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchPendingInfo = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await getSessionUser(getRequest(), headers)
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, status')
    .eq('id', user.id)
    .single()
  flush(headers)
  return { name: (profile?.name as string | null) ?? null, approved: profile?.status === 'approved' }
})

export const Route = createFileRoute('/pending')({
  component: Pending,
  loader: async () => await fetchPendingInfo(),
})

function Pending() {
  const router = useRouter()
  const { name, approved } = Route.useLoaderData()

  // Approved while this tab was open (e.g. admin granted access moments ago)
  // — send them into the app instead of stranding them on the waiting page.
  useEffect(() => {
    if (approved) router.navigate({ to: '/' })
  }, [approved, router])

  if (approved) return null

  return (
    <main className="page-wrap flex flex-1 flex-col items-center justify-center gap-3 pb-32 pt-9 text-center">
      <h1 className="display-title text-3xl font-extrabold text-[var(--ink)]">
        Hi{name ? `, ${name}` : ''} — you're almost in
      </h1>
      <p className="max-w-[420px] text-[15px] text-[var(--ink2)]">
        Your account is waiting for approval from the workspace admin. You'll
        get access as soon as they assign you to a workspace.
      </p>
    </main>
  )
}

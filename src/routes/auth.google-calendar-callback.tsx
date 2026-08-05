import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { completeGoogleCalendarConnectFn } from '#/lib/google-calendar-actions'
import { toast } from '#/components/Toast'

export const Route = createFileRoute('/auth/google-calendar-callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  component: GoogleCalendarCallback,
})

function GoogleCalendarCallback() {
  const { code, state } = Route.useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!code || !state) {
        toast('Gagal menyambungkan')
        navigate({ to: '/calendar' })
        return
      }
      try {
        await completeGoogleCalendarConnectFn({ data: { code, state } })
        if (!cancelled) {
          toast('Google Calendar tersambung')
          navigate({ to: '/calendar' })
        }
      } catch {
        if (!cancelled) {
          toast('Gagal menyambungkan')
          navigate({ to: '/calendar' })
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [code, state, navigate])

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <p className="text-[14px] text-[var(--ink3)]">Menyambungkan…</p>
    </main>
  )
}

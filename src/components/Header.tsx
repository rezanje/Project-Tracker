import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  const navigate = useNavigate()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getBrowserSupabase()
    supabase.auth
      .getUser()
      .then((res: { data: { user: { email?: string | null } | null } }) =>
        setEmail(res.data.user?.email ?? null),
      )
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_e: unknown, session: { user?: { email?: string | null } } | null) =>
        setEmail(session?.user?.email ?? null),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    setEmail(null)
    navigate({ to: '/login' })
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-md">
      <nav className="page-wrap flex items-center gap-3 py-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[var(--sea-ink)] no-underline"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--lagoon-deep)]" />
          <span className="text-base font-bold tracking-tight">GenTrack</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {email && (
            <>
              <span className="hidden max-w-[14rem] truncate text-sm text-[var(--sea-ink-soft)] sm:inline">
                {email}
              </span>
              <button
                type="button"
                onClick={logout}
                className="btn btn-ghost"
                aria-label="Log out"
              >
                <LogOut size={15} aria-hidden="true" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}

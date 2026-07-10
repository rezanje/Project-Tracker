import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import ThemeToggle from './ThemeToggle'

// Two-letter avatar initials from an email local part (e.g. reza.g → RG).
function initials(email: string): string {
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[.\-_+]/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return chars.toUpperCase() || '?'
}

function BrandMark() {
  return <img src="/logo192.png" alt="" width={34} height={34} className="rounded-[11px]" />
}

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
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur-md sm:px-6">
      <Link to="/" className="flex items-center gap-2.5 text-[var(--ink)] no-underline">
        <BrandMark />
        <span className="display-title text-[19px] font-extrabold">Rakit</span>
      </Link>

      <div className="flex items-center gap-2.5">
        <ThemeToggle />
        {email && (
          <>
            <div className="hidden items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pl-3.5 pr-1 sm:flex">
              <span className="max-w-[13rem] truncate text-[13px] font-semibold text-[var(--ink2)]">
                {email}
              </span>
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-bold text-white">
                {initials(email)}
              </span>
            </div>
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
    </header>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell, Bot, CalendarDays, ChevronDown, Clock, LogOut, Plus, Search } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import ThemeToggle from './ThemeToggle'

function greeting(h: number): string {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// First name from a profile name / email local part (e.g. "Reza Rahman" → "Reza").
function firstName(name: string | null, email: string | null): string {
  const base = (name ?? email?.split('@')[0] ?? '').trim()
  if (!base) return 'there'
  const first = base.split(/[.\-_\s]+/).filter(Boolean)[0] ?? base
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function initials(name: string | null, email: string | null): string {
  const base = name ?? email?.split('@')[0] ?? ''
  const parts = base.split(/[.\-_\s]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)
  return chars.toUpperCase() || '?'
}

export default function Header() {
  const navigate = useNavigate()
  const [now, setNow] = useState<Date | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    const supabase = getBrowserSupabase()
    supabase.auth.getUser().then(async (res: { data: { user: { id: string; email?: string | null } | null } }) => {
      const user = res.data.user
      if (!user) return
      setEmail(user.email ?? null)
      const { data } = await supabase.from('profiles').select('name').eq('id', user.id).single()
      setName((data?.name as string | null) ?? null)
    })
    return () => clearInterval(id)
  }, [])

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    navigate({ to: '/login' })
  }

  const hello = now ? greeting(now.getHours()) : 'Welcome'
  const who = firstName(name, email)
  const dateStr = now
    ? now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  const timeStr = now ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b-2 border-[var(--ink)] bg-[var(--header-bg)] px-4 py-2.5 backdrop-blur-md sm:px-6">
      {/* greeting + robot bubble */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 leading-tight">
          <p className="text-[11px] font-semibold text-[var(--ink3)]">{hello},</p>
          <p className="display-title truncate text-xl font-extrabold text-[var(--ink)]">{who} 👋</p>
        </div>
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border-2 border-[var(--ink)] bg-[var(--accent-soft)] text-[var(--accent-ink)] sm:flex">
          <Bot size={18} aria-hidden="true" />
        </span>
        <span className="hidden rounded-[10px] border-2 border-[var(--ink)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] lg:inline">
          Here's what matters today!
        </span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        {/* date / time */}
        {dateStr && (
          <div className="mr-1 hidden text-right leading-tight xl:block">
            <p className="flex items-center justify-end gap-1 text-[12px] font-bold text-[var(--ink)]">
              <CalendarDays size={13} className="text-[var(--ink3)]" aria-hidden="true" />
              {dateStr}
            </p>
            <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[var(--ink3)]">
              <Clock size={12} aria-hidden="true" />
              {timeStr}
            </p>
          </div>
        )}

        <label className="hidden items-center gap-2 rounded-full border-2 border-[var(--ink)] bg-[var(--card)] px-3 py-1.5 sm:flex">
          <Search size={15} className="text-[var(--ink3)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search anything…"
            className="w-36 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
          />
        </label>
        <button type="button" aria-label="Notifications" className="btn btn-ghost px-2.5">
          <Bell size={16} aria-hidden="true" />
        </button>
        {/* ponytail: + New is a visual shell; wired to a create flow in a later sub-project */}
        <button type="button" aria-label="New" className="btn btn-primary">
          <Plus size={16} aria-hidden="true" />
          <span className="hidden sm:inline">New</span>
        </button>

        {/* account chip (desktop) */}
        <button
          type="button"
          className="hidden items-center gap-1.5 rounded-full border-2 border-[var(--ink)] bg-[var(--card)] py-1 pl-1 pr-2 md:flex"
          title={email ?? undefined}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white">
            {initials(name, email)}
          </span>
          <ChevronDown size={14} className="text-[var(--ink3)]" aria-hidden="true" />
        </button>

        {/* mobile theme + logout */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="btn btn-ghost px-2.5"
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}

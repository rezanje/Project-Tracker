import { useEffect, useState } from 'react'
import { Bell, Plus, Search } from 'lucide-react'

function greeting(h: number): string {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Header() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const hello = now ? greeting(now.getHours()) : 'Welcome'
  const dateStr = now
    ? now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : ''
  const timeStr = now ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b-2 border-[var(--ink)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="display-title text-lg font-bold text-[var(--ink)]">{hello} 👋</p>
        {dateStr && (
          <p className="text-xs font-semibold text-[var(--ink2)]">
            {dateStr} · {timeStr}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="hidden items-center gap-2 rounded-full border-2 border-[var(--ink)] bg-[var(--card)] px-3 py-1.5 sm:flex">
          <Search size={15} className="text-[var(--ink3)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search…"
            className="w-40 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
          />
        </label>
        <button type="button" aria-label="Notifications" className="btn btn-ghost px-2.5">
          <Bell size={16} aria-hidden="true" />
        </button>
        {/* ponytail: + New is a visual shell; wired to a create flow in a later sub-project */}
        <button type="button" className="btn btn-primary">
          <Plus size={16} aria-hidden="true" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>
    </header>
  )
}

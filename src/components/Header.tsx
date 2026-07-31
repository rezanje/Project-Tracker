import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bell,
  CheckSquare,
  ChevronDown,
  FolderKanban,
  LogOut,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { searchFn, type SearchResults } from '#/lib/search'
import {
  fetchNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
  type Notification,
} from '#/lib/notifications'
import Popover from './Popover'
import QuickProjectForm from './QuickProjectForm'
import QuickTaskForm from './QuickTaskForm'
import ThemeToggle from './ThemeToggle'
import { WorkspacePill, WorkspaceSwitcherSheet } from './WorkspaceSwitcher'

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

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function ProfileMenu({ email, name }: { email: string | null; name: string | null }) {
  const navigate = useNavigate()

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    navigate({ to: '/login' })
  }

  return (
    <div className="hidden md:block">
      <Popover
        panelClassName="w-56 p-1.5"
        renderTrigger={(_open, toggle) => (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-full bg-[var(--card)] py-1 pl-1 pr-2 shadow-[var(--shadow-sm)]"
            title={email ?? undefined}
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-[var(--card)]"
              style={{ background: accentFor(email ?? name ?? '?') }}
            >
              {initials(name, email)}
            </span>
            <ChevronDown size={14} className="text-[var(--ink3)]" aria-hidden="true" />
          </button>
        )}
        renderPanel={(close) => (
          <>
            <p className="truncate px-3 py-2 text-[12px] font-medium text-[var(--ink3)]">{email}</p>
            <button
              type="button"
              onClick={() => {
                close()
                navigate({ to: '/coming-soon' })
              }}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13.5px] font-semibold text-[var(--ink2)] hover:bg-[var(--col)]"
            >
              <Settings size={15} aria-hidden="true" />
              Settings
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13.5px] font-semibold text-[var(--danger)] hover:bg-[var(--col)]"
            >
              <LogOut size={15} aria-hidden="true" />
              Log out
            </button>
          </>
        )}
      />
    </div>
  )
}

function NewMenu() {
  const [tab, setTab] = useState<'task' | 'project'>('task')

  return (
    <Popover
      renderTrigger={(_open, toggle) => (
        <button
          type="button"
          aria-label="New"
          onClick={() => {
            setTab('task')
            toggle()
          }}
          className="btn btn-primary"
        >
          <Plus size={16} aria-hidden="true" />
          <span className="hidden sm:inline">New</span>
        </button>
      )}
      renderPanel={(close) => (
        <>
          <div className="mb-3 flex gap-1 rounded-full bg-[var(--col)] p-1">
            <button
              type="button"
              onClick={() => setTab('task')}
              className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold ${
                tab === 'task' ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]' : 'text-[var(--ink3)]'
              }`}
            >
              Task
            </button>
            <button
              type="button"
              onClick={() => setTab('project')}
              className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold ${
                tab === 'project' ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]' : 'text-[var(--ink3)]'
              }`}
            >
              Project
            </button>
          </div>
          {tab === 'task' ? <QuickTaskForm onDone={close} /> : <QuickProjectForm onDone={close} />}
        </>
      )}
    />
  )
}

function SearchBox() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults>({ workspaces: [], boards: [], tasks: [] })

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({ workspaces: [], boards: [], tasks: [] })
      return
    }
    const id = setTimeout(() => {
      searchFn({ data: { q } }).then(setResults)
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const hasResults = results.workspaces.length + results.boards.length + results.tasks.length > 0

  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <Popover
        panelClassName="w-80 max-h-[70vh] overflow-y-auto p-1.5"
        renderTrigger={(open, toggle) => (
          <label className="flex items-center gap-2.5 rounded-[var(--r-md)] bg-[var(--col)] px-4 py-3.5 sm:rounded-full sm:bg-[var(--card)] sm:px-[18px] sm:py-[11px] sm:shadow-[var(--shadow-sm)]">
            <Search size={17} className="text-[var(--ink3)]" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search anything…"
              value={q}
              onChange={(e) => {
                const val = e.target.value
                setQ(val)
                const shouldOpen = val.trim().length >= 2
                if (shouldOpen !== open) toggle()
              }}
              onFocus={() => {
                if (q.trim().length >= 2 && !open) toggle()
              }}
              className="w-full min-w-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] sm:w-40 xl:w-52"
            />
          </label>
        )}
        renderPanel={(close) => {
          function go(to: '/workspace/$workspaceId' | '/board/$boardId', id: string) {
            close()
            setQ('')
            if (to === '/workspace/$workspaceId') navigate({ to, params: { workspaceId: id } })
            else navigate({ to, params: { boardId: id } })
          }
          return (
            <>
              {!hasResults && (
                <p className="px-2.5 py-3 text-center text-[12px] text-[var(--ink3)]">No matches for "{q}"</p>
              )}
              {results.workspaces.length > 0 && (
                <>
                  <p className="px-2.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                    Workspaces
                  </p>
                  {results.workspaces.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => go('/workspace/$workspaceId', w.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-bold text-[var(--ink2)] hover:bg-[var(--col)]"
                    >
                      {w.name}
                    </button>
                  ))}
                </>
              )}
              {results.boards.length > 0 && (
                <>
                  <p className="px-2.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                    Boards
                  </p>
                  {results.boards.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => go('/board/$boardId', b.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-bold text-[var(--ink2)] hover:bg-[var(--col)]"
                    >
                      <FolderKanban size={14} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
                      {b.title}
                    </button>
                  ))}
                </>
              )}
              {results.tasks.length > 0 && (
                <>
                  <p className="px-2.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                    Tasks
                  </p>
                  {results.tasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => go('/board/$boardId', t.boardId)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-bold text-[var(--ink2)] hover:bg-[var(--col)]"
                    >
                      <CheckSquare size={14} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
                      {t.title}
                    </button>
                  ))}
                </>
              )}
            </>
          )
        }}
      />
    </div>
  )
}

function NotificationsBell() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Notification[]>([])
  const unread = items.filter((n) => !n.read).length

  useEffect(() => {
    fetchNotificationsFn().then(setItems).catch(() => {})
  }, [])

  async function onItemClick(n: Notification, close: () => void) {
    close()
    if (n.kind === 'approval') {
      navigate({ to: '/admin/approvals' })
      return
    }
    if (!n.read) {
      await markNotificationReadFn({ data: { id: n.id, kind: n.kind } }).catch(() => {})
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)))
    }
    if (n.boardId) navigate({ to: '/board/$boardId', params: { boardId: n.boardId } })
  }

  async function markAll() {
    await markAllNotificationsReadFn().catch(() => {})
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
  }

  return (
    <Popover
      panelClassName="w-80 max-h-[70vh] overflow-y-auto p-1.5"
      renderTrigger={(_open, toggle) => (
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => {
            toggle()
            fetchNotificationsFn().then(setItems).catch(() => {})
          }}
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]"
        >
          <Bell size={19} strokeWidth={1.7} aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute right-[9px] top-[9px] flex h-[9px] min-w-[9px] items-center justify-center rounded-full border-[1.5px] border-[var(--card)] bg-[var(--accent)]" />
          )}
        </button>
      )}
      renderPanel={(close) => (
        <>
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-[11px] font-bold text-[var(--accent-ink)]">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <p className="px-2.5 py-4 text-center text-[12px] text-[var(--ink3)]">Nothing yet — you're all caught up.</p>
          )}
          {items.map((n) => (
            <button
              key={`${n.kind}:${n.id}`}
              type="button"
              onClick={() => onItemClick(n, close)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--col)] ${
                n.read ? '' : 'bg-[var(--accent-soft)]'
              }`}
            >
              <span className="text-[13px] font-semibold text-[var(--ink)]">{n.message}</span>
              <span className="text-[11px] text-[var(--ink3)]">{timeAgo(n.createdAt)}</span>
            </button>
          ))}
        </>
      )}
    />
  )
}

export default function Header() {
  const navigate = useNavigate()
  const [wsOpen, setWsOpen] = useState(false)
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
    <header className="sticky top-0 z-20 flex flex-col gap-4 bg-[var(--header-bg)] px-5 py-4 backdrop-blur-md sm:flex-row sm:flex-wrap sm:items-center sm:px-7 sm:py-6">
      {/* Greeting sits beside the round controls on mobile, matching the comp. */}
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <div className="min-w-0 flex-1">
          <div className="mb-2">
            <WorkspacePill onOpen={() => setWsOpen(true)} />
          </div>
          {dateStr && (
            <p className="truncate text-[13px] font-medium text-[var(--ink3)]">
              {dateStr}
              <span className="hidden xl:inline"> · {timeStr}</span>
            </p>
          )}
          <h1 className="mt-0.5 truncate text-[24px] font-extrabold tracking-[-0.03em] text-[var(--ink)] sm:text-[30px]">
            {hello}, {who}
          </h1>
        </div>

        {/* mobile-only: bell + theme + logout as round buttons */}
        <div className="flex items-center gap-2 sm:hidden">
          <NotificationsBell />
          <ThemeToggle compact />
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex w-full items-center gap-2.5 sm:w-auto">
        <SearchBox />
        <span className="hidden sm:contents">
          <NotificationsBell />
          <NewMenu />
        </span>
        <ProfileMenu email={email} name={name} />
      </div>

      <WorkspaceSwitcherSheet open={wsOpen} onClose={() => setWsOpen(false)} />
    </header>
  )
}

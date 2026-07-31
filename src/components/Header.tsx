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
import { fetchNotificationsFn } from '#/lib/notifications'
import NotificationSheet from './NotificationSheet'
import Popover from './Popover'
import QuickNoteForm from './QuickNoteForm'
import QuickProjectForm from './QuickProjectForm'
import QuickReminderForm from './QuickReminderForm'
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

const NEW_TABS = [
  ['task', 'Task'],
  ['project', 'Project'],
  ['note', 'Note'],
  ['reminder', 'Reminder'],
] as const
type NewTab = (typeof NEW_TABS)[number][0]

// Note and Reminder used to live in Home's "Quick actions" grid; Home is the
// comp's three sections now, so creation collects here and in the FAB sheet.
function NewMenu() {
  const [tab, setTab] = useState<NewTab>('task')

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
            {NEW_TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 rounded-full py-1.5 text-[11.5px] font-semibold ${
                  tab === id ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]' : 'text-[var(--ink3)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'task' && <QuickTaskForm onDone={close} />}
          {tab === 'project' && <QuickProjectForm onDone={close} />}
          {tab === 'note' && <QuickNoteForm onDone={close} />}
          {tab === 'reminder' && <QuickReminderForm onDone={close} />}
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

/** The bell. Notifications and messages both live behind it now that the nav is
 *  four tabs — it opens the sheet rather than a popover. */
export function NotificationsBell({ compact = false }: { compact?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetchNotificationsFn()
      .then((items) => setUnread(items.filter((n) => !n.read).length))
      .catch(() => {})
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Notifikasi"
        onClick={() => setOpen(true)}
        className={`relative flex shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)] transition active:scale-[.94] ${
          compact ? 'h-10 w-10' : 'h-11 w-11'
        }`}
      >
        <Bell size={19} strokeWidth={1.7} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-[9px] top-[9px] h-[7px] w-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_0_1.5px_var(--card)]" />
        )}
      </button>
      {open && <NotificationSheet onClose={() => setOpen(false)} />}
    </>
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

  // Not sticky: in the comps the header scrolls away with the page and the
  // floating bottom nav is the only pinned chrome. The translucent background
  // and blur went with it — both only existed to keep a pinned bar readable
  // over scrolling content.
  return (
    <header className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-7 sm:py-6">
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

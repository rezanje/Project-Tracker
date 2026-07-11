import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Calendar,
  CheckSquare,
  ChevronDown,
  Home,
  Inbox,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Star,
} from 'lucide-react'
import { fetchNav, type NavBoard, type NavWorkspace } from '#/lib/nav'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import ThemeToggle from './ThemeToggle'

const COLLAPSE_KEY = 'sidebar-collapsed'

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

// Two-letter avatar initials from an email local part (e.g. reza.g → RG).
function initials(email: string): string {
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[.\-_+]/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return chars.toUpperCase() || '?'
}

const MAIN_NAV: Array<{
  label: string
  icon: typeof Home
  to: '/' | '/coming-soon'
  badge?: number
}> = [
  { label: 'Command Center', icon: Home, to: '/' },
  { label: 'Inbox', icon: Inbox, to: '/coming-soon', badge: 8 },
  { label: 'My Tasks', icon: CheckSquare, to: '/coming-soon', badge: 18 },
  { label: 'Calendar', icon: Calendar, to: '/coming-soon' },
  { label: 'Reports', icon: BarChart3, to: '/coming-soon' },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [favOpen, setFavOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    fetchNav().then((nav) => {
      setWorkspaces(nav.workspaces)
      setBoards(nav.boards)
    })
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1')

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

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  const activeWorkspaceId =
    pathname.match(/^\/workspace\/([^/]+)/)?.[1] ??
    boards.find((b) => b.id === pathname.match(/^\/board\/([^/]+)/)?.[1])?.workspaceId ??
    null
  const activeBoardId = pathname.match(/^\/board\/([^/]+)/)?.[1] ?? null

  return (
    <aside
      className={`sticky top-0 z-10 hidden h-dvh shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--line)] bg-[var(--card)] py-4 md:flex ${
        collapsed ? 'w-14 px-2' : 'w-60 px-3'
      }`}
    >
      <Link to="/" className="mb-2 flex items-center gap-2 px-2 no-underline">
        <img src="/logo192.png" alt="" width={28} height={28} className="rounded-[8px]" />
        {!collapsed && <span className="display-title text-lg font-bold text-[var(--ink)]">Rakit</span>}
      </Link>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={`mb-1 flex shrink-0 items-center rounded-lg py-1.5 text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink)] ${
          collapsed ? 'justify-center px-2' : 'justify-end px-2.5'
        }`}
      >
        {collapsed ? (
          <PanelLeftOpen size={16} aria-hidden="true" />
        ) : (
          <PanelLeftClose size={16} aria-hidden="true" />
        )}
      </button>
      <nav className="mb-2 flex flex-col gap-0.5">
        {MAIN_NAV.map(({ label, icon: Icon, to, badge }) => {
          const active = pathname === to
          return (
            <Link
              key={label}
              to={to}
              title={label}
              className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold no-underline ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${active ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--ink2)] hover:bg-[var(--col)]'}`}
            >
              <Icon size={16} className="shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{label}</span>}
              {!collapsed && badge != null && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      {!collapsed && workspaces.length > 0 && (
        <p className="mb-1 mt-1 px-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
          Workspaces
        </p>
      )}
      {workspaces.map((w) => {
        const wsBoards = boards.filter((b) => b.workspaceId === w.id)
        const isActiveWs = w.id === activeWorkspaceId
        return (
          <div key={w.id}>
            <Link
              to="/workspace/$workspaceId"
              params={{ workspaceId: w.id }}
              title={w.name}
              className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold no-underline ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${isActiveWs ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--ink2)] hover:bg-[var(--col)]'}`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold text-white"
                style={{ background: accentFor(w.id) }}
              >
                {w.name.slice(0, 1).toUpperCase()}
              </span>
              {!collapsed && <span className="truncate">{w.name}</span>}
            </Link>
            {!collapsed && isActiveWs && wsBoards.length > 0 && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2.5">
                {wsBoards.map((b) => (
                  <Link
                    key={b.id}
                    to="/board/$boardId"
                    params={{ boardId: b.id }}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold no-underline ${
                      b.id === activeBoardId
                        ? 'bg-[var(--col)] text-[var(--ink)]'
                        : 'text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink2)]'
                    }`}
                  >
                    <LayoutGrid size={13} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{b.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* add workspace */}
      <Link
        to="/coming-soon"
        title="Add workspace"
        className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-semibold text-[var(--ink3)] no-underline hover:bg-[var(--col)] hover:text-[var(--ink2)] ${
          collapsed ? 'justify-center px-0' : 'px-2.5'
        }`}
      >
        <Plus size={16} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">Add workspace</span>}
      </Link>

      {/* favorites */}
      <button
        type="button"
        onClick={() => setFavOpen((v) => !v)}
        title="Favorites"
        className={`mt-1 flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold text-[var(--ink2)] hover:bg-[var(--col)] ${
          collapsed ? 'justify-center px-0' : 'px-2.5'
        }`}
      >
        <Star size={16} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="flex-1 truncate text-left">Favorites</span>}
        {!collapsed && (
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${favOpen ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        )}
      </button>
      {!collapsed && favOpen && (
        <p className="px-2.5 py-1 text-[12px] text-[var(--ink3)]">No favorites yet</p>
      )}

      {/* settings */}
      <Link
        to="/coming-soon"
        title="Settings"
        className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold text-[var(--ink2)] no-underline hover:bg-[var(--col)] ${
          collapsed ? 'justify-center px-0' : 'px-2.5'
        }`}
      >
        <Settings size={16} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">Settings</span>}
      </Link>

      <div className="mt-auto flex flex-col gap-2">
        {!collapsed && (
          <div
            className="-mx-3 h-36 bg-cover bg-bottom"
            style={{ backgroundImage: "url('/meadow.png')" }}
            aria-hidden="true"
          />
        )}

        {email && (
          <div
            className={`flex shrink-0 flex-col gap-2 border-t border-[var(--line)] pt-3 ${
              collapsed ? 'items-center' : ''
            }`}
          >
            <div className="flex justify-center">
              <ThemeToggle compact={collapsed} />
            </div>
            <div
              className={`flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--col)] py-1 ${
                collapsed ? 'px-1' : 'pl-3 pr-1'
              }`}
              title={email}
            >
              {!collapsed && (
                <span className="max-w-[8.5rem] truncate text-[12px] font-semibold text-[var(--ink2)]">
                  {email}
                </span>
              )}
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white">
                {initials(email)}
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Log out"
              title="Log out"
              className={`btn btn-ghost ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <LogOut size={15} aria-hidden="true" />
              {!collapsed && <span>Log out</span>}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

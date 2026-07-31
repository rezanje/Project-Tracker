import { useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import {
  Calendar,
  CheckSquare,
  Home,
  PieChart,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  UserCheck,
} from 'lucide-react'
import { fetchNav, fetchNavDeduped, type NavBoard, type NavWorkspace } from '#/lib/nav'
import { workspaceLogoFor } from '#/lib/workspace-logos'
import { fetchInboxUnreadDeduped } from '#/lib/messages'
import { createWorkspaceFn } from '#/lib/actions'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { accentFor } from '#/lib/accent'
import ThemeToggle from './ThemeToggle'

export { accentFor } from '#/lib/accent'

const COLLAPSE_KEY = 'sidebar-collapsed'

// Two-letter avatar initials from an email local part (e.g. reza.g → RG).
function initials(email: string): string {
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[.\-_+]/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return chars.toUpperCase() || '?'
}

// Mirrors the mobile bar so desktop and phone agree on what the app's four
// places are. Everything else keeps its doorway elsewhere: Projects behind
// Home's "See all", Reports behind the KPI card, approvals behind the Command
// Center's Approval tile, Inbox behind the header bell.
const MAIN_NAV: Array<{
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  to: '/home' | '/' | '/my-tasks' | '/calendar'
  badge?: number
}> = [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Command center', icon: PieChart, to: '/' },
  { label: 'My tasks', icon: CheckSquare, to: '/my-tasks' },
  { label: 'Schedule', icon: Calendar, to: '/calendar' },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [inboxUnread, setInboxUnread] = useState(0)

  useEffect(() => {
    function loadNav() {
      fetchNavDeduped().then((nav) => {
        setWorkspaces(nav.workspaces)
        setBoards(nav.boards)
        setIsSuperAdmin(nav.isSuperAdmin)
        setPendingApprovals(nav.pendingApprovalsCount)
      })
      fetchInboxUnreadDeduped().then(setInboxUnread).catch(() => {})
    }
    loadNav()
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1')

    // Nav has no route loader of its own, so `router.invalidate()` calls
    // elsewhere (e.g. after resolving an approval, or reading the inbox)
    // wouldn't otherwise reach it — re-fetch both on every resolved
    // navigation/invalidation instead.
    const unsubNav = router.subscribe('onResolved', loadNav)

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
    return () => {
      unsubNav()
      sub.subscription.unsubscribe()
    }
  }, [router])

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    setEmail(null)
    navigate({ to: '/login' })
  }

  async function addWorkspace() {
    const name = window.prompt('Workspace name')
    if (!name?.trim()) return
    const ws = await createWorkspaceFn({ data: { name } })
    const nav = await fetchNav()
    setWorkspaces(nav.workspaces)
    setBoards(nav.boards)
    navigate({ to: '/workspace/$workspaceId', params: { workspaceId: ws.id } })
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
      className={`sticky top-0 z-10 hidden h-dvh shrink-0 flex-col gap-[3px] overflow-y-auto bg-[var(--bg)] py-6 md:flex ${
        collapsed ? 'w-16 px-3' : 'w-[248px] px-4'
      }`}
    >
      <Link to="/" className="mb-5 flex items-center gap-2.5 px-2.5 no-underline">
        <img src="/logo192.png" alt="" width={32} height={32} className="rounded-[14px]" />
        {!collapsed && (
          <span className="text-[19px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Rakit</span>
        )}
      </Link>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={`mb-1 flex shrink-0 items-center rounded-[14px] py-2 text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink)] ${
          collapsed ? 'justify-center px-2' : 'justify-end px-3'
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
          const count = label === 'Inbox' ? inboxUnread : badge
          return (
            <Link
              key={label}
              to={to}
              title={label}
              className={`flex items-center gap-[11px] rounded-[14px] py-[11px] text-[14px] no-underline ${
                collapsed ? 'justify-center px-0' : 'px-3'
              } ${
                active
                  ? 'bg-[var(--card)] font-semibold text-[var(--ink)] shadow-[var(--shadow-sm)]'
                  : 'font-medium text-[var(--ink2)] hover:bg-[var(--col)]'
              }`}
            >
              <Icon size={18} className="shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{label}</span>}
              {!collapsed && count != null && count > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-[var(--card)]">
                  {count}
                </span>
              )}
            </Link>
          )
        })}
        {isSuperAdmin && (
          <Link
            to="/admin/approvals"
            title="Approvals"
            className={`flex items-center gap-[11px] rounded-[14px] py-[11px] text-[14px] no-underline ${
              collapsed ? 'justify-center px-0' : 'px-3'
            } ${
              pathname === '/admin/approvals'
                ? 'bg-[var(--card)] font-semibold text-[var(--ink)] shadow-[var(--shadow-sm)]'
                : 'font-medium text-[var(--ink2)] hover:bg-[var(--col)]'
            }`}
          >
            <UserCheck size={18} className="shrink-0" aria-hidden="true" />
            {!collapsed && <span className="flex-1 truncate">Approvals</span>}
            {!collapsed && pendingApprovals > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-[var(--card)]">
                {pendingApprovals}
              </span>
            )}
          </Link>
        )}
      </nav>
      {!collapsed && workspaces.length > 0 && (
        <p className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
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
              className={`flex items-center gap-[11px] rounded-[14px] py-[9px] text-[14px] no-underline ${
                collapsed ? 'justify-center px-0' : 'px-3'
              } ${
                isActiveWs
                  ? 'bg-[var(--sunk)] font-semibold text-[var(--ink)]'
                  : 'font-medium text-[var(--ink2)] hover:bg-[var(--col)]'
              }`}
            >
              {workspaceLogoFor(w.name) ? (
                <img
                  src={workspaceLogoFor(w.name) as string}
                  alt=""
                  className="h-[22px] w-[22px] shrink-0 rounded-[7px] object-cover"
                />
              ) : (
                <span
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-[var(--card)]"
                  style={{ background: accentFor(w.id) }}
                >
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              {!collapsed && <span className="truncate">{w.name}</span>}
            </Link>
            {!collapsed && isActiveWs && wsBoards.length > 0 && (
              <div className="ml-[22px] mt-0.5 flex flex-col gap-px border-l border-[var(--line)] pl-3">
                {wsBoards.map((b) => (
                  <Link
                    key={b.id}
                    to="/board/$boardId"
                    params={{ boardId: b.id }}
                    className={`flex items-center gap-2 rounded-[14px] px-2.5 py-[7px] text-[13.5px] no-underline ${
                      b.id === activeBoardId
                        ? 'font-semibold text-[var(--ink)]'
                        : 'font-medium text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink2)]'
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
      <button
        type="button"
        onClick={addWorkspace}
        title="Add workspace"
        className={`flex items-center gap-[11px] rounded-[14px] py-[9px] text-[14px] font-medium text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink2)] ${
          collapsed ? 'justify-center px-0' : 'px-3'
        }`}
      >
        <Plus size={18} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">Add workspace</span>}
      </button>

      {/* Settings and Log out live in the header's profile menu, so the rail
          stays the four destinations plus workspaces. */}

      <div className="mt-auto flex flex-col gap-2">
        {email && (
          <div
            className={`flex shrink-0 flex-col gap-2.5 pt-5 ${collapsed ? 'items-center' : ''}`}
          >
            <div className="flex justify-center">
              <ThemeToggle compact={collapsed} />
            </div>
            <div
              className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-1'}`}
              title={email}
            >
              <span
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[var(--card)]"
                style={{ background: accentFor(email) }}
              >
                {initials(email)}
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink3)]">
                  {email}
                </span>
              )}
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

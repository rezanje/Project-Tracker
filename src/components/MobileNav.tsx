import { useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  CheckSquare,
  Home,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  UserCheck,
  X,
} from 'lucide-react'
import { BarChart3, Calendar } from '@/components/pixel-icons'
import { fetchNav, type NavBoard, type NavWorkspace } from '#/lib/nav'
import { fetchInboxUnreadFn } from '#/lib/messages'
import { createWorkspaceFn } from '#/lib/actions'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { accentFor } from './Sidebar'
import ThemeToggle from './ThemeToggle'

const BAR_NAV: Array<{
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  to: '/home' | '/' | '/my-tasks' | '/calendar'
}> = [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Center', icon: LayoutDashboard, to: '/' },
  { label: 'Tasks', icon: CheckSquare, to: '/my-tasks' },
  { label: 'Calendar', icon: Calendar, to: '/calendar' },
]

export default function MobileNav() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
  const [email, setEmail] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [inboxUnread, setInboxUnread] = useState(0)

  useEffect(() => {
    fetchNav().then((nav) => {
      setWorkspaces(nav.workspaces)
      setBoards(nav.boards)
      setIsSuperAdmin(nav.isSuperAdmin)
      setPendingApprovals(nav.pendingApprovalsCount)
    })
    fetchInboxUnreadFn().then(setInboxUnread).catch(() => {})
    const supabase = getBrowserSupabase()
    supabase.auth
      .getUser()
      .then((res: { data: { user: { email?: string | null } | null } }) =>
        setEmail(res.data.user?.email ?? null),
      )
  }, [])

  // Close the sheet whenever the route changes (e.g. after tapping a link inside it).
  useEffect(() => {
    setSheetOpen(false)
  }, [pathname])

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    setEmail(null)
    setSheetOpen(false)
    navigate({ to: '/login' })
  }

  async function addWorkspace() {
    const name = window.prompt('Workspace name')
    if (!name?.trim()) return
    const ws = await createWorkspaceFn({ data: { name } })
    const nav = await fetchNav()
    setWorkspaces(nav.workspaces)
    setBoards(nav.boards)
    setSheetOpen(false)
    navigate({ to: '/workspace/$workspaceId', params: { workspaceId: ws.id } })
  }

  const activeWorkspaceId =
    pathname.match(/^\/workspace\/([^/]+)/)?.[1] ??
    boards.find((b) => b.id === pathname.match(/^\/board\/([^/]+)/)?.[1])?.workspaceId ??
    null
  const activeBoardId = pathname.match(/^\/board\/([^/]+)/)?.[1] ?? null
  const morePages = ['/reports', '/inbox', '/admin/approvals']
  const moreActive = morePages.includes(pathname) || pathname.startsWith('/workspace/') || pathname.startsWith('/board/')

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t-2 border-[var(--ink)] bg-[var(--header-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Primary"
      >
        {BAR_NAV.map(({ label, icon: Icon, to }) => {
          const active = pathname === to
          return (
            <Link
              key={label}
              to={to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold no-underline ${
                active ? 'text-[var(--accent-ink)]' : 'text-[var(--ink3)]'
              }`}
            >
              <Icon size={20} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="More"
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${
            moreActive ? 'text-[var(--accent-ink)]' : 'text-[var(--ink3)]'
          }`}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          More
        </button>
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-y-auto rounded-t-2xl border-t-2 border-[var(--ink)] bg-[var(--card)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mb-2 flex items-center justify-between">
              <span className="display-title text-base font-bold text-[var(--ink)]">Menu</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close menu"
                className="rounded-full p-1.5 text-[var(--ink3)] hover:bg-[var(--col)]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <Link
              to="/reports"
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-bold text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <BarChart3 size={17} className="shrink-0" aria-hidden="true" />
              Reports
            </Link>
            <Link
              to="/inbox"
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-bold text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <Inbox size={17} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">Inbox</span>
              {inboxUnread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                  {inboxUnread}
                </span>
              )}
            </Link>
            {isSuperAdmin && (
              <Link
                to="/admin/approvals"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-bold text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
              >
                <UserCheck size={17} className="shrink-0" aria-hidden="true" />
                <span className="flex-1">Approvals</span>
                {pendingApprovals > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            )}

            {workspaces.length > 0 && (
              <p className="mb-1 mt-3 px-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
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
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-bold no-underline ${
                      isActiveWs ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--ink2)] hover:bg-[var(--col)]'
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold text-white"
                      style={{ background: accentFor(w.id) }}
                    >
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="truncate">{w.name}</span>
                  </Link>
                  {isActiveWs && wsBoards.length > 0 && (
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
            <button
              type="button"
              onClick={addWorkspace}
              className="mt-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-semibold text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink2)]"
            >
              <Plus size={17} className="shrink-0" aria-hidden="true" />
              Add workspace
            </button>

            <Link
              to="/coming-soon"
              className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-bold text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <Settings size={17} className="shrink-0" aria-hidden="true" />
              Settings
            </Link>

            {email && (
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ink2)]">{email}</span>
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
            )}
          </div>
        </div>
      )}
    </>
  )
}

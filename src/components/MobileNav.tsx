import { useEffect, useState, type ComponentType } from 'react'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Calendar,
  CheckSquare,
  Home,
  Inbox,
  PieChart,
  LayoutGrid,
  LogOut,
  Plus,
  Settings,
  UserCheck,
  X,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { fetchNav, fetchNavDeduped, type NavBoard, type NavWorkspace } from '#/lib/nav'
import { fetchInboxUnreadDeduped } from '#/lib/messages'
import { createWorkspaceFn } from '#/lib/actions'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { workspaceLogoFor } from '#/lib/workspace-logos'
import { accentFor } from './Sidebar'
import QuickProjectForm from './QuickProjectForm'
import QuickTaskForm from './QuickTaskForm'
import ThemeToggle from './ThemeToggle'

// The redesign's four destinations. Everything the old nav sheet reached
// (Reports, Inbox, Approvals, Settings) is intentionally not here — see the
// handoff notes; it stays routable, just not advertised.
const BAR_NAV: Array<{
  label: string
  icon: ComponentType<LucideProps>
  to: '/home' | '/' | '/my-tasks' | '/calendar'
}> = [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Command center', icon: PieChart, to: '/' },
  { label: 'My tasks', icon: CheckSquare, to: '/my-tasks' },
  { label: 'Schedule', icon: Calendar, to: '/calendar' },
]

export default function MobileNav() {
  const navigate = useNavigate()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [createTab, setCreateTab] = useState<'task' | 'project'>('task')
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
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
    const supabase = getBrowserSupabase()
    supabase.auth
      .getUser()
      .then((res: { data: { user: { email?: string | null } | null } }) =>
        setEmail(res.data.user?.email ?? null),
      )

    // See Sidebar.tsx: nav has no route loader, so re-fetch both on every
    // resolved navigation/invalidation to pick up count changes elsewhere.
    const unsubNav = router.subscribe('onResolved', loadNav)
    return () => unsubNav()
  }, [router])

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

  return (
    <>
      {/* Fade so content scrolls out from under the floating bar instead of
          being clipped by a hard edge. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[120px] bg-[linear-gradient(180deg,transparent_0%,var(--bg)_55%)] md:hidden"
        aria-hidden="true"
      />
      <nav
        className="fixed inset-x-5 bottom-[calc(env(safe-area-inset-bottom)+22px)] z-30 flex items-center gap-3 md:hidden"
        aria-label="Primary"
      >
        <div className="flex flex-1 items-center justify-around rounded-full bg-[var(--card)] px-2 py-[11px] shadow-[var(--shadow-float)] dark:bg-[var(--sunk)]">
          {BAR_NAV.map(({ label, icon: Icon, to }) => {
            const active = pathname === to
            return (
              <Link
                key={label}
                to={to}
                aria-label={label}
                title={label}
                className="flex flex-col items-center gap-[5px] px-3 py-0.5 no-underline transition active:scale-90"
              >
                <Icon
                  size={21}
                  strokeWidth={1.9}
                  className={active ? 'text-[var(--ink)]' : 'text-[var(--ink3)]'}
                  aria-hidden="true"
                />
                <span
                  className={`h-[5px] w-[5px] rounded-full ${active ? 'bg-[var(--accent)]' : 'bg-transparent'}`}
                  aria-hidden="true"
                />
              </Link>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Task baru"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(232,98,44,.42)] transition hover:-translate-y-0.5 active:scale-[.94]"
        >
          <Plus size={24} strokeWidth={2.2} aria-hidden="true" />
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
          <div className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col overflow-y-auto rounded-t-[28px] bg-[var(--card)] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-[var(--shadow)]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">New</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {/* Quick create — the FAB's primary job. */}
            <div className="mb-3 flex gap-1 rounded-full bg-[var(--col)] p-1">
              <button
                type="button"
                onClick={() => setCreateTab('task')}
                className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${
                  createTab === 'task'
                    ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--ink3)]'
                }`}
              >
                Task
              </button>
              <button
                type="button"
                onClick={() => setCreateTab('project')}
                className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${
                  createTab === 'project'
                    ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--ink3)]'
                }`}
              >
                Project
              </button>
            </div>
            {createTab === 'task' ? (
              <QuickTaskForm onDone={() => setSheetOpen(false)} />
            ) : (
              <QuickProjectForm onDone={() => setSheetOpen(false)} />
            )}

            <p className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Go to
            </p>
            <Link
              to="/reports"
              className="flex items-center gap-[11px] rounded-[14px] px-3 py-[11px] text-[14px] font-medium text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <BarChart3 size={18} className="shrink-0" aria-hidden="true" />
              Reports
            </Link>
            <Link
              to="/inbox"
              className="flex items-center gap-[11px] rounded-[14px] px-3 py-[11px] text-[14px] font-medium text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <Inbox size={18} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">Inbox</span>
              {inboxUnread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-[var(--card)]">
                  {inboxUnread}
                </span>
              )}
            </Link>
            {isSuperAdmin && (
              <Link
                to="/admin/approvals"
                className="flex items-center gap-[11px] rounded-[14px] px-3 py-[11px] text-[14px] font-medium text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
              >
                <UserCheck size={18} className="shrink-0" aria-hidden="true" />
                <span className="flex-1">Approvals</span>
                {pendingApprovals > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-[var(--card)]">
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            )}

            {workspaces.length > 0 && (
              <p className="mb-2 mt-4 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
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
                    className={`flex items-center gap-[11px] rounded-[14px] px-3 py-[9px] text-[14px] no-underline ${
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
                    <span className="truncate">{w.name}</span>
                  </Link>
                  {isActiveWs && wsBoards.length > 0 && (
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
            <button
              type="button"
              onClick={addWorkspace}
              className="mt-0.5 flex items-center gap-[11px] rounded-[14px] px-3 py-[9px] text-[14px] font-medium text-[var(--ink3)] hover:bg-[var(--col)] hover:text-[var(--ink2)]"
            >
              <Plus size={18} className="shrink-0" aria-hidden="true" />
              Add workspace
            </button>

            <Link
              to="/coming-soon"
              className="mt-3 flex items-center gap-[11px] rounded-[14px] px-3 py-[11px] text-[14px] font-medium text-[var(--ink2)] no-underline hover:bg-[var(--col)]"
            >
              <Settings size={18} className="shrink-0" aria-hidden="true" />
              Settings
            </Link>

            {email && (
              <div className="mt-4 flex items-center gap-2.5 border-t border-[var(--line)] pt-4">
                <span
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[var(--card)]"
                  style={{ background: accentFor(email) }}
                >
                  {email.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ink3)]">{email}</span>
                <ThemeToggle compact />
                <button
                  type="button"
                  onClick={logout}
                  aria-label="Log out"
                  title="Log out"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)]"
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

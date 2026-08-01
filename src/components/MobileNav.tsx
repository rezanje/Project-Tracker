import { useEffect, useState, type ComponentType } from 'react'
import { useRouterState, Link } from '@tanstack/react-router'
import { Calendar, CheckSquare, FolderKanban, Home, Plus, X } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import QuickNoteForm from './QuickNoteForm'
import QuickProjectForm from './QuickProjectForm'
import QuickReminderForm from './QuickReminderForm'
import QuickTaskForm from './QuickTaskForm'
import { Sheet } from './WorkspaceSwitcher'

// All four are one workspace's view of itself, and all four follow the pill.
// There is no Command Center tab: the account level is Home with the scope on
// "Semua workspace", so it is the same button one level up rather than a fifth
// destination. Reports, Inbox and Approvals keep doorways elsewhere (the KPI
// card, the header bell, the Approval tile).
const BAR_NAV: Array<{
  label: string
  icon: ComponentType<LucideProps>
  to: '/home' | '/projects' | '/my-tasks' | '/calendar'
  /** Extra paths that should light this tab's dot. */
  also?: string
}> = [
  { label: 'Home', icon: Home, to: '/home', also: '/workspace/' },
  { label: 'Project', icon: FolderKanban, to: '/projects', also: '/board/' },
  { label: 'Task', icon: CheckSquare, to: '/my-tasks' },
  { label: 'Schedule', icon: Calendar, to: '/calendar' },
]

export default function MobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [createTab, setCreateTab] = useState<'task' | 'project' | 'note' | 'reminder'>('task')

  // Close the sheet whenever the route changes (e.g. after a create navigates).
  useEffect(() => {
    setSheetOpen(false)
  }, [pathname])

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
          {BAR_NAV.map(({ label, icon: Icon, to, also }) => {
            const active = pathname === to || (also ? pathname.startsWith(also) : false)
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
        <div className="md:hidden">
          <Sheet onClose={() => setSheetOpen(false)} label="Task baru" className="max-h-[86dvh]">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="flex-1 text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">
                Task baru
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Tutup"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition active:scale-[.92]"
              >
                <X size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

            {/* Note and Reminder moved here (and to the header's "+ New") when
                Home lost its Quick actions grid. */}
            <div className="mb-4 flex gap-1.5 rounded-full bg-[var(--col)] p-1">
              {(['task', 'project', 'note', 'reminder'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCreateTab(tab)}
                  className={`flex-1 rounded-full py-2 text-[12px] font-semibold capitalize ${
                    createTab === tab
                      ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                      : 'text-[var(--ink3)]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {createTab === 'task' && <QuickTaskForm onDone={() => setSheetOpen(false)} />}
            {createTab === 'project' && <QuickProjectForm onDone={() => setSheetOpen(false)} />}
            {createTab === 'note' && <QuickNoteForm onDone={() => setSheetOpen(false)} />}
            {createTab === 'reminder' && <QuickReminderForm onDone={() => setSheetOpen(false)} />}
          </Sheet>
        </div>
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { Check } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { isDoneColumn, localDateStr } from '#/lib/home'
import { completeStandaloneTaskFn } from '#/lib/actions'
import { bucketize, type Task } from '#/lib/my-tasks'
import { inScope, useScope } from '#/lib/workspace-scope'
import { WorkspacePill, WorkspaceSwitcherSheet } from '#/components/WorkspaceSwitcher'
import { toast } from '#/components/Toast'

const fetchMyTasks = createServerFn({ method: 'GET' }).handler(async (): Promise<Task[]> => {
  const headers = new Headers()
  // requireUser redirects unauthenticated/unapproved users — keep it outside the
  // try so the redirect is not swallowed by the empty-list fallback.
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const [{ data: boards }, { data: standalone }] = await Promise.all([
      supabase
        .from('boards')
        .select('id,title,workspace_id,workspaces(name),columns(title,cards(id,title,due_date,assignee_id))')
        .neq('status', 'archived'),
      supabase
        .from('standalone_tasks')
        .select('id,title,due_date,workspace_id,workspaces(name),done')
        .eq('user_id', user.id),
    ])

    const tasks: Task[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      workspace_id: string | null
      workspaces: { name: string } | { name: string }[] | null
      columns?: Array<{
        title: string
        cards?: Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null }>
      }>
    }>) {
      const ws = Array.isArray(b.workspaces) ? b.workspaces[0] : b.workspaces
      const workspaceName = ws?.name ?? 'No workspace'
      for (const col of b.columns ?? []) {
        const colDone = isDoneColumn(col.title)
        for (const c of col.cards ?? []) {
          if (c.assignee_id !== user.id) continue
          tasks.push({
            id: c.id,
            title: c.title,
            boardId: b.id,
            boardTitle: b.title,
            colTitle: col.title,
            workspaceId: b.workspace_id,
            workspaceName,
            due: c.due_date,
            done: colDone,
          })
        }
      }
    }
    for (const s of (standalone ?? []) as Array<{
      id: string
      title: string
      due_date: string | null
      workspace_id: string | null
      workspaces: { name: string } | { name: string }[] | null
      done: boolean
    }>) {
      const ws = Array.isArray(s.workspaces) ? s.workspaces[0] : s.workspaces
      tasks.push({
        id: s.id,
        title: s.title,
        boardId: null,
        boardTitle: 'Personal',
        colTitle: '',
        // Pre-0034 rows carry no workspace; they still group under 'Personal'.
        workspaceId: s.workspace_id,
        workspaceName: ws?.name ?? 'Personal',
        due: s.due_date,
        done: s.done,
      })
    }
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return tasks
  } catch {
    return []
  }
})

export const Route = createFileRoute('/my-tasks')({
  loader: async () => await fetchMyTasks(),
  component: MyTasks,
})

function fmtDue(due: string | null): string {
  if (!due) return ''
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** 54px conic ring with the percentage on a disc inside it. */
function ProgressRing({ pct }: { pct: number }) {
  return (
    <span
      className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--sunk) 0)` }}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--card)] text-[12.5px] font-bold text-[var(--ink)]">
        {pct}%
      </span>
    </span>
  )
}

/** One task row. The checkbox completes standalone tasks in place; board tasks
 *  live in a column, so their row opens the board instead. */
function TaskRow({
  task,
  overdue,
  showWorkspace,
  onToggle,
  onOpen,
}: {
  task: Task
  overdue: boolean
  showWorkspace: boolean
  onToggle: (() => void) | null
  onOpen: () => void
}) {
  const project = [showWorkspace ? task.workspaceName : null, task.boardTitle].filter(Boolean).join(' · ')
  return (
    <div className="card card-hover flex items-start gap-3.5 px-4 py-3.5">
      <button
        type="button"
        onClick={onToggle ?? onOpen}
        aria-label={task.done ? 'Buka lagi' : 'Tandai selesai'}
        aria-pressed={task.done}
        className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition ${
          task.done
            ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
            : 'text-transparent shadow-[inset_0_0_0_1.8px_var(--sunk)]'
        }`}
      >
        <Check size={13} strokeWidth={3.2} aria-hidden="true" />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={`block truncate text-[14.5px] font-semibold ${
            task.done ? 'text-[var(--ink)] line-through opacity-45' : 'text-[var(--ink)]'
          }`}
        >
          {task.title}
        </span>
        <span className="mt-[7px] flex flex-wrap items-center gap-2.5">
          {task.colTitle && <span className="chip text-[11.5px]">{task.colTitle}</span>}
          <span className="text-[12px] font-medium text-[var(--ink3)]">{project}</span>
          {task.due && (
            <span
              className={`whitespace-nowrap text-[12px] tabular-nums ${
                overdue ? 'font-bold text-[var(--accent-ink)]' : 'font-medium text-[var(--ink3)]'
              }`}
            >
              {fmtDue(task.due)}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

function MyTasks() {
  const initialTasks = Route.useLoaderData() as Task[]
  const [tasks, setTasks] = useState(initialTasks)
  const [wsOpen, setWsOpen] = useState(false)
  // Ids of standalone tasks whose completion is in flight (optimistically
  // removed below, server write not yet confirmed). If an unrelated action
  // (e.g. QuickTaskForm's router.invalidate() on standalone-task create)
  // triggers a loader re-run while a completion is pending, the loader can
  // still return that task — its done=true write hasn't landed server-side
  // yet — so the resync below must keep filtering it out, or the row would
  // reappear until the write finally settles. Mirrors the pendingDelete
  // handling in board.$boardId.tsx.
  const pendingCompleteRef = useRef<Set<string>>(new Set())
  // Re-sync from the loader whenever it re-runs (e.g. after QuickTaskForm's
  // router.invalidate() on standalone-task create). Only fires when
  // initialTasks itself changes, so the optimistic removal in
  // completeStandalone below (which doesn't invalidate the router) is
  // unaffected.
  useEffect(() => {
    setTasks(
      initialTasks.map((t) => (pendingCompleteRef.current.has(t.id) ? { ...t, done: true } : t)),
    )
  }, [initialTasks])
  const navigate = useNavigate()
  const scope = useScope()
  const [filter, setFilter] = useState<'all' | 'today' | 'done'>('all')
  const today = localDateStr()

  const scoped = tasks.filter((t) => inScope(scope, t.workspaceId))
  const openTasks = scoped.filter((t) => !t.done)
  const doneTasks = scoped.filter((t) => t.done)
  const todayTasks = openTasks.filter((t) => t.due === today)
  const shown = filter === 'done' ? doneTasks : filter === 'today' ? todayTasks : openTasks
  // Grouped by due bucket in "Semua"; the narrower filters are already one
  // bucket each, so they render flat.
  const groups = filter === 'all' ? bucketize(shown) : [{ key: filter, label: '', tint: '', tasks: shown }]
  const pct = scoped.length ? Math.round((doneTasks.length / scoped.length) * 100) : 0

  function openTask(task: Task) {
    if (task.boardId) navigate({ to: '/board/$boardId', params: { boardId: task.boardId } })
  }

  /** Ticking a personal task marks it done in place — it moves to the Selesai
   *  filter rather than vanishing. Only completion is wired: the server
   *  function has no un-complete counterpart yet. */
  async function completeStandalone(task: Task) {
    if (task.done) {
      toast('Belum bisa dibuka lagi dari sini')
      return
    }
    pendingCompleteRef.current.add(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: true } : t)))
    toast('Task selesai')
    try {
      await completeStandaloneTaskFn({ data: { id: task.id } })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: false } : t)))
      toast('Gagal — coba lagi')
    } finally {
      pendingCompleteRef.current.delete(task.id)
    }
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2">
              <WorkspacePill onOpen={() => setWsOpen(true)} />
            </div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">My tasks</h1>
            <p className="mt-0.5 text-[13.5px] text-[var(--ink2)]">
              {doneTasks.length} selesai · {openTasks.length} tersisa
            </p>
          </div>
          <ProgressRing pct={pct} />
        </div>

        <div className="gt-scroll flex gap-2 overflow-x-auto pb-1">
          {([
            ['all', 'Semua', openTasks.length],
            ['today', 'Hari ini', todayTasks.length],
            ['done', 'Selesai', doneTasks.length],
          ] as const).map(([value, label, n]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-semibold transition ${
                filter === value
                  ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                  : 'bg-[var(--col)] text-[var(--ink2)] hover:bg-[var(--sunk)]'
              }`}
            >
              {label} <span className="opacity-55">{n}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 && (
          <div className="rounded-[20px] bg-[var(--col)] px-[18px] py-8 text-center">
            <p className="text-[14.5px] font-bold text-[var(--ink)]">Kosong di sini</p>
            <p className="mt-[5px] text-[13px] text-[var(--ink3)]">Ganti filter atau bikin task baru.</p>
          </div>
        )}

        {groups.map((b) => (
          <section key={b.key}>
            {b.label && b.tasks.length > 0 && (
              <p
                className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: b.key === 'overdue' ? 'var(--accent-ink)' : 'var(--ink3)' }}
              >
                {b.label} · {b.tasks.length}
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              {b.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  overdue={!t.done && !!t.due && t.due < today}
                  showWorkspace={scope === 'all'}
                  onToggle={t.boardId ? null : () => completeStandalone(t)}
                  onOpen={() => openTask(t)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <WorkspaceSwitcherSheet open={wsOpen} onClose={() => setWsOpen(false)} />
    </main>
  )
}

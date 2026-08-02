import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { Check } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { dueHour, isDoneColumn, localDateStr } from '#/lib/home'
import {
  completeCardFn,
  completeStandaloneTaskFn,
  setCardColumnFn,
  updateStandaloneTaskFn,
  deleteStandaloneTaskFn,
} from '#/lib/actions'
import { fetchBoardAssigneesFn, type BoardColumn } from '#/lib/nav'
import Popover from '#/components/Popover'
import { bucketize, type Task } from '#/lib/my-tasks'
import { inScope, useScope } from '#/lib/workspace-scope'
import { toast } from '#/components/Toast'
import StandaloneTaskSheet from '#/components/StandaloneTaskSheet'

const fetchMyTasks = createServerFn({ method: 'GET' }).handler(async (): Promise<Task[]> => {
  const headers = new Headers()
  // requireUser redirects unauthenticated/unapproved users — keep it outside the
  // try so the redirect is not swallowed by the empty-list fallback.
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const [{ data: boards }, { data: standalone }] = await Promise.all([
      supabase
        .from('boards')
        .select('id,title,workspace_id,workspaces(name),columns(title,cards(id,title,due_date,due_time,assignee_id))')
        .neq('status', 'archived'),
      supabase
        .from('standalone_tasks')
        .select('id,title,due_date,due_time,reminder_offsets,workspace_id,workspaces(name),done')
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
        cards?: Array<{
          id: string
          title: string
          due_date: string | null
          due_time: string | null
          assignee_id: string | null
        }>
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
            dueTime: c.due_time,
            // Only the card sheet edits a board card's reminders, and it reads
            // them from the board loader — this list never needs them.
            offsets: null,
            done: colDone,
          })
        }
      }
    }
    for (const s of (standalone ?? []) as Array<{
      id: string
      title: string
      due_date: string | null
      due_time: string | null
      reminder_offsets: number[] | null
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
        dueTime: s.due_time,
        offsets: s.reminder_offsets,
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

function fmtDue(due: string | null, dueTime?: string | null): string {
  if (!due) return ''
  const day = new Date(due + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const hour = dueHour(dueTime)
  return hour ? `${day} ${hour}` : day
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

/** The lane chip. For a board task it opens a picker so the status can be
 *  changed from here — the lanes are fetched on first open, since a row only
 *  knows the lane it is currently in. */
function StatusChip({ task, onPick }: { task: Task; onPick: (columnId: string, title: string) => void }) {
  const [lanes, setLanes] = useState<BoardColumn[] | null>(null)

  if (!task.boardId) return <span className="chip text-[11.5px]">{task.colTitle}</span>

  return (
    <Popover
      align="left"
      panelClassName="w-48 max-w-[calc(100vw-2.5rem)] p-1.5"
      renderTrigger={(open, toggle) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!open && !lanes) {
              fetchBoardAssigneesFn({ data: { boardId: task.boardId! } })
                .then((r) => setLanes(r.columns))
                .catch(() => setLanes([]))
            }
            toggle()
          }}
          className="chip text-[11.5px] transition hover:bg-[var(--sunk)]"
        >
          {task.colTitle}
        </button>
      )}
      renderPanel={(close) => (
        <>
          {lanes === null && <p className="px-2.5 py-2 text-[12px] text-[var(--ink3)]">Memuat…</p>}
          {lanes?.length === 0 && (
            <p className="px-2.5 py-2 text-[12px] text-[var(--ink3)]">Ga ada kolom.</p>
          )}
          {lanes?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                close()
                if (c.title !== task.colTitle) onPick(c.id, c.title)
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] font-semibold hover:bg-[var(--col)] ${
                c.title === task.colTitle ? 'text-[var(--ink)]' : 'text-[var(--ink2)]'
              }`}
            >
              {c.title}
              {c.title === task.colTitle && <Check size={13} strokeWidth={3} aria-hidden="true" />}
            </button>
          ))}
        </>
      )}
    />
  )
}

/** One task row. The checkbox completes the task in place — a personal task
 *  flips its done flag, a board task moves to its board's Done lane. */
function TaskRow({
  task,
  overdue,
  showWorkspace,
  onToggle,
  onOpen,
  onSetColumn,
}: {
  task: Task
  overdue: boolean
  showWorkspace: boolean
  onToggle: (() => void) | null
  onOpen: () => void
  onSetColumn: (columnId: string, title: string) => void
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
      {/* The title is the button; the meta row sits outside it so the status
          chip can be its own control rather than a button inside a button. */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className={`block w-full truncate text-left text-[14.5px] font-semibold ${
            task.done ? 'text-[var(--ink)] line-through opacity-45' : 'text-[var(--ink)]'
          }`}
        >
          {task.title}
        </button>
        <div className="mt-[7px] flex flex-wrap items-center gap-2.5">
          {task.colTitle && <StatusChip task={task} onPick={onSetColumn} />}
          <span className="text-[12px] font-medium text-[var(--ink3)]">{project}</span>
          {task.due && (
            <span
              className={`whitespace-nowrap text-[12px] tabular-nums ${
                overdue ? 'font-bold text-[var(--accent-ink)]' : 'font-medium text-[var(--ink3)]'
              }`}
            >
              {fmtDue(task.due, task.dueTime)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function MyTasks() {
  const initialTasks = Route.useLoaderData() as Task[]
  const [tasks, setTasks] = useState(initialTasks)
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
  const router = useRouter()
  const scope = useScope()
  const [filter, setFilter] = useState<'all' | 'today' | 'done'>('all')
  const [sheetTask, setSheetTask] = useState<Task | null>(null)
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
    else setSheetTask(task)
  }

  /** Ticking a task marks it done in place — it moves to the Selesai filter
   *  rather than vanishing. Only completion is wired for personal tasks: the
   *  server function has no un-complete counterpart yet. */
  async function complete(task: Task) {
    if (task.done) {
      toast(task.boardId ? 'Pindahin lewat status buat buka lagi' : 'Belum bisa dibuka lagi dari sini')
      return
    }
    pendingCompleteRef.current.add(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: true } : t)))
    toast('Task selesai ✓')
    try {
      if (task.boardId) await completeCardFn({ data: { cardId: task.id } })
      else await completeStandaloneTaskFn({ data: { id: task.id } })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: false } : t)))
      toast('Gagal — coba lagi')
    } finally {
      pendingCompleteRef.current.delete(task.id)
    }
  }

  /** Status chip → move the card to another lane without leaving the list. */
  async function setColumn(task: Task, columnId: string, title: string) {
    const before = { colTitle: task.colTitle, done: task.done }
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, colTitle: title, done: isDoneColumn(title) } : t)),
    )
    toast(`Dipindah ke ${title}`)
    try {
      await setCardColumnFn({ data: { cardId: task.id, columnId } })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...before } : t)))
      toast('Gagal — coba lagi')
    }
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
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
                  onToggle={() => complete(t)}
                  onOpen={() => openTask(t)}
                  onSetColumn={(columnId, title) => setColumn(t, columnId, title)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {sheetTask && (
        <StandaloneTaskSheet
          task={sheetTask}
          onClose={() => setSheetTask(null)}
          onSaved={() => router.invalidate()}
          onUpdate={(id, fields) => updateStandaloneTaskFn({ data: { id, fields } })}
          onDelete={async (id) => {
            setSheetTask(null)
            setTasks((prev) => prev.filter((t) => t.id !== id))
            toast('Task dihapus')
            try {
              await deleteStandaloneTaskFn({ data: { id } })
            } catch {
              router.invalidate()
              toast('Gagal hapus — coba lagi')
            }
          }}
        />
      )}
    </main>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { CheckSquare, ChevronRight } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { isDoneColumn, localDateStr } from '#/lib/home'
import { completeStandaloneTaskFn } from '#/lib/actions'
import { bucketize, groupBy, byProject, byWorkspace, type Task } from '#/lib/my-tasks'

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
        .select('id,title,due_date,workspace_id,workspaces(name)')
        .eq('user_id', user.id)
        .eq('done', false),
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
        if (isDoneColumn(col.title)) continue
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

/** Shared row content for both the board-task (Link) and standalone-task
 * (button) variants below — only the outer element, its props, the subtitle
 * text, and the trailing chevron differ between them. */
function TaskRowContent({ task, overdue, showChevron }: { task: Task; overdue: boolean; showChevron: boolean }) {
  return (
    <>
      <span
        className="h-[22px] w-[22px] shrink-0 rounded-[12px] border-[1.8px] border-[var(--line-strong)]"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{task.title}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-[var(--ink3)]">
          {task.boardId ? `${task.workspaceName} · ${task.boardTitle} · ${task.colTitle}`
            : task.workspaceId ? `${task.workspaceName} · ${task.boardTitle}`
            : task.boardTitle}
        </p>
      </div>
      {task.due && (
        <span
          className={`shrink-0 whitespace-nowrap text-[12.5px] tabular-nums ${
            overdue ? 'font-bold text-[var(--danger)]' : 'font-semibold text-[var(--ink2)]'
          }`}
        >
          {fmtDue(task.due)}
        </span>
      )}
      {showChevron && <ChevronRight size={16} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />}
    </>
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
    setTasks(initialTasks.filter((t) => !pendingCompleteRef.current.has(t.id)))
  }, [initialTasks])
  const [mode, setMode] = useState<'due' | 'project' | 'workspace'>('due')
  const groups =
    mode === 'project' ? groupBy(tasks, byProject)
    : mode === 'workspace' ? groupBy(tasks, byWorkspace)
    : bucketize(tasks)
  // Overdue is a property of the task, not of the group it landed in: in
  // project/workspace mode there is no 'overdue' group, but an overdue date
  // must still render red.
  const today = localDateStr()

  async function completeStandalone(task: Task) {
    pendingCompleteRef.current.add(task.id)
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await completeStandaloneTaskFn({ data: { id: task.id } })
    } catch {
      setTasks((prev) => [...prev, task])
    } finally {
      pendingCompleteRef.current.delete(task.id)
    }
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <CheckSquare size={22} className="text-[var(--ink3)]" aria-hidden="true" />
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">My Tasks</h1>
            <p className="text-[13.5px] text-[var(--ink3)]">
              {tasks.length} open · {tasks.filter((t) => !!t.due && t.due < today).length} overdue
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['due', 'Due date'],
            ['project', 'Project'],
            ['workspace', 'Workspace'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-full px-4 py-2.5 text-[13px] font-semibold transition ${
                mode === value
                  ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                  : 'bg-[var(--col)] text-[var(--ink2)] hover:bg-[var(--sunk)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="panel p-12 text-center">
            <p className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">All clear 🎉</p>
            <p className="mt-2 text-[14px] text-[var(--ink3)]">No open tasks across your boards.</p>
          </div>
        )}

        {groups.map((b) => (
          <section key={b.key}>
            <p
              className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: b.key === 'overdue' ? 'var(--danger)' : 'var(--ink3)' }}
            >
              {b.label} · {b.tasks.length}
            </p>
            <div className="flex flex-col gap-2.5">
              {b.tasks.map((t) =>
                t.boardId ? (
                  <Link
                    key={t.id}
                    to="/board/$boardId"
                    params={{ boardId: t.boardId }}
                    className="card card-hover flex items-center gap-3.5 px-4 py-[15px] no-underline"
                  >
                    <TaskRowContent task={t} overdue={!!t.due && t.due < today} showChevron />
                  </Link>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => completeStandalone(t)}
                    className="card card-hover flex w-full items-center gap-3.5 px-4 py-[15px] text-left"
                  >
                    <TaskRowContent task={t} overdue={!!t.due && t.due < today} showChevron={false} />
                  </button>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

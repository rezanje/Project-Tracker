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
        .select('id,title,due_date')
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
    for (const s of (standalone ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
      tasks.push({
        id: s.id,
        title: s.title,
        boardId: null,
        boardTitle: 'Personal',
        colTitle: '',
        workspaceId: null,
        workspaceName: 'Personal',
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
      <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold text-[var(--ink)]">{task.title}</p>
        <p className="truncate text-[11px] text-[var(--ink3)]">
          {task.boardId ? `${task.workspaceName} · ${task.boardTitle} · ${task.colTitle}` : task.boardTitle}
        </p>
      </div>
      {task.due && (
        <span
          className="shrink-0 text-[11px] font-bold tabular-nums"
          style={{ color: overdue ? 'var(--danger)' : 'var(--ink2)' }}
        >
          {fmtDue(task.due)}
        </span>
      )}
      {showChevron && <ChevronRight size={15} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />}
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
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-center gap-2">
          <CheckSquare size={22} className="text-[var(--accent)]" aria-hidden="true" />
          <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">My Tasks</h1>
          <span className="chip ml-1">{tasks.length} open</span>
        </div>

        <div className="flex w-fit gap-0 overflow-hidden rounded-full border border-[var(--line)]">
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
              className={`px-3.5 py-1.5 text-[12px] font-bold ${
                mode === value
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink2)] hover:bg-[var(--col)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="card p-10 text-center text-[var(--ink2)]">
            <p className="display-title text-lg font-bold">All clear 🎉</p>
            <p className="mt-1 text-sm text-[var(--ink3)]">No open tasks across your boards.</p>
          </div>
        )}

        {groups.map((b) => (
          <section key={b.key} className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.tint }} />
              <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">{b.label}</h2>
              <span className="text-[12px] font-bold text-[var(--ink3)]">{b.tasks.length}</span>
            </div>
            <div className="flex flex-col">
              {b.tasks.map((t) =>
                t.boardId ? (
                  <Link
                    key={t.id}
                    to="/board/$boardId"
                    params={{ boardId: t.boardId }}
                    className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 no-underline last:border-0 hover:bg-[var(--col)]"
                  >
                    <TaskRowContent task={t} overdue={!!t.due && t.due < today} showChevron />
                  </Link>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => completeStandalone(t)}
                    className="flex w-full items-center gap-3 border-b border-[var(--line)] py-2.5 text-left last:border-0 hover:bg-[var(--col)]"
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

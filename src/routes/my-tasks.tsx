import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { CheckSquare, ChevronRight } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { isDoneColumn, localDateStr } from '#/lib/home'

type Task = {
  id: string
  title: string
  boardId: string
  boardTitle: string
  colTitle: string
  due: string | null
}

const fetchMyTasks = createServerFn({ method: 'GET' }).handler(async (): Promise<Task[]> => {
  const headers = new Headers()
  // requireUser redirects unauthenticated/unapproved users — keep it outside the
  // try so the redirect is not swallowed by the empty-list fallback.
  const { user, supabase } = await requireUser(getRequest(), headers)
  try {
    const { data: boards } = await supabase
      .from('boards')
      .select('id,title,columns(title,cards(id,title,due_date,assignee_id))')
      .neq('status', 'archived')

    const tasks: Task[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      columns?: Array<{
        title: string
        cards?: Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null }>
      }>
    }>) {
      for (const col of b.columns ?? []) {
        if (isDoneColumn(col.title)) continue
        for (const c of col.cards ?? []) {
          if (c.assignee_id !== user.id) continue
          tasks.push({ id: c.id, title: c.title, boardId: b.id, boardTitle: b.title, colTitle: col.title, due: c.due_date })
        }
      }
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

type Bucket = { key: string; label: string; tint: string; tasks: Task[] }

function bucketize(tasks: Task[]): Bucket[] {
  const today = localDateStr()
  const in7 = localDateStr(new Date(Date.now() + 7 * 86_400_000))
  const buckets: Bucket[] = [
    { key: 'overdue', label: 'Overdue', tint: 'var(--danger)', tasks: [] },
    { key: 'today', label: 'Today', tint: '#d97706', tasks: [] },
    { key: 'week', label: 'This week', tint: '#2563eb', tasks: [] },
    { key: 'later', label: 'Later', tint: 'var(--ink3)', tasks: [] },
    { key: 'none', label: 'No due date', tint: 'var(--ink3)', tasks: [] },
  ]
  const by = Object.fromEntries(buckets.map((b) => [b.key, b])) as Record<string, Bucket>
  for (const t of tasks) {
    if (!t.due) by.none.tasks.push(t)
    else if (t.due < today) by.overdue.tasks.push(t)
    else if (t.due === today) by.today.tasks.push(t)
    else if (t.due <= in7) by.week.tasks.push(t)
    else by.later.tasks.push(t)
  }
  for (const b of buckets) b.tasks.sort((a, z) => (a.due ?? '') < (z.due ?? '') ? -1 : 1)
  return buckets.filter((b) => b.tasks.length > 0)
}

function fmtDue(due: string | null): string {
  if (!due) return ''
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function MyTasks() {
  const tasks = Route.useLoaderData() as Task[]
  const buckets = bucketize(tasks)

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-center gap-2">
          <CheckSquare size={22} className="text-[var(--accent)]" aria-hidden="true" />
          <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">My Tasks</h1>
          <span className="chip ml-1">{tasks.length} open</span>
        </div>

        {tasks.length === 0 && (
          <div className="card p-10 text-center text-[var(--ink2)]">
            <p className="display-title text-lg font-bold">All clear 🎉</p>
            <p className="mt-1 text-sm text-[var(--ink3)]">No open tasks across your boards.</p>
          </div>
        )}

        {buckets.map((b) => (
          <section key={b.key} className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.tint }} />
              <h2 className="text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">{b.label}</h2>
              <span className="text-[12px] font-bold text-[var(--ink3)]">{b.tasks.length}</span>
            </div>
            <div className="flex flex-col">
              {b.tasks.map((t) => (
                <Link
                  key={t.id}
                  to="/board/$boardId"
                  params={{ boardId: t.boardId }}
                  className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 no-underline last:border-0 hover:bg-[var(--col)]"
                >
                  <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-[var(--ink)]">{t.title}</p>
                    <p className="truncate text-[11px] text-[var(--ink3)]">
                      {t.boardTitle} · {t.colTitle}
                    </p>
                  </div>
                  {t.due && (
                    <span
                      className="shrink-0 text-[11px] font-bold tabular-nums"
                      style={{ color: b.key === 'overdue' ? 'var(--danger)' : 'var(--ink2)' }}
                    >
                      {fmtDue(t.due)}
                    </span>
                  )}
                  <ChevronRight size={15} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

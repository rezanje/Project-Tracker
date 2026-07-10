import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { ArrowUpRight } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { createWorkspace } from '#/lib/workspaces'
import { isDoneColumn } from '#/lib/home'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

type WsCard = { id: string; name: string; projects: number; progress: number }
type AggTask = { id: string; title: string; due: string | null; boardId: string; boardTitle: string }

const fetchWorkspaces = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const [{ data: me }, { data: workspaces }, { data: boards }, { data: notes }, { data: anns }] =
    await Promise.all([
      supabase.from('profiles').select('name, is_super_admin').eq('id', user.id).single(),
      supabase.from('workspaces').select('id,name').order('created_at'),
      supabase.from('boards').select('id,title,priority,workspace_id,columns(title,cards(id,title,due_date))'),
      supabase.from('notes').select('id,body,created_at').order('created_at', { ascending: false }).limit(8),
      supabase
        .from('announcements')
        .select('id,body,created_at,profiles:author_id(name)')
        .order('created_at', { ascending: false })
        .limit(6),
    ])

  const isSuperAdmin = me?.is_super_admin === true
  const pendingCount = isSuperAdmin
    ? ((await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count ?? 0)
    : 0

  const today = new Date().toISOString().slice(0, 10)
  const stats = new Map<string, { total: number; done: number; projects: number }>()
  let total = 0
  let done = 0
  const todayTasks: AggTask[] = []
  const overdue: AggTask[] = []
  const urgent: Array<{ id: string; title: string }> = []

  for (const b of (boards ?? []) as Array<{
    id: string
    title: string
    priority: string | null
    workspace_id: string | null
    columns?: unknown[]
  }>) {
    const ws = b.workspace_id
    const s = ws ? stats.get(ws) ?? { total: 0, done: 0, projects: 0 } : null
    if (s) s.projects++
    if (b.priority === 'urgent') urgent.push({ id: b.id, title: b.title })
    for (const col of (b.columns ?? []) as Array<{ title: string; cards?: unknown[] }>) {
      const isDone = isDoneColumn(col.title)
      for (const c of (col.cards ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
        total++
        if (isDone) done++
        if (s) {
          s.total++
          if (isDone) s.done++
        }
        const t: AggTask = { id: c.id, title: c.title, due: c.due_date ?? null, boardId: b.id, boardTitle: b.title }
        if (!isDone && c.due_date) {
          if (c.due_date < today) overdue.push(t)
          else if (c.due_date === today) todayTasks.push(t)
        }
      }
    }
    if (ws && s) stats.set(ws, s)
  }

  const list: WsCard[] = (workspaces ?? []).map((w) => {
    const s = stats.get(w.id) ?? { total: 0, done: 0, projects: 0 }
    return {
      id: w.id,
      name: w.name,
      projects: s.projects,
      progress: s.total ? Math.round((s.done / s.total) * 100) : 0,
    }
  })

  flush(headers)
  return {
    name: me?.name ?? null,
    isSuperAdmin,
    pendingCount,
    workspaces: list,
    agg: { total, done, active: total - done, progress: total ? Math.round((done / total) * 100) : 0 },
    todayTasks: todayTasks.slice(0, 6),
    overdue: overdue.sort((a, b) => (a.due! < b.due! ? -1 : 1)).slice(0, 6),
    urgent,
    notes: (notes ?? []).map((n) => ({ id: n.id as string, body: n.body as string })),
    announcements: (anns ?? []).map((a) => {
      const raw = (a as { profiles: unknown }).profiles
      const p = (Array.isArray(raw) ? raw[0] : raw) as { name: string | null } | null
      return { id: a.id as string, body: a.body as string, author: p?.name ?? null }
    }),
  }
})

const newWorkspace = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const name = (d as { name?: unknown })?.name
    if (typeof name !== 'string' || !name.trim()) throw new Error('name required')
    return { name: name.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const ws = await createWorkspace(supabase, user.id, data.name)
    flush(headers)
    return ws
  })

export const Route = createFileRoute('/')({
  component: Workspaces,
  loader: async () => await fetchWorkspaces(),
})

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="card flex items-center justify-between p-5">
      <div>
        <div className="display-title text-3xl font-extrabold tabular-nums text-[var(--ink)]" suppressHydrationWarning>
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="mt-1 text-[13px] font-semibold text-[var(--ink3)]" suppressHydrationWarning>
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>
    </div>
  )
}

function fmtDue(due: string | null): string {
  if (!due) return '—'
  return new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Workspaces() {
  const router = useRouter()
  const { name, workspaces, agg, todayTasks, overdue, notes, announcements, urgent, isSuperAdmin, pendingCount } =
    Route.useLoaderData()
  const [creating, setCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!wsName.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const ws = await newWorkspace({ data: { name: wsName } })
      setWsName('')
      setCreating(false)
      router.navigate({ to: '/workspace/$workspaceId', params: { workspaceId: ws.id } })
    } catch {
      setErr('Could not create workspace. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="meadow-bg" aria-hidden="true" />
      <main className="page-wrap relative z-[1] pb-32 pt-9 gt-fade">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p
              suppressHydrationWarning
              className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--ink3)]"
            >
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
            <h1 className="display-title mt-1 text-4xl font-extrabold leading-none text-[var(--ink)]">
              Hi, {name ?? 'there'}
            </h1>
            <p className="mt-3 text-[15px] text-[var(--ink2)]">
              Your workspaces — pick an office to dive in.
            </p>
          </div>
          {isSuperAdmin && (
            <Link to="/admin/approvals" className="btn btn-ghost px-4 py-3 text-sm no-underline">
              Approvals{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="btn btn-primary px-5 py-3 text-sm"
          >
            <span className="text-[17px] leading-none">+</span>
            New workspace
          </button>
        </div>

        {creating && (
          <form onSubmit={onCreate} className="card mb-8 flex flex-wrap gap-3 p-4">
            <input
              ref={inputRef}
              placeholder="Workspace name (e.g. Gentanala)…"
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              className="field min-w-[220px] flex-1"
            />
            <button type="submit" disabled={busy} className="btn btn-primary btn-square">
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="btn btn-ghost btn-square"
            >
              Cancel
            </button>
            {err && <p className="w-full text-[13px] font-semibold text-[var(--danger)]">{err}</p>}
          </form>
        )}

        {workspaces.length > 0 && (
          <>
            {urgent.length > 0 && (
              <div className="mb-4 rounded-[var(--radius)] p-4" style={{ background: 'var(--danger)' }}>
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-white/80">
                  Urgent projects · {urgent.length}
                </div>
                <div className="flex flex-wrap gap-2">
                  {urgent.map((u) => (
                    <a
                      key={u.id}
                      href={`/board/${u.id}`}
                      style={{ color: '#fff' }}
                      className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold no-underline hover:bg-white/25"
                    >
                      {u.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4 grid gap-4 lg:grid-cols-[280px_1fr_1fr]">
              <div className="flex flex-col gap-4">
                <Clock />
                <div className="card p-5">
                  <div className="display-title text-5xl font-extrabold leading-none text-[var(--ink)]">
                    {agg.progress}%
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[var(--ink2)]">Overall progress</div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                    <div className="h-full rounded-full" style={{ width: `${agg.progress}%`, background: 'var(--accent)' }} />
                  </div>
                  <div className="mt-4 flex gap-6">
                    {[['Tasks', agg.total], ['Active', agg.active], ['Done', agg.done]].map(([l, v]) => (
                      <div key={l}>
                        <div className="display-title text-2xl font-bold text-[var(--ink)]">{v}</div>
                        <div className="text-[12px] font-semibold text-[var(--ink3)]">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="display-title text-[17px] font-bold text-[var(--ink)]">Overdue</h3>
                  <span className="text-[13px] font-semibold text-[var(--ink2)]">{overdue.length}</span>
                </div>
                {overdue.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--ink3)]">Nothing overdue.</p>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {overdue.map((t) => (
                      <li key={t.id}>
                        <a href={`/board/${t.boardId}`} className="flex items-center justify-between gap-3 py-2.5 no-underline">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[var(--ink)]">{t.title}</span>
                            <span className="block truncate text-[12px] text-[var(--ink3)]">{t.boardTitle} · due {fmtDue(t.due)}</span>
                          </span>
                          <span className="shrink-0 text-[11px] font-bold text-[var(--danger)]">overdue</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="display-title text-[17px] font-bold text-[var(--ink)]">Today</h3>
                  <span className="text-[13px] font-semibold text-[var(--ink2)]">{todayTasks.length}</span>
                </div>
                {todayTasks.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--ink3)]">Nothing due today.</p>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {todayTasks.map((t) => (
                      <li key={t.id}>
                        <a href={`/board/${t.boardId}`} className="flex items-center justify-between gap-3 py-2.5 no-underline">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[var(--ink)]">{t.title}</span>
                            <span className="block truncate text-[12px] text-[var(--ink3)]">{t.boardTitle}</span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              <div className="card p-5">
                <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">Announcements</h3>
                {announcements.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--ink3)]">No announcements.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {announcements.map((a) => (
                      <li key={a.id} className="border-l-2 border-[var(--accent)] pl-3">
                        <p className="text-sm leading-snug text-[var(--ink)]">{a.body}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--ink3)]">{a.author ?? 'Owner'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card p-5">
                <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">My notes</h3>
                {notes.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--ink3)]">No notes.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--line)]">
                    {notes.map((n) => (
                      <li key={n.id} className="py-2 text-sm text-[var(--ink)]">{n.body}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mb-4 flex items-baseline justify-between px-0.5">
              <h2 className="display-title text-2xl font-bold text-[var(--ink)]">Your workspaces</h2>
              <span className="text-[13px] font-semibold text-[var(--ink2)]">
                {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
              </span>
            </div>
          </>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {workspaces.map((w) => {
            const accent = accentFor(w.id)
            return (
              <Link
                key={w.id}
                to="/workspace/$workspaceId"
                params={{ workspaceId: w.id }}
                className="card card-hover flex flex-col gap-4 p-5 no-underline"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-[11px] text-[15px] font-extrabold text-white"
                    style={{ background: accent }}
                  >
                    {w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <ArrowUpRight size={17} className="text-[var(--ink3)]" aria-hidden="true" />
                </div>
                <div className="display-title text-[21px] font-bold leading-tight text-[var(--ink)]">
                  {w.name}
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--ink3)]">
                    <span>
                      {w.projects} project{w.projects === 1 ? '' : 's'}
                    </span>
                    <span>{w.progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${w.progress}%`, background: accent }}
                    />
                  </div>
                </div>
              </Link>
            )
          })}

          {workspaces.length === 0 && !creating && (
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setTimeout(() => inputRef.current?.focus(), 0)
              }}
              className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed border-[var(--line)] p-5 text-[var(--ink2)]"
            >
              <span className="text-2xl">+</span>
              <span className="text-sm font-bold">Create your first workspace</span>
            </button>
          )}
        </div>
      </main>
    </>
  )
}

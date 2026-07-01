import { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Eye,
  Phone,
  Zap,
} from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { createBoard } from '#/lib/boards'
import { isDoneColumn } from '#/lib/home'

// Supabase may rotate the session cookie on any call; flush those Set-Cookie
// headers (collected on a throwaway Headers) onto the real response.
function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const newBoard = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const title = (d as { title?: unknown })?.title
    if (typeof title !== 'string' || !title.trim()) throw new Error('Title required')
    return { title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const board = await createBoard(supabase, user.id, data.title)
    flush(headers)
    return board
  })

type Member = { name: string | null; avatar_url: string | null }
type Task = {
  id: string
  title: string
  status: string
  done: boolean
  due: string | null
  owner: Member | null
  label: { name: string; color: string } | null
}
type Project = {
  id: string
  title: string
  type: string | null
  projectStatus: string
  value: number // owner-only project value in whole rupiah; 0 for non-owned
  tasks: Task[]
  members: Member[]
}

// Single server fn → single requireUser/getUser. Two parallel auth'd server
// fns raced to refresh the same single-use Supabase token, corrupting the
// session and yielding malformed (content-type-less) responses.
const fetchHome = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)

  const [{ data: me }, { data: boardRows }, { data: finance }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', user.id).single(),
    supabase
      .from('boards')
      .select(
        'id,title,type,status,columns(title,cards(id,title,due_date,card_labels(labels(name,color)),assignee:profiles!assignee_id(name,avatar_url))),board_members(profiles(id,name,avatar_url))',
      )
      .order('created_at'),
    // RLS returns only the caller's owned boards, so the total is inherently
    // owner-scoped and clients never see other people's values.
    supabase.from('project_finance').select('board_id,value_idr'),
  ])

  const valueByBoard = new Map<string, number>()
  for (const f of (finance ?? []) as Array<{ board_id: string; value_idr: number }>) {
    valueByBoard.set(f.board_id, Number(f.value_idr) || 0)
  }

  // Nested embeds arrive as object or single-element array depending on the
  // relationship; normalise defensively.
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const projects: Project[] = (boardRows ?? []).map((b) => {
    const tasks: Task[] = []
    for (const col of (b.columns ?? []) as Array<{ title: string; cards?: unknown[] }>) {
      const status = col.title
      const done = isDoneColumn(status)
      for (const c of (col.cards ?? []) as Array<Record<string, unknown>>) {
        const labelJoin = one(c.card_labels as unknown) as { labels: unknown } | null
        const label = labelJoin
          ? (one(labelJoin.labels) as { name: string; color: string } | null)
          : null
        const owner = one(c.assignee as unknown) as Member | null
        tasks.push({
          id: c.id as string,
          title: c.title as string,
          status,
          done,
          due: (c.due_date as string | null) ?? null,
          owner,
          label,
        })
      }
    }
    const seen = new Set<string>()
    const members: Member[] = []
    for (const m of (b.board_members ?? []) as Array<{ profiles: unknown }>) {
      const p = one(m.profiles) as
        | { id: string; name: string | null; avatar_url: string | null }
        | null
      if (p && !seen.has(p.id)) {
        seen.add(p.id)
        members.push({ name: p.name, avatar_url: p.avatar_url })
      }
    }
    return {
      id: b.id as string,
      title: b.title as string,
      type: (b.type as string | null) ?? null,
      projectStatus: (b.status as string) ?? 'active',
      value: valueByBoard.get(b.id as string) ?? 0,
      tasks,
      members,
    }
  })

  const totalValue = [...valueByBoard.values()].reduce((a, b) => a + b, 0)

  flush(headers)
  return { name: me?.name ?? null, projects, totalValue }
})

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => await fetchHome(),
})

// Deterministic accent per board so each project reads with its own colour.
const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const TASK_ICONS = [Eye, Phone, CheckCircle2]

function personInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const chars = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return chars.toUpperCase() || '?'
}

function Avatar({
  name,
  url,
  className = '',
}: {
  name: string | null
  url?: string | null
  className?: string
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        className={`h-7 w-7 rounded-full border-2 border-[var(--card)] object-cover ${className}`}
      />
    )
  }
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--accent)] text-[11px] font-bold text-white ${className}`}
    >
      {personInitials(name)}
    </span>
  )
}

function fmtDue(due: string | null): string {
  if (!due) return '—'
  return new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Home() {
  const router = useRouter()
  const { name, projects, totalValue } = Route.useLoaderData()
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? '')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const project =
    projects.find((p) => p.id === selectedId) ?? projects[0] ?? null

  const derived = useMemo(() => {
    const tasks = project?.tasks ?? []
    const total = tasks.length
    const done = tasks.filter((t) => t.done).length
    return {
      tasks,
      total,
      done,
      active: total - done,
      progress: total ? Math.round((done / total) * 100) : 0,
      todayTasks: tasks.filter((t) => !t.done).slice(0, 3),
      requests: tasks.filter((t) => !t.due && !t.done).slice(0, 4),
    }
  }, [project])

  const members = project?.members ?? []

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const board = await newBoard({ data: { title } })
    setTitle('')
    setBusy(false)
    setCreating(false)
    setSelectedId(board.id)
    router.invalidate()
  }

  return (
    <>
      <div className="meadow-bg" aria-hidden="true" />
      <main className="page-wrap relative z-[1] pb-32 pt-9 gt-fade">
        {/* Hero */}
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
              Here's where your projects stand today.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {members.length > 0 && (
              <div className="flex -space-x-2">
                {members.map((m, i) => (
                  <Avatar key={i} name={m.name} url={m.avatar_url} />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setCreating((c) => !c)}
              className="btn btn-primary px-5 py-3 text-sm"
            >
              <span className="text-[17px] leading-none">+</span>
              New project
            </button>
          </div>
        </div>

        {creating && (
          <form onSubmit={onCreate} className="card mb-8 flex flex-wrap gap-3 p-4">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              placeholder="Project name…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
          </form>
        )}

        {!project ? (
          <div className="card p-10 text-center">
            <div className="display-title text-xl font-bold text-[var(--ink)]">
              No projects yet
            </div>
            <p className="mt-2 text-sm text-[var(--ink2)]">
              Create your first project to see it here.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn btn-primary btn-square mt-5"
            >
              + New project
            </button>
          </div>
        ) : (
          <>
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
            {/* Left column: project + progress + activity */}
            <div className="flex flex-col gap-4">
              <div className="card flex items-center gap-3 p-4">
                <span
                  className="h-10 w-10 shrink-0 rounded-[11px]"
                  style={{ background: accentFor(project.id) }}
                />
                <div className="min-w-0 flex-1">
                  <select
                    value={project.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                    className="w-full cursor-pointer truncate bg-transparent text-[15px] font-bold text-[var(--ink)] focus:outline-none"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs font-semibold text-[var(--ink3)]">
                    {derived.total} task{derived.total === 1 ? '' : 's'} ·{' '}
                    {members.length} member{members.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="display-title text-5xl font-extrabold leading-none text-[var(--ink)]">
                  {derived.progress}%
                </div>
                <div className="mt-2 text-sm font-semibold text-[var(--ink2)]">
                  Project progress
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${derived.progress}%`, background: 'var(--accent)' }}
                  />
                </div>
              </div>

              <div
                className="rounded-[var(--radius)] p-5"
                style={{ background: '#F5C948' }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[15px] font-bold text-[#3a2f00]">
                    Project activity
                  </span>
                  <span className="rounded-full bg-[#3a2f00]/10 px-2.5 py-1 text-[11px] font-bold text-[#3a2f00]">
                    Stats
                  </span>
                </div>
                <div className="flex gap-7">
                  {[
                    ['Tasks', derived.total],
                    ['Active', derived.active],
                    ['Done', derived.done],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="display-title text-2xl font-extrabold text-[#3a2f00]">
                        {val}
                      </div>
                      <div className="text-[12px] font-semibold text-[#6b5900]">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Middle column: today's tasks */}
            <div>
              <div className="mb-4 flex items-baseline justify-between px-0.5">
                <h2 className="display-title text-xl font-bold text-[var(--ink)]">
                  Today's tasks
                </h2>
                <span className="text-[13px] font-semibold text-[var(--ink2)]">
                  {derived.active} up next
                </span>
              </div>

              {derived.todayTasks.length === 0 ? (
                <div className="card p-8 text-center text-sm text-[var(--ink3)]">
                  Nothing active. Clear runway.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {derived.todayTasks.map((t, i) => {
                    const Icon = TASK_ICONS[i % TASK_ICONS.length]
                    const tint = t.label?.color ?? accentFor(project.id)
                    return (
                      <div key={t.id} className="card p-5">
                        <div className="mb-4 flex items-center gap-3">
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-[10px]"
                            style={{ background: `${tint}22`, color: tint }}
                          >
                            <Icon size={18} aria-hidden="true" />
                          </span>
                          {t.label && (
                            <span
                              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                              style={{ background: `${t.label.color}22`, color: t.label.color }}
                            >
                              {t.label.name}
                            </span>
                          )}
                        </div>
                        <div className="border-b border-[var(--line)] pb-4 text-lg font-bold text-[var(--ink)]">
                          {t.title}
                        </div>
                        <div className="grid grid-cols-3 gap-2 py-4">
                          {[
                            ['STATUS', t.status],
                            ['DUE', fmtDue(t.due)],
                            ['OWNER', t.owner?.name ?? 'Unassigned'],
                          ].map(([label, val]) => (
                            <div key={label}>
                              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ink3)]">
                                {label}
                              </div>
                              <div className="mt-0.5 truncate text-sm font-semibold text-[var(--ink)]">
                                {val}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t border-[var(--line)] pt-4">
                          <div className="flex -space-x-2">
                            {members.slice(0, 3).map((m, j) => (
                              <Avatar key={j} name={m.name} url={m.avatar_url} />
                            ))}
                          </div>
                          <a
                            href={`/board/${project.id}`}
                            className="btn btn-primary px-4 py-2 text-sm no-underline"
                          >
                            Open card
                          </a>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right column: quick requests + focus mode */}
            <div className="flex flex-col gap-4">
              <div className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap size={17} className="text-[var(--accent)]" aria-hidden="true" />
                    <h3 className="display-title text-[17px] font-bold text-[var(--ink)]">
                      Quick requests
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="text-[13px] font-semibold text-[var(--accent)]"
                  >
                    + Set task
                  </button>
                </div>
                {derived.requests.length === 0 ? (
                  <p className="py-3 text-sm text-[var(--ink3)]">No open requests.</p>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {derived.requests.map((r) => (
                      <li key={r.id}>
                        <a
                          href={`/board/${project.id}`}
                          className="flex items-center justify-between gap-3 py-3 no-underline"
                        >
                          <span className="truncate text-sm font-semibold text-[var(--ink)]">
                            {r.title}
                          </span>
                          <ChevronRight
                            size={16}
                            className="shrink-0 text-[var(--ink3)]"
                            aria-hidden="true"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div
                className="flex flex-col gap-4 rounded-[var(--radius)] p-5"
                style={{ background: '#0E1A14' }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="display-title text-[17px] font-bold text-white">
                    Focus mode
                  </h3>
                  <BarChart3 size={18} className="text-white/40" aria-hidden="true" />
                </div>
                <p className="text-sm text-white/60">
                  Lo-fi & instrumental while you work.
                </p>
                <iframe
                  src="https://open.spotify.com/embed/playlist/37i9dQZF1DZ06evO4pXYMW?utm_source=generator"
                  width="100%"
                  height="352"
                  style={{ border: 0, borderRadius: 12 }}
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  title="Focus playlist"
                />
              </div>
            </div>
          </div>

          {/* Your projects — click a card to switch the dashboard above */}
          <div className="mb-4 mt-10 flex items-baseline justify-between px-0.5">
            <h2 className="display-title text-2xl font-bold text-[var(--ink)]">
              Your projects
            </h2>
            <span className="text-[13px] font-semibold text-[var(--ink2)]">
              {projects.length} project{projects.length === 1 ? '' : 's'}
              {totalValue > 0 && ` · Rp ${totalValue.toLocaleString('id-ID')}`}
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {projects.map((p) => {
              const accent = accentFor(p.id)
              const total = p.tasks.length
              const done = p.tasks.filter((t) => t.done).length
              const pct = total ? Math.round((done / total) * 100) : 0
              return (
                <a
                  key={p.id}
                  href={`/board/${p.id}`}
                  className="card card-hover flex flex-col gap-4 p-5 no-underline"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: accent }}
                      />
                      <span className="truncate text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ink2)]">
                        {p.type ?? 'Project'}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={17}
                      className="shrink-0 text-[var(--ink3)]"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="display-title text-[21px] font-bold leading-tight text-[var(--ink)]">
                    {p.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--col)] px-2.5 py-0.5 text-[11px] font-bold capitalize text-[var(--ink2)]">
                      {p.projectStatus.replace('_', ' ')}
                    </span>
                    {p.value > 0 && (
                      <span className="text-[11px] font-bold text-[var(--accent-ink)]">
                        Rp {p.value.toLocaleString('id-ID')}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--ink3)]">
                      <span>
                        {done}/{total} task{total === 1 ? '' : 's'}
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: accent }}
                      />
                    </div>
                  </div>
                  {p.members.length > 0 && (
                    <div className="flex -space-x-2">
                      {p.members.slice(0, 4).map((m, j) => (
                        <Avatar key={j} name={m.name} url={m.avatar_url} />
                      ))}
                    </div>
                  )}
                </a>
              )
            })}

            <form
              onSubmit={onCreate}
              className="flex flex-col justify-center gap-3 rounded-[var(--radius)] border-2 border-dashed border-[var(--line)] p-5"
            >
              <div className="display-title text-base font-bold text-[var(--ink2)]">
                Start a new project
              </div>
              <input
                placeholder="Project name…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field"
              />
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary btn-square w-full"
              >
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </form>
          </div>
          </>
        )}
      </main>
    </>
  )
}

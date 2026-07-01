import { useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { ArrowUpRight } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { createBoard, listMyBoards } from '#/lib/boards'
import { computeStats, isDoneColumn } from '#/lib/home'

// Supabase may rotate the session cookie on any call; flush those Set-Cookie
// headers (collected on a throwaway Headers) onto the real response.
function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchBoards = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  const boards = await listMyBoards(supabase)
  flush(headers)
  return boards
})

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

const fetchHome = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: me }, { data: cardRows }, { data: cols }, { data: mem }] =
    await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).single(),
      supabase
        .from('cards')
        .select(
          'id,title,due_date,columns(title,board_id),card_labels(labels(name,color)),assignee:profiles!assignee_id(name,avatar_url)',
        )
        .lte('due_date', today)
        .order('due_date'),
      supabase.from('columns').select('title,cards(id)'),
      supabase.from('board_members').select('profiles(id,name,avatar_url)'),
    ])

  // Cards embed columns/labels/assignee as (possibly single-element) arrays or
  // objects depending on the relationship; normalise defensively.
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const todayTasks = (cardRows ?? [])
    .map((r) => {
      const col = one(r.columns) as { title: string; board_id: string } | null
      const labelJoin = one(r.card_labels) as { labels: unknown } | null
      const label = labelJoin ? (one(labelJoin.labels) as { name: string; color: string } | null) : null
      const owner = one(r.assignee) as { name: string | null; avatar_url: string | null } | null
      return {
        id: r.id as string,
        title: r.title as string,
        boardId: col?.board_id ?? '',
        status: col?.title ?? '',
        due: (r.due_date as string | null) ?? null,
        owner,
        label,
      }
    })
    .filter((t) => t.boardId && !isDoneColumn(t.status))
    .slice(0, 4)

  const stats = computeStats(
    (cols ?? []).map((c) => ({
      title: c.title as string,
      cards: (c.cards ?? []) as { id: string }[],
    })),
  )

  const seen = new Set<string>()
  const members: HomeData['members'] = []
  for (const row of mem ?? []) {
    const p = one((row as { profiles: unknown }).profiles) as
      | { id: string; name: string | null; avatar_url: string | null }
      | null
    if (p && !seen.has(p.id)) {
      seen.add(p.id)
      members.push({ name: p.name, avatar_url: p.avatar_url })
    }
  }

  flush(headers)
  return { name: me?.name ?? null, todayTasks, stats, members: members.slice(0, 5) }
})

type HomeData = {
  name: string | null
  todayTasks: Array<{
    id: string
    title: string
    boardId: string
    status: string
    due: string | null
    owner: { name: string | null; avatar_url: string | null } | null
    label: { name: string; color: string } | null
  }>
  stats: { total: number; active: number; done: number }
  members: Array<{ name: string | null; avatar_url: string | null }>
}

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    const [boards, home] = await Promise.all([fetchBoards(), fetchHome()])
    return { boards, home }
  },
})

// Deterministic accent per board so the grid reads with variety — derived from
// the id, not fabricated data.
const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

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

function Home() {
  const router = useRouter()
  const { boards, home } = Route.useLoaderData()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const newBoardRef = useRef<HTMLInputElement>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    await newBoard({ data: { title } })
    setTitle('')
    setBusy(false)
    router.invalidate()
  }

  return (
    <>
      <div className="meadow-bg" aria-hidden="true" />
      <main className="page-wrap relative z-[1] pb-32 pt-9 gt-fade">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--ink3)]">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
            <h1 className="display-title mt-1 text-4xl font-extrabold leading-none text-[var(--ink)]">
              Hi, {home.name ?? 'there'}
            </h1>
            <p className="mt-3 text-[15px] text-[var(--ink2)]">
              Here's where your projects stand today.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {home.members.length > 0 && (
              <div className="flex -space-x-2">
                {home.members.map((m, i) => (
                  <Avatar key={i} name={m.name} url={m.avatar_url} />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => newBoardRef.current?.focus()}
              className="btn btn-primary px-5 py-3 text-sm"
            >
              <span className="text-[17px] leading-none">+</span>
              New project
            </button>
          </div>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* Today's tasks */}
          <section className="card p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="display-title text-xl font-bold text-[var(--ink)]">
                Today's tasks
              </h2>
              <span className="text-[13px] font-semibold text-[var(--ink2)]">
                {home.todayTasks.length} due
              </span>
            </div>

            {home.todayTasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ink3)]">
                Nothing due today. Clear runway.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {home.todayTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      {t.label && (
                        <span
                          className="mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={{ background: `${t.label.color}22`, color: t.label.color }}
                        >
                          {t.label.name}
                        </span>
                      )}
                      <div className="truncate font-bold text-[var(--ink)]">{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-[var(--ink3)]">
                        <span>{t.status}</span>
                        <span>Due {t.due ? new Date(t.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
                        {t.owner?.name && <span>{t.owner.name}</span>}
                      </div>
                    </div>
                    {t.owner && <Avatar name={t.owner.name} url={t.owner.avatar_url} />}
                    <a
                      href={`/board/${t.boardId}`}
                      className="btn btn-ghost shrink-0 px-4 py-2 text-sm no-underline"
                    >
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Focus mode / Spotify */}
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="display-title text-xl font-bold text-[var(--ink)]">Focus mode</h2>
            <p className="text-sm text-[var(--ink2)]">Lo-fi & instrumental while you work.</p>
            <iframe
              src="https://open.spotify.com/embed/playlist/37i9dQZF1DZ06evO4pXYMW?utm_source=generator"
              width="100%"
              height="352"
              style={{ border: 0, borderRadius: 12 }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title="Focus playlist"
            />
          </section>
        </div>

        {/* Activity strip */}
        <div className="card mb-8 flex items-center gap-8 p-5">
          <div>
            <div className="display-title text-3xl font-extrabold text-[var(--ink)]">
              {home.stats.total === 0 ? '0%' : `${Math.round((home.stats.done / home.stats.total) * 100)}%`}
            </div>
            <div className="text-[12px] font-semibold text-[var(--ink3)]">Progress</div>
          </div>
          <div className="h-10 w-px bg-[var(--line)]" />
          <div className="flex gap-8">
            <div>
              <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.total}</div>
              <div className="text-[12px] font-semibold text-[var(--ink3)]">Tasks</div>
            </div>
            <div>
              <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.active}</div>
              <div className="text-[12px] font-semibold text-[var(--ink3)]">Active</div>
            </div>
            <div>
              <div className="display-title text-2xl font-bold text-[var(--ink)]">{home.stats.done}</div>
              <div className="text-[12px] font-semibold text-[var(--ink3)]">Done</div>
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-baseline justify-between px-0.5">
          <h2 className="display-title text-xl font-bold text-[var(--ink)]">
            All projects
          </h2>
          <span className="text-[13px] font-semibold text-[var(--ink2)]">
            {boards.length} project{boards.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {boards.map((b) => {
            const accent = accentFor(b.id)
            return (
              <a
                key={b.id}
                href={`/board/${b.id}`}
                className="card card-hover flex flex-col gap-4 p-5 no-underline"
              >
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: accent }}
                    />
                    <span className="truncate text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ink2)]">
                      Project
                    </span>
                  </span>
                  <ArrowUpRight
                    size={17}
                    className="shrink-0 text-[var(--ink3)]"
                    aria-hidden="true"
                  />
                </div>
                <div className="display-title text-[21px] font-bold leading-tight text-[var(--ink)]">
                  {b.title}
                </div>
                <div className="text-xs font-semibold text-[var(--ink3)]">
                  Created {new Date(b.created_at).toLocaleDateString()}
                </div>
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
              ref={newBoardRef}
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
      </main>
    </>
  )
}

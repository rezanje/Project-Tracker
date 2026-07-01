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
  component: Boards,
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

function Boards() {
  const router = useRouter()
  const { boards } = Route.useLoaderData()
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
        <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="display-title text-4xl font-extrabold leading-none text-[var(--ink)]">
              Your projects
            </h1>
            <p className="mt-3 text-[15px] text-[var(--ink2)]">
              Here's where your work stands today.
            </p>
          </div>
          <button
            type="button"
            onClick={() => newBoardRef.current?.focus()}
            className="btn btn-primary px-5 py-3 text-sm"
          >
            <span className="text-[17px] leading-none">+</span>
            New project
          </button>
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

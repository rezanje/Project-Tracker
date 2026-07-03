import { useRef, useState } from 'react'
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

const fetchWorkspaces = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const [{ data: me }, { data: workspaces }, { data: boards }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', user.id).single(),
    supabase.from('workspaces').select('id,name').order('created_at'),
    supabase.from('boards').select('id,workspace_id,columns(title,cards(id))'),
  ])

  const stats = new Map<string, { total: number; done: number; projects: number }>()
  for (const b of (boards ?? []) as Array<{ workspace_id: string | null; columns?: unknown[] }>) {
    const ws = b.workspace_id
    if (!ws) continue
    const s = stats.get(ws) ?? { total: 0, done: 0, projects: 0 }
    s.projects++
    for (const col of (b.columns ?? []) as Array<{ title: string; cards?: unknown[] }>) {
      const n = (col.cards ?? []).length
      s.total += n
      if (isDoneColumn(col.title)) s.done += n
    }
    stats.set(ws, s)
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
  return { name: me?.name ?? null, workspaces: list }
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

function Workspaces() {
  const router = useRouter()
  const { name, workspaces } = Route.useLoaderData()
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

import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
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
import { getServiceSupabase } from '#/lib/supabase/server'
import { createBoard } from '#/lib/boards'
import {
  inviteWorkspaceMember,
  listWorkspaceMembers,
  setWorkspaceMemberRole,
  removeWorkspaceMember,
  type TeamMember,
} from '#/lib/workspaces'
import TeamPanel from '#/components/TeamPanel'
import { isDoneColumn } from '#/lib/home'

// Supabase may rotate the session cookie on any call; flush those Set-Cookie
// headers (collected on a throwaway Headers) onto the real response.
function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const newBoard = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { title, workspaceId } = (d ?? {}) as { title?: unknown; workspaceId?: unknown }
    if (typeof title !== 'string' || !title.trim()) throw new Error('Title required')
    if (typeof workspaceId !== 'string') throw new Error('workspaceId required')
    return { title: title.trim(), workspaceId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const board = await createBoard(supabase, user.id, data.title, data.workspaceId)
    flush(headers)
    return board
  })

const inviteTeamFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, email } = (d ?? {}) as { workspaceId?: unknown; email?: unknown }
    if (typeof workspaceId !== 'string' || typeof email !== 'string' || !email.trim())
      throw new Error('workspaceId and email required')
    return { workspaceId, email: email.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', data.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (wm?.role !== 'owner') throw new Error('forbidden')
    const res = await inviteWorkspaceMember(getServiceSupabase(), data.workspaceId, data.email)
    flush(headers)
    return res
  })

const fetchTeamFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { workspaceId?: unknown })?.workspaceId
    if (typeof id !== 'string') throw new Error('workspaceId required')
    return { workspaceId: id }
  })
  .handler(async ({ data }): Promise<{ members: TeamMember[] }> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', data.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (wm?.role !== 'owner') throw new Error('forbidden')
    const members = await listWorkspaceMembers(getServiceSupabase(), data.workspaceId)
    flush(headers)
    return { members }
  })

const setRoleFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, userId, role } = (d ?? {}) as {
      workspaceId?: unknown
      userId?: unknown
      role?: unknown
    }
    if (typeof workspaceId !== 'string' || typeof userId !== 'string')
      throw new Error('workspaceId and userId required')
    return { workspaceId, userId, role: role === 'owner' ? ('owner' as const) : ('member' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await setWorkspaceMemberRole(supabase, data.workspaceId, data.userId, data.role)
    flush(headers)
  })

const removeMemberFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, userId } = (d ?? {}) as { workspaceId?: unknown; userId?: unknown }
    if (typeof workspaceId !== 'string' || typeof userId !== 'string')
      throw new Error('workspaceId and userId required')
    return { workspaceId, userId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await removeWorkspaceMember(supabase, data.workspaceId, data.userId)
    flush(headers)
  })

const postAnnouncementFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, body } = (d ?? {}) as { workspaceId?: unknown; body?: unknown }
    if (typeof workspaceId !== 'string' || typeof body !== 'string' || !body.trim())
      throw new Error('workspaceId and body required')
    return { workspaceId, body: body.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase
      .from('announcements')
      .insert({ workspace_id: data.workspaceId, author_id: user.id, body: data.body })
    if (error) throw error
    flush(headers)
  })

const addNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const body = (d as { body?: unknown })?.body
    if (typeof body !== 'string' || !body.trim()) throw new Error('body required')
    return { body: body.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { error } = await supabase.from('notes').insert({ user_id: user.id, body: data.body })
    if (error) throw error
    flush(headers)
  })

const deleteNoteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await supabase.from('notes').delete().eq('id', data.id)
    flush(headers)
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
const fetchHome = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const id = (d as { workspaceId?: unknown })?.workspaceId
    if (typeof id !== 'string') throw new Error('workspaceId required')
    return { workspaceId: id }
  })
  .handler(async ({ data }) => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)

  const [
    { data: me },
    { data: ws },
    { data: wm },
    { data: announcements },
    { data: notes },
    { data: boardRows },
    { data: finance },
  ] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).single(),
      supabase.from('workspaces').select('name').eq('id', data.workspaceId).maybeSingle(),
      supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', data.workspaceId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('announcements')
        .select('id,body,created_at,profiles:author_id(name)')
        .eq('workspace_id', data.workspaceId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('notes')
        .select('id,body,created_at')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('boards')
        .select(
          'id,title,type,status,columns(title,cards(id,title,due_date,card_labels(labels(name,color)),assignee:profiles!assignee_id(name,avatar_url))),board_members(profiles(id,name,avatar_url))',
        )
        .eq('workspace_id', data.workspaceId)
        .order('created_at'),
      // RLS scopes finance to owner, so the total stays owner-private.
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
  return {
    name: me?.name ?? null,
    projects,
    totalValue,
    workspaceId: data.workspaceId,
    workspaceName: ws?.name ?? 'Workspace',
    wsRole: (wm?.role as string | null) ?? null,
    meId: user.id,
    announcements: (announcements ?? []).map((a) => {
      const raw = (a as { profiles: unknown }).profiles
      const p = (Array.isArray(raw) ? raw[0] : raw) as { name: string | null } | null
      return {
        id: a.id as string,
        body: a.body as string,
        created_at: a.created_at as string,
        author: p?.name ?? null,
      }
    }),
    notes: (notes ?? []).map((n) => ({
      id: n.id as string,
      body: n.body as string,
      created_at: n.created_at as string,
    })),
  }
})

export const Route = createFileRoute('/workspace/$workspaceId')({
  component: Home,
  loader: async ({ params }) => await fetchHome({ data: { workspaceId: params.workspaceId } }),
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
      <span
        className="text-3xl font-extrabold tabular-nums text-[var(--ink3)]"
        suppressHydrationWarning
      >
        {now.toLocaleTimeString(undefined, { second: '2-digit' }).replace(/\D/g, '')}
      </span>
    </div>
  )
}

function Home() {
  const router = useRouter()
  const { name, projects, totalValue, workspaceId, workspaceName, wsRole, meId, announcements, notes } =
    Route.useLoaderData()
  const isWsOwner = wsRole === 'owner'
  const [annBody, setAnnBody] = useState('')
  const [noteBody, setNoteBody] = useState('')

  async function onPostAnn(e: React.FormEvent) {
    e.preventDefault()
    if (!annBody.trim()) return
    await postAnnouncementFn({ data: { workspaceId, body: annBody } })
    setAnnBody('')
    router.invalidate()
  }
  async function onAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteBody.trim()) return
    await addNoteFn({ data: { body: noteBody } })
    setNoteBody('')
    router.invalidate()
  }
  async function onDelNote(id: string) {
    await deleteNoteFn({ data: { id } })
    router.invalidate()
  }
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamBusy, setTeamBusy] = useState(false)

  async function openTeam() {
    setTeamBusy(true)
    setTeamOpen(true)
    try {
      const { members } = await fetchTeamFn({ data: { workspaceId } })
      setTeamMembers(members)
    } finally {
      setTeamBusy(false)
    }
  }
  async function refreshTeam() {
    const { members } = await fetchTeamFn({ data: { workspaceId } })
    setTeamMembers(members)
  }
  async function onSetRole(userId: string, role: 'owner' | 'member') {
    setTeamBusy(true)
    try {
      await setRoleFn({ data: { workspaceId, userId, role } })
      await refreshTeam()
    } finally {
      setTeamBusy(false)
    }
  }
  async function onRemoveMember(userId: string) {
    setTeamBusy(true)
    try {
      await removeMemberFn({ data: { workspaceId, userId } })
      await refreshTeam()
    } finally {
      setTeamBusy(false)
    }
  }
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? '')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [invEmail, setInvEmail] = useState('')
  const [invMsg, setInvMsg] = useState<string | null>(null)
  const [invLink, setInvLink] = useState<string | null>(null)

  async function onInviteTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!invEmail.trim()) return
    setInvMsg(null)
    setInvLink(null)
    try {
      const r = await inviteTeamFn({ data: { workspaceId, email: invEmail } })
      if (r.status === 'added') setInvMsg('Added to workspace as member.')
      else {
        setInvMsg('Invite created. Share the link.')
        setInvLink(`${window.location.origin}/signup?winvite=${r.token}`)
      }
      setInvEmail('')
    } catch {
      setInvMsg('Failed to invite.')
    }
  }
  const [showArchived, setShowArchived] = useState(false)

  // Archived projects stay loaded (0 extra query) but are hidden from the grid
  // by default so finished work doesn't clutter active projects.
  const archivedCount = projects.filter((p) => p.projectStatus === 'archived').length
  const visible = showArchived
    ? projects
    : projects.filter((p) => p.projectStatus !== 'archived')

  const project =
    visible.find((p) => p.id === selectedId) ?? visible[0] ?? null

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

  // Overdue across every project in this workspace (past due, not done).
  const today = new Date().toISOString().slice(0, 10)
  const overdue = projects
    .flatMap((p) => p.tasks.map((t) => ({ ...t, projectId: p.id, projectTitle: p.title })))
    .filter((t) => t.due && t.due < today && !t.done)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
    .slice(0, 6)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setCreateErr(null)
    try {
      const board = await newBoard({ data: { title, workspaceId } })
      setTitle('')
      setCreating(false)
      setSelectedId(board.id)
      router.invalidate()
    } catch {
      setCreateErr('Could not create project. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="meadow-bg" aria-hidden="true" />
      <main className="page-wrap relative z-[1] pb-32 pt-9 gt-fade">
        {/* Hero */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Link
              to="/"
              className="mb-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--ink)]"
            >
              <ChevronRight size={15} className="rotate-180" aria-hidden="true" />
              Workspaces
            </Link>
            <h1 className="display-title text-4xl font-extrabold leading-none text-[var(--ink)]">
              {workspaceName}
            </h1>
            <p className="mt-3 text-[15px] text-[var(--ink2)]">
              Hi {name ?? 'there'} — here's this workspace today.
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
            {isWsOwner && (
              <button
                type="button"
                onClick={openTeam}
                className="btn btn-ghost px-4 py-3 text-sm"
              >
                Team
              </button>
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

        {teamOpen && (
          <TeamPanel
            members={teamMembers}
            meId={meId}
            busy={teamBusy}
            onSetRole={onSetRole}
            onRemove={onRemoveMember}
            onClose={() => setTeamOpen(false)}
          />
        )}

        {isWsOwner && (
          <div className="mb-8 flex flex-col items-start gap-2">
            <form onSubmit={onInviteTeam} className="flex flex-wrap gap-2">
              <input
                type="email"
                placeholder="Invite team member by email…"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                className="field rounded-full px-4 py-2.5 text-[13px] sm:w-[260px]"
              />
              <button type="submit" className="btn btn-primary btn-square">
                Invite to workspace
              </button>
            </form>
            {invMsg && (
              <span className="text-xs font-semibold text-[var(--accent-ink)]">{invMsg}</span>
            )}
            {invLink && (
              <div className="flex w-full max-w-[420px] items-center gap-2">
                <input
                  readOnly
                  value={invLink}
                  onFocus={(e) => e.target.select()}
                  className="field flex-1 rounded-full px-3 py-2 text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(invLink)}
                  className="btn btn-ghost btn-square px-3 py-2 text-xs"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

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
            {createErr && (
              <p className="w-full text-[13px] font-semibold text-[var(--danger)]">{createErr}</p>
            )}
          </form>
        )}

        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <Clock />
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="display-title text-[17px] font-bold text-[var(--ink)]">Overdue</h3>
              <span className="text-[13px] font-semibold text-[var(--ink2)]">{overdue.length}</span>
            </div>
            {overdue.length === 0 ? (
              <p className="py-3 text-sm text-[var(--ink3)]">Nothing overdue — nice.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {overdue.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`/board/${t.projectId}`}
                      className="flex items-center justify-between gap-3 py-2.5 no-underline"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--ink)]">
                          {t.title}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--ink3)]">
                          {t.projectTitle} · due {fmtDue(t.due)}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-[var(--danger)]">
                        overdue
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">
              Announcements
            </h3>
            {isWsOwner && (
              <form onSubmit={onPostAnn} className="mb-3 flex gap-2">
                <input
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="Post to the team…"
                  className="field flex-1 text-[13px]"
                />
                <button type="submit" className="btn btn-primary btn-square px-3 text-xs">
                  Post
                </button>
              </form>
            )}
            {announcements.length === 0 ? (
              <p className="py-2 text-sm text-[var(--ink3)]">No announcements yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {announcements.map((a) => (
                  <li key={a.id} className="border-l-2 border-[var(--accent)] pl-3">
                    <p className="text-sm leading-snug text-[var(--ink)]">{a.body}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
                      {a.author ?? 'Owner'} ·{' '}
                      {new Date(a.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">My notes</h3>
            <form onSubmit={onAddNote} className="mb-3 flex gap-2">
              <input
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Quick note…"
                className="field flex-1 text-[13px]"
              />
              <button type="submit" className="btn btn-primary btn-square px-3 text-xs">
                Add
              </button>
            </form>
            {notes.length === 0 ? (
              <p className="py-2 text-sm text-[var(--ink3)]">No notes.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2 py-2">
                    <span className="text-sm leading-snug text-[var(--ink)]">{n.body}</span>
                    <button
                      type="button"
                      onClick={() => onDelNote(n.id)}
                      aria-label="Delete note"
                      className="shrink-0 text-lg leading-none text-[var(--ink3)] hover:text-[var(--danger)]"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {!project ? (
          <div className="card p-10 text-center">
            {projects.length === 0 ? (
              <>
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
              </>
            ) : (
              <>
                <div className="display-title text-xl font-bold text-[var(--ink)]">
                  Semua project di-archive
                </div>
                <p className="mt-2 text-sm text-[var(--ink2)]">
                  {archivedCount} project archived tersembunyi.
                </p>
                <button
                  type="button"
                  onClick={() => setShowArchived(true)}
                  className="btn btn-primary btn-square mt-5"
                >
                  Tampilkan archived
                </button>
              </>
            )}
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
                    {visible.map((p) => (
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
            <div className="flex items-baseline gap-3">
              {archivedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="text-[13px] font-semibold text-[var(--accent)] hover:underline"
                >
                  {showArchived ? 'Sembunyikan' : 'Tampilkan'} archived ({archivedCount})
                </button>
              )}
              <span className="text-[13px] font-semibold text-[var(--ink2)]">
                {visible.length} project{visible.length === 1 ? '' : 's'}
                {totalValue > 0 && ` · Rp ${totalValue.toLocaleString('id-ID')}`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {visible.map((p) => {
              const accent = accentFor(p.id)
              const total = p.tasks.length
              const done = p.tasks.filter((t) => t.done).length
              const pct = total ? Math.round((done / total) * 100) : 0
              return (
                <a
                  key={p.id}
                  href={`/board/${p.id}`}
                  className={`card card-hover flex flex-col gap-4 p-5 no-underline${
                    p.projectStatus === 'archived' ? ' opacity-60' : ''
                  }`}
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
              {createErr && (
                <p className="text-[13px] font-semibold text-[var(--danger)]">{createErr}</p>
              )}
            </form>
          </div>
          </>
        )}
      </main>
    </>
  )
}

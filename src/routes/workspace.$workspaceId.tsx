import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { createBoard } from '#/lib/boards'
import {
  inviteWorkspaceMember,
  listWorkspaceMembers,
  setWorkspaceMemberRole,
  removeWorkspaceMember,
  searchAddableAccounts,
  addExistingWorkspaceMember,
  type TeamMember,
  type AddableAccount,
} from '#/lib/workspaces'
import TeamPanel from '#/components/TeamPanel'
import {
  fetchAssignedGoalsFn, assignKpiFn, reviewKpiCheckinFn, reviewKrCheckinFn,
  deleteGoalFn, assignObjectiveFn, addKeyResultFn, type AssignedKpi, type AssignedObjective,
} from '#/lib/goals'
import { isDoneColumn, localDateStr } from '#/lib/home'
import WorkspaceDashboard, {
  type WsProject,
  type WsScheduleItem,
  type WsMember,
  type WsActivity,
} from '#/components/WorkspaceDashboard'

// Supabase may rotate the session cookie on any call; flush those Set-Cookie
// headers (collected on a throwaway Headers) onto the real response.
function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const newBoard = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { title, workspaceId, kind } = (d ?? {}) as {
      title?: unknown
      workspaceId?: unknown
      kind?: unknown
    }
    if (typeof title !== 'string' || !title.trim()) throw new Error('Title required')
    if (typeof workspaceId !== 'string') throw new Error('workspaceId required')
    return { title: title.trim(), workspaceId, kind: kind === 'leads' ? ('leads' as const) : ('tasks' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const board = await createBoard(supabase, user.id, data.title, data.workspaceId, data.kind)
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

const searchAccountsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, query } = (d ?? {}) as { workspaceId?: unknown; query?: unknown }
    if (typeof workspaceId !== 'string' || typeof query !== 'string')
      throw new Error('workspaceId and query required')
    return { workspaceId, query }
  })
  .handler(async ({ data }): Promise<AddableAccount[]> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', data.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (wm?.role !== 'owner') throw new Error('forbidden')
    const results = await searchAddableAccounts(getServiceSupabase(), data.workspaceId, data.query)
    flush(headers)
    return results
  })

const addMemberFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, userId } = (d ?? {}) as { workspaceId?: unknown; userId?: unknown }
    if (typeof workspaceId !== 'string' || typeof userId !== 'string')
      throw new Error('workspaceId and userId required')
    return { workspaceId, userId }
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
    await addExistingWorkspaceMember(getServiceSupabase(), data.workspaceId, data.userId)
    flush(headers)
    return { ok: true }
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

function Home() {
  const router = useRouter()
  const { projects, workspaceId, workspaceName, wsRole, meId, announcements } = Route.useLoaderData()
  const isWsOwner = wsRole === 'owner'

  // team panel (manage roles) — kept
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [assignedKpis, setAssignedKpis] = useState<AssignedKpi[]>([])
  const [assignedObjectives, setAssignedObjectives] = useState<AssignedObjective[]>([])
  async function refreshGoals() {
    const { kpis, objectives } = await fetchAssignedGoalsFn({ data: { workspaceId } })
    setAssignedKpis(kpis)
    setAssignedObjectives(objectives)
  }
  useEffect(() => {
    fetchTeamFn({ data: { workspaceId } })
      .then(({ members }) => setTeamMembers(members))
      .catch(() => {})
  }, [workspaceId])
  async function openTeam() {
    setTeamBusy(true)
    setTeamOpen(true)
    try {
      const { members } = await fetchTeamFn({ data: { workspaceId } })
      setTeamMembers(members)
      await refreshGoals()
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
  async function onAddMember(userId: string) {
    setTeamBusy(true)
    try {
      await addMemberFn({ data: { workspaceId, userId } })
      await refreshTeam()
    } finally {
      setTeamBusy(false)
    }
  }
  async function onSearchAccounts(query: string): Promise<AddableAccount[]> {
    return searchAccountsFn({ data: { workspaceId, query } })
  }
  async function onAssignKpi(assigneeId: string, name: string, target: number, unit: string, startDate: string, endDate: string) {
    await assignKpiFn({ data: { assigneeId, workspaceId, name, target, unit, startDate, endDate } })
    await refreshGoals()
  }
  async function onReviewKpi(checkinId: string, approve: boolean) {
    await reviewKpiCheckinFn({ data: { checkinId, approve } })
    await refreshGoals()
  }
  async function onReviewKr(checkinId: string, approve: boolean) {
    await reviewKrCheckinFn({ data: { checkinId, approve } })
    await refreshGoals()
  }
  async function onDeleteKpi(id: string) {
    await deleteGoalFn({ data: { kind: 'kpi', id } })
    await refreshGoals()
  }
  async function onDeleteObjective(id: string) {
    await deleteGoalFn({ data: { kind: 'objective', id } })
    await refreshGoals()
  }
  async function onAssignObjective(assigneeId: string, title: string, startDate: string, endDate: string) {
    await assignObjectiveFn({ data: { assigneeId, workspaceId, title, startDate, endDate } })
    await refreshGoals()
  }
  async function onAddKeyResult(objectiveId: string, title: string, target: number) {
    await addKeyResultFn({ data: { objectiveId, title, target } })
    await refreshGoals()
  }

  // create project — kept
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'tasks' | 'leads'>('tasks')
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setCreateErr(null)
    try {
      const board = await newBoard({ data: { title, workspaceId, kind } })
      setTitle('')
      setCreating(false)
      router.navigate({ to: '/board/$boardId', params: { boardId: board.id } })
    } catch {
      setCreateErr('Could not create project. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // invite (owner) — kept
  const [invEmail, setInvEmail] = useState('')
  const [invMsg, setInvMsg] = useState<string | null>(null)
  const [invLink, setInvLink] = useState<string | null>(null)
  async function onInviteTeam() {
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

  // ---- aggregate real data for the mockup dashboard ----
  const active = projects.filter((p) => p.projectStatus !== 'archived')
  const allTasks = active.flatMap((p) => p.tasks)
  const total = allTasks.length
  const done = allTasks.filter((t) => t.done).length
  const progress = total ? Math.round((done / total) * 100) : 0
  const today = localDateStr()
  const overdue = allTasks.filter((t) => t.due && t.due < today && !t.done).length

  const breakdown = { done: 0, inProgress: 0, todo: 0, blocked: 0, total }
  for (const t of allTasks) {
    if (t.done) breakdown.done++
    else if (/block/i.test(t.status)) breakdown.blocked++
    else if (/progress|doing|review/i.test(t.status)) breakdown.inProgress++
    else breakdown.todo++
  }

  const dashProjects: WsProject[] = active.map((p) => {
    const t = p.tasks.length
    const d = p.tasks.filter((x) => x.done).length
    return { id: p.id, title: p.title, progress: t ? Math.round((d / t) * 100) : 0, members: p.members }
  })

  const TAGC: Record<string, string> = { Finance: '#2563eb', Meeting: '#7c3aed', Content: '#0891b2', Design: '#db2777' }
  const schedule: WsScheduleItem[] = active
    .flatMap((p) => p.tasks.map((t) => ({ task: t, boardId: p.id })))
    .filter(({ task }) => task.due === today && !task.done)
    .slice(0, 5)
    .map(({ task, boardId }) => ({
      id: task.id,
      title: task.title,
      tag: task.label?.name ?? null,
      tagColor: task.label?.color ?? (task.label ? (TAGC[task.label.name] ?? 'var(--ink3)') : 'var(--ink3)'),
      boardId,
    }))

  const dashMembers: WsMember[] = teamMembers.map((m) => ({
    name: m.name,
    role: m.role,
    avatar_url: (m as { avatar_url?: string | null }).avatar_url ?? null,
  }))
  const membersCount =
    teamMembers.length || new Set(active.flatMap((p) => p.members.map((m) => m.name))).size

  const activity: WsActivity[] = announcements.map((a) => ({
    id: a.id,
    author: a.author,
    text: `— ${a.body}`,
    when: new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }))

  return (
    <>
      <WorkspaceDashboard
        workspaceId={workspaceId}
        name={workspaceName}
        progress={progress}
        totalTasks={total}
        overdue={overdue}
        membersCount={membersCount}
        activeProjects={active.length}
        projects={dashProjects}
        schedule={schedule}
        members={dashMembers}
        breakdown={breakdown}
        activity={activity}
        onManageTeam={isWsOwner ? openTeam : () => {}}
        onNewProject={() => setCreating(true)}
      />

      {teamOpen && (
        <TeamPanel
          members={teamMembers}
          meId={meId}
          busy={teamBusy}
          onSetRole={onSetRole}
          onRemove={onRemoveMember}
          onClose={() => setTeamOpen(false)}
          assignedKpis={assignedKpis}
          assignedObjectives={assignedObjectives}
          onAssignKpi={onAssignKpi}
          onReviewKpi={onReviewKpi}
          onReviewKr={onReviewKr}
          onDeleteKpi={onDeleteKpi}
          onDeleteObjective={onDeleteObjective}
          onAssignObjective={onAssignObjective}
          onAddKeyResult={onAddKeyResult}
          inviteEmail={invEmail}
          onInviteEmailChange={setInvEmail}
          onInvite={onInviteTeam}
          inviteMessage={invMsg}
          inviteLink={invLink}
          onSearchAccounts={onSearchAccounts}
          onAddMember={onAddMember}
        />
      )}

      {creating && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCreating(false)}
        >
          <form onSubmit={onCreate} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5">
            <h3 className="display-title mb-3 text-lg font-bold text-[var(--ink)]">New project</h3>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              placeholder="Project name…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field mb-3"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'tasks' | 'leads')}
              className="field mb-3 w-full"
            >
              <option value="tasks">Task board</option>
              <option value="leads">Leads pipeline</option>
            </select>
            {isWsOwner && (
              <div className="mb-3 border-t border-[var(--line)] pt-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
                  Invite member
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="email…"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                    className="field flex-1 text-[13px]"
                  />
                  <button type="button" onClick={onInviteTeam} className="btn btn-ghost btn-square px-3 text-xs">
                    Invite
                  </button>
                </div>
                {invMsg && <p className="mt-1 text-xs font-semibold text-[var(--accent-ink)]">{invMsg}</p>}
                {invLink && (
                  <input
                    readOnly
                    value={invLink}
                    onFocus={(e) => e.target.select()}
                    className="field mt-1 w-full text-[11px]"
                  />
                )}
              </div>
            )}
            {createErr && <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">{createErr}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn btn-primary btn-square flex-1">
                {busy ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setCreating(false)} className="btn btn-ghost btn-square">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

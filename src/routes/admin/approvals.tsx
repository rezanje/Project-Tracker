import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireSuperAdmin } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import {
  approveToBoard,
  approveToWorkspace,
  listAllBoards,
  listAllWorkspaces,
  listPendingProfiles,
  rejectProfile,
  type BoardOption,
  type PendingProfile,
  type WorkspaceOption,
} from '#/lib/approvals'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchApprovals = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  await requireSuperAdmin(getRequest(), headers)
  const svc = getServiceSupabase()
  const [pending, workspaces, boards] = await Promise.all([
    listPendingProfiles(svc),
    listAllWorkspaces(svc),
    listAllBoards(svc),
  ])
  flush(headers)
  return { pending, workspaces, boards }
})

const approveWorkspaceFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { userId, workspaceId, role } = (d ?? {}) as {
      userId?: unknown
      workspaceId?: unknown
      role?: unknown
    }
    if (typeof userId !== 'string' || typeof workspaceId !== 'string')
      throw new Error('userId and workspaceId required')
    return { userId, workspaceId, role: role === 'owner' ? ('owner' as const) : ('member' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    await requireSuperAdmin(getRequest(), headers)
    await approveToWorkspace(getServiceSupabase(), data.userId, data.workspaceId, data.role)
    flush(headers)
  })

const approveBoardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { userId, boardId, role } = (d ?? {}) as {
      userId?: unknown
      boardId?: unknown
      role?: unknown
    }
    if (typeof userId !== 'string' || typeof boardId !== 'string')
      throw new Error('userId and boardId required')
    return { userId, boardId, role: role === 'client' ? ('client' as const) : ('member' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    await requireSuperAdmin(getRequest(), headers)
    await approveToBoard(getServiceSupabase(), data.userId, data.boardId, data.role)
    flush(headers)
  })

const rejectFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { userId } = (d ?? {}) as { userId?: unknown }
    if (typeof userId !== 'string') throw new Error('userId required')
    return { userId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    await requireSuperAdmin(getRequest(), headers)
    await rejectProfile(getServiceSupabase(), data.userId)
    flush(headers)
  })

export const Route = createFileRoute('/admin/approvals')({
  component: Approvals,
  loader: async () => await fetchApprovals(),
})

type Target = 'workspace' | 'board'

function ApprovalRow({
  applicant,
  workspaces,
  boards,
  onApproved,
}: {
  applicant: PendingProfile
  workspaces: WorkspaceOption[]
  boards: BoardOption[]
  onApproved: () => void
}) {
  const [target, setTarget] = useState<Target>('workspace')
  const [id, setId] = useState(workspaces[0]?.id ?? '')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function onTargetChange(next: Target) {
    setTarget(next)
    setId(next === 'workspace' ? (workspaces[0]?.id ?? '') : (boards[0]?.id ?? ''))
    setRole('member')
  }

  async function onApprove() {
    if (!id) return
    setBusy(true)
    setErr(null)
    try {
      if (target === 'workspace') {
        await approveWorkspaceFn({ data: { userId: applicant.id, workspaceId: id, role } })
      } else {
        await approveBoardFn({ data: { userId: applicant.id, boardId: id, role } })
      }
      onApproved()
    } catch {
      setErr('Approval failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!confirm(`Reject ${applicant.email ?? applicant.name ?? 'this signup'}?`)) return
    setBusy(true)
    setErr(null)
    try {
      await rejectFn({ data: { userId: applicant.id } })
      onApproved()
    } catch {
      setErr('Reject failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const options = target === 'workspace' ? workspaces : boards
  const roleOptions = target === 'workspace' ? ['owner', 'member'] : ['member', 'client']

  return (
    <li className="card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-bold text-[var(--ink)]">{applicant.name ?? 'Unnamed'}</div>
        <div className="text-[12px] text-[var(--ink3)]">{applicant.email ?? '—'}</div>
      </div>
      <select
        value={target}
        onChange={(e) => onTargetChange(e.target.value as Target)}
        className="field w-auto"
      >
        <option value="workspace">Workspace</option>
        <option value="board">Board</option>
      </select>
      <select value={id} onChange={(e) => setId(e.target.value)} className="field w-auto min-w-[160px]">
        {options.length === 0 && <option value="">No {target}s yet</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {'name' in o ? o.name : o.title}
          </option>
        ))}
      </select>
      <select value={role} onChange={(e) => setRole(e.target.value)} className="field w-auto">
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy || !id}
        className="btn btn-primary btn-square"
      >
        {busy ? 'Approving…' : 'Approve'}
      </button>
      <button type="button" onClick={onReject} disabled={busy} className="btn btn-danger btn-square">
        Reject
      </button>
      {err && (
        <p className="w-full text-[13px] font-semibold text-[var(--danger)]">{err}</p>
      )}
    </li>
  )
}

function Approvals() {
  const router = useRouter()
  const { pending, workspaces, boards } = Route.useLoaderData()

  return (
    <main className="page-wrap pb-32 pt-9 gt-fade">
      <h1 className="display-title mb-2 text-3xl font-extrabold text-[var(--ink)]">
        Pending approvals
      </h1>
      <p className="mb-8 text-[15px] text-[var(--ink2)]">
        {pending.length} account{pending.length === 1 ? '' : 's'} waiting for a workspace or board grant.
      </p>
      {pending.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--ink3)]">Nothing pending.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((p) => (
            <ApprovalRow
              key={p.id}
              applicant={p}
              workspaces={workspaces}
              boards={boards}
              onApproved={() => router.invalidate()}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

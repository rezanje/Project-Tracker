import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { TeamMember, AddableAccount } from '#/lib/workspaces'
import type { AssignedKpi, AssignedObjective } from '#/lib/goals'
import { AssignedGoalsCard } from './Goals'

interface Props {
  members: TeamMember[]
  meId: string
  busy: boolean
  onSetRole: (userId: string, role: 'owner' | 'member') => void
  onRemove: (userId: string) => void
  onClose: () => void
  assignedKpis: AssignedKpi[]
  assignedObjectives: AssignedObjective[]
  onAssignKpi: (assigneeId: string, name: string, target: number, unit: string, startDate: string, endDate: string) => void
  onReviewKpi: (checkinId: string, approve: boolean) => void
  onReviewKr: (checkinId: string, approve: boolean) => void
  onDeleteKpi: (id: string) => void
  onDeleteObjective: (id: string) => void
  onAssignObjective: (assigneeId: string, title: string, startDate: string, endDate: string) => void
  onAddKeyResult: (objectiveId: string, title: string, target: number) => void
  inviteEmail: string
  onInviteEmailChange: (email: string) => void
  onInvite: () => void
  inviteMessage: string | null
  inviteLink: string | null
  onSearchAccounts: (query: string) => Promise<AddableAccount[]>
  onAddMember: (userId: string) => Promise<void>
}

function initials(name: string | null, email: string | null): string {
  const s = name?.trim() || email || '?'
  const parts = s.split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s.slice(0, 2).toUpperCase()
}

function AssignKpiForm({ members, onAssign }: { members: TeamMember[]; onAssign: Props['onAssignKpi'] }) {
  const [open, setOpen] = useState(false)
  const [assigneeId, setAssigneeId] = useState(members[0]?.user_id ?? '')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-square mb-4 w-full text-xs">
        Assign KPI
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!assigneeId || !name.trim()) return
        onAssign(assigneeId, name.trim(), Number(target) || 0, unit.trim(), startDate, endDate)
        setOpen(false)
        setName('')
        setTarget('')
        setUnit('')
        setStartDate('')
        setEndDate('')
      }}
      className="mb-4 flex flex-col gap-2 rounded-[12px] border border-[var(--line)] p-3"
    >
      <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field text-[13px]">
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id}</option>
        ))}
      </select>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="KPI name" className="field text-[13px]" />
      <div className="flex gap-2">
        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" placeholder="Target" className="field w-24 text-[13px]" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" className="field flex-1 text-[13px]" />
      </div>
      <div className="flex gap-2">
        <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="field flex-1 text-[13px]" />
        <input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date" className="field flex-1 text-[13px]" />
      </div>
      <button type="submit" className="btn btn-primary btn-square text-xs">Assign</button>
    </form>
  )
}

function AssignObjectiveForm({ members, onAssign }: { members: TeamMember[]; onAssign: Props['onAssignObjective'] }) {
  const [open, setOpen] = useState(false)
  const [assigneeId, setAssigneeId] = useState(members[0]?.user_id ?? '')
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-square mb-4 w-full text-xs">
        Assign Objective
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!assigneeId || !title.trim()) return
        onAssign(assigneeId, title.trim(), startDate, endDate)
        setOpen(false)
        setTitle('')
        setStartDate('')
        setEndDate('')
      }}
      className="mb-4 flex flex-col gap-2 rounded-[12px] border border-[var(--line)] p-3"
    >
      <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field text-[13px]">
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id}</option>
        ))}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Objective title" className="field text-[13px]" />
      <div className="flex gap-2">
        <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="field flex-1 text-[13px]" />
        <input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date" className="field flex-1 text-[13px]" />
      </div>
      <button type="submit" className="btn btn-primary btn-square text-xs">Assign</button>
    </form>
  )
}

export default function TeamPanel({
  members, meId, busy, onSetRole, onRemove, onClose,
  assignedKpis, assignedObjectives, onAssignKpi, onReviewKpi, onReviewKr, onDeleteKpi, onDeleteObjective,
  onAssignObjective, onAddKeyResult,
  inviteEmail, onInviteEmailChange, onInvite, inviteMessage, inviteLink,
  onSearchAccounts, onAddMember,
}: Props) {
  const isOwner = members.find((m) => m.user_id === meId)?.role === 'owner'
  const [searchResults, setSearchResults] = useState<AddableAccount[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = inviteEmail.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await onSearchAccounts(q)
      setSearchResults(results)
      setSearching(false)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteEmail])

  async function handleAdd(userId: string) {
    await onAddMember(userId)
    onInviteEmailChange('')
    setSearchResults([])
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[640px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">
            Team · {members.length}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <ul className="mb-4 flex flex-col divide-y divide-[var(--line)]">
          {members.map((m) => {
            const isMe = m.user_id === meId
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-bold text-white">
                  {initials(m.name, m.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[var(--ink)]">
                    {m.name ?? m.email ?? 'Unknown'} {isMe && <span className="text-[var(--ink3)]">(you)</span>}
                  </div>
                  {m.email && (
                    <div className="truncate text-[12px] text-[var(--ink3)]">{m.email}</div>
                  )}
                </div>
                <select
                  value={m.role}
                  disabled={isMe || busy}
                  onChange={(e) => onSetRole(m.user_id, e.target.value as 'owner' | 'member')}
                  className="field w-auto rounded-full px-3 py-1.5 text-[13px] disabled:opacity-60"
                >
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                </select>
                <button
                  type="button"
                  disabled={isMe || busy}
                  onClick={() => onRemove(m.user_id)}
                  className="btn btn-danger btn-square shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            )
          })}
          {members.length === 0 && (
            <li className="py-6 text-center text-sm text-[var(--ink3)]">No members yet.</li>
          )}
        </ul>

        {isOwner && (
          <div className="mb-4 border-t border-[var(--line)] pt-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
              Invite member
            </p>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="name or email…"
                  value={inviteEmail}
                  onChange={(e) => onInviteEmailChange(e.target.value)}
                  className="field flex-1 text-[13px]"
                />
                <button type="button" onClick={onInvite} className="btn btn-ghost btn-square px-3 text-xs">
                  Invite
                </button>
              </div>
              {(searching || searchResults.length > 0) && (
                <div className="absolute left-0 right-[86px] top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[12px] border border-[var(--line)] bg-[var(--card)] shadow-[0_12px_30px_-10px_rgba(16,28,22,0.35)]">
                  {searching && (
                    <p className="px-3 py-2 text-xs text-[var(--ink3)]">Searching…</p>
                  )}
                  {!searching && searchResults.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleAdd(a.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                        {initials(a.name, null)}
                      </span>
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {inviteMessage && <p className="mt-1 text-xs font-semibold text-[var(--accent-ink)]">{inviteMessage}</p>}
            {inviteLink && (
              <input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.target.select()}
                className="field mt-1 w-full text-[11px]"
              />
            )}
          </div>
        )}

        <div className="border-t border-[var(--line)] pt-4">
          <h3 className="display-title mb-2 text-[15px] font-bold text-[var(--ink)]">KPIs</h3>
          <AssignKpiForm members={members} onAssign={onAssignKpi} />
          <h3 className="display-title mb-2 text-[15px] font-bold text-[var(--ink)]">Objectives</h3>
          <AssignObjectiveForm members={members} onAssign={onAssignObjective} />
          <AssignedGoalsCard
            kpis={assignedKpis}
            objectives={assignedObjectives}
            onReviewKpi={onReviewKpi}
            onReviewKr={onReviewKr}
            onDeleteKpi={onDeleteKpi}
            onDeleteObjective={onDeleteObjective}
            onAddKeyResult={onAddKeyResult}
          />
        </div>
      </div>
    </div>
  )
}

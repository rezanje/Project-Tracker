import { useState } from 'react'
import { X, Check, Clock } from 'lucide-react'
import type { Kpi, Kr, Objective, AssignedKpi, AssignedObjective } from '#/lib/goals'

const pct = (c: number, t: number) => (t ? Math.min(100, Math.round((c / t) * 100)) : 0)

// ---- Assignee view: my own KPIs/Objectives, with a check-in action ----

interface AssigneeProps {
  kpis: Kpi[]
  objectives: Objective[]
  onCheckinKpi: (kpiId: string, proposedValue: number, note: string) => void
  onCheckinKr: (krId: string, proposedValue: number, note: string) => void
}

function CheckinForm({ onSubmit }: { onSubmit: (value: number, note: string) => void }) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-square px-2 text-[11px]">
        Check in
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!value) return
        onSubmit(Number(value), note)
        setOpen(false)
        setValue('')
        setNote('')
      }}
      className="mt-2 flex flex-wrap gap-2 gt-fade"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="number"
        placeholder="New value"
        aria-label="New value"
        autoFocus
        className="field w-24 text-[12px]"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note (optional)"
        className="field flex-1 text-[12px]"
      />
      <button type="submit" className="btn btn-primary btn-square px-3 text-xs">Submit</button>
    </form>
  )
}

export function MyGoalsCard({ kpis, objectives, onCheckinKpi, onCheckinKr }: AssigneeProps) {
  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">My KPIs</h3>
        {kpis.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">No KPIs assigned yet.</p>}
        <ul className="flex flex-col gap-3">
          {kpis.map((k) => (
            <li key={k.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--ink)]">{k.name}</span>
                <span className="text-[var(--ink3)]">{k.current} / {k.target} {k.unit ?? ''}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct(k.current, k.target)}%` }} />
              </div>
              {k.pending ? (
                <div className="mt-1.5">
                  <span
                    className="chip gap-1 text-[11px]"
                    style={{ background: 'var(--pop-soft)', color: 'var(--pop-ink)', borderColor: 'var(--pop-ink)' }}
                  >
                    <Clock size={11} />
                    Pending review: {k.pending.proposedValue}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5">
                  <CheckinForm onSubmit={(value, note) => onCheckinKpi(k.id, value, note)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">My Objectives</h3>
        {objectives.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">No objectives assigned yet.</p>}
        <ul className="flex flex-col gap-4">
          {objectives.map((o) => (
            <li key={o.id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--ink)]">{o.title}</span>
                <span className="text-[12px] font-semibold text-[var(--ink3)]">{o.progress}%</span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${o.progress}%` }} />
              </div>
              <ul className="flex flex-col gap-2 pl-3">
                {o.krs.map((k) => (
                  <li key={k.id} className="text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[var(--ink2)]">{k.title}</span>
                      <span className="text-[var(--ink3)]">{k.current} / {k.target}</span>
                    </div>
                    {k.pending ? (
                      <div className="mt-1">
                        <span
                          className="chip gap-1 text-[11px]"
                          style={{ background: 'var(--pop-soft)', color: 'var(--pop-ink)', borderColor: 'var(--pop-ink)' }}
                        >
                          <Clock size={11} />
                          Pending review: {k.pending.proposedValue}
                        </span>
                      </div>
                    ) : (
                      <CheckinForm onSubmit={(value, note) => onCheckinKr(k.id, value, note)} />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---- Owner view: everyone this owner assigned, with approve/reject ----

interface OwnerProps {
  kpis: AssignedKpi[]
  objectives: AssignedObjective[]
  onReviewKpi: (checkinId: string, approve: boolean) => void
  onReviewKr: (checkinId: string, approve: boolean) => void
  onDeleteKpi: (id: string) => void
  onDeleteObjective: (id: string) => void
  onAddKeyResult: (objectiveId: string, title: string, target: number) => void
}

function ReviewRow({ pending, onReview }: { pending: Kr['pending']; onReview: (checkinId: string, approve: boolean) => void }) {
  if (!pending) return null
  return (
    <div className="mt-1.5 flex items-center gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--col)] p-2 text-[11px] gt-fade">
      <span className="flex-1">Proposed: <b>{pending.proposedValue}</b>{pending.note ? ` — ${pending.note}` : ''}</span>
      <button
        type="button"
        onClick={() => onReview(pending.id, true)}
        aria-label="Approve"
        className="rounded-full p-1 text-[var(--accent-ink)] hover:bg-[var(--card)] hover:opacity-70"
      >
        <Check size={15} />
      </button>
      <button
        type="button"
        onClick={() => onReview(pending.id, false)}
        aria-label="Reject"
        className="rounded-full p-1 text-[var(--danger)] hover:bg-[var(--card)] hover:opacity-70"
      >
        <X size={15} />
      </button>
    </div>
  )
}

function AddKrForm({ onAdd }: { onAdd: (title: string, target: number) => void }) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-square px-2 text-[11px]">
        ＋ Key result
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onAdd(title.trim(), Number(target) || 100)
        setOpen(false)
        setTitle('')
        setTarget('')
      }}
      className="mt-2 flex flex-wrap gap-2 gt-fade"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Key result title"
        aria-label="Key result title"
        autoFocus
        className="field flex-1 text-[12px]"
      />
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        type="number"
        placeholder="Target"
        aria-label="Target"
        className="field w-24 text-[12px]"
      />
      <button type="submit" className="btn btn-primary btn-square px-3 text-xs">Add</button>
    </form>
  )
}

export function AssignedGoalsCard({ kpis, objectives, onReviewKpi, onReviewKr, onDeleteKpi, onDeleteObjective, onAddKeyResult }: OwnerProps) {
  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">Assigned KPIs</h3>
        {kpis.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">Nothing assigned yet.</p>}
        <ul className="flex flex-col gap-3">
          {kpis.map((k) => (
            <li key={k.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--ink)]">{k.name} <span className="font-normal text-[var(--ink3)]">— {k.assigneeName ?? 'Unassigned'}</span></span>
                <span className="flex items-center gap-2 text-[var(--ink3)]">
                  {k.current} / {k.target} {k.unit ?? ''}
                  <button type="button" onClick={() => onDeleteKpi(k.id)} aria-label="Delete KPI" className="text-[var(--ink3)] hover:text-[var(--danger)]">
                    <X size={14} />
                  </button>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct(k.current, k.target)}%` }} />
              </div>
              <ReviewRow pending={k.pending} onReview={onReviewKpi} />
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">Assigned Objectives</h3>
        {objectives.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">Nothing assigned yet.</p>}
        <ul className="flex flex-col gap-4">
          {objectives.map((o) => (
            <li key={o.id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--ink)]">{o.title} <span className="font-normal text-[var(--ink3)]">— {o.assigneeName ?? 'Unassigned'}</span></span>
                <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ink3)]">
                  {o.progress}%
                  <button type="button" onClick={() => onDeleteObjective(o.id)} aria-label="Delete objective" className="hover:text-[var(--danger)]">
                    <X size={14} />
                  </button>
                </span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${o.progress}%` }} />
              </div>
              <ul className="flex flex-col gap-2 pl-3">
                {o.krs.map((k) => (
                  <li key={k.id} className="text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[var(--ink2)]">{k.title}</span>
                      <span className="text-[var(--ink3)]">{k.current} / {k.target}</span>
                    </div>
                    <ReviewRow pending={k.pending} onReview={onReviewKr} />
                  </li>
                ))}
              </ul>
              <div className="pl-3">
                <AddKrForm onAdd={(title, target) => onAddKeyResult(o.id, title, target)} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

import { useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Flag,
  FileText,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { Clock, Flame, ListChecks } from '@/components/pixel-icons'
import { localDateStr } from '#/lib/home'

// ponytail: board chrome around the real kanban. Stats + Team + Budget value are
// real (passed from the route); roadmap milestones are real too (board_milestones,
// owner-managed). Activity feed, Files list, and the spent-% are still static
// mockup placeholders until those data sources exist. AI panel
// is a Coming Soon shell.

type Member = { id?: string | null; name?: string | null; email?: string | null; role?: string | null }

const AVATAR_TINTS = ['#7c3aed', '#2563eb', '#db2777', '#0891b2', '#d97706', '#1f9d55']
function initials(m: Member): string {
  const base = (m.name ?? m.email ?? '?').trim()
  const parts = base.split(/[.\-_\s@]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)
  return chars.toUpperCase() || '?'
}

export function BoardStats({
  dueToday,
  overdue,
  completed,
  total,
  members,
  budgetIdr,
}: {
  dueToday: number
  overdue: number
  completed: number
  total: number
  members: number
  budgetIdr: number | null
}) {
  const cells = [
    { icon: Flame, n: dueToday, label: 'Due today', tint: '#d97706' },
    { icon: Clock, n: overdue, label: 'Overdue', tint: 'var(--danger)' },
    { icon: CheckCircle2, n: completed, label: 'Completed', tint: 'var(--accent)' },
    { icon: ListChecks, n: total, label: 'Total tasks', tint: '#2563eb' },
    { icon: Users, n: members, label: 'Members', tint: '#7c3aed' },
  ]
  return (
    <div className="card mx-auto mb-5 flex max-w-[1400px] flex-wrap items-stretch p-0">
      {cells.map(({ icon: Icon, n, label, tint }, i) => (
        <div
          key={label}
          className={`flex min-w-[120px] flex-1 items-center gap-2.5 px-4 py-3 ${
            i > 0 ? 'border-l-2 border-[var(--line)]' : ''
          }`}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--ink)]"
            style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
          >
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <p className="display-title text-lg font-extrabold leading-none text-[var(--ink)]">{n}</p>
            <p className="truncate text-[11px] font-semibold text-[var(--ink2)]">{label}</p>
          </div>
        </div>
      ))}
      {budgetIdr != null && (
        <div className="flex min-w-[180px] flex-[1.4] flex-col justify-center gap-1 border-l-2 border-[var(--line)] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink2)]">
            <Wallet size={14} className="text-[var(--accent)]" /> Budget
          </span>
          <p className="display-title text-sm font-extrabold leading-none text-[var(--ink)]">
            Rp {budgetIdr.toLocaleString('id-ID')}
          </p>
          <p className="text-[10px] text-[var(--ink3)]">Spend tracking coming soon</p>
        </div>
      )}
    </div>
  )
}

function RailCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Activity
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="card p-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <Icon size={13} /> {title}
      </h3>
      {children}
    </section>
  )
}

const ACTIVITY = [
  { who: 'Reza Rahman', what: 'moved Packaging box', when: '2 min ago' },
  { who: 'Dimas Ardi', what: 'uploaded logo.ai', when: '15 min ago' },
  { who: 'Nadia Putri', what: 'commented on Pengujian kualitas', when: '1 hour ago' },
]
const FILES = [
  { name: 'logo.ai', size: '2.4 MB' },
  { name: 'spec_produksi.pdf', size: '1.2 MB' },
  { name: 'budget.xlsx', size: '28 KB' },
  { name: 'brand_guide.psd', size: '18 MB' },
]

export function BoardRail({
  members,
  budgetIdr,
}: {
  members: Member[]
  budgetIdr: number | null
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 xl:flex">
      {/* AI assistant — Coming Soon */}
      <section className="card relative overflow-hidden p-3.5">
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          <Sparkles size={13} className="text-[var(--accent)]" /> AI Project Assistant
        </h3>
        <div className="pointer-events-none space-y-1.5 opacity-40 blur-[1.5px]">
          <p className="text-[13px] font-bold text-[var(--ink)]">Project is on track! 🎉</p>
          <p className="text-[12px] text-[var(--ink3)]">2 tasks due today · 1 overdue</p>
          <p className="text-[12px] text-[var(--ink3)]">Estimated completion: 23 July</p>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="chip bg-[var(--pop-soft)] text-[var(--pop-ink)]"
            style={{ borderColor: 'var(--pop-ink)' }}
          >
            🤖 Coming Soon
          </span>
        </div>
      </section>

      <RailCard icon={Activity} title="Activity Feed">
        <div className="flex flex-col gap-2">
          {ACTIVITY.map((a) => (
            <div key={a.what} className="flex gap-2">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: AVATAR_TINTS[a.who.length % AVATAR_TINTS.length] }}
              >
                {a.who.split(' ').map((s) => s[0]).join('').slice(0, 2)}
              </span>
              <p className="text-[12px] leading-snug text-[var(--ink2)]">
                <b className="text-[var(--ink)]">{a.who}</b> {a.what}
                <span className="block text-[10px] text-[var(--ink3)]">{a.when}</span>
              </p>
            </div>
          ))}
        </div>
      </RailCard>

      <RailCard icon={FileText} title="Files">
        <div className="flex flex-col gap-1.5">
          {FILES.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <FileText size={14} className="shrink-0 text-[var(--ink3)]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--ink)]">{f.name}</span>
              <span className="shrink-0 text-[10px] text-[var(--ink3)]">{f.size}</span>
            </div>
          ))}
        </div>
      </RailCard>

      {budgetIdr != null && (
        <RailCard icon={Wallet} title="Budget">
          <p className="display-title text-lg font-extrabold text-[var(--ink)]">
            Rp {budgetIdr.toLocaleString('id-ID')}
          </p>
          <p className="mt-1 text-[11px] text-[var(--ink3)]">Spend tracking coming soon</p>
        </RailCard>
      )}

      <RailCard icon={Users} title="Team">
        <div className="flex flex-col gap-2">
          {members.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No members yet</p>}
          {members.slice(0, 6).map((m, i) => (
            <div key={m.id ?? i} className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: AVATAR_TINTS[i % AVATAR_TINTS.length] }}
              >
                {initials(m)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-[var(--ink)]">{m.name ?? m.email ?? 'Member'}</p>
                {m.role && <p className="truncate text-[10px] capitalize text-[var(--ink3)]">{m.role}</p>}
              </div>
            </div>
          ))}
        </div>
      </RailCard>
    </aside>
  )
}

export type BoardMilestone = { id: string; label: string; start_date: string; end_date: string }

function fmtRange(start: string, end: string): string {
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export function BoardRoadmap({
  milestones,
  isOwner,
  onAdd,
  onDelete,
}: {
  milestones: BoardMilestone[]
  isOwner: boolean
  onAdd: (label: string, startDate: string, endDate: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const today = localDateStr()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !startDate || !endDate) return
    setSaving(true)
    try {
      await onAdd(label.trim(), startDate, endDate)
      setLabel('')
      setStartDate('')
      setEndDate('')
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card mx-auto mt-5 max-w-[1400px] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          <Flag size={13} /> Roadmap / Milestone
        </h3>
        {isOwner && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline"
          >
            {adding ? 'Cancel' : '+ Add milestone'}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
          <input
            autoFocus
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="field w-40"
          />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="field" />
          <button type="submit" disabled={saving} className="btn btn-primary px-3 py-1.5 text-[12px]">
            {saving ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
      {milestones.length === 0 ? (
        <p className="text-[12px] text-[var(--ink3)]">No milestones yet.</p>
      ) : (
        <div className="flex items-start gap-2 overflow-x-auto">
          {milestones.map((m, i) => {
            const done = m.end_date < today
            const active = !done && m.start_date <= today
            return (
              <div key={m.id} className="group flex flex-1 items-start gap-2">
                <div className="flex min-w-[120px] flex-col items-center gap-1.5 text-center">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--ink)] text-[12px] font-bold"
                    style={
                      done
                        ? { background: 'var(--accent)', color: '#fff' }
                        : active
                          ? { background: 'var(--pop)', color: 'var(--pop-ink)' }
                          : { background: 'var(--col)', color: 'var(--ink3)' }
                    }
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <p className="text-[12px] font-bold text-[var(--ink)]">{m.label}</p>
                  <p className="text-[10px] text-[var(--ink3)]">{fmtRange(m.start_date, m.end_date)}</p>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => onDelete(m.id)}
                      className="text-[10px] font-semibold text-[var(--danger)] opacity-0 group-hover:opacity-100"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {i < milestones.length - 1 && (
                  <span className="mt-4 h-0.5 flex-1 bg-[var(--line)]" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

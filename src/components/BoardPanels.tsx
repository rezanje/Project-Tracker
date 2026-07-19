import { useEffect, useState } from 'react'
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
import type { ActivityItem, FileItem } from '#/lib/board-data'

// ponytail: board chrome around the real kanban. Stats + Team + Budget value are
// real (passed from the route); roadmap milestones are real too (board_milestones,
// owner-managed). Activity feed and Files list are real too (comments +
// attachment uploads, merged by time — card moves aren't included, no
// move-history table exists). The spent-% is still a static mockup
// placeholder until that data source exists. AI panel is a Coming Soon shell.

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hour${secs < 7200 ? '' : 's'} ago`
  return `${Math.floor(secs / 86400)} day${secs < 172800 ? '' : 's'} ago`
}

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
  action,
  children,
}: {
  icon: typeof Activity
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          <Icon size={13} /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ActivityList({
  items,
  onItemClick,
}: {
  items: ActivityItem[]
  onItemClick: (cardId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onItemClick(a.cardId)}
          className="flex gap-2 rounded-lg p-1 -m-1 text-left hover:bg-[var(--col)]"
        >
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: AVATAR_TINTS[a.authorName.length % AVATAR_TINTS.length] }}
          >
            {a.authorName.split(' ').map((s) => s[0]).join('').slice(0, 2)}
          </span>
          <p className="text-[12px] leading-snug text-[var(--ink2)]">
            <b className="text-[var(--ink)]">{a.authorName}</b> {a.text}
            <span className="block text-[10px] text-[var(--ink3)]">{timeAgo(a.createdAt)}</span>
          </p>
        </button>
      ))}
    </div>
  )
}

function LogModal({
  icon: Icon,
  title,
  onClose,
  children,
}: {
  icon: typeof Activity
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-md flex-col p-3.5"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
            <Icon size={13} /> {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[11px] font-bold text-[var(--ink3)] hover:text-[var(--ink)]"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  )
}

function FilesList({
  items,
  onItemClick,
}: {
  items: FileItem[]
  onItemClick: (cardId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onItemClick(f.cardId)}
          className="flex w-full items-center gap-2 rounded-lg p-1 -m-1 text-left hover:bg-[var(--col)]"
        >
          <FileText size={14} className="shrink-0 text-[var(--ink3)]" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--ink)]">
            {f.filename}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--ink3)]">{timeAgo(f.createdAt)}</span>
        </button>
      ))}
    </div>
  )
}

export function BoardRail({
  members,
  budgetIdr,
  activity,
  onActivityClick,
  files,
  onFileClick,
}: {
  members: Member[]
  budgetIdr: number | null
  activity: ActivityItem[]
  onActivityClick: (cardId: string) => void
  files: FileItem[]
  onFileClick: (cardId: string) => void
}) {
  const [logOpen, setLogOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const preview = activity.slice(0, 8)
  const filesPreview = files.slice(0, 5)

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

      <RailCard
        icon={Activity}
        title="Activity Feed"
        action={
          activity.length > 0 && (
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              className="shrink-0 text-[10px] font-bold text-[var(--accent-ink)] hover:underline"
            >
              View all
            </button>
          )
        }
      >
        {activity.length === 0 ? (
          <p className="text-[12px] text-[var(--ink3)]">No activity yet.</p>
        ) : (
          <ActivityList items={preview} onItemClick={onActivityClick} />
        )}
      </RailCard>

      {logOpen && (
        <LogModal icon={Activity} title="Activity log" onClose={() => setLogOpen(false)}>
          <ActivityList
            items={activity}
            onItemClick={(cardId) => {
              setLogOpen(false)
              onActivityClick(cardId)
            }}
          />
        </LogModal>
      )}

      <RailCard
        icon={FileText}
        title="Files"
        action={
          files.length > 0 && (
            <button
              type="button"
              onClick={() => setFilesOpen(true)}
              className="shrink-0 text-[10px] font-bold text-[var(--accent-ink)] hover:underline"
            >
              View all
            </button>
          )
        }
      >
        {files.length === 0 ? (
          <p className="text-[12px] text-[var(--ink3)]">No files yet.</p>
        ) : (
          <FilesList items={filesPreview} onItemClick={onFileClick} />
        )}
      </RailCard>

      {filesOpen && (
        <LogModal icon={FileText} title="Files" onClose={() => setFilesOpen(false)}>
          <FilesList
            items={files}
            onItemClick={(cardId) => {
              setFilesOpen(false)
              onFileClick(cardId)
            }}
          />
        </LogModal>
      )}

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

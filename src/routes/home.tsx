import { useMemo, useState, type ComponentType } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  AlarmClock,
  CheckSquare,
  Flame,
  FolderPlus,
  Megaphone,
  MoreVertical,
  Plus,
  StickyNote,
  Target,
} from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { fetchDashboard, type DashboardData, type DashProjectMember } from '#/lib/dashboard'
import { deleteNoteFn } from '#/lib/actions'
import {
  fetchMyGoalsFn,
  submitKpiCheckinFn,
  submitKrCheckinFn,
  selfAssignKpiFn,
  selfAssignObjectiveFn,
  type MyGoals,
} from '#/lib/goals'
import { MyGoalsCard } from '#/components/Goals'
import Popover from '#/components/Popover'
import QuickTaskForm from '#/components/QuickTaskForm'
import QuickProjectForm from '#/components/QuickProjectForm'
import QuickNoteForm from '#/components/QuickNoteForm'
import QuickReminderForm from '#/components/QuickReminderForm'
import NoteDetail from '#/components/NoteDetail'

// ponytail: Home wires the schema-backed data (today tasks, active
// projects, KPI headline numbers, project progress, announcements, notes).
// Pomodoro is functional; Music and the KPI mini-bar shapes stay static (no
// source / a later slice).

export const Route = createFileRoute('/home')({
  loader: async () => {
    const [dashboard, goals] = await Promise.all([fetchDashboard(), fetchMyGoalsFn()])
    return { dashboard, goals }
  },
  component: Home,
})

function QuickTile({
  label,
  icon: Icon,
  panel,
}: {
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  panel: (close: () => void) => React.ReactNode
}) {
  return (
    <Popover
      panelClassName="w-64"
      renderTrigger={(_open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className="flex flex-col items-center gap-2 text-center"
        >
          <span className="flex h-[52px] w-full items-center justify-center rounded-[16px] bg-[var(--col)] text-[var(--ink)] transition-colors hover:bg-[var(--sunk)]">
            <Icon size={19} />
          </span>
          <span className="text-[11.5px] font-semibold text-[var(--ink2)]">{label}</span>
        </button>
      )}
      renderPanel={panel}
    />
  )
}

const KPI_BARS = [4, 6, 5, 7, 6, 8, 9]

function fmtRupiah(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`
  return `Rp ${n.toLocaleString('id-ID')}`
}

/** Continuous progress track. */
function Bar({ pct, color = 'var(--ink)' }: { pct: number; color?: string }) {
  return (
    <div className="progress-track w-full">
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  )
}

/** Bar sparkline. The tallest column carries the one accent; the rest are tone. */
function MiniBars({ data, className = 'h-8' }: { data: number[]; className?: string }) {
  const max = Math.max(...data)
  return (
    <div className={`flex items-end gap-1.5 ${className}`}>
      {data.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[3px]"
          style={{
            height: `${(v / max) * 100}%`,
            background: v === max ? 'var(--accent)' : 'var(--sunk)',
          }}
        />
      ))}
    </div>
  )
}

function Donut({ pct }: { pct: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--col)" strokeWidth="12" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="53" textAnchor="middle" className="fill-[var(--ink)] text-lg font-extrabold">
        {pct}%
      </text>
    </svg>
  )
}

function ProjectAvatars({ members }: { members: DashProjectMember[] }) {
  if (members.length === 0) return null
  const shown = members.slice(0, 3)
  return (
    <span className="avatar-stack">
      {shown.map((m) => (
        <span
          key={m.id}
          title={m.name}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-bold text-[var(--card)]"
          style={{ background: accentFor(m.id) }}
        >
          {m.avatar_url ? (
            <img src={m.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            (m.name.trim().split(/\s+/)[0]?.[0] ?? '?').toUpperCase()
          )}
        </span>
      ))}
      {members.length > 3 && (
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--sunk)] text-[9px] font-bold text-[var(--ink2)]">
          +{members.length - 3}
        </span>
      )}
    </span>
  )
}

function SelfGoalForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'kpi' | 'objective'>('kpi')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (kind === 'kpi') {
        await selfAssignKpiFn({
          data: { name: name.trim(), target: Number(target) || 0, unit, startDate, endDate },
        })
      } else {
        await selfAssignObjectiveFn({ data: { title: name.trim(), startDate, endDate } })
      }
      router.invalidate()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save goal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
        <Target size={14} aria-hidden="true" /> New goal
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setKind('kpi')}
          className={`btn btn-square flex-1 text-xs ${kind === 'kpi' ? 'btn-primary' : 'btn-ghost'}`}
        >
          KPI
        </button>
        <button
          type="button"
          onClick={() => setKind('objective')}
          className={`btn btn-square flex-1 text-xs ${kind === 'objective' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Objective
        </button>
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={kind === 'kpi' ? 'KPI name' : 'Objective title'}
        className="field text-[13px]"
      />
      {kind === 'kpi' && (
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            type="number"
            placeholder="Target"
            className="field w-24 text-[13px]"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit"
            className="field flex-1 text-[13px]"
          />
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          type="date"
          className="field flex-1 text-[13px]"
        />
        <input
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          type="date"
          className="field flex-1 text-[13px]"
        />
      </div>
      {error && <p className="text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !name.trim()} className="btn btn-primary btn-square w-full">
        {saving ? 'Saving…' : 'Add goal'}
      </button>
    </form>
  )
}

function Home() {
  const { dashboard: d, goals } = Route.useLoaderData() as { dashboard: DashboardData; goals: MyGoals }
  const router = useRouter()

  async function removeNote(id: string) {
    if (!window.confirm('Delete this note?')) return
    await deleteNoteFn({ data: { id } })
    router.invalidate()
  }

  const [noteSort, setNoteSort] = useState<'newest' | 'oldest' | 'category'>('newest')
  const [selectedNote, setSelectedNote] = useState<DashboardData['notes'][number] | null>(null)

  const noteCategories = useMemo(
    () => Array.from(new Set(d.notes.map((n) => n.category).filter((c): c is string => !!c))).sort(),
    [d.notes],
  )

  const sortedNotes = useMemo(() => {
    const arr = [...d.notes]
    if (noteSort === 'oldest') arr.sort((a, b) => a.created_at.localeCompare(b.created_at))
    else if (noteSort === 'category')
      arr.sort(
        (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || b.created_at.localeCompare(a.created_at),
      )
    else arr.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return arr
  }, [d.notes, noteSort])

  async function onCheckinKpi(kpiId: string, proposedValue: number, note: string) {
    await submitKpiCheckinFn({ data: { kpiId, proposedValue, note } })
    router.invalidate()
  }
  async function onCheckinKr(krId: string, proposedValue: number, note: string) {
    await submitKrCheckinFn({ data: { krId, proposedValue, note } })
    router.invalidate()
  }

  const total = d.myStats.total
  const overallPct = total ? Math.round((d.myStats.completed / total) * 100) : 0
  const pp = d.projectProgress
  const ppPct = pp.total ? Math.round((pp.completed / pp.total) * 100) : 0

  const KPIS = [
    { label: 'Tasks done', val: String(d.stats.completed) },
    { label: 'On progress', val: String(pp.inProgress) },
    { label: 'Overdue', val: String(d.stats.overdue) },
    { label: 'Completion', val: `${ppPct}%` },
  ]

  /** KPI teaser — what the prototype's Home leads with on mobile. The trend
   *  badge the comp shows is omitted: there is no revenue history to derive it
   *  from, and a hard-coded percentage would read as real. */
  const kpiTeaser = (
    <section className="panel flex items-center gap-3.5 p-[18px]">
      <div className="w-[118px] flex-none">
        <p className="mb-3 text-[15.5px] font-bold leading-[1.25] tracking-[-0.015em] text-[var(--ink)]">
          Lihat progres
          <br />
          KPI kamu
        </p>
        <Link
          to="/reports"
          className="inline-flex items-center rounded-full bg-[var(--btn)] px-4 py-[9px] text-[13px] font-bold text-[var(--btn-ink)] no-underline transition hover:opacity-90 active:scale-[.96]"
        >
          Check now
        </Link>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mt-4 flex h-[66px] items-end gap-[5px]">
          {KPI_BARS.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-[5px]"
              style={{
                height: `${(v / Math.max(...KPI_BARS)) * 100}%`,
                background: i === KPI_BARS.length - 1 ? 'var(--accent)' : 'var(--sunk)',
              }}
            />
          ))}
        </div>
      </div>
    </section>
  )

  /** Revenue hero — the desktop rail card from the spec sheet's section 05. */
  const revenueHero = (
    <section className="rounded-[var(--r-lg)] bg-[var(--ink)] p-6 text-[var(--bg)] shadow-[0_10px_28px_rgba(28,26,23,.16)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-55">Revenue</p>
      <p className="mt-2 text-[30px] font-extrabold tracking-[-0.03em] tabular-nums">{fmtRupiah(d.revenue)}</p>
      <div className="mt-5 flex h-16 items-end gap-1.5">
        {KPI_BARS.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-[5px]"
            style={{
              height: `${(v / Math.max(...KPI_BARS)) * 100}%`,
              background: i === KPI_BARS.length - 1 ? 'var(--accent)' : 'rgba(251,250,248,.2)',
            }}
          />
        ))}
      </div>
      <Link
        to="/reports"
        className="mt-5 inline-flex items-center rounded-full bg-[var(--bg)] px-5 py-2.5 text-[13.5px] font-bold text-[var(--ink)] no-underline"
      >
        Check now
      </Link>
    </section>
  )

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 lg:flex-row">
        {/* left / main */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="lg:hidden">{kpiTeaser}</div>

          {/* TODAY */}
          <section className="panel p-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
                  <Flame size={18} className="text-[var(--ink3)]" aria-hidden="true" />
                  Today
                </h2>
                <p className="mt-1 text-[13.5px] text-[var(--ink3)]">
                  {total} tasks · {d.myStats.overdue} overdue · {d.myStats.dueToday} due today
                </p>
              </div>
              <div className="flex w-full items-center gap-3 sm:w-[240px]">
                <Bar pct={overallPct} />
                <span className="whitespace-nowrap text-[15px] font-bold tracking-[-0.02em] text-[var(--ink)]">
                  {overallPct}%
                </span>
              </div>
            </div>
            <div className="flex flex-col">
              {d.myToday.length === 0 && (
                <p className="py-3 text-[14px] text-[var(--ink3)]">Nothing due today 🎉</p>
              )}
              {d.myToday.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3.5 border-b border-[var(--line-soft)] py-3.5 last:border-0"
                >
                  <span
                    className="h-[22px] w-[22px] shrink-0 rounded-[12px] border-[1.8px] border-[var(--line-strong)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{t.title}</p>
                    <span className="text-[12.5px] text-[var(--ink3)]">{t.boardTitle}</span>
                  </div>
                  <span className="chip chip-warn shrink-0">Due today</span>
                </div>
              ))}
            </div>
            <Link
              to="/my-tasks"
              className="mt-4 inline-block text-[13.5px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--ink)]"
            >
              View all tasks →
            </Link>
          </section>

          {/* ACTIVE PROJECTS */}
          <section>
            <div className="mb-3.5 flex items-baseline justify-between">
              <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Projects</h2>
              <Link
                to="/projects"
                className="text-[13.5px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--accent)]"
              >
                See all
              </Link>
            </div>
            {d.projects.length === 0 ? (
              <p className="text-[14px] text-[var(--ink3)]">No projects yet.</p>
            ) : (
              <div className="gt-scroll -mx-5 flex gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0">
                {d.projects.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    to="/board/$boardId"
                    params={{ boardId: p.id }}
                    className="panel card-hover w-[200px] shrink-0 p-5 no-underline md:w-auto"
                  >
                    <MiniBars data={KPI_BARS} className="mb-4 h-[52px]" />
                    <p className="truncate text-[16px] font-bold tracking-[-0.015em] text-[var(--ink)]">{p.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--ink3)]">
                      {p.done} / {p.total} tasks
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                      <Bar pct={p.progress} />
                      <span className="text-[13px] font-bold text-[var(--ink)]">{p.progress}%</span>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <ProjectAvatars members={p.members} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* KPI + PROJECT PROGRESS */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <a href="#my-goals" className="panel block p-6 no-underline">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                KPI overview
              </p>
              <div className="grid grid-cols-2 gap-3">
                {KPIS.map((k) => (
                  <div key={k.label} className="rounded-[16px] bg-[var(--col)] p-4">
                    <p className="text-[12.5px] text-[var(--ink3)]">{k.label}</p>
                    <p className="mt-1 text-[24px] font-bold tracking-[-0.02em] text-[var(--ink)]">{k.val}</p>
                  </div>
                ))}
              </div>
            </a>

            <section className="panel p-6">
              <p className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                <Target size={13} /> Project progress
              </p>
              <div className="flex items-center gap-5">
                <Donut pct={ppPct} />
                <div className="flex-1 space-y-2.5">
                  <ProgRow label="Total projects" n={pp.total} tint="var(--ink3)" />
                  <ProgRow label="Completed" n={pp.completed} tint="var(--ink)" />
                  <ProgRow label="In progress" n={pp.inProgress} tint="var(--accent)" />
                </div>
              </div>
            </section>
          </div>

          <div id="my-goals" className="scroll-mt-4">
            <div className="mb-3.5 flex items-baseline justify-between">
              <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">My goals</h2>
              <Popover
                align="left"
                panelClassName="w-72"
                renderTrigger={(_open, toggle) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="flex items-center gap-1 text-[13.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
                  >
                    <Plus size={14} /> New goal
                  </button>
                )}
                renderPanel={(close) => <SelfGoalForm onDone={close} />}
              />
            </div>
            <MyGoalsCard
              kpis={goals.kpis}
              objectives={goals.objectives}
              onCheckinKpi={onCheckinKpi}
              onCheckinKr={onCheckinKr}
            />
          </div>
        </div>

        {/* right rail */}
        <div className="flex w-full flex-col gap-5 lg:w-[340px] lg:shrink-0">
          {/* REVENUE HERO — mobile renders it at the top of the main column */}
          <div className="hidden lg:block">{revenueHero}</div>

          {/* QUICK ACTIONS */}
          <section className="panel p-[22px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Quick actions
            </p>
            <div className="grid grid-cols-4 gap-2.5">
              <QuickTile
                label="Task"
                icon={CheckSquare}
                panel={(close) => <QuickTaskForm onDone={close} />}
              />
              <QuickTile
                label="Project"
                icon={FolderPlus}
                panel={(close) => <QuickProjectForm onDone={close} />}
              />
              <QuickTile
                label="Note"
                icon={StickyNote}
                panel={(close) => (
                  <QuickNoteForm
                    categorySuggestions={noteCategories}
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
              <QuickTile
                label="Reminder"
                icon={AlarmClock}
                panel={(close) => <QuickReminderForm onDone={close} />}
              />
            </div>
          </section>

          {/* ANNOUNCEMENTS */}
          <section className="panel p-[22px]">
            <div className="mb-4 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
                <Megaphone size={13} /> Announcements
              </p>
              <button type="button" className="text-[12.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]">
                View all
              </button>
            </div>
            <div className="flex flex-col gap-3.5">
              {d.announcements.length === 0 && <p className="text-[13px] text-[var(--ink3)]">No announcements.</p>}
              {d.announcements.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[var(--card)]"
                    style={{ background: accentFor(a.author ?? 'Team') }}
                  >
                    {(a.author ?? 'Team').trim().split(/\s+/)[0]?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[var(--ink)]">{a.author ?? 'Team'}</p>
                    <p className="mt-0.5 text-[13.5px] leading-[1.45] text-[var(--ink2)]">{a.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* NOTES */}
          <section className="panel p-[22px]">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Notes</p>
              <div className="flex items-center gap-3">
                <select
                  value={noteSort}
                  onChange={(e) => setNoteSort(e.target.value as typeof noteSort)}
                  aria-label="Sort notes"
                  className="field"
                  style={{ width: 'auto', padding: '0.35rem 0.6rem', fontSize: '12px' }}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="category">Category (A–Z)</option>
                </select>
                <Popover
                  align="left"
                  panelClassName="w-64"
                  renderTrigger={(_open, toggle) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className="flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
                    >
                      <Plus size={13} /> New
                    </button>
                  )}
                  renderPanel={(close) => (
                    <QuickNoteForm
                      categorySuggestions={noteCategories}
                      onDone={() => {
                        close()
                        router.invalidate()
                      }}
                    />
                  )}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              {sortedNotes.length === 0 && <p className="text-[13px] text-[var(--ink3)]">No notes.</p>}
              {sortedNotes.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedNote(n)}
                  onKeyDown={(e) => {
                    // Only react when the card itself is focused — otherwise Enter on
                    // the nested delete button bubbles here too, opening a note that
                    // may have just been deleted (stopPropagation on click doesn't
                    // stop the keydown that already ran this handler).
                    if (e.target === e.currentTarget && e.key === 'Enter') setSelectedNote(n)
                  }}
                  className="flex cursor-pointer items-start gap-2 rounded-[16px] bg-[var(--col)] px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] leading-[1.45] text-[var(--ink)]">{n.body}</p>
                    {n.category && (
                      <span className="mt-2.5 inline-block rounded-full bg-[var(--sunk)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--ink2)]">
                        {n.category}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeNote(n.id)
                    }}
                    aria-label="Delete note"
                    className="shrink-0 text-[var(--ink3)] hover:text-[var(--danger)]"
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {selectedNote && (
            <NoteDetail
              note={selectedNote}
              categorySuggestions={noteCategories}
              onClose={() => setSelectedNote(null)}
              onSaved={() => {
                setSelectedNote(null)
                router.invalidate()
              }}
              onDelete={async () => {
                await removeNote(selectedNote.id)
                setSelectedNote(null)
              }}
            />
          )}
        </div>
      </div>
    </main>
  )
}

function ProgRow({ label, n, tint }: { label: string; n: number; tint: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="flex items-center gap-2 font-medium text-[var(--ink2)]">
        <span className="h-2 w-2 rounded-full" style={{ background: tint }} />
        {label}
      </span>
      <span className="font-bold tabular-nums text-[var(--ink)]">{n}</span>
    </div>
  )
}

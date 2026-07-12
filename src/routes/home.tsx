import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  AlarmClock,
  CheckSquare,
  Flame,
  FolderPlus,
  Megaphone,
  MoreVertical,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  StickyNote,
  Target,
  Volume2,
} from 'lucide-react'
import { segFill } from '#/lib/progress'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { deleteNoteFn } from '#/lib/actions'
import { fetchMyGoalsFn, submitKpiCheckinFn, submitKrCheckinFn, type MyGoals } from '#/lib/goals'
import { MyGoalsCard } from '#/components/Goals'
import Popover from '#/components/Popover'
import QuickTaskForm from '#/components/QuickTaskForm'
import QuickProjectForm from '#/components/QuickProjectForm'
import QuickNoteForm from '#/components/QuickNoteForm'
import QuickReminderForm from '#/components/QuickReminderForm'

// ponytail: Pixel Home wires the schema-backed data (today tasks, active
// projects, KPI headline numbers, project progress, announcements, notes).
// Pomodoro is functional; Music and the KPI mini-bar shapes stay static (no
// source / a later slice).

export const Route = createFileRoute('/home')({
  loader: async () => {
    const [dashboard, goals] = await Promise.all([fetchDashboard(), fetchMyGoalsFn()])
    return { dashboard, goals }
  },
  component: PixelHome,
})

function QuickTile({
  label,
  icon: Icon,
  tint,
  panel,
}: {
  label: string
  icon: typeof CheckSquare
  tint: string
  panel: (close: () => void) => React.ReactNode
}) {
  return (
    <Popover
      panelClassName="w-64"
      renderTrigger={(_open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className="flex flex-col items-center gap-1.5 rounded-[10px] border-2 border-[var(--line)] p-2 text-center hover:border-[var(--ink)]"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[var(--ink)]"
            style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
          >
            <Icon size={16} />
          </span>
          <span className="text-[10px] font-bold text-[var(--ink2)]">{label}</span>
        </button>
      )}
      renderPanel={panel}
    />
  )
}

const KPI_BARS = [4, 6, 5, 7, 6, 8, 9]
const PROJECT_TINTS = ['var(--accent)', '#d97706', '#2563eb', '#7c3aed', '#db2777']

function fmtRupiah(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`
  return `Rp ${n.toLocaleString('id-ID')}`
}

function SegBar({ pct, color }: { pct: number; color: string }) {
  const on = segFill(pct, 12)
  return (
    <span className="progress-seg w-full">
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="progress-seg-block flex-1"
          style={i < on ? { background: color, borderColor: color } : undefined}
        />
      ))}
    </span>
  )
}

function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  return (
    <div className="flex h-8 items-end gap-0.5">
      {data.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.5 + (i / data.length) * 0.5 }}
        />
      ))}
    </div>
  )
}

function Pomodoro() {
  const [secs, setSecs] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!running) return
    ref.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          setRunning(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (ref.current) clearInterval(ref.current)
    }
  }, [running])

  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          🍅 Pomodoro
        </h3>
        <Settings size={14} className="text-[var(--ink3)]" aria-hidden="true" />
      </div>
      <div className="lcd-screen mb-3">
        <p className="lcd-digits text-center text-5xl font-bold">
          {mm}:{ss}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="btn btn-primary flex-1"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Play size={15} aria-hidden="true" />
          {running ? 'Pause' : 'Start Focus'}
        </button>
        <button
          type="button"
          onClick={() => {
            setRunning(false)
            setSecs(25 * 60)
          }}
          className="btn btn-ghost flex-1"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
      </div>
    </section>
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
      <text x="48" y="53" textAnchor="middle" className="display-title fill-[var(--ink)] text-lg font-extrabold">
        {pct}%
      </text>
    </svg>
  )
}

function Avatar({ i }: { i: number }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ background: ['#7c3aed', '#2563eb', '#db2777', '#0891b2'][i % 4] }}
    >
      {String.fromCharCode(65 + i)}
    </span>
  )
}

function PixelHome() {
  const { dashboard: d, goals } = Route.useLoaderData() as { dashboard: DashboardData; goals: MyGoals }
  const router = useRouter()

  async function removeNote(id: string) {
    if (!window.confirm('Delete this note?')) return
    await deleteNoteFn({ data: { id } })
    router.invalidate()
  }

  async function onCheckinKpi(kpiId: string, proposedValue: number, note: string) {
    await submitKpiCheckinFn({ data: { kpiId, proposedValue, note } })
    router.invalidate()
  }
  async function onCheckinKr(krId: string, proposedValue: number, note: string) {
    await submitKrCheckinFn({ data: { krId, proposedValue, note } })
    router.invalidate()
  }

  const total = d.stats.totalTasks
  const overallPct = total ? Math.round((d.stats.completed / total) * 100) : 0
  const pp = d.projectProgress
  const ppPct = pp.total ? Math.round((pp.completed / pp.total) * 100) : 0

  const KPIS = [
    { label: 'Revenue', val: fmtRupiah(d.revenue), tint: 'var(--accent)' },
    { label: 'Tasks Done', val: String(d.stats.completed), tint: '#2563eb' },
    { label: 'On Progress', val: String(pp.inProgress), tint: '#d97706' },
    { label: 'Overdue', val: String(d.stats.overdue), tint: 'var(--danger)' },
  ]

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 lg:flex-row">
        {/* left / main */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* TODAY */}
          <section className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Flame size={18} className="text-[var(--danger)]" aria-hidden="true" />
              <h3 className="display-title text-lg font-extrabold text-[var(--ink)]">Today</h3>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-4 border-b-2 border-[var(--line)] pb-3">
              <Stat n={String(total)} label="Tasks" />
              <Stat n={String(d.stats.overdue)} label="Overdue" tint="var(--danger)" />
              <Stat n={String(d.stats.dueToday)} label="Due today" tint="#d97706" />
              <div className="ml-auto flex items-center gap-2">
                <SegBar pct={overallPct} color="var(--accent)" />
                <span className="whitespace-nowrap text-sm font-extrabold text-[var(--accent-ink)]">{overallPct}%</span>
              </div>
            </div>
            <div className="flex flex-col">
              {d.today.length === 0 && (
                <p className="py-3 text-sm text-[var(--ink3)]">Nothing due today 🎉</p>
              )}
              {d.today.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0">
                  <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[var(--ink)]">{t.title}</p>
                    <span className="text-[11px] font-semibold text-[var(--ink3)]">{t.boardTitle}</span>
                  </div>
                  <span className="chip shrink-0" style={{ background: 'var(--pop-soft)', color: 'var(--pop-ink)', borderColor: 'var(--pop-ink)' }}>
                    Due today
                  </span>
                  <Avatar i={0} />
                </div>
              ))}
            </div>
            <Link to="/my-tasks" className="mt-2 inline-block text-[12px] font-bold text-[var(--accent-ink)] no-underline hover:underline">
              View all tasks →
            </Link>
          </section>

          {/* ACTIVE PROJECTS */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">Active Projects</h3>
              <Link to="/projects" className="text-[11px] font-bold text-[var(--accent-ink)] no-underline hover:underline">
                View all projects →
              </Link>
            </div>
            {d.projects.length === 0 ? (
              <p className="text-sm text-[var(--ink3)]">No projects yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {d.projects.slice(0, 3).map((p, i) => {
                  const tint = PROJECT_TINTS[i % PROJECT_TINTS.length]
                  return (
                    <Link
                      key={p.id}
                      to="/board/$boardId"
                      params={{ boardId: p.id }}
                      className="rounded-[10px] border-2 border-[var(--ink)] p-3 no-underline hover:bg-[var(--col)]"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: tint }} />
                        <p className="truncate text-[13px] font-bold text-[var(--ink)]">{p.title}</p>
                        <span className="ml-auto text-[12px] font-extrabold" style={{ color: tint }}>
                          {p.progress}%
                        </span>
                      </div>
                      <SegBar pct={p.progress} color={tint} />
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[var(--ink3)]">
                          {p.done} / {p.total} tasks
                        </span>
                        <span className="avatar-stack">
                          <Avatar i={0} />
                          <Avatar i={1} />
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>

          {/* KPI + PROJECT PROGRESS */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📊 KPI Overview
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {KPIS.map((k) => (
                  <div key={k.label} className="rounded-[10px] border-2 border-[var(--line)] p-3">
                    <p className="text-[11px] font-semibold text-[var(--ink3)]">{k.label}</p>
                    <p className="display-title text-lg font-extrabold leading-tight text-[var(--ink)]">{k.val}</p>
                    <div className="mt-1">
                      <MiniBars data={KPI_BARS} color={k.tint} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                <Target size={13} /> Project Progress
              </h3>
              <div className="flex items-center gap-4">
                <Donut pct={ppPct} />
                <div className="flex-1 space-y-2">
                  <ProgRow label="Total Projects" n={pp.total} tint="var(--ink3)" />
                  <ProgRow label="Completed" n={pp.completed} tint="var(--accent)" />
                  <ProgRow label="In Progress" n={pp.inProgress} tint="#d97706" />
                </div>
              </div>
            </section>
          </div>

          <MyGoalsCard
            kpis={goals.kpis}
            objectives={goals.objectives}
            onCheckinKpi={onCheckinKpi}
            onCheckinKr={onCheckinKr}
          />
        </div>

        {/* right rail */}
        <div className="flex w-full flex-col gap-4 lg:w-80">
          {/* QUICK ACTIONS */}
          <section className="card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              ⚡ Quick Actions
            </h3>
            <div className="grid grid-cols-4 gap-2">
              <QuickTile
                label="Add Task"
                icon={CheckSquare}
                tint="var(--accent)"
                panel={(close) => <QuickTaskForm onDone={close} />}
              />
              <QuickTile
                label="Add Project"
                icon={FolderPlus}
                tint="#d97706"
                panel={(close) => <QuickProjectForm onDone={close} />}
              />
              <QuickTile
                label="Add Note"
                icon={StickyNote}
                tint="#7c3aed"
                panel={(close) => (
                  <QuickNoteForm
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
              <QuickTile
                label="Set Reminder"
                icon={AlarmClock}
                tint="#2563eb"
                panel={(close) => <QuickReminderForm onDone={close} />}
              />
            </div>
          </section>

          <Pomodoro />

          {/* MUSIC */}
          <section className="card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              🎵 Music
            </h3>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-[var(--ink)] bg-[var(--col)]">
                <Music2 size={20} className="text-[var(--ink2)]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[var(--ink)]">Lofi for Coding</p>
                <p className="truncate text-[11px] text-[var(--ink3)]">Lofi Girl</p>
              </div>
            </div>
            <div className="my-2 h-1.5 rounded-full bg-[var(--col)]">
              <div className="h-full w-1/3 rounded-full bg-[var(--accent)]" />
            </div>
            <div className="flex items-center justify-center gap-4 text-[var(--ink2)]">
              <SkipBack size={16} />
              <button
                type="button"
                aria-label="Play"
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--btn)] text-[var(--btn-ink)]"
              >
                <Play size={15} />
              </button>
              <SkipForward size={16} />
              <Volume2 size={16} className="ml-auto" />
            </div>
          </section>

          {/* ANNOUNCEMENTS */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                <Megaphone size={13} /> Announcements
              </h3>
              <button type="button" className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
                View all
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {d.announcements.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No announcements.</p>}
              {d.announcements.map((a, i) => (
                <div key={a.id} className="flex gap-2 rounded-[10px] border-2 border-[var(--line)] p-2">
                  <Avatar i={i} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-[var(--ink)]">{a.author ?? 'Team'}</p>
                    <p className="text-[12px] text-[var(--ink2)]">{a.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* NOTES */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📝 Notes
              </h3>
              <Popover
                align="left"
                panelClassName="w-64"
                renderTrigger={(_open, toggle) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="flex items-center gap-1 text-[11px] font-bold text-[var(--accent-ink)] hover:underline"
                  >
                    <Plus size={12} /> New Note
                  </button>
                )}
                renderPanel={(close) => (
                  <QuickNoteForm
                    onDone={() => {
                      close()
                      router.invalidate()
                    }}
                  />
                )}
              />
            </div>
            <div className="flex flex-col gap-2">
              {d.notes.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No notes.</p>}
              {d.notes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start gap-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--pop-soft)] p-2.5"
                >
                  <p className="min-w-0 flex-1 text-[12px] font-semibold text-[var(--pop-ink)]">{n.body}</p>
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    aria-label="Delete note"
                    className="shrink-0 text-[var(--pop-ink)] hover:text-[var(--danger)]"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function Stat({ n, label, tint }: { n: string; label: string; tint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="display-title text-2xl font-extrabold" style={{ color: tint ?? 'var(--ink)' }}>
        {n}
      </span>
      <span className="text-[11px] font-semibold text-[var(--ink3)]">{label}</span>
    </div>
  )
}

function ProgRow({ label, n, tint }: { label: string; n: number; tint: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="flex items-center gap-2 font-semibold text-[var(--ink2)]">
        <span className="h-2 w-2 rounded-full" style={{ background: tint }} />
        {label}
      </span>
      <span className="font-extrabold text-[var(--ink)]">{n}</span>
    </div>
  )
}

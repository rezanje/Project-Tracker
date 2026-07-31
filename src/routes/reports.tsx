import { createFileRoute } from '@tanstack/react-router'
import {
  BarChart3,
  CheckCircle2,
  Clock,
  ListChecks,
} from 'lucide-react'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'

// ponytail: Reports reuses the dashboard aggregation — everything here is real
// (per-workspace / per-project progress, task + project status). No new query.

const ACCENTS = ['#8a7f73', '#a8927c', '#6e7a66', '#9c8b7a']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}
function progressColor(pct: number): string {
  if (pct >= 80) return 'var(--ink)'
  if (pct >= 45) return 'var(--accent)'
  return 'var(--danger)'
}

export const Route = createFileRoute('/reports')({
  loader: async () => await fetchDashboard(),
  component: Reports,
})

function Bar({ label, sub, pct, color }: { label: string; sub?: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ink)]">{label}</p>
        {sub && <span className="shrink-0 text-[12.5px] text-[var(--ink3)]">{sub}</span>}
        <span className="shrink-0 text-[13px] font-bold tabular-nums text-[var(--ink)]">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function Donut({ segments }: { segments: Array<{ n: number; color: string }> }) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1
  const r = 40
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--sunk)" strokeWidth="16" />
      {segments.map((s, i) => {
        const len = (s.n / total) * c
        const el = (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 60 60)"
          />
        )
        offset += len
        return el
      })}
    </svg>
  )
}

function Reports() {
  const d = Route.useLoaderData() as DashboardData
  const total = d.stats.totalTasks
  const completion = total ? Math.round((d.stats.completed / total) * 100) : 0
  const pp = d.projectProgress
  const notStarted = Math.max(0, pp.total - pp.completed - pp.inProgress)

  const tiles = [
    { icon: ListChecks, n: total, label: 'Total tasks', tint: 'var(--ink)' },
    { icon: CheckCircle2, n: d.stats.completed, label: 'Completed', tint: 'var(--accent)' },
    { icon: Clock, n: d.stats.overdue, label: 'Overdue', tint: 'var(--danger)' },
    { icon: BarChart3, n: `${completion}%`, label: 'Completion', tint: 'var(--pop)' },
  ]

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <BarChart3 size={22} className="text-[var(--ink3)]" aria-hidden="true" />
          <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Reports</h1>
        </div>

        {/* overview */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {tiles.map(({ icon: Icon, n, label, tint }) => (
            <div key={label} className="panel flex items-center gap-3.5 p-5">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-[var(--col)]"
                style={{ color: tint }}
              >
                <Icon size={19} strokeWidth={1.7} />
              </span>
              <div className="min-w-0">
                <p className="text-[24px] font-bold leading-none tracking-[-0.02em] text-[var(--ink)]">{n}</p>
                <p className="mt-1.5 truncate text-[12.5px] text-[var(--ink3)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* workspace performance */}
          <section className="panel p-6 lg:col-span-2">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Workspace performance
            </p>
            <div className="flex flex-col gap-4">
              {d.workspaces.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No workspaces yet.</p>}
              {d.workspaces.map((w) => (
                <Bar
                  key={w.id}
                  label={w.name}
                  sub={`${w.projects} projects · ${w.tasks} tasks`}
                  pct={w.progress}
                  color={accentFor(w.id)}
                />
              ))}
            </div>
          </section>

          {/* project status donut */}
          <section className="panel p-6">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Project status
            </p>
            <div className="flex items-center gap-5">
              <Donut
                segments={[
                  { n: pp.completed, color: 'var(--ink)' },
                  { n: pp.inProgress, color: 'var(--accent)' },
                  { n: notStarted, color: 'var(--sunk)' },
                ]}
              />
              <div className="flex-1 space-y-2.5 text-[13px]">
                <Legend color="var(--ink)" label="Completed" n={pp.completed} />
                <Legend color="var(--accent)" label="In progress" n={pp.inProgress} />
                <Legend color="var(--sunk)" label="Not started" n={notStarted} />
              </div>
            </div>
          </section>
        </div>

        {/* project completion */}
        <section className="panel p-6">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
            Project completion
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {d.projects.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No projects yet.</p>}
            {d.projects.map((p) => (
              <Bar key={p.id} label={p.title} sub={p.wsName} pct={p.progress} color={progressColor(p.progress)} />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 font-medium text-[var(--ink2)]">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-bold tabular-nums text-[var(--ink)]">{n}</span>
    </div>
  )
}

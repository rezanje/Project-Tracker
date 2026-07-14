import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2 } from 'lucide-react'
import { BarChart3, Clock, ListChecks } from '@/components/pixel-icons'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'

// ponytail: Reports reuses the dashboard aggregation — everything here is real
// (per-workspace / per-project progress, task + project status). No new query.

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}
function progressColor(pct: number): string {
  if (pct >= 80) return 'var(--accent)'
  if (pct >= 45) return '#d9a406'
  return 'var(--danger)'
}

export const Route = createFileRoute('/reports')({
  loader: async () => await fetchDashboard(),
  component: Reports,
})

function Bar({ label, sub, pct, color }: { label: string; sub?: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--ink)]">{label}</p>
        {sub && <span className="shrink-0 text-[11px] text-[var(--ink3)]">{sub}</span>}
        <span className="shrink-0 text-[12px] font-extrabold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--col)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
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
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--col)" strokeWidth="16" />
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
    { icon: ListChecks, n: total, label: 'Total tasks', tint: '#2563eb' },
    { icon: CheckCircle2, n: d.stats.completed, label: 'Completed', tint: 'var(--accent)' },
    { icon: Clock, n: d.stats.overdue, label: 'Overdue', tint: 'var(--danger)' },
    { icon: BarChart3, n: `${completion}%`, label: 'Completion', tint: '#d97706' },
  ]

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={22} className="text-[var(--accent)]" aria-hidden="true" />
          <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">Reports</h1>
        </div>

        {/* overview */}
        <div className="card flex flex-wrap items-stretch p-0">
          {tiles.map(({ icon: Icon, n, label, tint }, i) => (
            <div
              key={label}
              className={`flex min-w-[140px] flex-1 items-center gap-3 px-4 py-4 ${
                i > 0 ? 'border-l-2 border-[var(--line)]' : ''
              }`}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--ink)]"
                style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
              >
                <Icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="display-title text-xl font-extrabold leading-none text-[var(--ink)]">{n}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-[var(--ink2)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* workspace performance */}
          <section className="card p-4 lg:col-span-2">
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              Workspace Performance
            </h2>
            <div className="flex flex-col gap-3">
              {d.workspaces.length === 0 && <p className="text-sm text-[var(--ink3)]">No workspaces yet.</p>}
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
          <section className="card p-4">
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              Project Status
            </h2>
            <div className="flex items-center gap-4">
              <Donut
                segments={[
                  { n: pp.completed, color: 'var(--accent)' },
                  { n: pp.inProgress, color: '#d97706' },
                  { n: notStarted, color: 'var(--ink3)' },
                ]}
              />
              <div className="flex-1 space-y-2 text-[12px]">
                <Legend color="var(--accent)" label="Completed" n={pp.completed} />
                <Legend color="#d97706" label="In Progress" n={pp.inProgress} />
                <Legend color="var(--ink3)" label="Not Started" n={notStarted} />
              </div>
            </div>
          </section>
        </div>

        {/* project completion */}
        <section className="card p-4">
          <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
            Project Completion
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {d.projects.length === 0 && <p className="text-sm text-[var(--ink3)]">No projects yet.</p>}
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
      <span className="flex items-center gap-2 font-semibold text-[var(--ink2)]">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-extrabold text-[var(--ink)]">{n}</span>
    </div>
  )
}

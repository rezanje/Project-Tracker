import { createFileRoute, useRouter } from '@tanstack/react-router'
import BackButton from '#/components/BackButton'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { inScope, useScope } from '#/lib/workspace-scope'
import {
  fetchAssignedGoalsFn,
  fetchMyGoalsFn,
  reviewKpiCheckinFn,
  reviewKrCheckinFn,
  submitKpiCheckinFn,
  submitKrCheckinFn,
  type AssignedGoals,
  type MyGoals,
} from '#/lib/goals'

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

type ReportsData = { dashboard: DashboardData; goals: MyGoals; assigned: AssignedGoals }

export const Route = createFileRoute('/reports')({
  loader: async (): Promise<ReportsData> => {
    const [dashboard, goals, assigned] = await Promise.all([
      fetchDashboard(),
      fetchMyGoalsFn(),
      fetchAssignedGoalsFn(),
    ])
    return { dashboard, goals, assigned }
  },
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

function pct(current: number, target: number): number {
  if (!target) return 0
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)))
}

function Reports() {
  const { dashboard: d, goals, assigned } = Route.useLoaderData() as ReportsData
  const router = useRouter()
  const scope = useScope()
  const workspaces = d.workspaces.filter((w) => inScope(scope, w.id))
  const projects = d.projects.filter((p) => inScope(scope, p.wsId))
  const total = d.stats.totalTasks
  const completion = total ? Math.round((d.stats.completed / total) * 100) : 0
  const pp = d.projectProgress
  const notStarted = Math.max(0, pp.total - pp.completed - pp.inProgress)

  async function reviewKpi(checkinId: string, approve: boolean) {
    await reviewKpiCheckinFn({ data: { checkinId, approve } })
    router.invalidate()
  }
  async function reviewKr(checkinId: string, approve: boolean) {
    await reviewKrCheckinFn({ data: { checkinId, approve } })
    router.invalidate()
  }
  async function checkinKpi(kpiId: string) {
    const raw = window.prompt('New value?')
    if (raw == null || raw.trim() === '') return
    await submitKpiCheckinFn({ data: { kpiId, proposedValue: Number(raw) || 0, note: '' } })
    router.invalidate()
  }
  async function checkinKr(krId: string) {
    const raw = window.prompt('New value?')
    if (raw == null || raw.trim() === '') return
    await submitKrCheckinFn({ data: { krId, proposedValue: Number(raw) || 0, note: '' } })
    router.invalidate()
  }

  /** My KPIs + every key result, flattened into the comp's one goal list. */
  const goalRows = [
    ...goals.kpis.map((k) => ({
      id: k.id,
      title: k.name,
      current: k.current,
      target: k.target,
      pending: k.pending,
      onCheckin: () => checkinKpi(k.id),
      onReview: reviewKpi,
    })),
    ...goals.objectives.flatMap((o) =>
      o.krs.map((k) => ({
        id: k.id,
        title: `${o.title} · ${k.title}`,
        current: k.current,
        target: k.target,
        pending: k.pending,
        onCheckin: () => checkinKr(k.id),
        onReview: reviewKr,
      })),
    ),
  ]
  /** Check-ins waiting on this user as the assigner, from the owner view. */
  const inbox = [
    ...assigned.kpis
      .filter((k) => k.pending)
      .map((k) => ({ id: k.id, who: k.assigneeName, title: k.name, p: k.pending!, onReview: reviewKpi })),
    ...assigned.objectives.flatMap((o) =>
      o.krs
        .filter((k) => k.pending)
        .map((k) => ({
          id: k.id,
          who: o.assigneeName,
          title: `${o.title} · ${k.title}`,
          p: k.pending!,
          onReview: reviewKr,
        })),
    ),
  ]

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="flex-1 text-center text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
            Performance
          </h1>
          <span className="w-10" />
        </div>

        {/* The comp's pair: Selesai over the total, and completion as the one
            accent number. Its "On-time 92% · +4 vs bulan lalu" needs history
            the schema doesn't keep, so completion stands in for it. */}
        <div className="flex gap-3">
          <div className="flex-1 rounded-[22px] bg-[var(--card)] p-4 shadow-[var(--shadow)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Selesai</p>
            <p className="mt-1.5 text-[28px] font-extrabold tabular-nums tracking-[-0.03em] text-[var(--ink)]">
              {d.stats.completed}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--ink2)]">dari {total} task</p>
          </div>
          <div className="flex-1 rounded-[22px] bg-[var(--card)] p-4 shadow-[var(--shadow)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Completion</p>
            <p className="mt-1.5 text-[28px] font-extrabold tracking-[-0.03em] text-[var(--accent)]">
              {completion}%
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--ink2)]">{d.stats.overdue} telat</p>
          </div>
        </div>

        {/* Minggu ini — the column needs a resolved height or the percentage
            bars collapse, hence the stretch row with a flex-end wrapper. */}
        <section className="rounded-[var(--r-lg)] bg-[var(--card)] p-[18px] shadow-[var(--shadow)]">
          <h2 className="mb-4 text-[16px] font-bold tracking-[-0.02em] text-[var(--ink)]">Minggu ini</h2>
          <div className="flex h-[120px] items-stretch gap-2">
            {d.weekProgress.map((b, i) => (
              <div key={b.d} className="flex h-full flex-1 flex-col items-center gap-2">
                <div className="flex flex-1 w-full items-end">
                  <div
                    className="w-full rounded-[6px]"
                    style={{
                      height: `${Math.max(4, b.v)}%`,
                      background: i === d.weekProgress.length - 1 ? 'var(--accent)' : 'var(--sunk)',
                    }}
                  />
                </div>
                <span className="text-[11px] font-medium text-[var(--ink3)]">{b.d}</span>
              </div>
            ))}
          </div>
        </section>

        {/* My goals */}
        <section>
          <div className="mb-3.5 flex items-baseline justify-between">
            <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">My goals</h2>
            <a
              href="/home#my-goals"
              className="text-[13.5px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--ink)]"
            >
              + New goal
            </a>
          </div>
          {goalRows.length === 0 ? (
            <p className="panel p-8 text-center text-[14px] text-[var(--ink3)]">No goals assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {goalRows.map((g) => (
                <div key={g.id} className="card p-4">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[14.5px] font-semibold text-[var(--ink)]">{g.title}</p>
                    <span className={`chip shrink-0 ${g.pending ? 'chip-warn' : ''}`}>
                      {g.pending ? 'Pending approval' : 'On track'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <div className="progress-track flex-1">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${pct(g.current, g.target)}%`,
                          background: g.pending ? 'var(--accent)' : 'var(--ink)',
                        }}
                      />
                    </div>
                    <span className="text-[12.5px] font-bold tabular-nums text-[var(--ink)]">
                      {g.current} / {g.target}
                    </span>
                  </div>
                  {!g.pending && (
                    <button
                      type="button"
                      onClick={g.onCheckin}
                      className="mt-3 text-[12.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
                    >
                      Check in →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Check-ins waiting on me as the assigner */}
        {inbox.length > 0 && (
          <section>
            <h2 className="mb-3.5 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Waiting on you</h2>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {inbox.map((g) => (
                <div key={g.id} className="card p-4">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[14.5px] font-semibold text-[var(--ink)]">{g.title}</p>
                    <span className="chip chip-warn shrink-0">Pending approval</span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-[var(--ink3)]">
                    {g.who ?? 'Someone'} proposed {g.p.proposedValue}
                    {g.p.note ? ` — ${g.p.note}` : ''}
                  </p>
                  <div className="mt-3.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => g.onReview(g.p.id, true)}
                      className="btn btn-primary flex-1 py-2.5 text-[13px]"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => g.onReview(g.p.id, false)}
                      className="btn btn-ghost flex-1 py-2.5 text-[13px]"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Beyond the comps: the workspace / project breakdowns the app already had. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="panel p-6 lg:col-span-2">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Workspace performance
            </p>
            <div className="flex flex-col gap-4">
              {workspaces.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No workspaces yet.</p>}
              {workspaces.map((w) => (
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

        <section className="panel p-6">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
            Project completion
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {projects.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No projects yet.</p>}
            {projects.map((p) => (
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

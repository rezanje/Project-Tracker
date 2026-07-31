import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  Banknote,
  Building2,
  Clock,
  FileText,
  Flame,
  FolderKanban,
  Image as ImageIcon,
  Info,
  ListChecks,
  Star,
  TrendingUp,
  X,
} from 'lucide-react'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { fetchTodayEventsFn, type EventItem } from '#/lib/events'
import { fetchPendingApprovalsFn, resolveApprovalFn, type ApprovalRequest, type ApprovalKind } from '#/lib/approval-requests'
import { workspaceLogoFor } from '#/lib/workspace-logos'

type CommandCenterData = Omit<DashboardData, 'approvals'> & { events: EventItem[]; approvals: ApprovalRequest[] }

export const Route = createFileRoute('/')({
  loader: async (): Promise<CommandCenterData> => {
    const [dashboard, events, approvals] = await Promise.all([
      fetchDashboard(),
      fetchTodayEventsFn(),
      fetchPendingApprovalsFn(),
    ])
    return { ...dashboard, events, approvals }
  },
  component: CommandCenter,
})

const ACCENTS = ['#8a7f73', '#a8927c', '#6e7a66', '#9c8b7a']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const STAT_META = [
  { key: 'workspaces', icon: Building2, label: 'Workspaces', tint: 'var(--accent)' },
  { key: 'projects', icon: FolderKanban, label: 'Projects', tint: 'var(--ink2)' },
  { key: 'totalTasks', icon: ListChecks, label: 'Total tasks', tint: 'var(--ink)' },
  { key: 'dueToday', icon: Clock, label: 'Due today', tint: 'var(--pop)' },
  { key: 'overdue', icon: Flame, label: 'Need attention', tint: 'var(--danger)' },
  { key: 'completed', icon: TrendingUp, label: 'Completed', tint: 'var(--accent)' },
] as const

const HEALTH_COLORS: Record<string, string> = {
  Healthy: 'var(--ink)',
  'Need attention': 'var(--pop)',
  'Behind schedule': 'var(--danger)',
}
/** Status chip class per health / due bucket — tone, not hue. */
const HEALTH_CHIP: Record<string, string> = {
  Healthy: 'chip-done',
  'Need attention': 'chip-warn',
  'Behind schedule': 'chip-danger',
}
const DUE_COLORS: Record<string, string> = {
  Overdue: 'var(--danger)',
  'Due today': 'var(--pop)',
  'Due tomorrow': 'var(--ink)',
  'Due soon': 'var(--ink3)',
}
const DUE_CHIP: Record<string, string> = {
  Overdue: 'chip-danger',
  'Due today': 'chip-warn',
  'Due tomorrow': 'chip',
  'Due soon': 'chip',
}
function progressColor(pct: number): string {
  if (pct >= 80) return 'var(--ink)'
  if (pct >= 45) return 'var(--accent)'
  return 'var(--danger)'
}

const TYPE_COLORS: Record<string, string> = {
  Meeting: 'var(--ink2)',
  Approval: 'var(--ink)',
  Call: 'var(--ink2)',
  Review: 'var(--pop)',
  Content: 'var(--ink2)',
}
const APPROVAL_ICON: Record<ApprovalKind, typeof Banknote> = {
  budget: Banknote,
  leave: FileText,
  content: ImageIcon,
}
const SPARK = [4, 6, 5, 8, 7, 9, 11]

function CardHead({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">{title}</p>
      {action && (
        <button
          type="button"
          className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
        >
          {action}
        </button>
      )}
    </div>
  )
}

function Avatars({ n }: { n: number }) {
  const show = Math.min(n, 3)
  return (
    <span className="avatar-stack">
      {Array.from({ length: show }).map((_, i) => (
        <span
          key={i}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-bold text-[var(--card)]"
          style={{ background: accentFor(String(i)) }}
        >
          {String.fromCharCode(65 + i)}
        </span>
      ))}
      {n > 3 && (
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--sunk)] text-[9px] font-bold text-[var(--ink2)]">
          +{n - 3}
        </span>
      )}
    </span>
  )
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 72},${20 - ((v - min) / span) * 18}`).join(' ')
  return (
    <svg width="72" height="22" viewBox="0 0 72 22" className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function CommandCenter() {
  const d = Route.useLoaderData() as CommandCenterData
  const router = useRouter()
  async function handleResolve(id: string, decision: 'approved' | 'rejected') {
    await resolveApprovalFn({ data: { id, decision } })
    router.invalidate()
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        {/* stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {STAT_META.map(({ icon: Icon, key, label, tint }) => (
            <div key={label} className="panel flex items-center gap-3.5 p-5">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-[var(--col)]"
                style={{ color: tint }}
              >
                <Icon size={19} strokeWidth={1.7} />
              </span>
              <div className="min-w-0">
                <p className="text-[24px] font-bold leading-none tracking-[-0.02em] text-[var(--ink)]">
                  {d.stats[key]}
                </p>
                <p className="mt-1.5 truncate text-[12.5px] text-[var(--ink3)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* workspace health */}
        <section className="panel p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Workspace health <Info size={12} />
            </p>
            <button
              type="button"
              className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
            >
              View all
            </button>
          </div>
          {d.workspaces.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-[var(--ink3)]">No workspaces yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {d.workspaces.slice(0, 4).map((w) => (
                <div key={w.id} className="rounded-[var(--r-md)] bg-[var(--col)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    {workspaceLogoFor(w.name) ? (
                      <img
                        src={workspaceLogoFor(w.name) as string}
                        alt=""
                        className="h-8 w-8 rounded-[14px] object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-[14px] text-[12px] font-bold text-[var(--card)]"
                        style={{ background: accentFor(w.id) }}
                      >
                        {w.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <Star
                      size={15}
                      className={w.progress >= 80 ? 'fill-[var(--pop)] text-[var(--pop)]' : 'text-[var(--ink3)]'}
                    />
                  </div>
                  <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{w.name}</p>
                  <div className="my-3 flex h-12 items-end justify-center gap-1.5" aria-hidden="true">
                    {[8, 12, 6, 14, 10].map((h, i) => (
                      <span
                        key={i}
                        className="w-full flex-1 rounded-[4px]"
                        style={{
                          height: `${(h / 14) * 100}%`,
                          background: h === 14 ? 'var(--ink)' : 'var(--sunk)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1">
                      <Meter pct={w.progress} color={HEALTH_COLORS[w.status]} />
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums text-[var(--ink)]">
                      {w.progress}%
                    </span>
                  </div>
                  <span className={`chip ${HEALTH_CHIP[w.status] ?? ''} mt-3`}>{w.status}</span>
                  <p className="mt-2.5 text-[12.5px] text-[var(--ink3)]">
                    {w.projects} projects · {w.tasks} tasks
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* priority radar + timeline + approvals */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <section className="panel p-6 lg:col-span-4">
            <CardHead title="Priority radar" action="View all" />
            {d.myPriority.length === 0 ? (
              <p className="py-4 text-center text-[14px] text-[var(--ink3)]">Nothing urgent 🎉</p>
            ) : (
              <div className="flex flex-col">
                {d.myPriority.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 border-b border-[var(--line-soft)] py-3 last:border-0"
                  >
                    <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: DUE_COLORS[p.bucket] }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-[var(--ink)]">{p.title}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-[var(--ink3)]">
                        {p.boardTitle}
                        {p.wsName ? ` · ${p.wsName}` : ''}
                      </p>
                    </div>
                    <span className={`chip ${DUE_CHIP[p.bucket] ?? ''} shrink-0`}>{p.bucket}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-6 lg:col-span-5">
            <CardHead title="Today's timeline" action="View calendar" />
            <div className="flex flex-col">
              {d.events.length === 0 && (
                <p className="py-4 text-center text-[14px] text-[var(--ink3)]">Nothing scheduled today 🎉</p>
              )}
              {d.events.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 border-b border-[var(--line-soft)] py-3 last:border-0"
                >
                  <span className="w-12 shrink-0 text-[12.5px] font-semibold tabular-nums text-[var(--ink2)]">
                    {t.time}
                  </span>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[t.type] }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[var(--ink)]">{t.title}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-[var(--ink3)]">{t.sub}</p>
                  </div>
                  <span className="chip shrink-0">{t.type}</span>
                  <Avatars n={t.people} />
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-6 lg:col-span-3">
            <CardHead title="Need approval" action="View all" />
            {d.approvals.length === 0 ? (
              <p className="py-4 text-center text-[14px] text-[var(--ink3)]">No approvals pending 🎉</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {d.approvals.map((a) => {
                  const Icon = APPROVAL_ICON[a.kind]
                  return (
                    <div key={a.id} className="rounded-[var(--r-md)] bg-[var(--col)] p-4">
                      <div className="flex items-center gap-2.5">
                        <Icon size={17} className="shrink-0 text-[var(--ink3)]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{a.title}</p>
                          <p className="truncate text-[12.5px] text-[var(--ink3)]">{a.sub}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold text-[var(--ink)]">{a.meta}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-primary px-4 py-2 text-[12.5px]"
                            onClick={() => handleResolve(a.id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            aria-label="Reject"
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sunk)] text-[var(--ink2)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-ink)]"
                            onClick={() => handleResolve(a.id, 'rejected')}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        {/* project radar + heatmap + portfolio + weekly */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <section className="panel p-6">
            <CardHead title="Project radar" action="View all" />
            <div className="flex flex-col gap-3.5">
              {d.projects.slice(0, 5).map((p) => (
                <div key={p.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{p.title}</p>
                      <p className="truncate text-[12px] text-[var(--ink3)]">{p.wsName}</p>
                    </div>
                    <span className="text-[13px] font-bold tabular-nums text-[var(--ink)]">{p.progress}%</span>
                  </div>
                  <Meter pct={p.progress} color={progressColor(p.progress)} />
                </div>
              ))}
              {d.projects.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No projects yet.</p>}
            </div>
          </section>

          <section className="panel p-6">
            <CardHead title={`Workload heatmap · ${d.monthLabel}`} />
            <div className="flex flex-col gap-1.5">
              {['W1', 'W2', 'W3', 'W4', 'W5'].map((w, r) => (
                <div key={w} className="flex items-center gap-1.5">
                  <span className="w-7 text-[11px] font-medium text-[var(--ink3)]">{w}</span>
                  {d.heatmap[r].map((intensity, c) => (
                    <span
                      key={c}
                      className="h-4 flex-1 rounded-[4px]"
                      style={{ background: `color-mix(in oklab, var(--accent) ${intensity}%, var(--sunk))` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end gap-1 text-[11px] font-medium text-[var(--ink3)]">
              Less
              {[10, 30, 55, 80].map((o) => (
                <span
                  key={o}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: `color-mix(in oklab, var(--accent) ${o}%, var(--sunk))` }}
                />
              ))}
              More
            </div>
          </section>

          <section className="panel p-6">
            <CardHead title="Portfolio overview" action="View report" />
            <div className="flex flex-col">
              {d.workspaces.slice(0, 4).map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-3 border-b border-[var(--line-soft)] py-3 last:border-0"
                >
                  {workspaceLogoFor(w.name) ? (
                    <img
                      src={workspaceLogoFor(w.name) as string}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-[14px] object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] text-[12px] font-bold text-[var(--card)]"
                      style={{ background: accentFor(w.id) }}
                    >
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{w.name}</p>
                    <p className="truncate text-[12px] text-[var(--ink3)]">
                      {w.projects} projects · {w.tasks} tasks
                    </p>
                  </div>
                  <Sparkline data={SPARK} color={progressColor(w.progress)} />
                </div>
              ))}
              {d.workspaces.length === 0 && <p className="text-[14px] text-[var(--ink3)]">No workspaces yet.</p>}
            </div>
          </section>

          <section className="panel p-6">
            <CardHead title="Weekly progress" action="This week" />
            <div className="mb-4 flex h-28 items-end gap-1.5">
              {d.weekProgress.map((b) => (
                <div key={b.d} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <div
                    className="w-full rounded-[5px]"
                    style={{ height: `${b.v}%`, background: b.v > 80 ? 'var(--accent)' : 'var(--sunk)' }}
                  />
                  <span className="text-[10.5px] font-medium text-[var(--ink3)]">{b.d}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <WeekStat n={d.stats.completed} label="Completed" />
              <WeekStat n={d.projectProgress.inProgress} label="On progress" />
              <WeekStat n={d.stats.overdue} label="Overdue" />
              <WeekStat n={Math.max(0, d.stats.totalTasks - d.stats.completed)} label="Not started" />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function WeekStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-[14px] bg-[var(--col)] p-3">
      <p className="text-[20px] font-bold leading-none tracking-[-0.02em] text-[var(--ink)]">{n}</p>
      <p className="mt-1 text-[11.5px] text-[var(--ink3)]">{label}</p>
    </div>
  )
}

import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  AlertTriangle,
  Banknote,
  FileText,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react'
import { Building2, Clock, Flame, FolderKanban, ListChecks } from '@/components/pixel-icons'
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

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const STAT_META = [
  { key: 'workspaces', icon: Building2, label: 'Workspaces', tint: 'var(--accent)' },
  { key: 'projects', icon: FolderKanban, label: 'Projects', tint: '#7c3aed' },
  { key: 'totalTasks', icon: ListChecks, label: 'Total tasks', tint: '#2563eb' },
  { key: 'dueToday', icon: Clock, label: 'Due today', tint: '#d97706' },
  { key: 'overdue', icon: Flame, label: 'Need attention', tint: 'var(--danger)' },
  { key: 'completed', icon: TrendingUp, label: 'Completed', tint: 'var(--accent)' },
] as const

const HEALTH_COLORS: Record<string, string> = {
  Healthy: 'var(--accent)',
  'Need attention': '#d9a406',
  'Behind schedule': 'var(--danger)',
}
const DUE_COLORS: Record<string, string> = {
  Overdue: 'var(--danger)',
  'Due today': '#d97706',
  'Due tomorrow': '#2563eb',
  'Due soon': 'var(--ink3)',
}
function progressColor(pct: number): string {
  if (pct >= 80) return 'var(--accent)'
  if (pct >= 45) return '#d9a406'
  return 'var(--danger)'
}

// ---- static panels (no data source yet) ----
const AI_ITEMS = [
  { icon: AlertTriangle, tint: 'var(--danger)', title: 'Produksi Gentanala terlambat 2 hari', sub: '3 task overdue' },
  { icon: Lightbulb, tint: '#d9a406', title: 'Konten minggu depan masih kosong', sub: '2 konten belum dijadwalkan' },
  { icon: TrendingUp, tint: 'var(--accent)', title: 'Revenue Disma Fresh naik 14% minggu ini', sub: 'Rp 4.2M (+14%)' },
  { icon: Truck, tint: '#2563eb', title: 'Supplier packaging belum approve', sub: 'Menunggu dari PT. Kayu Abadi' },
]
const TYPE_COLORS: Record<string, string> = {
  Meeting: '#7c3aed',
  Approval: '#2563eb',
  Call: '#0891b2',
  Review: '#d97706',
  Content: '#db2777',
}
const APPROVAL_ICON: Record<ApprovalKind, typeof Banknote> = {
  budget: Banknote,
  leave: FileText,
  content: ImageIcon,
}
const SPARK = [4, 6, 5, 8, 7, 9, 11]

function CardHead({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">{title}</h3>
      {action && (
        <button type="button" className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
          {action} →
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
          className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ background: ['#7c3aed', '#2563eb', '#db2777'][i % 3] }}
        >
          {String.fromCharCode(65 + i)}
        </span>
      ))}
      {n > 3 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--col)] text-[9px] font-bold text-[var(--ink2)]">
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--col)]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
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
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
        {/* stats */}
        <div className="card flex flex-wrap items-stretch p-0">
          {STAT_META.map(({ icon: Icon, key, label, tint }, i) => (
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
                <p className="display-title text-xl font-extrabold leading-none text-[var(--ink)]">
                  {d.stats[key]}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-[var(--ink2)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* workspace health + AI summary */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="card p-4 lg:col-span-8">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                Workspace Health <Info size={12} className="text-[var(--ink3)]" />
              </h3>
              <button type="button" className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
                View all workspaces →
              </button>
            </div>
            {d.workspaces.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--ink3)]">No workspaces yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {d.workspaces.slice(0, 4).map((w) => (
                  <div key={w.id} className="rounded-[10px] border-2 border-[var(--ink)] bg-[var(--card)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      {workspaceLogoFor(w.name) ? (
                        <img
                          src={workspaceLogoFor(w.name) as string}
                          alt=""
                          className="h-7 w-7 rounded-[7px] object-cover"
                        />
                      ) : (
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[11px] font-extrabold text-white"
                          style={{ background: accentFor(w.id) }}
                        >
                          {w.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <Star
                        size={14}
                        className={w.progress >= 80 ? 'fill-[#f5c451] text-[#f5c451]' : 'text-[var(--ink3)]'}
                      />
                    </div>
                    <p className="truncate text-[13px] font-bold text-[var(--ink)]">{w.name}</p>
                    <div className="my-2 flex h-14 items-end justify-center gap-1" aria-hidden="true">
                      {[8, 12, 6, 14, 10].map((h, i) => (
                        <span
                          key={i}
                          className="w-2 rounded-t-sm border border-[var(--ink)]"
                          style={{ height: `${h * 3}px`, background: 'color-mix(in oklab, var(--ink) 12%, var(--card))' }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Meter pct={w.progress} color={HEALTH_COLORS[w.status]} />
                      </div>
                      <span
                        className="shrink-0 whitespace-nowrap text-[12px] font-extrabold"
                        style={{ color: HEALTH_COLORS[w.status] }}
                      >
                        {w.progress}%
                      </span>
                    </div>
                    <span
                      className="chip mt-2"
                      style={{
                        background: `color-mix(in oklab, ${HEALTH_COLORS[w.status]} 16%, transparent)`,
                        color: HEALTH_COLORS[w.status],
                        borderColor: HEALTH_COLORS[w.status],
                      }}
                    >
                      {w.status}
                    </span>
                    <p className="mt-2 text-[11px] font-semibold text-[var(--ink3)]">
                      {w.projects} Projects · {w.tasks} Tasks
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AI SUMMARY — Coming Soon */}
          <section className="card relative overflow-hidden p-4 lg:col-span-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                <Sparkles size={13} className="text-[var(--accent)]" /> AI Summary
              </h3>
            </div>
            <div className="pointer-events-none space-y-2 opacity-40 blur-[1.5px]">
              {AI_ITEMS.map((it) => (
                <div key={it.title} className="flex gap-2 rounded-[10px] border-2 border-[var(--line)] p-2">
                  <it.icon size={16} style={{ color: it.tint }} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-[var(--ink)]">{it.title}</p>
                    <p className="truncate text-[11px] text-[var(--ink3)]">{it.sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="chip bg-[var(--pop-soft)] text-[var(--pop-ink)]" style={{ borderColor: 'var(--pop-ink)' }}>
                🤖 Coming Soon
              </span>
            </div>
          </section>
        </div>

        {/* priority radar + timeline + approvals */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="card p-4 lg:col-span-4">
            <CardHead title="Priority Radar" action="View all" />
            {d.myPriority.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--ink3)]">Nothing urgent 🎉</p>
            ) : (
              <div className="flex flex-col">
                {d.myPriority.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 last:border-0">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: DUE_COLORS[p.bucket] }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-[var(--ink)]">{p.title}</p>
                      <p className="truncate text-[11px] text-[var(--ink3)]">
                        {p.boardTitle}
                        {p.wsName ? ` • ${p.wsName}` : ''}
                      </p>
                    </div>
                    <span
                      className="chip shrink-0"
                      style={{
                        background: `color-mix(in oklab, ${DUE_COLORS[p.bucket]} 16%, transparent)`,
                        color: DUE_COLORS[p.bucket],
                        borderColor: DUE_COLORS[p.bucket],
                      }}
                    >
                      {p.bucket}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card p-4 lg:col-span-5">
            <CardHead title="Today's Timeline" action="View calendar" />
            <div className="flex flex-col">
              {d.events.length === 0 && (
                <p className="py-4 text-center text-sm text-[var(--ink3)]">Nothing scheduled today 🎉</p>
              )}
              {d.events.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0">
                  <span className="w-11 shrink-0 text-[12px] font-bold tabular-nums text-[var(--ink2)]">{t.time}</span>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[t.type] }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[var(--ink)]">{t.title}</p>
                    <p className="truncate text-[11px] text-[var(--ink3)]">{t.sub}</p>
                  </div>
                  <span
                    className="chip shrink-0"
                    style={{
                      background: `color-mix(in oklab, ${TYPE_COLORS[t.type]} 16%, transparent)`,
                      color: TYPE_COLORS[t.type],
                      borderColor: TYPE_COLORS[t.type],
                    }}
                  >
                    {t.type}
                  </span>
                  <Avatars n={t.people} />
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4 lg:col-span-3">
            <CardHead title="Need Approval" action="View all" />
            {d.approvals.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--ink3)]">No approvals pending 🎉</p>
            ) : (
              <div className="flex flex-col gap-2">
                {d.approvals.map((a) => {
                  const Icon = APPROVAL_ICON[a.kind]
                  return (
                    <div key={a.id} className="rounded-[10px] border-2 border-[var(--line)] p-2.5">
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="shrink-0 text-[var(--ink2)]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-bold text-[var(--ink)]">{a.title}</p>
                          <p className="truncate text-[11px] text-[var(--ink3)]">{a.sub}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[12px] font-bold text-[var(--ink)]">{a.meta}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="btn btn-primary px-3 py-1 text-[12px]"
                            onClick={() => handleResolve(a.id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            aria-label="Reject"
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--line)] text-[var(--ink2)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <section className="card p-4">
            <CardHead title="Project Radar" action="View all projects" />
            <div className="flex flex-col gap-2.5">
              {d.projects.slice(0, 5).map((p) => (
                <div key={p.id}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: progressColor(p.progress) }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold text-[var(--ink)]">{p.title}</p>
                      <p className="truncate text-[10px] text-[var(--ink3)]">{p.wsName}</p>
                    </div>
                    <span className="text-[12px] font-extrabold text-[var(--ink2)]">{p.progress}%</span>
                  </div>
                  <Meter pct={p.progress} color={progressColor(p.progress)} />
                </div>
              ))}
              {d.projects.length === 0 && <p className="text-sm text-[var(--ink3)]">No projects yet.</p>}
            </div>
          </section>

          <section className="card p-4">
            <CardHead title={`Workload Heatmap (${d.monthLabel})`} />
            <div className="flex flex-col gap-1.5">
              {['W1', 'W2', 'W3', 'W4', 'W5'].map((w, r) => (
                <div key={w} className="flex items-center gap-1.5">
                  <span className="w-6 text-[10px] font-bold text-[var(--ink3)]">{w}</span>
                  {d.heatmap[r].map((intensity, c) => (
                    <span
                      key={c}
                      className="h-4 flex-1 rounded-[3px] border border-[var(--line)]"
                      style={{ background: `color-mix(in oklab, var(--accent) ${intensity}%, var(--col))` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold text-[var(--ink3)]">
              Less
              {[10, 30, 55, 80].map((o) => (
                <span
                  key={o}
                  className="h-3 w-3 rounded-[2px]"
                  style={{ background: `color-mix(in oklab, var(--accent) ${o}%, var(--col))` }}
                />
              ))}
              More
            </div>
          </section>

          <section className="card p-4">
            <CardHead title="Portfolio Overview" action="View report" />
            <div className="flex flex-col">
              {d.workspaces.slice(0, 4).map((w) => (
                <div key={w.id} className="flex items-center gap-2 border-b border-[var(--line)] py-2 last:border-0">
                  {workspaceLogoFor(w.name) ? (
                    <img
                      src={workspaceLogoFor(w.name) as string}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-[7px] object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-extrabold text-white"
                      style={{ background: accentFor(w.id) }}
                    >
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-[var(--ink)]">{w.name}</p>
                    <p className="truncate text-[10px] text-[var(--ink3)]">
                      {w.projects} Projects · {w.tasks} Tasks
                    </p>
                  </div>
                  <Sparkline data={SPARK} color={progressColor(w.progress)} />
                </div>
              ))}
              {d.workspaces.length === 0 && <p className="text-sm text-[var(--ink3)]">No workspaces yet.</p>}
            </div>
          </section>

          <section className="card p-4">
            <CardHead title="Weekly Progress" action="This week" />
            <div className="mb-3 flex h-28 items-end gap-1.5">
              {d.weekProgress.map((b) => (
                <div key={b.d} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-t-[4px] border-2 border-[var(--ink)]"
                    style={{
                      height: `${b.v}%`,
                      background: b.v > 80 ? 'var(--accent)' : 'color-mix(in oklab, var(--accent) 35%, var(--col))',
                    }}
                  />
                  <span className="text-[9px] font-semibold text-[var(--ink3)]">{b.d}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <WeekStat n={d.stats.completed} label="Completed" />
              <WeekStat n={d.projectProgress.inProgress} label="On Progress" />
              <WeekStat n={d.stats.overdue} label="Overdue" />
              <WeekStat n={Math.max(0, d.stats.totalTasks - d.stats.completed)} label="Not Started" />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function WeekStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--line)] p-2">
      <p className="display-title text-base font-extrabold leading-none text-[var(--ink)]">{n}</p>
      <p className="text-[10px] font-semibold text-[var(--ink3)]">{label}</p>
    </div>
  )
}

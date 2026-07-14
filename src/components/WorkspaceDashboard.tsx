import { useEffect, useState, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { Award, Bot, Plus, Sparkles, Trophy, Users } from 'lucide-react'
import { Flame, FolderKanban, ListChecks } from '@/components/pixel-icons'

// ponytail: presentational workspace dashboard matching the mockup. Real data
// is passed in by the route (stats, projects, schedule, members, status
// breakdown, activity). AI Summary is a Coming Soon shell; Achievements are
// static (no gamification backend); per-member online/status has no presence
// source so we show role instead.

export type WsMember = { name: string | null; role: string | null; avatar_url: string | null }
export type WsProject = { id: string; title: string; progress: number; members: Array<{ name: string | null; avatar_url: string | null }> }
export type WsScheduleItem = { id: string; title: string; tag: string | null; tagColor: string; boardId: string }
export type WsActivity = { id: string; text: string; when: string; author: string | null }
export type WsBreakdown = { done: number; inProgress: number; todo: number; blocked: number; total: number }

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}
function initials(name: string | null): string {
  if (!name) return '?'
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

function statusLabel(pct: number): { text: string; color: string } {
  if (pct >= 80) return { text: 'Healthy Workspace', color: 'var(--accent)' }
  if (pct >= 45) return { text: 'Needs Attention', color: '#d9a406' }
  return { text: 'Behind Schedule', color: 'var(--danger)' }
}

function Avatar({ name, url, i = 0 }: { name: string | null; url?: string | null; i?: number }) {
  if (url) return <img src={url} alt="" className="h-7 w-7 rounded-full border-2 border-[var(--card)] object-cover" />
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--card)] text-[10px] font-bold text-white"
      style={{ background: ACCENTS[i % ACCENTS.length] }}
    >
      {initials(name)}
    </span>
  )
}

function SegBar({ pct, color, blocks = 10 }: { pct: number; color: string; blocks?: number }) {
  const on = Math.round((Math.max(0, Math.min(100, pct)) / 100) * blocks)
  return (
    <span className="inline-flex flex-1 gap-[3px]">
      {Array.from({ length: blocks }).map((_, i) => (
        <span
          key={i}
          className="h-3 flex-1 rounded-[2px] border-[1.5px] border-[var(--ink)]"
          style={{ background: i < on ? color : 'var(--col)' }}
        />
      ))}
    </span>
  )
}

function Donut({ b }: { b: WsBreakdown }) {
  const total = b.total || 1
  const segs = [
    { n: b.done, c: 'var(--accent)' },
    { n: b.inProgress, c: '#2563eb' },
    { n: b.todo, c: 'var(--ink3)' },
    { n: b.blocked, c: 'var(--danger)' },
  ]
  const r = 38
  const c = 2 * Math.PI * r
  let off = 0
  return (
    <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0">
      <circle cx="56" cy="56" r={r} fill="none" stroke="var(--col)" strokeWidth="14" />
      {segs.map((s, i) => {
        const len = (s.n / total) * c
        const el = (
          <circle key={i} cx="56" cy="56" r={r} fill="none" stroke={s.c} strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 56 56)" />
        )
        off += len
        return el
      })}
      <text x="56" y="52" textAnchor="middle" className="display-title fill-[var(--ink)] text-lg font-extrabold">{b.total}</text>
      <text x="56" y="68" textAnchor="middle" className="fill-[var(--ink3)] text-[9px] font-bold">Total Tasks</text>
    </svg>
  )
}

const ACHIEVEMENTS = [
  { icon: Trophy, label: 'Perfect Week', sub: 'No overdue tasks', tint: '#d9a406', bg: 'var(--pop-soft)' },
  { icon: Flame, label: '7 Days Streak', sub: 'Active every day', tint: 'var(--danger)', bg: 'color-mix(in oklab, var(--danger) 12%, transparent)' },
  { icon: Award, label: 'Tree Planter', sub: '100 tasks done', tint: 'var(--accent)', bg: 'var(--accent-soft)' },
  { icon: Sparkles, label: 'Top Performer', sub: 'High completion', tint: '#2563eb', bg: 'color-mix(in oklab, #2563eb 12%, transparent)' },
]

function Head({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">{title}</h3>
      {action && (
        <button type="button" onClick={onAction} className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
          {action} →
        </button>
      )}
    </div>
  )
}

export default function WorkspaceDashboard({
  workspaceId,
  name,
  progress,
  totalTasks,
  overdue,
  membersCount,
  activeProjects,
  projects,
  schedule,
  members,
  breakdown,
  activity,
  onManageTeam,
  onNewProject,
}: {
  workspaceId: string
  name: string
  progress: number
  totalTasks: number
  overdue: number
  membersCount: number
  activeProjects: number
  projects: WsProject[]
  schedule: WsScheduleItem[]
  members: WsMember[]
  breakdown: WsBreakdown
  activity: WsActivity[]
  onManageTeam: () => void
  onNewProject: () => void
}) {
  const st = statusLabel(progress)
  const [clock, setClock] = useState('')
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
        {/* workspace header */}
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-[12px] font-semibold text-[var(--ink3)] no-underline hover:text-[var(--ink)]">
            ← Workspaces
          </Link>
          <span
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border-2 border-[var(--ink)] text-lg font-extrabold text-white"
            style={{ background: accentFor(workspaceId) }}
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">{name}</h1>
              <span className="chip">Workspace</span>
            </div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: st.color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: st.color }} />
              {st.text}
              <span className="ml-1 flex items-center gap-1 text-[var(--ink3)]">
                <Users size={12} /> {membersCount} members
              </span>
            </p>
          </div>
          <span className="ml-auto text-[12px] font-semibold tabular-nums text-[var(--ink3)]">{clock}</span>
        </div>

        {/* today's overview */}
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <OverviewStat icon={ListChecks} n={totalTasks} label="Tasks" tint="#2563eb" />
          <OverviewStat icon={Flame} n={overdue} label="Overdue" tint="var(--danger)" />
          <OverviewStat icon={Users} n={membersCount} label="Members" tint="#7c3aed" />
          <OverviewStat icon={FolderKanban} n={activeProjects} label="Active Projects" tint="var(--accent)" />
          <div className="ml-auto flex min-w-[200px] flex-1 items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">Overall Progress</p>
              <SegBar pct={progress} color="var(--accent)" blocks={12} />
            </div>
            <span className="display-title text-xl font-extrabold text-[var(--accent-ink)]">{progress}%</span>
          </div>
        </div>

        {/* AI summary + schedule + active projects */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* AI summary — Coming Soon */}
          <section className="card relative overflow-hidden p-4">
            <Head title="AI Summary" />
            <div className="pointer-events-none flex gap-2 opacity-40 blur-[1.5px]">
              <Bot size={40} className="shrink-0 text-[var(--accent)]" />
              <p className="text-[13px] text-[var(--ink2)]">
                {name} is doing well! Consider reviewing projects that are behind schedule.
              </p>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="chip bg-[var(--pop-soft)] text-[var(--pop-ink)]" style={{ borderColor: 'var(--pop-ink)' }}>
                🤖 Coming Soon
              </span>
            </div>
          </section>

          {/* upcoming schedule */}
          <section className="card p-4">
            <Head title="Upcoming Schedule" />
            <div className="flex flex-col">
              {schedule.length === 0 && <p className="py-2 text-sm text-[var(--ink3)]">Nothing scheduled today.</p>}
              {schedule.map((s) => (
                <Link
                  key={s.id}
                  to="/board/$boardId"
                  params={{ boardId: s.boardId }}
                  className="flex items-center gap-3 border-b border-[var(--line)] py-2 no-underline last:border-0 hover:bg-[var(--col)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[var(--ink)]">{s.title}</p>
                    {s.tag && (
                      <span className="text-[11px] font-bold" style={{ color: s.tagColor }}>
                        {s.tag}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* active projects */}
          <section className="card p-4">
            <Head title="Active Projects" />
            <div className="flex flex-col gap-3">
              {projects.length === 0 && <p className="text-sm text-[var(--ink3)]">No active projects.</p>}
              {projects.slice(0, 5).map((p) => (
                <div key={p.id}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: accentFor(p.id) }} />
                    <Link
                      to="/board/$boardId"
                      params={{ boardId: p.id }}
                      className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--ink)] no-underline hover:underline"
                    >
                      {p.title}
                    </Link>
                    <span className="text-[12px] font-extrabold" style={{ color: accentFor(p.id) }}>{p.progress}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SegBar pct={p.progress} color={accentFor(p.id)} />
                    <span className="flex -space-x-1.5">
                      {p.members.slice(0, 3).map((m, i) => (
                        <Avatar key={i} name={m.name} url={m.avatar_url} i={i} />
                      ))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* team members + achievements */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <Head title="Team Members" action="Manage" onAction={onManageTeam} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {members.length === 0 && <p className="text-sm text-[var(--ink3)]">No members yet.</p>}
              {members.slice(0, 4).map((m, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 rounded-[10px] border-2 border-[var(--line)] p-2 text-center">
                  <Avatar name={m.name} url={m.avatar_url} i={i} />
                  <p className="w-full truncate text-[12px] font-bold text-[var(--ink)]">{m.name ?? 'Member'}</p>
                  <p className="w-full truncate text-[10px] capitalize text-[var(--ink3)]">{m.role ?? 'member'}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <Head title="Achievements" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ACHIEVEMENTS.map((a) => (
                <div key={a.label} className="flex flex-col items-center gap-1 rounded-[10px] border-2 border-[var(--ink)] p-2.5 text-center" style={{ background: a.bg }}>
                  <a.icon size={20} style={{ color: a.tint }} />
                  <p className="text-[11px] font-extrabold text-[var(--ink)]">{a.label}</p>
                  <p className="text-[9px] text-[var(--ink3)]">{a.sub}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* team overview + recent activity */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <Head title="Team Overview" />
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1 space-y-2.5">
                <BreakRow label="Done" n={breakdown.done} total={breakdown.total} color="var(--accent)" />
                <BreakRow label="In Progress" n={breakdown.inProgress} total={breakdown.total} color="#2563eb" />
                <BreakRow label="To Do" n={breakdown.todo} total={breakdown.total} color="var(--ink3)" />
                <BreakRow label="Blocked" n={breakdown.blocked} total={breakdown.total} color="var(--danger)" />
              </div>
              <Donut b={breakdown} />
            </div>
          </section>

          <section className="card p-4">
            <Head title="Recent Activity" />
            <div className="flex flex-col gap-2.5">
              {activity.length === 0 && <p className="text-sm text-[var(--ink3)]">No recent activity.</p>}
              {activity.slice(0, 6).map((a, i) => (
                <div key={a.id} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0"><Avatar name={a.author} i={i} /></span>
                  <p className="text-[12px] leading-snug text-[var(--ink2)]">
                    <b className="text-[var(--ink)]">{a.author ?? 'Someone'}</b> {a.text}
                    <span className="block text-[10px] text-[var(--ink3)]">{a.when}</span>
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* floating new-project */}
        <button
          type="button"
          onClick={onNewProject}
          aria-label="New project"
          className="btn btn-primary fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full p-0"
        >
          <Plus size={22} />
        </button>
      </div>
    </main>
  )
}

function OverviewStat({ icon: Icon, n, label, tint }: { icon: ComponentType<{ size?: number; className?: string }>; n: number; label: string; tint: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--ink)]"
        style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
      >
        <Icon size={17} />
      </span>
      <div>
        <p className="display-title text-lg font-extrabold leading-none text-[var(--ink)]">{n}</p>
        <p className="text-[11px] font-semibold text-[var(--ink2)]">{label}</p>
      </div>
    </div>
  )
}

function BreakRow({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-2 font-semibold text-[var(--ink2)]">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="font-bold text-[var(--ink)]">{n} <span className="text-[var(--ink3)]">({pct}%)</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--col)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

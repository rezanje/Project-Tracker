import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { completeCardFn, completeStandaloneTaskFn } from '#/lib/actions'
import { isDoneColumn, isInProgressColumn } from '#/lib/home'
import { inScope, useScope } from '#/lib/workspace-scope'
import { fetchDashboard, type DashboardData, type DashProjectMember, type DashTask } from '#/lib/dashboard'
import { fetchPendingApprovalsFn, type ApprovalRequest } from '#/lib/approval-requests'
import { fetchMyKpiTrendFn, type KpiTrend } from '#/lib/goals'
import CommandCenter from '#/components/CommandCenter'
import { toast } from '#/components/Toast'

/** The 3px lane bar, same reading as the task-detail sheet's. */
function barColor(title: string): string {
  if (isDoneColumn(title)) return 'var(--ink)'
  if (isInProgressColumn(title)) return 'var(--accent)'
  if (/review|approv/i.test(title)) return 'var(--done)'
  return 'var(--ink3)'
}

// The comp's Home is three things and nothing else: the KPI teaser, the
// projects of the current workspace, and what's due today. Goals moved to
// Reports; notes and announcements to the Command Center; note, reminder,
// task and project creation to the "+ New" menu and the FAB.

export const Route = createFileRoute('/home')({
  loader: async (): Promise<HomeData> => {
    const [dashboard, approvals, kpiTrend] = await Promise.all([
      fetchDashboard(),
      fetchPendingApprovalsFn().catch(() => [] as ApprovalRequest[]),
      fetchMyKpiTrendFn().catch(() => null as KpiTrend | null),
    ])
    return { ...dashboard, approvals: approvals.length, kpiTrend }
  },
  component: Home,
})

type HomeData = DashboardData & { approvals: number; kpiTrend: KpiTrend | null }

/** Continuous progress track. */
function Bar({ pct, color = 'var(--ink)' }: { pct: number; color?: string }) {
  return (
    <div className="progress-track w-full">
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  )
}

/** Bar sparkline. The tallest column carries the one accent; the rest are
 *  tone. A flat-zero week (a real project with nothing completed in the
 *  window, not missing data) draws as even short bars rather than dividing
 *  by zero into NaN heights or lying with an empty one. */
function MiniBars({ data, className = 'h-8' }: { data: number[]; className?: string }) {
  const max = Math.max(0, ...data)
  return (
    <div className={`flex items-end gap-1.5 ${className}`}>
      {data.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[3px]"
          style={{
            height: max > 0 ? `${(v / max) * 100}%` : '8%',
            background: max > 0 && v === max ? 'var(--accent)' : 'var(--sunk)',
          }}
        />
      ))}
    </div>
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

/** A "due today" card: lane bar, title, round checkbox, lane name, assignee. */
function TodayCard({
  task,
  onComplete,
  busy,
}: {
  task: DashTask
  onComplete: (task: DashTask) => void
  busy: boolean
}) {
  return (
    <div className="flex gap-3 rounded-[20px] bg-[var(--card)] px-4 py-[15px] shadow-[var(--shadow-sm)] transition hover:-translate-y-px">
      <span
        className="w-[3px] shrink-0 self-stretch rounded-full"
        style={{ background: barColor(task.status) }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {task.boardId ? (
            <Link
              to="/board/$boardId"
              params={{ boardId: task.boardId }}
              className="min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.35] text-[var(--ink)] no-underline"
            >
              {task.title}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.35] text-[var(--ink)]">
              {task.title}
            </span>
          )}
          {/* Content-calendar cards have no Done column to move into — their
              status is draft/scheduled/posted, set from the board itself. */}
          {!task.isContent && (
            <button
              type="button"
              onClick={() => onComplete(task)}
              disabled={busy}
              aria-label={`Tandai "${task.title}" selesai`}
              className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-transparent shadow-[inset_0_0_0_1.8px_var(--sunk)] transition hover:text-[var(--ink3)] active:scale-90 disabled:opacity-40"
            >
              <Check size={12} strokeWidth={3.2} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="mt-[3px] text-[13px] text-[var(--ink3)]">{task.status}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2.5">
          {task.assignee ? (
            <span
              title={task.assignee.name}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: accentFor(task.assignee.id) }}
            >
              {task.assignee.avatar_url ? (
                <img src={task.assignee.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                (task.assignee.name.trim().split(/\s+/)[0]?.[0] ?? '?').toUpperCase()
              )}
            </span>
          ) : (
            <span />
          )}
          <span className="text-[12.5px] font-medium text-[var(--ink2)]">{task.boardTitle}</span>
        </div>
      </div>
    </div>
  )
}

function Home() {
  const d = Route.useLoaderData() as HomeData
  const router = useRouter()
  const scope = useScope()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function complete(task: DashTask) {
    setBusyId(task.id)
    try {
      if (task.boardId) await completeCardFn({ data: { cardId: task.id } })
      else await completeStandaloneTaskFn({ data: { id: task.id } })
      toast('Task selesai ✓')
      router.invalidate()
    } catch {
      toast('Gagal menandai selesai')
    } finally {
      setBusyId(null)
    }
  }

  const myToday = d.myToday.filter((t) => inScope(scope, t.wsId))
  const projects = d.projects.filter((p) => inScope(scope, p.wsId))

  const total = d.myStats.total
  const overallPct = total ? Math.round((d.myStats.completed / total) * 100) : 0

  // Home is the level indicator. "Semua workspace" is the account level, so it
  // shows every company at once; inside a workspace it shows that company's
  // day. Two views, one tab — which is why the Command Center never needed a
  // nav entry of its own.
  if (scope === 'all') {
    return (
      <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
        <div className="gt-fade mx-auto flex max-w-[900px] flex-col">
          <CommandCenter d={d} />
        </div>
      </main>
    )
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5">
        {/* KPI TEASER — what the prototype's Home leads with, now backed by real
            check-in history (kpiTrendBars, src/lib/goals.ts) instead of a fixed
            shape. Hidden outright when the signed-in user has no active KPI:
            an empty or fabricated chart would be worse than no card at all. */}
        {d.kpiTrend && (
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
              {/* Height reads against target (not this window's own tallest
                  bar), so a short bar honestly means "far from goal" rather
                  than just "smaller than another bar in view". */}
              <div className="mt-4 flex h-[66px] items-end gap-[5px]">
                {d.kpiTrend.bars.map((v, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-[5px]"
                    style={{
                      height: `${Math.max(4, v)}%`,
                      background: i === d.kpiTrend!.bars.length - 1 ? 'var(--accent)' : 'var(--sunk)',
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PROJECTS */}
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
          {projects.length === 0 ? (
            <p className="text-[14px] text-[var(--ink3)]">No projects yet.</p>
          ) : (
            <div className="gt-scroll -mx-5 flex gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to="/board/$boardId"
                  params={{ boardId: p.id }}
                  className="panel card-hover w-[200px] shrink-0 p-5 no-underline md:w-auto"
                >
                  {/* Real per-day completions (dashboard.ts computeWeeklyCompletions),
                      last 7 local days — not a fixed shape shared by every card. */}
                  <MiniBars data={p.weeklyCompletions} className="mb-4 h-[52px]" />
                  <p className="truncate text-[16px] font-bold tracking-[-0.015em] text-[var(--ink)]">{p.title}</p>
                  <p className="mt-1 text-[13px] text-[var(--ink3)]">
                    {p.done} / {p.total} tasks
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <Bar pct={p.progress} />
                    <span className="shrink-0 text-[13px] font-bold text-[var(--ink)]">{p.progress}%</span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <ProjectAvatars members={p.members} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* TASK HARI INI — one card per task, as the comp draws it. The comp's
            clock time ("Today · 10:15am") is omitted: cards carry a due date,
            not a due time. */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Task hari ini</h2>
            <Link
              to="/my-tasks"
              className="text-[13.5px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--accent)]"
            >
              See all
            </Link>
          </div>
          {myToday.length === 0 ? (
            <div className="rounded-[20px] bg-[var(--col)] px-[18px] py-7 text-center">
              <p className="text-[14.5px] font-bold text-[var(--ink)]">Clear semua 🎉</p>
              <p className="mt-1 text-[13px] text-[var(--ink3)]">
                {total} task total · {d.myStats.overdue} telat · {overallPct}% selesai
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {myToday.map((t) => (
                <TodayCard key={t.id} task={t} onComplete={complete} busy={busyId === t.id} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

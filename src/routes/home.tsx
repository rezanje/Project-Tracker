import { createFileRoute, Link } from '@tanstack/react-router'
import { Flame } from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { inScope, useScope } from '#/lib/workspace-scope'
import { fetchDashboard, type DashboardData, type DashProjectMember } from '#/lib/dashboard'

// The comp's Home is three things and nothing else: the KPI teaser, the
// projects of the current workspace, and what's due today. Goals moved to
// Reports; notes and announcements to the Command Center; note, reminder,
// task and project creation to the "+ New" menu and the FAB.

export const Route = createFileRoute('/home')({
  loader: async () => await fetchDashboard(),
  component: Home,
})

const KPI_BARS = [4, 6, 5, 7, 6, 8, 9]

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

function Home() {
  const d = Route.useLoaderData() as DashboardData
  const scope = useScope()

  const myToday = d.myToday.filter((t) => inScope(scope, t.wsId))
  const projects = d.projects.filter((p) => inScope(scope, p.wsId))

  const total = d.myStats.total
  const overallPct = total ? Math.round((d.myStats.completed / total) * 100) : 0

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5">
        {/* KPI TEASER — what the prototype's Home leads with. The trend badge the
            comp shows is omitted: there is no revenue history to derive it from,
            and a hard-coded percentage would read as real. */}
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
              {projects.slice(0, 3).map((p) => (
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
            {myToday.length === 0 && (
              <p className="py-3 text-[14px] text-[var(--ink3)]">Nothing due today 🎉</p>
            )}
            {myToday.map((t) => (
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
      </div>
    </main>
  )
}

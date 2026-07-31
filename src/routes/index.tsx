import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Check } from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { fetchPendingApprovalsFn, type ApprovalRequest } from '#/lib/approval-requests'
import { setScope } from '#/lib/workspace-scope'
import { workspaceLogoFor } from '#/lib/workspace-logos'
import { NotificationsBell } from '#/components/Header'
import ThemeToggle from '#/components/ThemeToggle'
import { WorkspacePill, WorkspaceSwitcherSheet } from '#/components/WorkspaceSwitcher'

type CommandCenterData = DashboardData & { approvalList: ApprovalRequest[] }

export const Route = createFileRoute('/')({
  loader: async (): Promise<CommandCenterData> => {
    const [dashboard, approvalList] = await Promise.all([
      fetchDashboard(),
      fetchPendingApprovalsFn().catch(() => [] as ApprovalRequest[]),
    ])
    return { ...dashboard, approvalList }
  },
  component: CommandCenter,
})

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

/** A stat tile. Pass `to` to make it a doorway — the approvals queue lives
 *  behind the Approval count rather than in a menu of its own. */
function Stat({
  label,
  value,
  accent,
  to,
}: {
  label: string
  value: number
  accent?: boolean
  to?: '/reports'
}) {
  const body = (
    <>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">{label}</p>
      <p
        className={`mt-[5px] text-[26px] font-extrabold tabular-nums tracking-[-0.03em] ${
          accent ? 'text-[var(--accent)]' : 'text-[var(--ink)]'
        }`}
      >
        {value}
      </p>
    </>
  )
  const cls = 'flex-1 rounded-[22px] bg-[var(--card)] p-[15px] shadow-[var(--shadow)]'
  if (!to) return <div className={cls}>{body}</div>
  return (
    <Link to={to} className={`${cls} block no-underline transition hover:-translate-y-0.5 active:scale-[.99]`}>
      {body}
    </Link>
  )
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--col)] px-[18px] py-7 text-center">
      <p className="text-[14.5px] font-bold text-[var(--ink)]">{title}</p>
      <p className="mt-[5px] text-[13px] text-[var(--ink3)]">{sub}</p>
    </div>
  )
}

function CommandCenter() {
  const d = Route.useLoaderData() as CommandCenterData
  const navigate = useNavigate()
  const [wsOpen, setWsOpen] = useState(false)

  const active = Math.max(0, d.stats.totalTasks - d.stats.completed)
  // "Butuh perhatian" in the design is late ∪ in-review. The aggregation
  // exposes due buckets but not column names, so this is the late half only.
  const attention = d.priority.filter((p) => p.bucket === 'Overdue')

  function openWorkspace(id: string) {
    setScope(id)
    navigate({ to: '/home' })
  }

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="gt-fade mx-auto flex max-w-[560px] flex-col gap-[18px]">
        {/* header */}
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="mb-2.5">
              <WorkspacePill onOpen={() => setWsOpen(true)} />
            </div>
            <h1 className="text-[27px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[var(--ink)]">
              Command center
            </h1>
            <p className="mt-[5px] text-[13.5px] text-[var(--ink2)]">
              {d.stats.workspaces} perusahaan · {d.stats.projects} project aktif
            </p>
          </div>
          <NotificationsBell compact />
          <ThemeToggle />
        </div>

        {/* stat tiles */}
        <div className="flex gap-2.5">
          <Stat label="Aktif" value={active} />
          <Stat label="Telat" value={d.stats.overdue} accent />
          <Stat label="Approval" value={d.approvals} to="/reports" />
        </div>

        {/* workspace cards */}
        <section>
          <h2 className="mb-3 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Workspace kamu</h2>
          <div className="flex flex-col gap-2.5">
            {d.workspaces.length === 0 && (
              <Empty title="Belum ada workspace" sub="Bikin satu lewat tombol pindah workspace." />
            )}
            {d.workspaces.map((w) => {
              const logo = workspaceLogoFor(w.name)
              const tone = accentFor(w.id)
              const done = Math.round((w.tasks * w.progress) / 100)
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => openWorkspace(w.id)}
                  className="rounded-[22px] bg-[var(--card)] p-4 text-left shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 active:scale-[.99]"
                >
                  <div className="flex items-center gap-3">
                    {logo ? (
                      <img src={logo} alt="" className="h-[42px] w-[42px] rounded-[15px] object-cover" />
                    ) : (
                      <span
                        className="flex h-[42px] w-[42px] items-center justify-center rounded-[15px] text-[13.5px] font-extrabold text-white"
                        style={{ background: tone }}
                      >
                        {initials(w.name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px] font-bold tracking-[-0.02em] text-[var(--ink)]">
                        {w.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ink3)]">{w.status}</span>
                    </span>
                    {w.status === 'Behind schedule' && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-ink)]">
                        Telat
                      </span>
                    )}
                    <ChevronRight size={17} strokeWidth={2.2} className="shrink-0 text-[var(--ink3)]" />
                  </div>
                  <div className="mt-3.5 flex items-center gap-2.5">
                    <span className="progress-track flex-1">
                      <span
                        className="progress-fill block"
                        style={{ width: `${w.progress}%`, background: tone }}
                      />
                    </span>
                    <span className="text-[12px] font-bold tabular-nums text-[var(--ink2)]">{w.progress}%</span>
                  </div>
                  <p className="mt-2.5 text-[12.5px] text-[var(--ink3)]">
                    {Math.max(0, w.tasks - done)} aktif · {done} selesai · {w.projects} project
                  </p>
                </button>
              )
            })}
          </div>
        </section>

        {/* needs attention */}
        <section>
          <h2 className="mb-3 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Butuh perhatian</h2>
          <div className="flex flex-col gap-2.5">
            {attention.length === 0 ? (
              <Empty title="Semua aman ✓" sub="Ga ada yang telat di semua workspace." />
            ) : (
              attention.map((t) => (
                <div
                  key={t.id}
                  className="flex gap-3.5 rounded-[20px] bg-[var(--card)] px-4 py-[15px] shadow-[var(--shadow-sm)]"
                >
                  <span className="w-[3px] shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2.5">
                      <p className="min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.35] text-[var(--ink)]">
                        {t.title}
                      </p>
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--accent-ink)]">
                        Telat
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ background: accentFor(t.wsName) }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink3)]">
                        {t.wsName} · {t.boardTitle}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* today, all teams */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Hari ini, semua tim</h2>
            <Link
              to="/my-tasks"
              className="text-[13.5px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--accent)]"
            >
              See all
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {d.today.length === 0 ? (
              <Empty title="Clear semua 🎉" sub="Ga ada task tersisa hari ini." />
            ) : (
              d.today.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start gap-3.5 rounded-[20px] bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-sm)]"
                >
                  <span
                    className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-transparent shadow-[inset_0_0_0_1.8px_var(--sunk)]"
                    aria-hidden="true"
                  >
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold leading-[1.35] text-[var(--ink)]">{t.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ background: accentFor(t.boardTitle) }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink3)]">{t.boardTitle}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <WorkspaceSwitcherSheet open={wsOpen} onClose={() => setWsOpen(false)} />
    </main>
  )
}

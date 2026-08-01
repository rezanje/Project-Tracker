import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Check, ChevronRight, Megaphone, Plus, StickyNote } from 'lucide-react'
import { accentFor, gradientFor } from '#/lib/accent'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { fetchPendingApprovalsFn, type ApprovalRequest } from '#/lib/approval-requests'
import { setScope } from '#/lib/workspace-scope'
import { completeCardFn, deleteNoteFn } from '#/lib/actions'
import { toast } from '#/components/Toast'
import { NotificationsBell } from '#/components/Header'
import NoteDetail from '#/components/NoteDetail'
import Popover from '#/components/Popover'
import QuickNoteForm from '#/components/QuickNoteForm'
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
  to?: '/reports' | '/admin/approvals'
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
  const router = useRouter()
  const [wsOpen, setWsOpen] = useState(false)
  const [selectedNote, setSelectedNote] = useState<CommandCenterData['notes'][number] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Same rule as the workspace page: the URL says which level you are on. This
  // screen IS the account level, so arriving here — from the nav tab, a link,
  // a refresh — lifts the scope out of whatever workspace it was in. Otherwise
  // the pill kept naming a company while the page showed all of them.
  useEffect(() => {
    setScope('all')
  }, [])

  async function complete(id: string) {
    setBusyId(id)
    try {
      await completeCardFn({ data: { cardId: id } })
      toast('Task selesai ✓')
      router.invalidate()
    } catch {
      toast('Gagal menandai selesai')
    } finally {
      setBusyId(null)
    }
  }
  const noteCategories = useMemo(
    () => Array.from(new Set(d.notes.map((n) => n.category).filter((c): c is string => !!c))).sort(),
    [d.notes],
  )

  const active = Math.max(0, d.stats.totalTasks - d.stats.completed)
  // "Butuh perhatian" in the design is late ∪ in-review. The aggregation
  // exposes due buckets but not column names, so this is the late half only.
  const attention = d.priority.filter((p) => p.bucket === 'Overdue')

  // A workspace card is a step down a level, so it lands on that workspace's
  // dashboard — the same place the switcher goes.
  function openWorkspace(id: string) {
    setScope(id)
    navigate({ to: '/workspace/$workspaceId', params: { workspaceId: id } })
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
          <Stat label="Approval" value={d.approvals} to="/admin/approvals" />
        </div>

        {/* workspace cards */}
        <section>
          <h2 className="mb-3 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">Workspace kamu</h2>
          <div className="flex flex-col gap-2.5">
            {d.workspaces.length === 0 && (
              <Empty title="Belum ada workspace" sub="Bikin satu lewat tombol pindah workspace." />
            )}
            {d.workspaces.map((w) => {
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
                    <span
                      className="flex h-[42px] w-[42px] items-center justify-center rounded-[15px] text-[13.5px] font-extrabold text-white"
                      style={{ background: gradientFor(w.id) }}
                    >
                      {initials(w.name)}
                    </span>
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
                  <button
                    type="button"
                    onClick={() => complete(t.id)}
                    disabled={busyId === t.id}
                    aria-label={`Tandai "${t.title}" selesai`}
                    className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-transparent shadow-[inset_0_0_0_1.8px_var(--sunk)] transition hover:text-[var(--ink3)] active:scale-90 disabled:opacity-40"
                  >
                    <Check size={12} strokeWidth={3.2} aria-hidden="true" />
                  </button>
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

        {/* Announcements and notes were Home's right rail until Home was cut
            back to the comp's three sections. Both are account-wide rather than
            per-workspace, so the cross-workspace monitor is where they belong.
            fetchDashboard already carries them — no extra query. */}
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
            <Megaphone size={17} className="text-[var(--ink3)]" aria-hidden="true" />
            Pengumuman
          </h2>
          {d.announcements.length === 0 ? (
            <Empty title="Belum ada pengumuman" sub="Kabar buat tim muncul di sini." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {d.announcements.map((a) => (
                <div key={a.id} className="flex gap-3 rounded-[20px] bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-sm)]">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                    style={{ background: accentFor(a.author ?? 'Team') }}
                  >
                    {(a.author ?? 'Team').trim().split(/\s+/)[0]?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[var(--ink)]">{a.author ?? 'Team'}</p>
                    <p className="mt-0.5 text-[13.5px] leading-[1.45] text-[var(--ink2)]">{a.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="flex items-center gap-1.5 text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
              <StickyNote size={17} className="text-[var(--ink3)]" aria-hidden="true" />
              Catatan
            </h2>
            <Popover
              panelClassName="w-64 max-w-[calc(100vw-2.5rem)]"
              renderTrigger={(_open, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex items-center gap-1 text-[13.5px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]"
                >
                  <Plus size={14} aria-hidden="true" /> Baru
                </button>
              )}
              renderPanel={(close) => (
                <QuickNoteForm
                  categorySuggestions={noteCategories}
                  onDone={() => {
                    close()
                    router.invalidate()
                  }}
                />
              )}
            />
          </div>
          {d.notes.length === 0 ? (
            <Empty title="Belum ada catatan" sub="Simpan yang penting sebelum lupa." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {d.notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedNote(n)}
                  className="rounded-[20px] bg-[var(--card)] px-4 py-3.5 text-left shadow-[var(--shadow-sm)] transition hover:-translate-y-px"
                >
                  <p className="text-[13.5px] leading-[1.45] text-[var(--ink)]">{n.body}</p>
                  {n.category && (
                    <span className="mt-2.5 inline-block rounded-full bg-[var(--col)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--ink2)]">
                      {n.category}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedNote && (
        <NoteDetail
          note={selectedNote}
          categorySuggestions={noteCategories}
          onClose={() => setSelectedNote(null)}
          onSaved={() => {
            setSelectedNote(null)
            router.invalidate()
          }}
          onDelete={async () => {
            await deleteNoteFn({ data: { id: selectedNote.id } })
            setSelectedNote(null)
            router.invalidate()
          }}
        />
      )}

      <WorkspaceSwitcherSheet open={wsOpen} onClose={() => setWsOpen(false)} />
    </main>
  )
}

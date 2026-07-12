import { ChevronRight } from 'lucide-react'
import { STATUS_COLOR, type CardRow, type Pillar } from '#/lib/board-data'

// Content-board views other than the calendar: list, timeline, pipeline,
// gallery, analytics. All read the same cards the CalendarView does. Purely
// presentational — clicking a card opens the shared detail panel.

export type ContentView = 'list' | 'timeline' | 'pipeline' | 'gallery' | 'analytics'

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', posted: 'Posted' }
const STATUS_ORDER = ['draft', 'scheduled', 'posted'] as const

function fmtDate(due: string | null): string {
  if (!due) return 'No date'
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function StatusChip({ status }: { status: string | null }) {
  if (!status) return null
  const c = STATUS_COLOR[status] ?? 'var(--ink3)'
  return (
    <span
      className="chip shrink-0"
      style={{ background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c, borderColor: c }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function PillarDot({ pillar }: { pillar: Pillar | undefined }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pillar?.color ?? 'var(--ink3)' }} />
}

function Bar({ label, n, max, color }: { label: string; n: number; max: number; color: string }) {
  const pct = max ? Math.round((n / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="font-semibold text-[var(--ink2)]">{label}</span>
        <span className="font-extrabold text-[var(--ink)]">{n}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--col)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function ContentViews({
  view,
  cards,
  pillars,
  onCardClick,
}: {
  view: ContentView
  cards: CardRow[]
  pillars: Pillar[]
  onCardClick: (card: CardRow) => void
}) {
  const pillarById = new Map(pillars.map((p) => [p.id, p]))
  const pillarOf = (c: CardRow) => (c.pillar_id ? pillarById.get(c.pillar_id) : undefined)

  // ---- LIST ----
  if (view === 'list') {
    const sorted = [...cards].sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1)
    return (
      <div className="card p-1.5">
        {sorted.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--ink3)]">No content yet.</p>
        ) : (
          <div className="flex flex-col">
            {sorted.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onCardClick(c)}
                className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--col)]"
              >
                <PillarDot pillar={pillarOf(c)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-[var(--ink)]">{c.title}</p>
                  <p className="truncate text-[11px] text-[var(--ink3)]">
                    {pillarOf(c)?.name ?? 'No pillar'}
                    {c.channels?.length ? ` · ${c.channels.join(', ')}` : ''}
                  </p>
                </div>
                <StatusChip status={c.content_status} />
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--ink2)]">{fmtDate(c.due_date)}</span>
                <ChevronRight size={15} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---- TIMELINE ----
  if (view === 'timeline') {
    const dated = cards.filter((c) => c.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    const groups = new Map<string, CardRow[]>()
    for (const c of dated) {
      const k = c.due_date!
      const arr = groups.get(k) ?? []
      arr.push(c)
      groups.set(k, arr)
    }
    const undated = cards.filter((c) => !c.due_date)
    return (
      <div className="flex flex-col gap-4">
        {groups.size === 0 && undated.length === 0 && (
          <div className="card p-6 text-center text-sm text-[var(--ink3)]">No content yet.</div>
        )}
        {[...groups.entries()].map(([date, list]) => (
          <div key={date} className="flex gap-3">
            <div className="w-24 shrink-0 pt-1 text-right text-[12px] font-extrabold text-[var(--ink2)]">
              {fmtDate(date)}
            </div>
            <div className="flex flex-1 flex-col gap-2 border-l-2 border-[var(--line)] pl-3">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCardClick(c)}
                  className="card card-hover flex items-center gap-2 p-2.5 text-left"
                >
                  <PillarDot pillar={pillarOf(c)} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--ink)]">{c.title}</span>
                  <StatusChip status={c.content_status} />
                </button>
              ))}
            </div>
          </div>
        ))}
        {undated.length > 0 && (
          <div className="flex gap-3">
            <div className="w-24 shrink-0 pt-1 text-right text-[12px] font-extrabold text-[var(--ink3)]">Unscheduled</div>
            <div className="flex flex-1 flex-col gap-2 border-l-2 border-[var(--line)] pl-3">
              {undated.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCardClick(c)}
                  className="card card-hover flex items-center gap-2 p-2.5 text-left"
                >
                  <PillarDot pillar={pillarOf(c)} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--ink)]">{c.title}</span>
                  <StatusChip status={c.content_status} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- PIPELINE (columns by status) ----
  if (view === 'pipeline') {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STATUS_ORDER.map((status) => {
          const list = cards.filter((c) => (c.content_status ?? 'draft') === status)
          return (
            <div key={status} className="col-surface flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                <h3 className="display-title text-[15px] font-bold text-[var(--ink)]">{STATUS_LABEL[status]}</h3>
                <span className="text-[12px] font-bold text-[var(--ink3)]">{list.length}</span>
              </div>
              {list.length === 0 && <p className="text-[12px] text-[var(--ink3)]">Empty</p>}
              {list.map((c) => (
                <button key={c.id} type="button" onClick={() => onCardClick(c)} className="card card-hover p-3 text-left">
                  <div className="flex items-center gap-2">
                    <PillarDot pillar={pillarOf(c)} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--ink)]">{c.title}</span>
                  </div>
                  {c.channels?.length ? (
                    <p className="mt-1 truncate text-[11px] text-[var(--ink3)]">{c.channels.join(', ')}</p>
                  ) : null}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // ---- GALLERY ----
  if (view === 'gallery') {
    return cards.length === 0 ? (
      <div className="card p-6 text-center text-sm text-[var(--ink3)]">No content yet.</div>
    ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => {
          const pillar = pillarOf(c)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onCardClick(c)}
              className="card card-hover flex flex-col overflow-hidden p-0 text-left"
            >
              <div className="h-20 w-full" style={{ background: pillar?.color ?? 'var(--col)' }} />
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <p className="line-clamp-2 text-[13px] font-bold leading-snug text-[var(--ink)]">{c.title}</p>
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="truncate text-[10px] font-bold text-[var(--ink3)]">{pillar?.name ?? ''}</span>
                  <StatusChip status={c.content_status} />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  // ---- ANALYTICS ----
  const byStatus = STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], n: cards.filter((c) => (c.content_status ?? 'draft') === s).length, color: STATUS_COLOR[s] }))
  const byPillar = pillars.map((p) => ({ label: p.name, n: cards.filter((c) => c.pillar_id === p.id).length, color: p.color }))
  const channelCounts = new Map<string, number>()
  for (const c of cards) for (const ch of c.channels ?? []) channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1)
  const byChannel = [...channelCounts.entries()].map(([label, n]) => ({ label, n, color: '#2563eb' })).sort((a, b) => b.n - a.n)
  const maxS = Math.max(1, ...byStatus.map((x) => x.n))
  const maxP = Math.max(1, ...byPillar.map((x) => x.n))
  const maxC = Math.max(1, ...byChannel.map((x) => x.n))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section className="card p-4">
        <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">By Status</h3>
        <div className="flex flex-col gap-3">
          {byStatus.map((x) => <Bar key={x.label} {...x} max={maxS} />)}
        </div>
      </section>
      <section className="card p-4">
        <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">By Pillar</h3>
        <div className="flex flex-col gap-3">
          {byPillar.length === 0 && <p className="text-sm text-[var(--ink3)]">No pillars.</p>}
          {byPillar.map((x) => <Bar key={x.label} {...x} max={maxP} />)}
        </div>
      </section>
      <section className="card p-4">
        <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">By Channel</h3>
        <div className="flex flex-col gap-3">
          {byChannel.length === 0 && <p className="text-sm text-[var(--ink3)]">No channels tagged.</p>}
          {byChannel.map((x) => <Bar key={x.label} {...x} max={maxC} />)}
        </div>
      </section>
    </div>
  )
}

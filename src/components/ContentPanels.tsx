import { FileEdit, Lightbulb, Palette, ScrollText, Sparkles } from 'lucide-react'
import { CalendarClock, Film, Rocket } from '@/components/pixel-icons'

// ponytail: Content Calendar chrome around the real CalendarView. Stats, Today
// and completion% are real (from card content_status / due_date). The 6-stage
// pipeline (Ide→Published) and the heatmap are static: the DB status model is
// only draft/scheduled/posted, so the richer pipeline needs a status-model
// expansion (feature phase). AI assistant is a Coming Soon shell.

export function ContentStats({
  total,
  draft,
  scheduled,
  posted,
}: {
  total: number
  draft: number
  scheduled: number
  posted: number
}) {
  const completion = total > 0 ? Math.round((posted / total) * 100) : 0
  const cells = [
    { n: total, label: 'Total content', tint: '#2563eb' },
    { n: scheduled, label: 'Scheduled', tint: '#d97706' },
    { n: draft, label: 'Draft', tint: 'var(--ink3)' },
    { n: posted, label: 'Posted', tint: 'var(--accent)' },
  ]
  return (
    <div className="card mx-auto mb-5 flex max-w-[1400px] flex-wrap items-stretch p-0">
      {cells.map(({ n, label, tint }, i) => (
        <div
          key={label}
          className={`flex min-w-[120px] flex-1 flex-col justify-center px-4 py-3 ${
            i > 0 ? 'border-l-2 border-[var(--line)]' : ''
          }`}
        >
          <p className="display-title text-xl font-extrabold leading-none" style={{ color: tint }}>
            {n}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[var(--ink2)]">{label}</p>
        </div>
      ))}
      <div className="flex min-w-[180px] flex-[1.4] flex-col justify-center gap-1 border-l-2 border-[var(--line)] px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--ink2)]">Completion</span>
          <span className="text-[12px] font-extrabold text-[var(--accent-ink)]">{completion}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--col)]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${completion}%` }} />
        </div>
      </div>
    </div>
  )
}

export function ContentPipeline({ scheduled, posted }: { scheduled: number; posted: number }) {
  // ponytail: Ide/Script/Design/Edit are static — no matching DB status yet.
  const stages = [
    { key: 'Ide', icon: Lightbulb, n: 12, tint: '#d9a406', real: false },
    { key: 'Script', icon: ScrollText, n: 5, tint: '#2563eb', real: false },
    { key: 'Design', icon: Palette, n: 3, tint: '#7c3aed', real: false },
    { key: 'Edit', icon: Film, n: 2, tint: '#db2777', real: false },
    { key: 'Scheduled', icon: CalendarClock, n: scheduled, tint: '#d97706', real: true },
    { key: 'Published', icon: Rocket, n: posted, tint: 'var(--accent)', real: true },
  ]
  return (
    <div className="card mx-auto mb-5 max-w-[1400px] p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <FileEdit size={13} /> Content Pipeline
      </h3>
      <div className="flex items-center gap-2 overflow-x-auto">
        {stages.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center gap-2">
            <div className="min-w-[110px] flex-1 rounded-[10px] border-2 border-[var(--ink)] p-2.5">
              <div className="flex items-center gap-1.5">
                <s.icon size={14} style={{ color: s.tint }} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink3)]">{s.key}</span>
              </div>
              <p className="display-title mt-1 text-xl font-extrabold text-[var(--ink)]">{s.n}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--col)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, s.n * 6)}%`, background: s.tint }}
                />
              </div>
            </div>
            {i < stages.length - 1 && <span className="text-[var(--ink3)]">→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  draft: '#9ca3af',
  scheduled: '#d97706',
  posted: '#1f9d55',
}

export function ContentRail({
  today,
}: {
  today: Array<{ id: string; title: string; status: string | null }>
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 xl:flex">
      {/* today */}
      <section className="card p-3.5">
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          <CalendarClock size={13} /> Today
        </h3>
        <div className="flex flex-col gap-2">
          {today.length === 0 && <p className="text-[12px] text-[var(--ink3)]">No content scheduled today</p>}
          {today.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: STATUS_DOT[c.status ?? ''] ?? 'var(--ink3)' }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--ink)]">{c.title}</span>
              {c.status && (
                <span className="shrink-0 text-[10px] font-bold capitalize text-[var(--ink3)]">{c.status}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* AI content assistant — Coming Soon */}
      <section className="card relative overflow-hidden p-3.5">
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          <Sparkles size={13} className="text-[var(--accent)]" /> AI Content Assistant
        </h3>
        <div className="pointer-events-none space-y-1.5 opacity-40 blur-[1.5px]">
          <p className="text-[12px] text-[var(--ink3)]">Best time to post: Wed 09:00</p>
          <p className="text-[12px] text-[var(--ink3)]">You're low on Edukasi content this week</p>
          <p className="text-[12px] text-[var(--ink3)]">Behind Scene posts perform best — keep it up!</p>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="chip bg-[var(--pop-soft)] text-[var(--pop-ink)]" style={{ borderColor: 'var(--pop-ink)' }}>
            🤖 Coming Soon
          </span>
        </div>
      </section>

      {/* heatmap (static) */}
      <section className="card p-3.5">
        <h3 className="mb-2.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          Content Heatmap
        </h3>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 40 }).map((_, i) => {
            const lvl = (i * 7 + (i % 5) * 3) % 5
            return (
              <span
                key={i}
                className="aspect-square rounded-[3px]"
                style={{ background: `color-mix(in oklab, var(--accent) ${lvl * 22 + 8}%, var(--col))` }}
              />
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold text-[var(--ink3)]">
          Less
          {[10, 35, 60, 85].map((o) => (
            <span
              key={o}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: `color-mix(in oklab, var(--accent) ${o}%, var(--col))` }}
            />
          ))}
          More
        </div>
      </section>
    </aside>
  )
}

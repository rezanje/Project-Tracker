import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { STATUS_COLOR, type CardRow, type Pillar } from '#/lib/board-data'

interface Props {
  cards: CardRow[]
  pillars: Pillar[]
  canEdit: boolean
  onCardClick: (card: CardRow) => void
  onAddOnDay: (dateStr: string) => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n: number) => String(n).padStart(2, '0')
const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

/** Month grid of content cards keyed by due_date (= publish date). */
export default function CalendarView({ cards, pillars, canEdit, onCardClick, onAddOnDay }: Props) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const pillarById = new Map(pillars.map((p) => [p.id, p]))
  const byDate = new Map<string, CardRow[]>()
  for (const c of cards) {
    if (!c.due_date) continue
    if (!byDate.has(c.due_date)) byDate.set(c.due_date, [])
    byDate.get(c.due_date)!.push(c)
  }
  const unscheduled = cards.filter((c) => !c.due_date)

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = dateStr(today.getFullYear(), today.getMonth(), today.getDate())

  // Leading blanks then day cells, padded to full weeks.
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  function shift(delta: number) {
    const m = month + delta
    setYear(year + Math.floor(m / 12))
    setMonth(((m % 12) + 12) % 12)
  }
  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  function chip(card: CardRow) {
    const pillar = card.pillar_id ? pillarById.get(card.pillar_id) : undefined
    const bg = pillar?.color ?? 'var(--col)'
    return (
      <button
        key={card.id}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onCardClick(card)
        }}
        title={pillar ? `${pillar.name} · ${card.title}` : card.title}
        className="flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[11px] font-semibold"
        style={{ background: pillar ? bg : 'var(--col)', color: pillar ? '#fff' : 'var(--ink)' }}
      >
        {card.content_status && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: STATUS_COLOR[card.content_status] ?? '#9ca3af' }}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{card.title}</span>
      </button>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink2)] hover:text-[var(--ink)]">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="display-title min-w-[200px] text-center text-[22px] font-extrabold text-[var(--ink)]">
          {MONTHS[month]} {year}
        </h2>
        <button type="button" onClick={() => shift(1)} aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink2)] hover:text-[var(--ink)]">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={goToday} className="btn btn-ghost px-3 py-1.5 text-[13px]">
          Today
        </button>
        {pillars.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {pillars.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink2)]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--ink3)]">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="min-h-[104px] rounded-[12px]" />
          const ds = dateStr(year, month, d)
          const dayCards = byDate.get(ds) ?? []
          const isToday = ds === todayStr
          return (
            <div
              key={ds}
              onClick={() => canEdit && onAddOnDay(ds)}
              className={`min-h-[104px] rounded-[12px] border p-1.5 ${canEdit ? 'cursor-pointer' : ''} ${
                isToday ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--card)]'
              }`}
            >
              <div className={`mb-1 px-1 text-[12px] font-bold ${isToday ? 'text-[var(--accent-ink)]' : 'text-[var(--ink3)]'}`}>
                {d}
              </div>
              <div className="flex flex-col gap-1">{dayCards.map(chip)}</div>
            </div>
          )
        })}
      </div>

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--ink3)]">
            Unscheduled ({unscheduled.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((c) => (
              <div key={c.id} className="w-[180px]">{chip(c)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

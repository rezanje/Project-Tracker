import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  MoreHorizontal,
} from 'lucide-react'
import BackButton from '#/components/BackButton'
import { requireUser } from '#/lib/auth'
import { dueHour, isDoneColumn } from '#/lib/home'
import { listSchedule, type ScheduleEvent } from '#/lib/events'
import { inScope, useScope } from '#/lib/workspace-scope'

type CalTask = { id: string; title: string; boardTitle: string; boardId: string; wsId: string | null; due: string; dueTime: string | null; done: boolean }
type CalendarData = { tasks: CalTask[]; events: ScheduleEvent[] }

const ACCENTS = ['#8a7f73', '#a8927c', '#6e7a66', '#9c8b7a']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const fetchCalendar = createServerFn({ method: 'GET' }).handler(async (): Promise<CalendarData> => {
  const headers = new Headers()
  // requireUser redirects unauthenticated/unapproved users — keep it outside the
  // try so the redirect is not swallowed by the empty-list fallback.
  const { supabase } = await requireUser(getRequest(), headers)
  try {
    const [{ data: boards }, events] = await Promise.all([
      supabase
        .from('boards')
        .select('id,title,workspace_id,columns(title,cards(id,title,due_date,due_time))')
        .neq('status', 'archived'),
      listSchedule(supabase),
    ])

    const tasks: CalTask[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      workspace_id: string | null
      columns?: Array<{ title: string; cards?: Array<{ id: string; title: string; due_date: string | null; due_time: string | null }> }>
    }>) {
      for (const col of b.columns ?? []) {
        const done = isDoneColumn(col.title)
        for (const c of col.cards ?? []) {
          if (c.due_date)
            tasks.push({
              id: c.id,
              title: c.title,
              boardTitle: b.title,
              boardId: b.id,
              wsId: b.workspace_id,
              due: c.due_date,
              dueTime: c.due_time,
              done,
            })
        }
      }
    }
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return { tasks, events }
  } catch {
    return { tasks: [], events: [] }
  }
})

export const Route = createFileRoute('/calendar')({
  loader: async () => await fetchCalendar(),
  component: CalendarPage,
})

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Rail hours, matching the comp's 9 AM – 8 PM window. */
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve} ${suffix}`
}
/** '14:30' -> '02:30 PM' */
function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${pad(twelve)}:${pad(m)} ${suffix}`
}

function CalendarPage() {
  const { tasks: allTasks, events } = Route.useLoaderData() as CalendarData
  const navigate = useNavigate()
  const scope = useScope()
  const tasks = allTasks.filter((t) => inScope(scope, t.wsId))
  const [view, setView] = useState<'day' | 'month'>('day')
  // Everything below needs "now", so it is client-derived: start null and fill
  // in an effect so SSR and the first client render match.
  const [selected, setSelected] = useState<Date | null>(null)
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    const now = new Date()
    setSelected(now)
    setTodayStr(keyOf(now))
  }, [])

  const byDay = new Map<string, CalTask[]>()
  for (const t of tasks) {
    const arr = byDay.get(t.due) ?? []
    arr.push(t)
    byDay.set(t.due, arr)
  }
  const eventsByDay = new Map<string, ScheduleEvent[]>()
  for (const e of events) {
    const arr = eventsByDay.get(e.date) ?? []
    arr.push(e)
    eventsByDay.set(e.date, arr)
  }

  function shiftMonth(delta: number) {
    setSelected((d) => {
      if (!d) return d
      const next = new Date(d)
      next.setDate(1)
      next.setMonth(next.getMonth() + delta)
      return next
    })
  }

  const openBoard = (boardId: string) => navigate({ to: '/board/$boardId', params: { boardId } })

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[1100px] flex-col">
        {/* title row */}
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="flex-1 text-center text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
            Schedule
          </h1>
          <button
            type="button"
            onClick={() => setView((v) => (v === 'day' ? 'month' : 'day'))}
            title={view === 'day' ? 'Switch to month view' : 'Switch to day view'}
            aria-label={view === 'day' ? 'Switch to month view' : 'Switch to day view'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </div>

        {selected && (
          <>
            {/* month picker */}
            <div className="mt-5 flex items-center gap-2">
              <span className="text-[17px] font-bold tracking-[-0.02em] text-[var(--ink)]">
                {MONTHS[selected.getMonth()]} {selected.getFullYear()}
              </span>
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ChevronsUpDown size={14} className="text-[var(--ink2)]" aria-hidden="true" />
              </button>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink2)] hover:bg-[var(--col)]"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink2)] hover:bg-[var(--col)]"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setSelected(new Date())} className="btn btn-ghost ml-1">
                  Today
                </button>
              </span>
            </div>

            {view === 'day' ? (
              <>
                <WeekStrip selected={selected} onSelect={setSelected} todayStr={todayStr} />
                <DayTimeline
                  events={eventsByDay.get(keyOf(selected)) ?? []}
                  tasks={byDay.get(keyOf(selected)) ?? []}
                  onOpenBoard={openBoard}
                />
              </>
            ) : (
              <MonthGrid
                y={selected.getFullYear()}
                m={selected.getMonth()}
                byDay={byDay}
                eventsByDay={eventsByDay}
                todayStr={todayStr}
                onPickDay={(d) => {
                  setSelected(d)
                  setView('day')
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}

/** Mon–Sun strip around the selected date; tapping a day moves the timeline. */
function WeekStrip({
  selected,
  onSelect,
  todayStr,
}: {
  selected: Date
  onSelect: (d: Date) => void
  todayStr: string
}) {
  // Start the strip on the Monday of the selected week.
  const start = new Date(selected)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  const selectedKey = keyOf(selected)

  return (
    <div className="mt-3.5 flex gap-0.5">
      {days.map((d) => {
        const key = keyOf(d)
        const isSelected = key === selectedKey
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(d)}
            className={`flex flex-1 flex-col items-center gap-[3px] rounded-[16px] py-2 ${
              isSelected ? 'bg-[var(--card)] shadow-[var(--shadow-sm)]' : ''
            }`}
          >
            <span className={`text-[12.5px] font-medium ${isSelected ? 'text-[var(--ink2)]' : 'text-[var(--ink3)]'}`}>
              {DOW[d.getDay()]}
            </span>
            <span
              className={
                isSelected
                  ? 'text-[16px] font-bold text-[var(--ink)]'
                  : `text-[16px] font-semibold ${key === todayStr ? 'text-[var(--accent)]' : 'text-[var(--ink2)]'}`
              }
            >
              {d.getDate()}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Hour rail + the day's cards. Events sit on their start hour; tasks carry a
 *  due date only, so they stack in an all-day band above the rail. */
function DayTimeline({
  events,
  tasks,
  onOpenBoard,
}: {
  events: ScheduleEvent[]
  tasks: CalTask[]
  onOpenBoard: (boardId: string) => void
}) {
  const byHour = new Map<number, ScheduleEvent[]>()
  for (const e of events) {
    const h = Number(e.time.slice(0, 2))
    const slot = Math.min(Math.max(h, HOURS[0]), HOURS[HOURS.length - 1])
    const arr = byHour.get(slot) ?? []
    arr.push(e)
    byHour.set(slot, arr)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {tasks.length > 0 && (
        <section>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
            Due today · {tasks.length}
          </p>
          <div className="flex flex-col gap-2.5">
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenBoard(t.boardId)}
                className="card card-hover flex gap-3.5 px-4 py-[15px] text-left"
              >
                <span
                  className="w-[3px] shrink-0 rounded-full"
                  style={{ background: t.done ? 'var(--done)' : accentFor(t.boardId) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[14.5px] font-semibold ${
                      t.done ? 'text-[var(--ink3)] line-through' : 'text-[var(--ink)]'
                    }`}
                  >
                    {t.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-[var(--ink3)]">
                    {dueHour(t.dueTime) ? `${dueHour(t.dueTime)} · ${t.boardTitle}` : t.boardTitle}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <div className="flex w-11 shrink-0 flex-col pt-1">
          {HOURS.map((h) => (
            <span key={h} className="h-10 text-[12.5px] font-medium text-[var(--ink3)]">
              {hourLabel(h)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          {events.length === 0 && tasks.length === 0 && (
            <p className="py-6 text-[14px] text-[var(--ink3)]">Nothing scheduled 🎉</p>
          )}
          {HOURS.map((h) => {
            const slot = byHour.get(h) ?? []
            if (slot.length === 0) return <div key={h} className="h-10" aria-hidden="true" />
            return (
              <div key={h} className="mb-2.5 flex flex-col gap-2.5">
                {slot.map((e) => (
                  <article key={e.id} className="card flex gap-3.5 px-4 py-[14px]">
                    <span
                      className="w-[3px] shrink-0 rounded-full"
                      style={{ background: accentFor(e.type) }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{e.title}</p>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--ink3)]">{e.sub || e.type}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Attendees n={e.people} />
                        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink2)]">
                          <Clock size={13} aria-hidden="true" />
                          {prettyTime(e.time)}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Attendees({ n }: { n: number }) {
  if (n <= 0) return <span />
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

/** Month overview — not in the redesign comps, kept so the month-at-a-glance
 *  view the app already had isn't lost. Reachable from the header button. */
function MonthGrid({
  y,
  m,
  byDay,
  eventsByDay,
  todayStr,
  onPickDay,
}: {
  y: number
  m: number
  byDay: Map<string, CalTask[]>
  eventsByDay: Map<string, ScheduleEvent[]>
  todayStr: string
  onPickDay: (d: Date) => void
}) {
  const startDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="panel mt-4 overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-[var(--line-soft)]">
        {DOW.map((d) => (
          <div key={d} className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null)
            return <div key={i} className="min-h-[110px] border-b border-r border-[var(--line-soft)] bg-[var(--col)]" />
          const ds = `${y}-${pad(m + 1)}-${pad(day)}`
          const items = [
            ...(eventsByDay.get(ds) ?? []).map((e) => ({ id: e.id, title: e.title, tone: accentFor(e.type), done: false })),
            ...(byDay.get(ds) ?? []).map((t) => ({ id: t.id, title: t.title, tone: accentFor(t.boardId), done: t.done })),
          ]
          const isToday = ds === todayStr
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPickDay(new Date(y, m, day))}
              className="min-h-[110px] border-b border-r border-[var(--line-soft)] p-2 text-left"
            >
              <span
                className={`mb-1.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[13px] font-semibold ${
                  isToday ? 'bg-[var(--ink)] font-bold text-[var(--card)]' : 'text-[var(--ink2)]'
                }`}
              >
                {day}
              </span>
              <span className="flex flex-col gap-1">
                {items.slice(0, 3).map((it) => (
                  <span
                    key={it.id}
                    title={it.title}
                    className={`truncate rounded-[10px] px-2 py-1 text-[11.5px] font-semibold text-[var(--card)] ${
                      it.done ? 'opacity-55 line-through' : ''
                    }`}
                    style={{ background: it.tone }}
                  >
                    {it.title}
                  </span>
                ))}
                {items.length > 3 && (
                  <span className="px-1 text-[11px] font-medium text-[var(--ink3)]">+{items.length - 3} more</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

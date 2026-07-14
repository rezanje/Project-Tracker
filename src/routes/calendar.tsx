import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CalendarDays } from '@/components/pixel-icons'
import { requireUser } from '#/lib/auth'
import { isDoneColumn } from '#/lib/home'

type CalTask = { id: string; title: string; boardId: string; due: string; done: boolean }

const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const fetchCalendar = createServerFn({ method: 'GET' }).handler(async (): Promise<CalTask[]> => {
  const headers = new Headers()
  // requireUser redirects unauthenticated/unapproved users — keep it outside the
  // try so the redirect is not swallowed by the empty-list fallback.
  const { supabase } = await requireUser(getRequest(), headers)
  try {
    const { data: boards } = await supabase
      .from('boards')
      .select('id,columns(title,cards(id,title,due_date))')
      .neq('status', 'archived')

    const tasks: CalTask[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      columns?: Array<{ title: string; cards?: Array<{ id: string; title: string; due_date: string | null }> }>
    }>) {
      for (const col of b.columns ?? []) {
        const done = isDoneColumn(col.title)
        for (const c of col.cards ?? []) {
          if (c.due_date) tasks.push({ id: c.id, title: c.title, boardId: b.id, due: c.due_date, done })
        }
      }
    }
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return tasks
  } catch {
    return []
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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function CalendarPage() {
  const tasks = Route.useLoaderData() as CalTask[]
  const navigate = useNavigate()
  // Month selection is client-derived (needs "now"); start null and fill in an
  // effect so SSR and first client render match (no hydration mismatch).
  const [cur, setCur] = useState<{ y: number; m: number } | null>(null)
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    const now = new Date()
    setCur({ y: now.getFullYear(), m: now.getMonth() })
    setTodayStr(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  }, [])

  const byDay = new Map<string, CalTask[]>()
  for (const t of tasks) {
    const arr = byDay.get(t.due) ?? []
    arr.push(t)
    byDay.set(t.due, arr)
  }

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <CalendarDays size={22} className="text-[var(--accent)]" aria-hidden="true" />
          <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">Calendar</h1>
          {cur && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setCur((c) => (c ? (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }) : c))}
                className="btn btn-ghost px-2.5"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="display-title min-w-[150px] text-center text-lg font-bold text-[var(--ink)]">
                {MONTHS[cur.m]} {cur.y}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setCur((c) => (c ? (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }) : c))}
                className="btn btn-ghost px-2.5"
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = new Date()
                  setCur({ y: n.getFullYear(), m: n.getMonth() })
                }}
                className="btn btn-ghost"
              >
                Today
              </button>
            </div>
          )}
        </div>

        {cur && (
          <div className="card overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b-2 border-[var(--ink)]">
              {DOW.map((d) => (
                <div key={d} className="px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">
                  {d}
                </div>
              ))}
            </div>
            <MonthGrid y={cur.y} m={cur.m} byDay={byDay} todayStr={todayStr} onOpen={(boardId) => navigate({ to: '/board/$boardId', params: { boardId } })} />
          </div>
        )}
      </div>
    </main>
  )
}

function MonthGrid({
  y,
  m,
  byDay,
  todayStr,
  onOpen,
}: {
  y: number
  m: number
  byDay: Map<string, CalTask[]>
  todayStr: string
  onOpen: (boardId: string) => void
}) {
  const startDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="grid grid-cols-7">
      {cells.map((day, i) => {
        if (day === null) return <div key={i} className="min-h-[104px] border-b border-r border-[var(--line)] bg-[var(--col)]" />
        const dateStr = `${y}-${pad(m + 1)}-${pad(day)}`
        const dayTasks = byDay.get(dateStr) ?? []
        const isToday = dateStr === todayStr
        return (
          <div key={i} className="min-h-[104px] border-b border-r border-[var(--line)] p-1.5">
            <div
              className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-bold ${
                isToday ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink2)]'
              }`}
            >
              {day}
            </div>
            <div className="flex flex-col gap-1">
              {dayTasks.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpen(t.boardId)}
                  title={t.title}
                  className={`truncate rounded-[6px] border-2 border-[var(--ink)] px-1.5 py-0.5 text-left text-[11px] font-bold text-white ${
                    t.done ? 'opacity-55 line-through' : ''
                  }`}
                  style={{ background: accentFor(t.boardId) }}
                >
                  {t.title}
                </button>
              ))}
              {dayTasks.length > 3 && (
                <span className="px-1 text-[10px] font-bold text-[var(--ink3)]">+{dayTasks.length - 3} more</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

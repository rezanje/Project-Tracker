import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlarmClock,
  ArrowRight,
  ArrowUp,
  CheckSquare,
  Flame,
  FolderPlus,
  Megaphone,
  MoreVertical,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  StickyNote,
  Target,
  Volume2,
} from 'lucide-react'
import { segFill } from '#/lib/progress'

// ponytail: Pixel Home is UI-first with the mockup's exact static data. Pomodoro
// is genuinely functional (local countdown, no backend). Everything else is a
// visual shell wired to real data/actions in the feature-combing phase.

export const Route = createFileRoute('/home')({
  component: PixelHome,
})

const TAG_COLORS: Record<string, string> = {
  Finance: '#2563eb',
  Meeting: '#7c3aed',
  Content: '#0891b2',
  Design: '#db2777',
}
type Prio = 'High' | 'Medium' | 'Low'
const PRIO_COLORS: Record<Prio, string> = { High: 'var(--danger)', Medium: '#d97706', Low: 'var(--accent)' }

const TASKS: Array<{ title: string; tag: string; prio: Prio; time: string; overdue?: boolean }> = [
  { title: 'Finish Invoice', tag: 'Finance', prio: 'High', time: '09:00 AM' },
  { title: 'Client Meeting', tag: 'Meeting', prio: 'Medium', time: '01:00 PM' },
  { title: 'Upload Content', tag: 'Content', prio: 'Medium', time: '04:00 PM' },
  { title: 'Review Design', tag: 'Design', prio: 'Low', time: 'Tomorrow' },
  { title: 'Follow up Payment', tag: 'Finance', prio: 'High', time: 'Yesterday', overdue: true },
]

const QUICK_ACTIONS = [
  { label: 'Add Task', icon: CheckSquare, tint: 'var(--accent)' },
  { label: 'Add Project', icon: FolderPlus, tint: '#d97706' },
  { label: 'Add Note', icon: StickyNote, tint: '#7c3aed' },
  { label: 'Set Reminder', icon: AlarmClock, tint: '#2563eb' },
]

const PROJECTS = [
  { name: 'Gentanala', dot: 'var(--accent)', pct: 68, done: 12, total: 18 },
  { name: 'Content Calendar', dot: '#d97706', pct: 32, done: 5, total: 16 },
  { name: 'Marketing Campaign', dot: '#2563eb', pct: 88, done: 15, total: 17 },
]

const KPIS = [
  { label: 'Revenue', val: 'Rp 8.2M', delta: '+12%', up: true, tint: 'var(--accent)', bars: [4, 6, 5, 7, 6, 8, 9] },
  { label: 'Tasks Done', val: '24', delta: '+8%', up: true, tint: '#2563eb', bars: [3, 5, 4, 6, 7, 6, 8] },
  { label: 'On Progress', val: '12', delta: '', up: true, tint: '#d97706', bars: [5, 4, 6, 5, 7, 5, 6] },
  { label: 'Overdue', val: '2', delta: '-33%', up: false, tint: 'var(--danger)', bars: [6, 5, 4, 5, 3, 4, 2] },
]

const ANNOUNCEMENTS = [
  { who: 'Reza Rahman', text: 'Meeting jam 3 sore di ruang A ya!', when: 'Yesterday' },
  { who: 'Dimas Ardi', text: 'Server maintenance weekend ini.', when: '2 days ago' },
]

const NOTES = ['Meeting dengan supplier besok jam 10', 'Jangan lupa revisi logo Gentanala']

function SegBar({ pct, color }: { pct: number; color: string }) {
  const on = segFill(pct, 12)
  return (
    <span className="progress-seg w-full">
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="progress-seg-block flex-1"
          style={i < on ? { background: color, borderColor: color } : undefined}
        />
      ))}
    </span>
  )
}

function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  return (
    <div className="flex h-8 items-end gap-0.5">
      {data.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.5 + (i / data.length) * 0.5 }}
        />
      ))}
    </div>
  )
}

function Pomodoro() {
  const [secs, setSecs] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!running) return
    ref.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          setRunning(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (ref.current) clearInterval(ref.current)
    }
  }, [running])

  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
          🍅 Pomodoro
        </h3>
        <Settings size={14} className="text-[var(--ink3)]" aria-hidden="true" />
      </div>
      <p className="display-title mb-3 text-center text-5xl font-extrabold tabular-nums text-[var(--ink)]">
        {mm}:{ss}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="btn btn-primary flex-1"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Play size={15} aria-hidden="true" />
          {running ? 'Pause' : 'Start Focus'}
        </button>
        <button
          type="button"
          onClick={() => {
            setRunning(false)
            setSecs(25 * 60)
          }}
          className="btn btn-ghost flex-1"
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
      </div>
    </section>
  )
}

function Donut({ pct }: { pct: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--col)" strokeWidth="12" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 48 48)"
      />
      <text
        x="48"
        y="53"
        textAnchor="middle"
        className="display-title fill-[var(--ink)] text-lg font-extrabold"
      >
        {pct}%
      </text>
    </svg>
  )
}

function Avatar({ i }: { i: number }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ background: ['#7c3aed', '#2563eb', '#db2777', '#0891b2'][i % 4] }}
    >
      {String.fromCharCode(65 + i)}
    </span>
  )
}

function PixelHome() {
  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 lg:flex-row">
        {/* left / main */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* TODAY */}
          <section className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Flame size={18} className="text-[var(--danger)]" aria-hidden="true" />
              <h3 className="display-title text-lg font-extrabold text-[var(--ink)]">Today</h3>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-4 border-b-2 border-[var(--line)] pb-3">
              <Stat n="8" label="Tasks" />
              <Stat n="2" label="Overdue" tint="var(--danger)" />
              <Stat n="5" label="Due today" tint="#d97706" />
              <div className="ml-auto flex items-center gap-2">
                <SegBar pct={63} color="var(--accent)" />
                <span className="whitespace-nowrap text-sm font-extrabold text-[var(--accent-ink)]">63%</span>
              </div>
            </div>
            <div className="flex flex-col">
              {TASKS.map((t) => (
                <div
                  key={t.title}
                  className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0"
                >
                  <span className="h-4 w-4 shrink-0 rounded-[5px] border-2 border-[var(--ink)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-[13px] font-bold ${t.overdue ? 'text-[var(--danger)]' : 'text-[var(--ink)]'}`}
                    >
                      {t.title}
                    </p>
                    <span className="text-[11px] font-bold" style={{ color: TAG_COLORS[t.tag] }}>
                      {t.tag}
                    </span>
                  </div>
                  <span
                    className="chip shrink-0"
                    style={{
                      background: `color-mix(in oklab, ${PRIO_COLORS[t.prio]} 16%, transparent)`,
                      color: PRIO_COLORS[t.prio],
                      borderColor: PRIO_COLORS[t.prio],
                    }}
                  >
                    {t.prio}
                    {t.prio === 'High' ? <ArrowUp size={11} /> : <ArrowRight size={11} />}
                  </span>
                  <span
                    className={`w-20 shrink-0 text-right text-[11px] font-semibold tabular-nums ${
                      t.overdue ? 'text-[var(--danger)]' : 'text-[var(--ink3)]'
                    }`}
                  >
                    {t.time}
                  </span>
                  <Avatar i={0} />
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 text-[12px] font-bold text-[var(--accent-ink)] hover:underline">
              View all tasks →
            </button>
          </section>

          {/* ACTIVE PROJECTS */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">Active Projects</h3>
              <button type="button" className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
                View all projects →
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {PROJECTS.map((p) => (
                <div key={p.name} className="rounded-[10px] border-2 border-[var(--ink)] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.dot }} />
                    <p className="truncate text-[13px] font-bold text-[var(--ink)]">{p.name}</p>
                    <span className="ml-auto text-[12px] font-extrabold" style={{ color: p.dot }}>
                      {p.pct}%
                    </span>
                  </div>
                  <SegBar pct={p.pct} color={p.dot} />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[var(--ink3)]">
                      {p.done} / {p.total} tasks
                    </span>
                    <span className="avatar-stack">
                      <Avatar i={0} />
                      <Avatar i={1} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* KPI + PROJECT PROGRESS */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📊 KPI Overview
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {KPIS.map((k) => (
                  <div key={k.label} className="rounded-[10px] border-2 border-[var(--line)] p-3">
                    <p className="text-[11px] font-semibold text-[var(--ink3)]">{k.label}</p>
                    <p className="display-title text-lg font-extrabold leading-tight text-[var(--ink)]">{k.val}</p>
                    <div className="mt-1 flex items-end justify-between">
                      <MiniBars data={k.bars} color={k.tint} />
                      {k.delta && (
                        <span
                          className="text-[11px] font-bold"
                          style={{ color: k.up ? 'var(--accent-ink)' : 'var(--danger)' }}
                        >
                          {k.delta}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                <Target size={13} /> Project Progress
              </h3>
              <div className="flex items-center gap-4">
                <Donut pct={68} />
                <div className="flex-1 space-y-2">
                  <ProgRow label="Total Projects" n={8} tint="var(--ink3)" />
                  <ProgRow label="Completed" n={3} tint="var(--accent)" />
                  <ProgRow label="In Progress" n={5} tint="#d97706" />
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* right rail */}
        <div className="flex w-full flex-col gap-4 lg:w-80">
          {/* QUICK ACTIONS */}
          <section className="card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              ⚡ Quick Actions
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="flex flex-col items-center gap-1.5 rounded-[10px] border-2 border-[var(--line)] p-2 text-center hover:border-[var(--ink)]"
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[var(--ink)]"
                    style={{ background: `color-mix(in oklab, ${a.tint} 18%, transparent)`, color: a.tint }}
                  >
                    <a.icon size={16} />
                  </span>
                  <span className="text-[10px] font-bold text-[var(--ink2)]">{a.label}</span>
                </button>
              ))}
            </div>
          </section>

          <Pomodoro />

          {/* MUSIC */}
          <section className="card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
              🎵 Music
            </h3>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-[var(--ink)] bg-[var(--col)]">
                <Music2 size={20} className="text-[var(--ink2)]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[var(--ink)]">Lofi for Coding</p>
                <p className="truncate text-[11px] text-[var(--ink3)]">Lofi Girl</p>
              </div>
            </div>
            <div className="my-2 h-1.5 rounded-full bg-[var(--col)]">
              <div className="h-full w-1/3 rounded-full bg-[var(--accent)]" />
            </div>
            <div className="flex items-center justify-center gap-4 text-[var(--ink2)]">
              <SkipBack size={16} />
              <button
                type="button"
                aria-label="Play"
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--ink)] bg-[var(--btn)] text-[var(--btn-ink)]"
              >
                <Play size={15} />
              </button>
              <SkipForward size={16} />
              <Volume2 size={16} className="ml-auto" />
            </div>
          </section>

          {/* ANNOUNCEMENTS */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                <Megaphone size={13} /> Announcements
              </h3>
              <button type="button" className="text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
                View all
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {ANNOUNCEMENTS.map((a, i) => (
                <div key={a.text} className="flex gap-2 rounded-[10px] border-2 border-[var(--line)] p-2">
                  <Avatar i={i} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between text-[11px] font-bold text-[var(--ink)]">
                      {a.who}
                      <span className="text-[10px] font-semibold text-[var(--ink3)]">{a.when}</span>
                    </p>
                    <p className="text-[12px] text-[var(--ink2)]">{a.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* NOTES */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
                📝 Notes
              </h3>
              <button type="button" className="flex items-center gap-1 text-[11px] font-bold text-[var(--accent-ink)] hover:underline">
                <Plus size={12} /> New Note
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {NOTES.map((n) => (
                <div
                  key={n}
                  className="flex items-start gap-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--pop-soft)] p-2.5"
                >
                  <p className="min-w-0 flex-1 text-[12px] font-semibold text-[var(--pop-ink)]">{n}</p>
                  <MoreVertical size={14} className="shrink-0 text-[var(--pop-ink)]" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function Stat({ n, label, tint }: { n: string; label: string; tint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="display-title text-2xl font-extrabold" style={{ color: tint ?? 'var(--ink)' }}>
        {n}
      </span>
      <span className="text-[11px] font-semibold text-[var(--ink3)]">{label}</span>
    </div>
  )
}

function ProgRow({ label, n, tint }: { label: string; n: number; tint: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="flex items-center gap-2 font-semibold text-[var(--ink2)]">
        <span className="h-2 w-2 rounded-full" style={{ background: tint }} />
        {label}
      </span>
      <span className="font-extrabold text-[var(--ink)]">{n}</span>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ChevronRight,
  FolderKanban,
} from 'lucide-react'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { inScope, useScope } from '#/lib/workspace-scope'

export const Route = createFileRoute('/projects')({
  loader: async () => await fetchDashboard(),
  component: Projects,
})

const PROJECT_TINTS = ['var(--ink)', 'var(--accent)']

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress-track w-full">
      <div
        className="progress-fill"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
      />
    </div>
  )
}

function Projects() {
  const d = Route.useLoaderData() as DashboardData
  const [picOnly, setPicOnly] = useState(false)
  const scope = useScope()

  // This is the comp's board tab: it shows the projects of whichever workspace
  // the pill is set to, and every project only under "Semua workspace".
  const projects = d.projects.filter((p) => inScope(scope, p.wsId))
  const picCount = projects.filter((p) => p.isMyPic).length
  const shown = picOnly ? projects.filter((p) => p.isMyPic) : projects

  return (
    <main className="min-w-0 flex-1 px-5 pb-8 sm:px-7">
      <div className="mx-auto flex max-w-[900px] flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <FolderKanban size={22} className="text-[var(--ink3)]" aria-hidden="true" />
          <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Projects</h1>
          <span className="chip ml-1">{shown.length}</span>
        </div>

        <div className="flex gap-2">
          {([
            { key: false, label: 'All', n: projects.length },
            { key: true, label: "I'm PIC", n: picCount },
          ] as const).map((t) => (
            <button
              key={String(t.key)}
              type="button"
              onClick={() => setPicOnly(t.key)}
              aria-pressed={picOnly === t.key}
              className={`rounded-full px-4 py-2.5 text-[13px] font-semibold transition ${
                picOnly === t.key
                  ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                  : 'bg-[var(--col)] text-[var(--ink2)] hover:bg-[var(--sunk)]'
              }`}
            >
              {t.label} <span className="opacity-60">{t.n}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 && (
          <div className="panel p-12 text-center">
            <p className="text-[20px] font-bold tracking-[-0.02em] text-[var(--ink)]">
              {picOnly ? "You're not PIC of any project" : 'No projects yet'}
            </p>
            <p className="mt-2 text-[14px] text-[var(--ink3)]">
              {picOnly
                ? 'A project owner can make you PIC from Edit project.'
                : 'Create a board from a workspace to see it here.'}
            </p>
          </div>
        )}


        {shown.length > 0 && (
          <section className="panel p-6">
            <div className="flex flex-col">
              {shown.map((p, i) => {
                const tint = PROJECT_TINTS[i % PROJECT_TINTS.length]
                return (
                  <Link
                    key={p.id}
                    to="/board/$boardId"
                    params={{ boardId: p.id }}
                    className="flex items-center gap-3.5 border-b border-[var(--line-soft)] py-3.5 no-underline last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[14.5px] font-semibold text-[var(--ink)]">
                        <span className="truncate">{p.title}</span>
                        {p.isMyPic && <span className="chip chip-accent shrink-0 text-[10px]">PIC</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[12.5px] text-[var(--ink3)]">
                        {scope === 'all' ? `${p.wsName} · ` : ''}
                        {p.done}/{p.total} tasks
                      </p>
                      <div className="mt-2.5 max-w-[260px]">
                        <Bar pct={p.progress} color={tint} />
                      </div>
                    </div>
                    <span className="shrink-0 text-[13px] font-bold tabular-nums text-[var(--ink)]">
                      {p.progress}%
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

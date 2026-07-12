import { createFileRoute, Link } from '@tanstack/react-router'
import { FolderKanban, ChevronRight } from 'lucide-react'
import { fetchDashboard, type DashboardData } from '#/lib/dashboard'
import { segFill } from '#/lib/progress'

export const Route = createFileRoute('/projects')({
  loader: async () => await fetchDashboard(),
  component: Projects,
})

const PROJECT_TINTS = ['var(--accent)', '#d97706', '#2563eb', '#7c3aed', '#db2777']

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

function Projects() {
  const d = Route.useLoaderData() as DashboardData

  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-center gap-2">
          <FolderKanban size={22} className="text-[var(--accent)]" aria-hidden="true" />
          <h1 className="display-title text-2xl font-extrabold text-[var(--ink)]">All Projects</h1>
          <span className="chip ml-1">{d.projects.length}</span>
        </div>

        {d.projects.length === 0 && (
          <div className="card p-10 text-center text-[var(--ink2)]">
            <p className="display-title text-lg font-bold">No projects yet</p>
            <p className="mt-1 text-sm text-[var(--ink3)]">Create a board from a workspace to see it here.</p>
          </div>
        )}

        {d.projects.length > 0 && (
          <section className="card p-4">
            <div className="flex flex-col">
              {d.projects.map((p, i) => {
                const tint = PROJECT_TINTS[i % PROJECT_TINTS.length]
                return (
                  <Link
                    key={p.id}
                    to="/board/$boardId"
                    params={{ boardId: p.id }}
                    className="flex items-center gap-3 border-b border-[var(--line)] py-3 no-underline last:border-0 hover:bg-[var(--col)]"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-[var(--ink)]">{p.title}</p>
                      <p className="truncate text-[11px] text-[var(--ink3)]">
                        {p.wsName} · {p.done}/{p.total} tasks
                      </p>
                      <div className="mt-1.5 max-w-[220px]">
                        <SegBar pct={p.progress} color={tint} />
                      </div>
                    </div>
                    <span className="shrink-0 text-[12px] font-extrabold" style={{ color: tint }}>
                      {p.progress}%
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
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

import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { FolderPlus } from 'lucide-react'
import { fetchNav, type NavBoard, type NavWorkspace } from '#/lib/nav'
import { createBoardFn } from '#/lib/actions'

function routeWorkspaceId(pathname: string, boards: NavBoard[]): string | null {
  return (
    pathname.match(/^\/workspace\/([^/]+)/)?.[1] ??
    boards.find((b) => b.id === pathname.match(/^\/board\/([^/]+)/)?.[1])?.workspaceId ??
    null
  )
}

/** "New project" popover body: board title, dropped into a workspace that's
 * inferred (route context, else the first workspace) rather than chosen — a
 * project belongs to whichever workspace it's created from, not a free pick. */
export default function QuickProjectForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchNav().then((nav) => {
      setWorkspaces(nav.workspaces)
      const locked = routeWorkspaceId(pathname, nav.boards)
      setWorkspaceId(locked ?? nav.workspaces[0]?.id ?? '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const { boardId } = await createBoardFn({ data: { workspaceId, title } })
      onDone()
      navigate({ to: '/board/$boardId', params: { boardId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <FolderPlus size={14} aria-hidden="true" /> New project
      </p>
      <input
        autoFocus
        placeholder="Project name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="field mb-2"
      />
      {workspaceName && (
        <p className="mb-2 text-[12px] text-[var(--ink3)]">
          In workspace <span className="font-bold text-[var(--ink2)]">{workspaceName}</span>
        </p>
      )}
      {workspaces.length === 0 && (
        <p className="mb-2 text-[12px] text-[var(--ink3)]">No workspaces yet — create one from the sidebar first.</p>
      )}
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !workspaceId} className="btn btn-primary btn-square w-full">
        {saving ? 'Creating…' : 'Create project'}
      </button>
    </form>
  )
}

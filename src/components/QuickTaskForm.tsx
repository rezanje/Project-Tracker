import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { CheckSquare } from 'lucide-react'
import { fetchNav, fetchBoardAssigneesFn, type NavBoard, type NavWorkspace, type BoardAssignee } from '#/lib/nav'
import { quickCreateTaskFn } from '#/lib/actions'

// Boards live inside one workspace each — a board picked from workspace A
// can't take a task meant for workspace B, so the workspace is inferred from
// the current route (or chosen explicitly) and the board list stays scoped to it.
function routeWorkspaceId(pathname: string, boards: NavBoard[]): string | null {
  return (
    pathname.match(/^\/workspace\/([^/]+)/)?.[1] ??
    boards.find((b) => b.id === pathname.match(/^\/board\/([^/]+)/)?.[1])?.workspaceId ??
    null
  )
}

/** "New task" popover body: title + workspace (if ambiguous) + board, scoped
 * to the current workspace context. Used by both the header "+ New" menu and
 * the Home "Add Task" quick action. */
export default function QuickTaskForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState<BoardAssignee[]>([])
  const [meId, setMeId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchNav().then((nav) => {
      setBoards(nav.boards)
      setWorkspaces(nav.workspaces)
      const wsId = routeWorkspaceId(pathname, nav.boards) ?? nav.workspaces[0]?.id ?? ''
      setWorkspaceId(wsId)
      setBoardId(nav.boards.find((b) => b.workspaceId === wsId)?.id ?? '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!boardId) {
      setAssignees([])
      return
    }
    fetchBoardAssigneesFn({ data: { boardId } }).then(({ meId: id, members }) => {
      setMeId(id)
      setAssignees(members)
      setAssigneeId(id)
    })
  }, [boardId])

  const lockedWorkspaceId = routeWorkspaceId(pathname, boards)
  const boardsInWorkspace = boards.filter((b) => b.workspaceId === workspaceId)

  function onWorkspaceChange(id: string) {
    setWorkspaceId(id)
    setBoardId(boards.find((b) => b.workspaceId === id)?.id ?? '')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!boardId || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const { boardId: bId } = await quickCreateTaskFn({ data: { boardId, title, assigneeId } })
      onDone()
      navigate({ to: '/board/$boardId', params: { boardId: bId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <CheckSquare size={14} aria-hidden="true" /> New task
      </p>
      <input
        autoFocus
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="field mb-2"
      />
      {!lockedWorkspaceId && workspaces.length > 1 && (
        <select value={workspaceId} onChange={(e) => onWorkspaceChange(e.target.value)} className="field mb-2">
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}
      {boardsInWorkspace.length > 0 ? (
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className="field mb-2">
          {boardsInWorkspace.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      ) : (
        <p className="mb-2 text-[12px] text-[var(--ink3)]">No boards in this workspace yet — create one first.</p>
      )}
      {assignees.length > 0 && (
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field mb-2">
          <option value="">Unassigned</option>
          {assignees.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === meId ? 'Me' : m.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !boardId} className="btn btn-primary btn-square w-full">
        {saving ? 'Creating…' : 'Create task'}
      </button>
    </form>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import {
  fetchNav,
  fetchBoardAssigneesFn,
  type NavBoard,
  type NavWorkspace,
  type BoardAssignee,
  type BoardColumn,
} from '#/lib/nav'
import { quickCreateTaskFn, createStandaloneTaskFn } from '#/lib/actions'
import { localDateStr } from '#/lib/home'
import { toast } from './Toast'

const NO_PROJECT = '__none__'

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

/** A horizontally scrolling chip row — the comp's project and lane pickers. */
function Chips<T extends string>({
  value,
  options,
  onPick,
  label,
  rowRef,
}: {
  value: T
  options: Array<{ id: T; label: string }>
  onPick: (id: T) => void
  label: string
  rowRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div className="mb-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
        {label}
      </p>
      <div ref={rowRef} className="gt-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            aria-pressed={value === o.id}
            className={`shrink-0 whitespace-nowrap rounded-full px-[15px] py-2 text-[13px] font-semibold transition ${
              value === o.id
                ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                : 'bg-[var(--col)] text-[var(--ink2)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** "Task baru": title, project chips, lane chips, schedule-today toggle.
 *  Used by the FAB sheet and the header "+ New" menu alike. */
export default function QuickTaskForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const [boards, setBoards] = useState<NavBoard[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [today, setToday] = useState(false)
  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState<BoardAssignee[]>([])
  const [columns, setColumns] = useState<BoardColumn[]>([])
  const [columnId, setColumnId] = useState('')
  const [meId, setMeId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectRowRef = useRef<HTMLDivElement>(null)

  // The prefilled project can sit past the right edge of the chip row. Bring it
  // into view, or the sheet opens looking like nothing is selected.
  useEffect(() => {
    const row = projectRowRef.current
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (row && chip) row.scrollLeft = chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2
  }, [boardId, boards.length])

  useEffect(() => {
    fetchNav().then((nav) => {
      setBoards(nav.boards)
      setWorkspaces(nav.workspaces)
      const wsId = routeWorkspaceId(pathname, nav.boards) ?? nav.workspaces[0]?.id ?? ''
      setWorkspaceId(wsId)
      // Opened from a board? Prefill with that project, not merely the first
      // one in its workspace.
      const onBoardId = pathname.match(/^\/board\/([^/]+)/)?.[1]
      const current = onBoardId && nav.boards.find((b) => b.id === onBoardId)
      setBoardId(current ? current.id : (nav.boards.find((b) => b.workspaceId === wsId)?.id ?? NO_PROJECT))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!boardId || boardId === NO_PROJECT) {
      setAssignees([])
      setColumns([])
      setColumnId('')
      return
    }
    fetchBoardAssigneesFn({ data: { boardId } }).then(({ meId: id, members, columns: cols }) => {
      setMeId(id)
      setAssignees(members)
      setAssigneeId(id)
      setColumns(cols)
      setColumnId(cols[0]?.id ?? '')
    })
  }, [boardId])

  const lockedWorkspaceId = routeWorkspaceId(pathname, boards)
  const boardsInWorkspace = boards.filter((b) => b.workspaceId === workspaceId)
  const canSubmit = Boolean(title.trim()) && !saving && Boolean(boardId) && Boolean(workspaceId)

  function onWorkspaceChange(id: string) {
    setWorkspaceId(id)
    setBoardId(boards.find((b) => b.workspaceId === id)?.id ?? NO_PROJECT)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const dueDate = today ? localDateStr() : null
    try {
      if (boardId === NO_PROJECT) {
        await createStandaloneTaskFn({ data: { title, workspaceId, dueDate } })
        router.invalidate()
        toast('Task ditambahin')
        onDone()
        return
      }
      const { boardId: bId } = await quickCreateTaskFn({
        data: { boardId, title, assigneeId, columnId, dueDate },
      })
      toast('Task ditambahin')
      onDone()
      navigate({ to: '/board/$boardId', params: { boardId: bId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task gagal dibuat')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {/* `--col` rather than the comp's `--card`: this form also renders inside
          the header's `--card` popover, where card-on-card would vanish. */}
      <input
        autoFocus
        placeholder="Mau ngerjain apa?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Judul task"
        className="mb-4 w-full rounded-[18px] bg-[var(--col)] px-4 py-3.5 text-[16px] font-semibold text-[var(--ink)] outline-none placeholder:font-medium placeholder:text-[var(--ink3)]"
      />

      {/* Shown for project-less tasks too: those still belong to a workspace. */}
      {!lockedWorkspaceId && workspaces.length > 1 && (
        <Chips
          label="Workspace"
          value={workspaceId}
          onPick={onWorkspaceChange}
          options={workspaces.map((w) => ({ id: w.id, label: w.name }))}
        />
      )}

      <Chips
        label="Project"
        rowRef={projectRowRef}
        value={boardId}
        onPick={setBoardId}
        options={[
          { id: NO_PROJECT, label: 'Tanpa project' },
          ...boardsInWorkspace.map((b) => ({ id: b.id, label: b.title })),
        ]}
      />

      {columns.length > 0 && (
        <Chips
          label="Kolom"
          value={columnId}
          onPick={setColumnId}
          options={columns.map((c) => ({ id: c.id, label: c.title }))}
        />
      )}

      {assignees.length > 0 && (
        <Chips
          label="Ditugaskan ke"
          value={assigneeId}
          onPick={setAssigneeId}
          options={[
            { id: '', label: 'Belum ditugaskan' },
            ...assignees.map((m) => ({ id: m.id, label: m.id === meId ? 'Saya' : m.name })),
          ]}
        />
      )}

      <button
        type="button"
        onClick={() => setToday((v) => !v)}
        aria-pressed={today}
        className="mb-4 flex w-full items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5 text-left"
      >
        <span
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${
            today
              ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
              : 'text-transparent shadow-[inset_0_0_0_1.8px_var(--sunk)]'
          }`}
        >
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        </span>
        <span className="text-[14px] font-semibold text-[var(--ink)]">Jadwalkan hari ini</span>
      </button>

      {boardsInWorkspace.length === 0 && (
        <p className="mb-3 text-[12.5px] text-[var(--ink3)]">
          Belum ada project di workspace ini — pakai "Tanpa project" dulu.
        </p>
      )}
      {error && <p className="mb-3 text-[12.5px] font-semibold text-[var(--danger)]">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className={`h-[54px] w-full rounded-full text-[15px] font-bold transition ${
          canSubmit
            ? 'bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(232,98,44,.35)] active:scale-[.99]'
            : 'cursor-not-allowed bg-[var(--col)] text-[var(--ink3)]'
        }`}
      >
        {saving ? 'Bikin…' : 'Buat task'}
      </button>
    </form>
  )
}

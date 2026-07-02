import { useState } from 'react'
import { X } from 'lucide-react'
import { catColor } from '#/components/Card'
import type { BoardMeta } from '#/routes/board.$boardId'

interface Props {
  columns: { id: string; title: string }[]
  members: BoardMeta['members']
  categorySuggestions: string[]
  onClose: () => void
  onCreated: () => void
  onCreate: (task: {
    columnId: string
    title: string
    due_date: string | null
    assignee_id: string | null
    category: string | null
    description: string | null
  }) => Promise<void>
}

const label = 'mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--ink3)]'

export default function TaskCreate({
  columns,
  members,
  categorySuggestions,
  onClose,
  onCreated,
  onCreate,
}: Props) {
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title.trim() || !columnId) {
      setError('Name and phase are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        columnId,
        title: title.trim(),
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
        category: category.trim() || null,
        description: description.trim() || null,
      })
      onCreated()
    } catch {
      setError('Failed to create task. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">Add task</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className={label}>Task name</div>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Phase</div>
              <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className="field">
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={label}>Due date</div>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Assignee</div>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field">
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={label}>Category</div>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="task-categories"
                placeholder="Design, Bug…"
                className="field"
              />
              <datalist id="task-categories">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {category.trim() && (
                <span
                  className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: `${catColor(category.trim())}22`, color: catColor(category.trim()) }}
                >
                  {category.trim()}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className={label}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="field min-h-[80px] resize-y leading-relaxed"
            />
          </div>
          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2.5">
            <button onClick={handleCreate} disabled={busy} className="btn btn-primary btn-square">
              {busy ? 'Adding…' : 'Add task'}
            </button>
            <button onClick={onClose} className="btn btn-ghost btn-square">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

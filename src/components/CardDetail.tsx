import { useState } from 'react'
import { X } from 'lucide-react'
import Attachments from '#/components/Attachments'
import Comments from '#/components/Comments'
import type { CardRow } from '#/lib/board-data'
import type { BoardMeta } from '#/routes/board.$boardId'

interface CardDetailProps {
  card: CardRow
  boardId: string
  meta: BoardMeta
  isOwner: boolean
  onClose: () => void
  onSaved: () => void
  onUpdateCard: (
    cardId: string,
    fields: Partial<{
      title: string
      description: string | null
      due_date: string | null
      assignee_id: string | null
    }>,
  ) => Promise<void>
  onSetLabels: (cardId: string, labelIds: string[]) => Promise<void>
}

const labelCls = 'mb-1.5 block text-xs font-semibold text-[var(--sea-ink-soft)]'

export default function CardDetail({
  card,
  boardId,
  meta,
  isOwner,
  onClose,
  onSaved,
  onUpdateCard,
  onSetLabels,
}: CardDetailProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [dueDate, setDueDate] = useState(card.due_date ?? '')
  const [assigneeId, setAssigneeId] = useState(card.assignee_id ?? '')
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    card.card_labels.map((cl) => cl.label_id),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onUpdateCard(card.id, {
        title: title.trim() || card.title,
        description: description.trim() || null,
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
      })
      await onSetLabels(card.id, selectedLabelIds)
      onSaved()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  const assignee = meta.members.find((m) => m.id === (card.assignee_id ?? ''))

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
      onClick={handleBackdropClick}
    >
      <div className="card relative w-full max-w-lg p-6">
        <button
          onClick={onClose}
          aria-label="Close"
          className="btn btn-ghost absolute right-3 top-3 h-8 w-8 p-0"
        >
          <X size={16} aria-hidden="true" />
        </button>

        {isOwner ? (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className={labelCls}>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="field"
              />
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="field resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className={labelCls}>Assignee</label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="field"
                >
                  <option value="">— Unassigned —</option>
                  {meta.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {meta.labels.length > 0 ? (
              <div>
                <label className={labelCls}>Labels</label>
                <div className="flex flex-wrap gap-2">
                  {meta.labels.map((label) => {
                    const active = selectedLabelIds.includes(label.id)
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => toggleLabel(label.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold text-white transition ${
                          active
                            ? 'ring-2 ring-[var(--lagoon-deep)] ring-offset-1'
                            : 'opacity-55 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--sea-ink-soft)]">
                No labels on this board yet.
              </p>
            )}

            {error && <p className="text-xs text-[#b23b3b]">{error}</p>}

            <div className="border-t border-[var(--line)] pt-4">
              <Comments cardId={card.id} members={meta.members} />
            </div>
            <Attachments cardId={card.id} boardId={boardId} />

            <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="display-title pr-8 text-xl font-bold text-[var(--sea-ink)]">
              {card.title}
            </h2>

            {card.description && (
              <div>
                <p className={labelCls}>Description</p>
                <p className="whitespace-pre-wrap text-sm text-[var(--sea-ink)]">
                  {card.description}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className={labelCls}>Due date</p>
                <p className="text-sm text-[var(--sea-ink)]">
                  {card.due_date ?? (
                    <span className="italic text-[var(--sea-ink-soft)]">None</span>
                  )}
                </p>
              </div>
              <div>
                <p className={labelCls}>Assignee</p>
                <p className="text-sm text-[var(--sea-ink)]">
                  {assignee?.name ?? (
                    <span className="italic text-[var(--sea-ink-soft)]">Unassigned</span>
                  )}
                </p>
              </div>
            </div>

            {card.card_labels.length > 0 && (
              <div>
                <p className={labelCls}>Labels</p>
                <div className="flex flex-wrap gap-2">
                  {card.card_labels.map((cl) => {
                    const label = meta.labels.find((l) => l.id === cl.label_id)
                    if (!label) return null
                    return (
                      <span
                        key={cl.label_id}
                        className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-[var(--line)] pt-4">
              <Comments cardId={card.id} members={meta.members} />
            </div>
            <Attachments cardId={card.id} boardId={boardId} />

            <div className="flex justify-end border-t border-[var(--line)] pt-4">
              <button onClick={onClose} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

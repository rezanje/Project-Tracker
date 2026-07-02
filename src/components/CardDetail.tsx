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
  onDelete: () => void
  onUpdateCard: (
    cardId: string,
    fields: Partial<{
      title: string
      description: string | null
      due_date: string | null
      assignee_id: string | null
      category: string | null
    }>,
  ) => Promise<void>
  onSetLabels: (cardId: string, labelIds: string[]) => Promise<void>
  categorySuggestions?: string[]
}

const fieldLabel =
  'mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--ink3)]'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

export default function CardDetail({
  card,
  boardId,
  meta,
  isOwner,
  onClose,
  onSaved,
  onDelete,
  onUpdateCard,
  onSetLabels,
  categorySuggestions = [],
}: CardDetailProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [dueDate, setDueDate] = useState(card.due_date ?? '')
  const [assigneeId, setAssigneeId] = useState(card.assignee_id ?? '')
  const [category, setCategory] = useState(card.category ?? '')
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

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onUpdateCard(card.id, {
        title: title.trim() || card.title,
        description: description.trim() || null,
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
        category: category.trim() || null,
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-[640px] overflow-hidden rounded-[24px] bg-[var(--card)] shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        {/* Header */}
        <div className="relative px-6 pt-6">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-[18px] top-[18px] flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>

          {isOwner ? (
            meta.labels.length > 0 && (
              <div className="mb-3.5 flex flex-wrap gap-2 pr-10">
                {meta.labels.map((label) => {
                  const active = selectedLabelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      className="rounded-full border px-3 py-1 text-xs font-bold text-white transition"
                      style={
                        active
                          ? { backgroundColor: label.color, borderColor: label.color }
                          : {
                              backgroundColor: 'transparent',
                              borderColor: 'var(--line)',
                              color: 'var(--ink2)',
                            }
                      }
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            card.card_labels.length > 0 && (
              <div className="mb-3.5 flex flex-wrap gap-2 pr-10">
                {card.card_labels.map((cl) => {
                  const label = meta.labels.find((l) => l.id === cl.label_id)
                  if (!label) return null
                  return (
                    <span
                      key={cl.label_id}
                      className="rounded-full px-3 py-1 text-xs font-bold text-white"
                      style={{ backgroundColor: label.color }}
                    >
                      {label.name}
                    </span>
                  )
                })}
              </div>
            )
          )}

          {isOwner ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Card title"
              className="display-title w-full bg-transparent pr-10 text-[25px] font-extrabold text-[var(--ink)] outline-none"
            />
          ) : (
            <h2 className="display-title pr-10 text-[25px] font-extrabold text-[var(--ink)]">
              {card.title}
            </h2>
          )}
        </div>

        {/* Body */}
        <div className="px-6 pb-6 pt-4">
          <div className="mb-5 mt-4 grid grid-cols-2 gap-3.5">
            <div>
              <div className={fieldLabel}>Due date</div>
              {isOwner ? (
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="field"
                />
              ) : (
                <div className="pt-0.5 text-sm font-semibold text-[var(--ink)]">
                  {card.due_date ?? (
                    <span className="italic text-[var(--ink3)]">None</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className={fieldLabel}>Assignee</div>
              {isOwner ? (
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="field cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {meta.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2 pt-0.5">
                  {assignee && (
                    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                      {initials(assignee.name)}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    {assignee?.name ?? (
                      <span className="italic text-[var(--ink3)]">Unassigned</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mb-5">
            <div className={fieldLabel}>Description</div>
            {isOwner ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description…"
                className="field min-h-[88px] resize-y leading-relaxed"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink2)]">
                {card.description || (
                  <span className="italic text-[var(--ink3)]">No description.</span>
                )}
              </p>
            )}
          </div>

          {isOwner && (
            <div className="mb-4">
              <label className={fieldLabel}>Category</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="card-categories"
                placeholder="Design, Bug…"
                className="field"
              />
              <datalist id="card-categories">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}

          {isOwner && (
            <div className="mb-5 flex gap-2.5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary btn-square"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={onClose} className="btn btn-ghost btn-square">
                Cancel
              </button>
              <button onClick={onDelete} className="btn btn-danger btn-square ml-auto">
                Delete
              </button>
            </div>
          )}
          {error && <p className="mb-4 text-[13px] text-[var(--danger)]">{error}</p>}

          <div className="my-5 h-px bg-[var(--line)]" />

          <div className="mb-6">
            <Comments cardId={card.id} members={meta.members} />
          </div>
          <Attachments cardId={card.id} boardId={boardId} />
        </div>
      </div>
    </div>
  )
}

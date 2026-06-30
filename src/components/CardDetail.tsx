import { useState } from 'react'
import Comments from '#/components/Comments'
import type { CardRow } from '#/lib/board-data'
import type { BoardMeta } from '#/routes/board.$boardId'

interface CardDetailProps {
  card: CardRow
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

export default function CardDetail({
  card,
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

  // Backdrop click closes the modal
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  const assignee = meta.members.find((m) => m.id === (card.assignee_id ?? ''))

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      {/* Panel */}
      <div className="island-shell relative w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1 text-[var(--sea-ink-soft)] transition-colors hover:text-[var(--sea-ink)]"
        >
          ✕
        </button>

        {isOwner ? (
          // ── Owner: editable fields ────────────────────────────────────────────
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Due Date
              </label>
              {/* due_date is a Postgres `date` (YYYY-MM-DD) — matches input type="date" directly */}
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Assignee
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--lagoon-deep)]"
              >
                <option value="">— Unassigned —</option>
                {meta.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {meta.labels.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Labels
                </label>
                <div className="flex flex-wrap gap-2">
                  {meta.labels.map((label) => {
                    const active = selectedLabelIds.includes(label.id)
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => toggleLabel(label.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                          active
                            ? 'ring-2 ring-[var(--lagoon-deep)] ring-offset-1'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: label.color, color: '#fff' }}
                      >
                        {label.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {meta.labels.length === 0 && (
              <p className="text-xs text-[var(--sea-ink-soft)]">
                No labels on this board yet. Labels can be created in board settings.
              </p>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            {/* ── SLOT: Task 11 — Comments ─────────────────────────────────── */}
            <Comments cardId={card.id} members={meta.members} />
            {/* ── SLOT: Task 12 — Attachments will mount here ──────────────── */}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[rgba(23,58,64,0.2)] px-4 py-2 text-sm text-[var(--sea-ink)] transition-colors hover:bg-[rgba(23,58,64,0.05)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          // ── Client: read-only fields ──────────────────────────────────────────
          <div className="flex flex-col gap-4">
            <h2 className="pr-6 text-xl font-bold text-[var(--sea-ink)]">{card.title}</h2>

            {card.description && (
              <div>
                <p className="mb-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Description
                </p>
                <p className="whitespace-pre-wrap text-sm text-[var(--sea-ink)]">
                  {card.description}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--sea-ink-soft)]">Due Date</p>
              <p className="text-sm text-[var(--sea-ink)]">
                {card.due_date ?? <span className="italic text-[var(--sea-ink-soft)]">None</span>}
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--sea-ink-soft)]">Assignee</p>
              <p className="text-sm text-[var(--sea-ink)]">
                {assignee?.name ?? (
                  <span className="italic text-[var(--sea-ink-soft)]">Unassigned</span>
                )}
              </p>
            </div>

            {card.card_labels.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-[var(--sea-ink-soft)]">Labels</p>
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

            {/* ── SLOT: Task 11 — Comments ─────────────────────────────────── */}
            <Comments cardId={card.id} members={meta.members} />
            {/* ── SLOT: Task 12 — Attachments will mount here ──────────────── */}

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-full bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

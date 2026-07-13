import { useState } from 'react'
import { X } from 'lucide-react'
import { updateNoteFn } from '#/lib/actions'

type Note = { id: string; body: string; category: string | null }

export default function NoteDetail({
  note,
  categorySuggestions,
  onClose,
  onSaved,
  onDelete,
}: {
  note: Note
  categorySuggestions: string[]
  onClose: () => void
  onSaved: () => void
  onDelete: () => void
}) {
  const [body, setBody] = useState(note.body)
  const [category, setCategory] = useState(note.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateNoteFn({ data: { id: note.id, body: body.trim(), category: category.trim() || undefined } })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">Note</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <textarea
            autoFocus
            rows={10}
            placeholder="Write a note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="field resize-none"
          />
          <div>
            <input
              list="note-detail-categories"
              placeholder="Category (optional)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field"
            />
            <datalist id="note-detail-categories">
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          {error && <p className="text-[13px] font-semibold text-[var(--danger)]">{error}</p>}

          <div className="flex items-center justify-between">
            <button type="button" onClick={onDelete} className="btn btn-danger btn-square">
              Delete
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-square">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !body.trim()}
                className="btn btn-primary btn-square"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

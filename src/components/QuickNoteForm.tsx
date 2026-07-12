import { useState } from 'react'
import { StickyNote } from 'lucide-react'
import { createNoteFn } from '#/lib/actions'

export default function QuickNoteForm({ onDone }: { onDone: () => void }) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createNoteFn({ data: { body } })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <StickyNote size={14} aria-hidden="true" /> New note
      </p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Write a note…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="field mb-2 resize-none"
      />
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !body.trim()} className="btn btn-primary btn-square w-full">
        {saving ? 'Saving…' : 'Save note'}
      </button>
    </form>
  )
}

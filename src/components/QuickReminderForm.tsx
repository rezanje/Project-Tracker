import { useState } from 'react'
import { AlarmClock } from 'lucide-react'
import { createReminderFn } from '#/lib/reminders'

// Default the picker to an hour from now, formatted for <input type="datetime-local">.
function defaultLocalDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function QuickReminderForm({ onDone }: { onDone: () => void }) {
  const [message, setMessage] = useState('')
  const [when, setWhen] = useState(defaultLocalDateTime)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim() || !when) return
    setSaving(true)
    setError(null)
    try {
      await createReminderFn({ data: { message, remindAt: new Date(when).toISOString() } })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set reminder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--ink2)]">
        <AlarmClock size={14} aria-hidden="true" /> Set reminder
      </p>
      <input
        autoFocus
        placeholder="Remind me to…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="field mb-2"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="field mb-2"
      />
      {error && <p className="mb-2 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={saving || !message.trim()} className="btn btn-primary btn-square w-full">
        {saving ? 'Saving…' : 'Set reminder'}
      </button>
    </form>
  )
}

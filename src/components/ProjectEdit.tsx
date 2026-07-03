import { useState } from 'react'
import { X } from 'lucide-react'
import type { BoardWithColumns } from '#/lib/board-data'
import type { BoardMetaUpdate } from '#/lib/boards'

interface Props {
  board: BoardWithColumns
  typeSuggestions: string[]
  onClose: () => void
  onSaved: () => void
  onSave: (fields: BoardMetaUpdate, valueIdr: number) => Promise<void>
  onDelete: () => Promise<void>
}

const label = 'mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--ink3)]'
const STATUSES = ['active', 'on_hold', 'done', 'archived'] as const
const PRIORITIES = ['', 'low', 'medium', 'high', 'urgent'] as const

export default function ProjectEdit({ board, typeSuggestions, onClose, onSaved, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(board.title)
  const [description, setDescription] = useState(board.description ?? '')
  const [type, setType] = useState(board.type ?? '')
  const [pic, setPic] = useState(board.pic ?? '')
  const [status, setStatus] = useState(board.status)
  const [clientName, setClientName] = useState(board.client_name ?? '')
  const [startDate, setStartDate] = useState(board.start_date ?? '')
  const [deadline, setDeadline] = useState(board.deadline ?? '')
  const [priority, setPriority] = useState(board.priority ?? '')
  const [value, setValue] = useState(String(board.value_idr ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const t = (v: string) => (v.trim() === '' ? null : v.trim())
      await onSave(
        {
          title: title.trim() || board.title,
          description: t(description),
          type: t(type),
          pic: t(pic),
          status,
          client_name: t(clientName),
          start_date: startDate || null,
          deadline: deadline || null,
          priority: priority || null,
        },
        Math.max(0, Math.floor(Number(value) || 0)),
      )
      onSaved()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      // Parent navigates away on success; component unmounts, so leave `deleting` set.
    } catch {
      setError('Gagal menghapus project. Coba lagi.')
      setDeleting(false)
    }
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">Edit project</h2>
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
            <div className={label}>Project name</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Type</div>
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                list="project-types"
                placeholder="Design, Branding…"
                className="field"
              />
              <datalist id="project-types">
                {typeSuggestions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <div className={label}>Status</div>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="field">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Client</div>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="field" />
            </div>
            <div>
              <div className={label}>PIC</div>
              <input value={pic} onChange={(e) => setPic(e.target.value)} className="field" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Start date</div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
            </div>
            <div>
              <div className={label}>Deadline</div>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="field" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={label}>Priority</div>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="field">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p === '' ? '—' : p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={label}>Value (Rp) — private</div>
              <input
                type="number"
                min="0"
                step="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="field"
              />
            </div>
          </div>

          <div>
            <div className={label}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              className="field min-h-[88px] resize-y leading-relaxed"
            />
          </div>

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}

          <div className="flex gap-2.5">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-square">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={onClose} className="btn btn-ghost btn-square">
              Cancel
            </button>
          </div>

          <div className="mt-2 border-t border-[var(--line)] pt-4">
            <div className={label} style={{ color: 'var(--danger)' }}>
              Danger zone
            </div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-danger btn-square"
            >
              Hapus project
            </button>
            <p className="mt-1.5 text-[12px] text-[var(--ink3)]">
              Permanen. Semua task, komentar &amp; file ikut terhapus.
            </p>
          </div>
        </div>
      </div>
    </div>

    {confirming && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,28,22,0.42)] px-5 backdrop-blur-[3px] gt-back"
        onClick={(e) => e.target === e.currentTarget && !deleting && setConfirming(false)}
      >
        <div className="w-full max-w-[420px] rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
          <h3 className="display-title text-xl font-extrabold text-[var(--ink)]">
            Hapus “{board.title}”?
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink2)]">
            Project ini beserta semua task, komentar, dan file di dalamnya akan dihapus permanen.
            Tindakan ini tidak bisa dibatalkan.
          </p>
          {error && <p className="mt-2 text-[13px] text-[var(--danger)]">{error}</p>}
          <div className="mt-5 flex gap-2.5">
            <button onClick={handleDelete} disabled={deleting} className="btn btn-danger btn-square">
              {deleting ? 'Menghapus…' : 'Ya, hapus'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="btn btn-ghost btn-square"
            >
              Batal
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

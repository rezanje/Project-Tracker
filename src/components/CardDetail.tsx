import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import Attachments from '#/components/Attachments'
import Comments from '#/components/Comments'
import { Sheet } from '#/components/WorkspaceSwitcher'
import { toast } from '#/components/Toast'
import { accentFor } from '#/lib/accent'
import {
  CONTENT_CHANNELS, CONTENT_FORMATS, CONTENT_STATUSES, type CardRow, type Pillar,
} from '#/lib/board-data'
import { isDoneColumn, isInProgressColumn } from '#/lib/home'
import type { BoardMeta } from '#/routes/board.$boardId'

interface CardDetailProps {
  card: CardRow
  boardId: string
  meta: BoardMeta
  isOwner: boolean
  /** Uppercase eyebrow above the title — the project (and workspace) this card lives in. */
  projectName: string
  /** Every lane on the board, in order; drives the status segmented control. */
  columns: Array<{ id: string; title: string }>
  /** The lane the card currently sits in. */
  columnId?: string
  /** Move the card to another lane. Omitted for read-only viewers. */
  onMove?: (toColumnId: string) => void
  onClose: () => void
  onSaved: () => void
  /** Refetch board data after a quick, single-field save (deadline) that shouldn't close the sheet. */
  onRefresh?: () => void
  onDelete: () => void
  onUpdateCard: (
    cardId: string,
    fields: Partial<{
      title: string
      description: string | null
      due_date: string | null
      assignee_id: string | null
      category: string | null
      contact: string | null
      phone: string | null
      source: string | null
      deal_value: number | null
      pillar_id: string | null
      content_status: string | null
      channels: string[] | null
      format: string | null
    }>,
  ) => Promise<void>
  onSetLabels: (cardId: string, labelIds: string[]) => Promise<void>
  categorySuggestions?: string[]
  isLeads?: boolean
  isContent?: boolean
  pillars?: Pillar[]
}

const fieldLabel =
  'mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-[var(--ink3)]'
const eyebrow =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

/** The 3px lane bar: done reads as ink, active as the accent, review as green. */
function barColor(title: string | undefined): string {
  if (!title) return 'var(--ink3)'
  if (isDoneColumn(title)) return 'var(--ink)'
  if (isInProgressColumn(title)) return 'var(--accent)'
  if (/review|approv/i.test(title)) return 'var(--done)'
  return 'var(--ink3)'
}

function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function CardDetail({
  card,
  boardId,
  meta,
  isOwner,
  projectName,
  columns,
  columnId,
  onMove,
  onClose,
  onSaved,
  onRefresh,
  onDelete,
  onUpdateCard,
  onSetLabels,
  categorySuggestions = [],
  isLeads = false,
  isContent = false,
  pillars = [],
}: CardDetailProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [dueDate, setDueDate] = useState(card.due_date ?? '')
  const [assigneeId, setAssigneeId] = useState(card.assignee_id ?? '')
  const [category, setCategory] = useState(card.category ?? '')
  const [contact, setContact] = useState(card.contact ?? '')
  const [phone, setPhone] = useState(card.phone ?? '')
  const [source, setSource] = useState(card.source ?? '')
  const [dealValue, setDealValue] = useState(card.deal_value != null ? String(card.deal_value) : '')
  const [pillarId, setPillarId] = useState(card.pillar_id ?? '')
  const [contentStatus, setContentStatus] = useState(card.content_status ?? 'draft')
  const [channels, setChannels] = useState<string[]>(card.channels ?? [])
  const [format, setFormat] = useState(card.format ?? '')
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    card.card_labels.map((cl) => cl.label_id),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [dueSaving, setDueSaving] = useState(false)

  async function handleDueDateChange(value: string) {
    const prev = dueDate
    setDueDate(value)
    setDueSaving(true)
    try {
      await onUpdateCard(card.id, { due_date: value || null })
      toast(value ? `Deadline: ${longDate(value)}` : 'Deadline dihapus')
      onRefresh?.()
    } catch {
      setDueDate(prev)
      toast('Gagal menyimpan deadline')
    } finally {
      setDueSaving(false)
    }
  }

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    )
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
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
        ...(isLeads
          ? {
              contact: contact.trim() || null,
              phone: phone.trim() || null,
              source: source.trim() || null,
              deal_value: dealValue ? Math.max(0, Math.floor(Number(dealValue) || 0)) : null,
            }
          : {}),
        ...(isContent
          ? {
              pillar_id: pillarId || null,
              content_status: contentStatus || null,
              channels: channels.length ? channels : null,
              format: format || null,
            }
          : {}),
      })
      await onSetLabels(card.id, selectedLabelIds)
      toast('Task disimpan')
      onSaved()
    } catch {
      setError('Gagal menyimpan. Coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  const currentColumn = columns.find((c) => c.id === columnId)
  const done = currentColumn ? isDoneColumn(currentColumn.title) : false
  const doneColumn = columns.find((c) => isDoneColumn(c.title))
  const reopenColumn =
    columns.find((c) => isInProgressColumn(c.title)) ?? columns.find((c) => !isDoneColumn(c.title))
  const primaryTarget = done ? reopenColumn : doneColumn

  function move(toColumnId: string, label: string) {
    if (!onMove || toColumnId === columnId) return
    onMove(toColumnId)
    toast(`Dipindah ke ${label}`)
  }

  const assignee = meta.members.find((m) => m.id === (card.assignee_id ?? ''))
  const labels = card.card_labels
    .map((cl) => meta.labels.find((l) => l.id === cl.label_id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l))

  return (
    <Sheet
      onClose={onClose}
      label={card.title}
      className="max-h-[86%]"
      header={
        // Lane bar, project eyebrow, title, close.
        <div className="flex items-start gap-3">
          <span
            className="w-[3px] shrink-0 self-stretch rounded-full"
            style={{ background: barColor(currentColumn?.title) }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className={`truncate ${eyebrow}`}>{projectName}</p>
            <h2
              className={`mt-1 text-[21px] font-extrabold leading-[1.2] tracking-[-0.03em] text-[var(--ink)] ${
                done ? 'line-through opacity-50' : ''
              }`}
            >
              {card.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition hover:text-[var(--ink)] active:scale-[.92]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      {labels.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {labels.map((l) => (
            <span
              key={l.id}
              className="rounded-full px-3 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      {/* Clamped by default: real notes run to shopping lists and pasted links,
          and an unclamped one pushes Status and the primary action off-screen. */}
      {card.description && (
        <div className="mt-3.5 rounded-[16px] bg-[var(--col)] px-4 py-3.5">
          <p
            className={`whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-[var(--ink2)] ${
              noteOpen ? '' : 'line-clamp-5'
            }`}
          >
            {card.description}
          </p>
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className="mt-2 text-[12.5px] font-bold text-[var(--accent-ink)]"
          >
            {noteOpen ? 'Ringkas' : 'Selengkapnya'}
          </button>
        </div>
      )}

      <div className="mt-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={eyebrow}>Deadline</p>
          {isOwner ? (
            // A bare `input[type=date]` reads as an empty slot ("dd/mm/yyyy"),
            // so keep the sentence and lay the real control over it invisibly —
            // the tap still opens the OS picker.
            <div className={`relative mt-[3px] w-fit ${dueSaving ? 'opacity-60' : ''}`}>
              <p className="text-[14.5px] font-semibold text-[var(--ink)] underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px]">
                {dueDate ? longDate(dueDate) : (
                  <span className="text-[var(--ink3)]">Belum diatur</span>
                )}
              </p>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => handleDueDateChange(e.target.value)}
                disabled={dueSaving}
                aria-label="Deadline"
                className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
              />
            </div>
          ) : (
            <p className="mt-[3px] text-[14.5px] font-semibold text-[var(--ink)]">
              {card.due_date ? longDate(card.due_date) : (
                <span className="text-[var(--ink3)]">Belum diatur</span>
              )}
            </p>
          )}
        </div>
        {assignee && (
          <span
            title={assignee.name}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: accentFor(assignee.id) }}
          >
            {assignee.avatar_url ? (
              <img src={assignee.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials(assignee.name)
            )}
          </span>
        )}
      </div>

      {onMove && columns.length > 0 && (
        <>
          <p className={`mb-[9px] mt-5 ${eyebrow}`}>Status</p>
          {/* Boards can have more than the comp's four lanes, so the track scrolls
              rather than squeezing segments below the 44px tap target. */}
          <div className="gt-scroll flex gap-1.5 overflow-x-auto rounded-full bg-[var(--col)] p-1">
            {columns.map((c) => {
              const active = c.id === columnId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => move(c.id, c.title)}
                  aria-pressed={active}
                  className={`min-w-[86px] flex-1 whitespace-nowrap rounded-full py-[9px] text-[12.5px] font-bold transition ${
                    active
                      ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                      : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
                  }`}
                >
                  {c.title}
                </button>
              )
            })}
          </div>
        </>
      )}

      {isOwner && (
        <div className="mt-5 flex gap-2.5">
          {primaryTarget && onMove && (
            <button
              type="button"
              onClick={() => move(primaryTarget.id, primaryTarget.title)}
              className={`h-[52px] flex-1 rounded-full text-[15px] font-bold transition active:scale-[.99] ${
                done
                  ? 'bg-[var(--col)] text-[var(--ink)]'
                  : 'bg-[var(--btn)] text-[var(--btn-ink)] shadow-[0_8px_22px_rgba(28,26,23,.2)]'
              }`}
            >
              {done ? 'Buka lagi' : 'Tandai selesai'}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            aria-label="Hapus task"
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition hover:text-[var(--danger-ink)] active:scale-[.95]"
          >
            <Trash2 size={19} aria-hidden="true" />
          </button>
        </div>
      )}

      {isOwner && (
        <details className="mt-5 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
          <summary className="cursor-pointer list-none text-[13.5px] font-bold text-[var(--ink2)] [&::-webkit-details-marker]:hidden">
            Edit detail
          </summary>

          <div className="mt-4">
            <label className={fieldLabel} htmlFor="cd-title">Judul</label>
            <input
              id="cd-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field"
            />
          </div>

          <div className="mt-3">
            <label className={fieldLabel} htmlFor="cd-desc">Catatan</label>
            <textarea
              id="cd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tambah catatan…"
              className="field min-h-[88px] resize-y leading-relaxed"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="cd-due">Deadline</label>
              <input
                id="cd-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="field"
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="cd-assignee">Assignee</label>
              <select
                id="cd-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="field cursor-pointer"
              >
                <option value="">Belum ditugaskan</option>
                {meta.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {meta.labels.length > 0 && (
            <div className="mt-3">
              <div className={fieldLabel}>Label</div>
              <div className="flex flex-wrap gap-2">
                {meta.labels.map((label) => {
                  const active = selectedLabelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      aria-pressed={active}
                      className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition"
                      style={
                        active
                          ? { backgroundColor: label.color, color: '#fff' }
                          : { backgroundColor: 'var(--card)', color: 'var(--ink2)' }
                      }
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isLeads && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel} htmlFor="cd-contact">Kontak</label>
                <input id="cd-contact" value={contact} onChange={(e) => setContact(e.target.value)} className="field" />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="cd-phone">Telepon</label>
                <input id="cd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="field" />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="cd-source">Sumber</label>
                <input id="cd-source" value={source} onChange={(e) => setSource(e.target.value)} className="field" />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="cd-deal">Nilai deal (Rp)</label>
                <input
                  id="cd-deal"
                  type="number"
                  min="0"
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                  className="field"
                />
              </div>
            </div>
          )}

          {isContent && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel} htmlFor="cd-pillar">Pillar</label>
                <select id="cd-pillar" value={pillarId} onChange={(e) => setPillarId(e.target.value)} className="field">
                  <option value="">None</option>
                  {pillars.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel} htmlFor="cd-cstatus">Status konten</label>
                <select id="cd-cstatus" value={contentStatus} onChange={(e) => setContentStatus(e.target.value)} className="field capitalize">
                  {CONTENT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel} htmlFor="cd-format">Format</label>
                <select id="cd-format" value={format} onChange={(e) => setFormat(e.target.value)} className="field">
                  <option value="">None</option>
                  {CONTENT_FORMATS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className={fieldLabel}>Channel</div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {CONTENT_CHANNELS.map((c) => {
                    const on = channels.includes(c)
                    return (
                      <button key={c} type="button" onClick={() => toggleChannel(c)} aria-pressed={on}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          on ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--ink2)]'
                        }`}>
                        {c}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {!isContent && (
            <div className="mt-3">
              <label className={fieldLabel} htmlFor="cd-category">Kategori</label>
              <input
                id="cd-category"
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

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary mt-4 w-full rounded-full"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
          {error && <p className="mt-2 text-[13px] text-[var(--danger)]">{error}</p>}
        </details>
      )}

      <div className="mt-6 mb-5 h-px bg-[var(--line)]" />

      <div className="mb-6">
        <Comments cardId={card.id} members={meta.members} />
      </div>
      <Attachments cardId={card.id} boardId={boardId} />
    </Sheet>
  )
}

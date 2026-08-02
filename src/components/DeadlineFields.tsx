import { useState } from 'react'
import { toast } from '#/components/Toast'
import { REMINDER_OFFSETS } from '#/lib/board-data'

export type DeadlinePatch = Partial<{
  due_date: string | null
  due_time: string | null
  reminder_offsets: number[] | null
}>

const eyebrow =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]'

function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Postgres `time` renders as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

/**
 * The deadline of a task: date, time-of-day, and which reminders to send.
 * Everything saves on change — there is no Save button — and a failed save
 * snaps the control back, the same way the status pills behave.
 *
 * The caller owns persistence: `onSave` writes the patch and should reject on
 * failure. Mount with `key={taskId}` — the state below initialises once, so a
 * sheet reused for a different task would otherwise show the old values.
 */
export default function DeadlineFields({
  dueDate: initialDate,
  dueTime: initialTime,
  offsets: initialOffsets,
  hint,
  readOnly = false,
  trailing,
  onSave,
}: {
  dueDate: string | null
  dueTime: string | null
  offsets: number[] | null
  /** One line under the chips naming who gets the email. */
  hint: string
  readOnly?: boolean
  /** Rendered at the right of the deadline row — the assignee avatar, on cards. */
  trailing?: React.ReactNode
  onSave: (patch: DeadlinePatch) => Promise<unknown>
}) {
  const [dueDate, setDueDate] = useState(initialDate ?? '')
  const [dueTime, setDueTime] = useState(hhmm(initialTime))
  const [offsets, setOffsets] = useState<number[]>(initialOffsets ?? [])
  const [saving, setSaving] = useState(false)

  async function save(patch: DeadlinePatch, revert: () => void, okMessage: string) {
    setSaving(true)
    try {
      await onSave(patch)
      toast(okMessage)
    } catch {
      revert()
      toast('Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mt-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={eyebrow}>Deadline</p>
          {readOnly ? (
            <p className="mt-[3px] text-[14.5px] font-semibold text-[var(--ink)]">
              {dueDate ? (
                <>
                  {longDate(dueDate)}
                  {dueTime ? ` · ${dueTime}` : ''}
                </>
              ) : (
                <span className="text-[var(--ink3)]">Belum diatur</span>
              )}
            </p>
          ) : (
            <div className={`mt-[3px] flex items-baseline gap-2 ${saving ? 'opacity-60' : ''}`}>
              {/* A bare input[type=date] reads as an empty slot ("dd/mm/yyyy"),
                  so keep the sentence and lay the real control over it. */}
              <div className="relative w-fit">
                <p className="text-[14.5px] font-semibold text-[var(--ink)] underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px]">
                  {dueDate ? longDate(dueDate) : <span className="text-[var(--ink3)]">Belum diatur</span>}
                </p>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    const prev = dueDate
                    const next = e.target.value
                    setDueDate(next)
                    save(
                      { due_date: next || null },
                      () => setDueDate(prev),
                      next ? `Deadline: ${longDate(next)}` : 'Deadline dihapus',
                    )
                  }}
                  disabled={saving}
                  aria-label="Tanggal deadline"
                  className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
                />
              </div>
              {dueDate && (
                <div className="relative w-fit">
                  {/* 17:00 shown in muted ink rather than hidden: it is the
                      default the reminder times are measured from, so leaving
                      it out would make those times look arbitrary. */}
                  <p
                    className={`text-[14.5px] font-semibold underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px] ${
                      dueTime ? 'text-[var(--ink)]' : 'text-[var(--ink3)]'
                    }`}
                  >
                    {dueTime || '17:00'}
                  </p>
                  <input
                    type="time"
                    value={dueTime}
                    onChange={(e) => {
                      const prev = dueTime
                      const next = e.target.value
                      setDueTime(next)
                      save(
                        { due_time: next || null },
                        () => setDueTime(prev),
                        next ? `Jam: ${next}` : 'Jam direset ke 17:00',
                      )
                    }}
                    disabled={saving}
                    aria-label="Jam deadline"
                    className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {trailing}
      </div>

      {!readOnly && dueDate && (
        <>
          <p className={`mb-[9px] mt-[18px] ${eyebrow}`}>Pengingat</p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_OFFSETS.map(({ mins, label }) => {
              const on = offsets.includes(mins)
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    const prev = offsets
                    const next = on ? offsets.filter((m) => m !== mins) : [...offsets, mins]
                    setOffsets(next)
                    save(
                      { reminder_offsets: next.length ? next : null },
                      () => setOffsets(prev),
                      on ? `Pengingat ${label} dimatikan` : `Diingetin ${label} sebelum deadline`,
                    )
                  }}
                  disabled={saving}
                  aria-pressed={on}
                  className={`rounded-full px-3.5 py-[9px] text-[12.5px] font-bold transition active:scale-[.96] ${
                    on
                      ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                      : 'bg-[var(--col)] text-[var(--ink3)] hover:text-[var(--ink2)]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink3)]">{hint}</p>
        </>
      )}
    </>
  )
}

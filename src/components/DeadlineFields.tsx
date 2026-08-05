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
  remindersDisabledReason,
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
  /** Why reminders cannot be scheduled for this task at all. Renders in place
   *  of the chips — a task in a Done lane or on an archived board is one the
   *  trigger will refuse, and a switch that silently does nothing is worse
   *  than no switch. */
  remindersDisabledReason?: string
  onSave: (patch: DeadlinePatch) => Promise<unknown>
}) {
  const [dueDate, setDueDate] = useState(initialDate ?? '')
  const [dueTime, setDueTime] = useState(hhmm(initialTime))
  const [offsets, setOffsets] = useState<number[]>(initialOffsets ?? [])
  const [saving, setSaving] = useState(false)

  // The instant the trigger schedules from (Asia/Jakarta, default 17:00 when
  // no time is set) — used only to grey out offsets whose moment has already
  // passed. The database silently refuses to schedule those; the UI should
  // say so rather than promise a reminder that will never send.
  const deadlineMs = dueDate ? Date.parse(`${dueDate}T${dueTime || '17:00'}:00+07:00`) : NaN

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
                    const prevTime = dueTime
                    const prevOffsets = offsets
                    const next = e.target.value
                    setDueDate(next)
                    // Clearing the date hides the time and reminder controls, but
                    // they'd otherwise stay set-and-invisible — re-picking a date
                    // later would silently re-arm the old hour and offsets.
                    if (!next) {
                      setDueTime('')
                      setOffsets([])
                    }
                    save(
                      next
                        ? { due_date: next }
                        : { due_date: null, due_time: null, reminder_offsets: null },
                      () => {
                        setDueDate(prev)
                        if (!next) {
                          setDueTime(prevTime)
                          setOffsets(prevOffsets)
                        }
                      },
                      next ? `Deadline: ${longDate(next)}` : 'Deadline dihapus',
                    )
                  }}
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
          {remindersDisabledReason ? (
            <p className="text-[11.5px] leading-snug text-[var(--ink3)]">{remindersDisabledReason}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {REMINDER_OFFSETS.map(({ mins, label }) => {
                  const on = offsets.includes(mins)
                  // Past its moment: the trigger refuses to schedule this offset,
                  // so the chip goes inert rather than promising an email that
                  // will never send. Still reflects on/off — moving the deadline
                  // back out is a legitimate way to un-mute it.
                  const past = !Number.isNaN(deadlineMs) && deadlineMs - mins * 60_000 <= Date.now()
                  const reason = 'Waktunya udah lewat — pengingat ini nggak akan dikirim.'
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
                      disabled={saving || past}
                      aria-pressed={on}
                      title={past ? reason : undefined}
                      aria-label={past ? `${label}: ${reason}` : undefined}
                      className={`rounded-full px-3.5 py-[9px] text-[12.5px] font-bold transition active:scale-[.96] ${
                        past
                          ? 'bg-[var(--col)] text-[var(--ink3)] opacity-60'
                          : on
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
      )}
    </>
  )
}

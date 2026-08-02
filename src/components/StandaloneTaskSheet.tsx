import { Trash2, X } from 'lucide-react'
import { Sheet } from '#/components/WorkspaceSwitcher'
import DeadlineFields, { type DeadlinePatch } from '#/components/DeadlineFields'

const eyebrow =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]'

/** Personal tasks have no board, so this is deliberately thin: a deadline, its
 *  reminders, and a way out. DeadlineFields owns all three controls and their
 *  save behaviour — the same ones the card sheet uses. */
export default function StandaloneTaskSheet({
  task,
  onClose,
  onSaved,
  onUpdate,
  onDelete,
}: {
  task: {
    id: string
    title: string
    due: string | null
    dueTime: string | null
    offsets: number[] | null
    done: boolean
  }
  onClose: () => void
  onSaved: () => void
  onUpdate: (id: string, fields: DeadlinePatch) => Promise<unknown>
  onDelete: (id: string) => void
}) {
  return (
    <Sheet
      onClose={onClose}
      label={task.title}
      className="max-h-[86%]"
      header={
        <div className="flex items-start gap-3">
          <span
            className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--ink3)]"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className={`truncate ${eyebrow}`}>Task pribadi</p>
            <h2 className="mt-1 text-[21px] font-extrabold leading-[1.2] tracking-[-0.03em] text-[var(--ink)]">
              {task.title}
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
      <DeadlineFields
        key={task.id}
        dueDate={task.due}
        dueTime={task.dueTime}
        offsets={task.offsets}
        hint="Email ke kamu sendiri. Pengingat yang waktunya udah lewat dilewati."
        remindersDisabledReason={task.done ? 'Task yang udah selesai nggak dikirimin pengingat.' : undefined}
        onSave={async (patch) => {
          await onUpdate(task.id, patch)
          onSaved()
        }}
      />

      <button
        type="button"
        onClick={() => onDelete(task.id)}
        className="mt-6 mb-6 flex h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--col)] text-[14px] font-bold text-[var(--ink2)] transition hover:text-[var(--danger-ink)] active:scale-[.99]"
      >
        <Trash2 size={17} aria-hidden="true" />
        Hapus task
      </button>
    </Sheet>
  )
}

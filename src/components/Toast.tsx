import { useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'

// Single slot, exactly like the prototype: a new message replaces the previous
// one and restarts the 1.9s timer rather than stacking.
let message: string | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(next: string) {
  message = next
  seq += 1
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    message = null
    timer = null
    emit()
  }, 1900)
  emit()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** Mounted once in the root layout. */
export default function Toast() {
  const current = useSyncExternalStore(
    subscribe,
    () => message,
    () => null,
  )
  if (!current) return null
  return (
    <div
      // Keyed by seq so a replacing message replays the entrance animation.
      key={seq}
      role="status"
      aria-live="polite"
      className="gt-pop fixed inset-x-6 bottom-[104px] z-[70] mx-auto flex max-w-[420px] items-center gap-2.5 rounded-[16px] bg-[var(--btn)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--btn-ink)] shadow-[0_12px_34px_rgba(28,26,23,.32)] md:bottom-8"
    >
      <Check size={16} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">{current}</span>
    </div>
  )
}

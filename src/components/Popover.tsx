import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Close an open panel on an outside click. */
export function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])
  return ref
}

/** Trigger button + an anchored floating panel, closing on an outside click.
 * Shared shell for every header/quick-action dropdown so the positioning,
 * chrome and outside-click logic live in one place. */
export default function Popover({
  align = 'right',
  panelClassName = 'w-72',
  renderTrigger,
  renderPanel,
}: {
  align?: 'left' | 'right'
  panelClassName?: string
  renderTrigger: (open: boolean, toggle: () => void) => ReactNode
  renderPanel: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      {renderTrigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-[calc(100%+6px)] z-30 ${panelClassName} rounded-[14px] border-2 border-[var(--ink)] bg-[var(--card)] p-3 shadow-[0_10px_30px_-10px_rgba(16,28,22,0.35)]`}
        >
          {renderPanel(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

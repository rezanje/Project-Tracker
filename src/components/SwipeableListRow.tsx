import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

export type SwipeAction = {
  key: string
  label: string
  /** CSS color value (e.g. `var(--pop-soft)`) for the revealed button background. */
  bg: string
  /** CSS color value (e.g. `var(--pop-ink)`) for the revealed button text. */
  ink: string
  onCommit: () => void
}

const ACTION_WIDTH = 72
const AXIS_LOCK_THRESHOLD = 6

type Props = {
  actions: SwipeAction[]
  isOpen: boolean
  hasOtherOpen: boolean
  onOpenChange: (open: boolean) => void
  onCollapseOther: () => void
  onOpenDetail: () => void
  children: ReactNode
}

/**
 * A list row that can be swiped left (touch or mouse drag) to reveal a tray of
 * quick-action buttons underneath, iOS-Mail style. Tapping the row (no drag)
 * runs `onOpenDetail`; tapping while a tray is open just collapses it instead.
 */
export default function SwipeableListRow({
  actions,
  isOpen,
  hasOtherOpen,
  onOpenChange,
  onCollapseOther,
  onOpenDetail,
  children,
}: Props) {
  const maxOpen = actions.length * ACTION_WIDTH
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const axisRef = useRef<'x' | 'y' | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startOffsetRef = useRef(0)
  const [liveOffset, setLiveOffset] = useState<number | null>(null)

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    draggingRef.current = true
    movedRef.current = false
    axisRef.current = null
    startXRef.current = e.clientX
    startYRef.current = e.clientY
    startOffsetRef.current = isOpen ? -maxOpen : 0
    setLiveOffset(startOffsetRef.current)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current) return
    const dx = e.clientX - startXRef.current
    const dy = e.clientY - startYRef.current
    if (axisRef.current === null) {
      if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) return
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (axisRef.current === 'y') {
        // Vertical intent — let the page scroll, abandon swipe tracking.
        draggingRef.current = false
        setLiveOffset(null)
        return
      }
    }
    if (axisRef.current !== 'x') return
    movedRef.current = true
    const raw = startOffsetRef.current + dx
    setLiveOffset(Math.min(0, Math.max(-maxOpen, raw)))
  }

  function handlePointerUp() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const finalOffset = liveOffset ?? startOffsetRef.current
    const wasTap = !movedRef.current
    setLiveOffset(null)
    if (wasTap) {
      if (isOpen) onOpenChange(false)
      else if (hasOtherOpen) onCollapseOther()
      else onOpenDetail()
      return
    }
    onOpenChange(Math.abs(finalOffset) > maxOpen / 2)
  }

  // Enter/Space activates a native click with `detail === 0`; real pointer taps
  // are already handled in handlePointerUp above, so skip those here to avoid
  // double-firing.
  function handleKeyboardClick(e: { detail: number }) {
    if (e.detail !== 0) return
    if (isOpen) onOpenChange(false)
    else if (hasOtherOpen) onCollapseOther()
    else onOpenDetail()
  }

  return (
    <div className="relative overflow-hidden border-b border-[var(--line)] last:border-0">
      {maxOpen > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: maxOpen }}>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                onOpenChange(false)
                a.onCommit()
              }}
              className="flex h-full flex-1 items-center justify-center border-l-2 border-[var(--ink)] px-1 text-center text-[11px] font-bold leading-tight"
              style={{ background: a.bg, color: a.ink }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleKeyboardClick}
        className="flex w-full items-center gap-3 bg-[var(--card)] px-3 py-2.5 text-left hover:bg-[var(--col)]"
        style={{
          touchAction: 'pan-y',
          transform: `translateX(${liveOffset ?? (isOpen ? -maxOpen : 0)}px)`,
          transition: liveOffset === null ? 'transform 120ms steps(2, end)' : 'none',
        }}
      >
        {children}
      </button>
    </div>
  )
}

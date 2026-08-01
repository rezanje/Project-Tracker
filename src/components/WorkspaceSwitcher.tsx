import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { gradientFor } from '#/lib/accent'
import { createWorkspaceFn } from '#/lib/actions'
import { fetchNav, fetchNavDeduped, type NavWorkspace } from '#/lib/nav'
import { setScope, useScope, type Scope } from '#/lib/workspace-scope'
import { toast } from './Toast'

/** Two-letter mark for a workspace, e.g. "Rakit Studio" → RS. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

/** Shared workspace list + the name of whatever scope is active. */
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<NavWorkspace[]>([])
  const scope = useScope()

  useEffect(() => {
    fetchNavDeduped()
      .then((nav) => setWorkspaces(nav.workspaces))
      .catch(() => {})
  }, [])

  const active = workspaces.find((w) => w.id === scope) ?? null
  return { workspaces, setWorkspaces, scope, active, name: active?.name ?? 'Semua workspace' }
}

/** The pill in the Command Center / Home / My tasks headers. */
export function WorkspacePill({ onOpen }: { onOpen: () => void }) {
  const { active, name } = useWorkspaces()

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--card)] py-[5px] pl-[5px] pr-[13px] text-[12.5px] font-bold text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:-translate-y-px active:scale-[.97]"
    >
      <span
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9.5px] font-extrabold text-white"
        style={{
          background: active
            ? gradientFor(active.id)
            : 'linear-gradient(135deg,#E8622C 0%,#8A6A4B 52%,#4F6D7A 100%)',
        }}
      >
        {active ? initials(active.name) : ''}
      </span>
      <span className="max-w-[9rem] truncate">{name}</span>
      <ChevronsUpDown size={13} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
    </button>
  )
}

/** Bottom-sheet switcher. `taskCounts` is optional — the "n task aktif" line is
 *  omitted for a workspace with no entry rather than showing a wrong zero. */
export function WorkspaceSwitcherSheet({
  open,
  onClose,
  taskCounts,
}: {
  open: boolean
  onClose: () => void
  taskCounts?: Record<string, number>
}) {
  const navigate = useNavigate()
  const { workspaces, setWorkspaces, scope } = useWorkspaces()

  if (!open) return null

  // The pill is how you change level. "Semua workspace" is the account view,
  // which Home renders itself — there is no separate Command Center page. A
  // workspace goes to that company's dashboard. Scope follows either way, so
  // every scoped screen (Home, Project, Task, Schedule, Performance) narrows
  // with it.
  function pick(next: Scope) {
    setScope(next)
    onClose()
    if (next === 'all') {
      toast('Monitor semua workspace')
      navigate({ to: '/home' })
      return
    }
    toast(`Masuk ${workspaces.find((w) => w.id === next)?.name ?? 'workspace'}`)
    navigate({ to: '/workspace/$workspaceId', params: { workspaceId: next } })
  }

  async function addWorkspace() {
    const name = window.prompt('Nama workspace')
    if (!name?.trim()) return
    const ws = await createWorkspaceFn({ data: { name } })
    const nav = await fetchNav()
    setWorkspaces(nav.workspaces)
    pick(ws.id)
  }

  return (
    <Sheet
      onClose={onClose}
      label="Pindah workspace"
      header={
        <div className="mb-4">
          <h2 className="text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Pindah workspace</h2>
          <p className="mt-1 text-[13.5px] text-[var(--ink2)]">Semua perusahaan kamu di satu akun.</p>
        </div>
      }
    >
      <div className="flex flex-col gap-[9px]">
        <Row
          selected={scope === 'all'}
          onPick={() => pick('all')}
          name="Semua workspace"
          role="Monitor semua perusahaan"
          avatar={
            <span
              className="flex h-10 w-10 items-center justify-center rounded-[14px]"
              style={{ background: 'linear-gradient(135deg,#E8622C 0%,#8A6A4B 52%,#4F6D7A 100%)' }}
            />
          }
        />
        {workspaces.map((w) => {
          const n = taskCounts?.[w.id]
          return (
            <Row
              key={w.id}
              selected={scope === w.id}
              onPick={() => pick(w.id)}
              name={w.name}
              role={n == null ? '' : `${n} task aktif`}
              avatar={
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-[14px] text-[13.5px] font-extrabold text-white"
                  style={{ background: gradientFor(w.id) }}
                >
                  {initials(w.name)}
                </span>
              }
            />
          )
        })}
      </div>

      <button
        type="button"
        onClick={addWorkspace}
        className="mt-4 flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full bg-[var(--col)] text-[14.5px] font-bold text-[var(--ink2)] transition hover:text-[var(--ink)] active:scale-[.99]"
      >
        <Plus size={17} aria-hidden="true" />
        Tambah workspace
      </button>
    </Sheet>
  )
}

function Row({
  selected,
  onPick,
  name,
  role,
  avatar,
}: {
  selected: boolean
  onPick: () => void
  name: string
  role: string
  avatar: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`flex items-center gap-3 rounded-[18px] p-3 text-left transition ${
        selected
          ? 'bg-[var(--card)] shadow-[var(--shadow-sm)]'
          : 'shadow-[inset_0_0_0_1px_var(--line)]'
      }`}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold tracking-[-0.015em] text-[var(--ink)]">{name}</span>
        {role && <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ink3)]">{role}</span>}
      </span>
      {selected && (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white">
          <Check size={12} strokeWidth={3.2} aria-hidden="true" />
        </span>
      )}
    </button>
  )
}

/** Past this many pixels of downward drag, letting go dismisses the sheet. */
const DISMISS_AT = 110

/** How a touch that started at the top of a sheet's body should be read, from
 *  how far it has travelled so far.
 *
 *  `wait`    — too little movement to tell a tap from a gesture.
 *  `release` — someone else's gesture: upward is the body scrolling, and
 *              sideways-or-tied is a row swipe. A dead-even diagonal goes to
 *              the swipe rather than here: closing the sheet under someone
 *              who meant to swipe a row is the more surprising outcome.
 *  `claim`   — a downward pull with nothing left to scroll: dismiss drag.
 *
 *  Exported so the rules can be tested without a thumb on a phone. */
export function dragVerdict(dy: number, dx: number): 'wait' | 'release' | 'claim' {
  if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return 'wait'
  if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) return 'release'
  return 'claim'
}

/** Shared bottom-sheet chrome: scrim, grab handle, slide-up, escape to close,
 *  and drag-down-to-dismiss.
 *
 *  Portalled to `document.body` on purpose. The app header carries a
 *  `backdrop-filter`, which makes it a containing block for `position: fixed`
 *  descendants — a sheet opened from the header bell would otherwise pin itself
 *  to the bottom of the *header* instead of the viewport. */
export function Sheet({
  onClose,
  label,
  children,
  className = '',
  header,
}: {
  onClose: () => void
  label: string
  children: React.ReactNode
  className?: string
  /** Rendered above the scrolling body, inside the drag zone — use this for a
   *  sheet's title row so dragging down from the header (not just the thin
   *  grab handle) also dismisses the sheet. */
  header?: React.ReactNode
}) {
  const startY = useRef<number | null>(null)
  // The live offset lives in a ref as well as state: state drives the paint,
  // the ref is what pointerup reads, so the decision can't act on a value one
  // render behind the finger.
  const dragRef = useRef(0)
  const [drag, setDrag] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Read by listeners that are attached once; a prop captured directly would
  // go stale, and re-attaching on every render would reset the gesture
  // mid-drag (setDrag re-renders on every move).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** True when anything between `target` and the sheet body is a scroller that
   *  has already been scrolled — pulling down there means "scroll back up",
   *  not "close the sheet". */
  function overScrolledContent(target: EventTarget | null, stop: HTMLElement): boolean {
    let n = target as HTMLElement | null
    while (n && n !== stop) {
      if (n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true
      n = n.parentElement
    }
    return false
  }

  // Drag-to-dismiss from the body as well as the handle. The body must keep
  // scrolling, so it cannot simply take the gesture the way the handle does
  // (`touch-action: none`). Instead it watches raw touches and only claims one
  // when the content is already at the top AND the finger is heading down —
  // the point where there is no scrolling left to do. preventDefault in a
  // non-passive touchmove is what stops the browser from starting its own
  // overscroll; by then we know the gesture is ours.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let startY = 0
    let startX = 0
    let watching = false
    let claimed = false

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
      watching = el!.scrollTop <= 0 && !overScrolledContent(e.target, el!)
      claimed = false
    }

    function onTouchMove(e: TouchEvent) {
      if (!watching || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX
      if (!claimed) {
        const verdict = dragVerdict(dy, dx)
        if (verdict === 'wait') return
        if (verdict === 'release') {
          watching = false
          return
        }
        claimed = true
      }
      e.preventDefault()
      dragRef.current = dy
      setDrag(dy)
    }

    function onTouchEnd() {
      watching = false
      if (!claimed) return
      claimed = false
      const dy = dragRef.current
      dragRef.current = 0
      if (dy > DISMISS_AT) onCloseRef.current()
      else setDrag(0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // The header can carry real buttons (e.g. "Keluar"); let taps on those
    // through instead of hijacking them into a drag.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    startY.current = e.clientY
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the browser no longer tracks — carry on without capture.
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (startY.current === null) return
    // Downward only — an upward pull shouldn't lift the sheet off the bottom.
    const dy = Math.max(0, e.clientY - startY.current)
    dragRef.current = dy
    setDrag(dy)
  }

  function endDrag() {
    if (startY.current === null) return
    startY.current = null
    const dy = dragRef.current
    dragRef.current = 0
    if (dy > DISMISS_AT) onClose()
    else setDrag(0)
  }

  if (typeof document === 'undefined') return null

  const dragging = drag > 0

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="gt-back absolute inset-0 bg-[rgba(20,17,14,.42)] backdrop-blur-[2px]"
        style={dragging ? { opacity: Math.max(0.2, 1 - drag / (DISMISS_AT * 2.5)) } : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-w-[520px] flex-col rounded-t-[32px] bg-[var(--bg)] shadow-[0_-18px_50px_rgba(20,17,14,.28)] ${
          dragging ? '' : 'gt-up'
        } ${className}`}
        style={dragging ? { transform: `translateY(${drag}px)` } : undefined}
      >
        {/* The handle and header take the gesture outright (`touch-action:
            none`) because nothing up here scrolls. The body cannot do that
            without losing its scrolling, so it earns the drag a different way
            — see the touch listeners above. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ touchAction: 'none' }}
          className="shrink-0 cursor-grab px-[22px] pb-3 pt-3.5 active:cursor-grabbing"
        >
          <span className="mx-auto mb-3 block h-[5px] w-11 rounded-full bg-[var(--sunk)]" aria-hidden="true" />
          {header}
        </div>
        {/* overscroll-contain keeps the browser's own rubber-band and
            pull-to-refresh out of the way of the drag that starts at the top. */}
        <div
          ref={bodyRef}
          style={{ overscrollBehavior: 'contain' }}
          className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[30px] pt-[6px]"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

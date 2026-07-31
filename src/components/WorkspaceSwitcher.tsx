import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { accentFor } from '#/lib/accent'
import { createWorkspaceFn } from '#/lib/actions'
import { fetchNav, fetchNavDeduped, type NavWorkspace } from '#/lib/nav'
import { workspaceLogoFor } from '#/lib/workspace-logos'
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
  const logo = active ? workspaceLogoFor(active.name) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--card)] py-[5px] pl-[5px] pr-[13px] text-[12.5px] font-bold text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:-translate-y-px active:scale-[.97]"
    >
      {logo ? (
        <img src={logo} alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
      ) : (
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9.5px] font-extrabold text-white"
          style={
            active
              ? { background: accentFor(active.id) }
              : { background: 'linear-gradient(135deg,#E8622C 0%,#8A6A4B 52%,#4F6D7A 100%)' }
          }
        >
          {active ? initials(active.name) : ''}
        </span>
      )}
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

  function pick(next: Scope) {
    setScope(next)
    onClose()
    if (next === 'all') {
      toast('Monitor semua workspace')
      navigate({ to: '/' })
      return
    }
    toast(`Masuk ${workspaces.find((w) => w.id === next)?.name ?? 'workspace'}`)
    navigate({ to: '/home' })
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
    <Sheet onClose={onClose} label="Pindah workspace">
      <div className="mb-4">
        <h2 className="text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Pindah workspace</h2>
        <p className="mt-1 text-[13.5px] text-[var(--ink2)]">Semua perusahaan kamu di satu akun.</p>
      </div>

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
          const logo = workspaceLogoFor(w.name)
          const n = taskCounts?.[w.id]
          return (
            <Row
              key={w.id}
              selected={scope === w.id}
              onPick={() => pick(w.id)}
              name={w.name}
              role={n == null ? '' : `${n} task aktif`}
              avatar={
                logo ? (
                  <img src={logo} alt="" className="h-10 w-10 rounded-[14px] object-cover" />
                ) : (
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-[14px] text-[13.5px] font-extrabold text-white"
                    style={{ background: accentFor(w.id) }}
                  >
                    {initials(w.name)}
                  </span>
                )
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

/** Shared bottom-sheet chrome: scrim, grab handle, slide-up, escape to close.
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
}: {
  onClose: () => void
  label: string
  children: React.ReactNode
  className?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="gt-back absolute inset-0 bg-[rgba(20,17,14,.42)] backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`gt-up absolute inset-x-0 bottom-0 mx-auto max-w-[520px] overflow-y-auto rounded-t-[32px] bg-[var(--bg)] px-[22px] pb-[30px] pt-3.5 shadow-[0_-18px_50px_rgba(20,17,14,.28)] ${className}`}
      >
        <span className="mx-auto mb-[18px] block h-[5px] w-11 rounded-full bg-[var(--sunk)]" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  )
}

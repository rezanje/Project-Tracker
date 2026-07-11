import { useState } from 'react'
import { X } from 'lucide-react'
import type { Pillar } from '#/lib/board-data'

interface Props {
  pillars: Pillar[]
  onAdd: (name: string, color: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const SWATCHES = ['#2563eb', '#1f9d55', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626']

/** Owner-only strip to manage workspace content pillars. */
export default function PillarManager({ pillars, onAdd, onDelete }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onAdd(name.trim(), color)
      setName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mb-5 flex max-w-[1400px] flex-wrap items-center gap-2.5 rounded-[14px] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-[var(--ink3)]">Pillars</span>
      {pillars.map((p) => (
        <span
          key={p.id}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold text-white"
          style={{ background: p.color }}
        >
          {p.name}
          <button type="button" onClick={() => onDelete(p.id)} aria-label={`Delete ${p.name}`}
            className="opacity-80 hover:opacity-100">
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      ))}
      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex gap-1">
          {SWATCHES.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`}
              className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-offset-1 ring-[var(--ink)]' : ''}`}
              style={{ background: c }} />
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New pillar…"
          className="field w-[130px] rounded-full px-3 py-1.5 text-[13px]"
        />
        <button type="button" onClick={add} disabled={busy} className="btn btn-primary px-3 py-1.5 text-[13px]">
          Add
        </button>
      </div>
    </div>
  )
}

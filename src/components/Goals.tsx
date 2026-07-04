import { useState } from 'react'
import { X } from 'lucide-react'

type Kpi = { id: string; name: string; target: number; current: number; unit: string | null }
type Kr = { id: string; title: string; target: number; current: number }
type Okr = { id: string; title: string; krs: Kr[]; progress: number }

interface Props {
  kpis: Kpi[]
  okrs: Okr[]
  isOwner: boolean
  onKpiSave: (k: { id?: string; name: string; target: number; current: number; unit: string }) => void
  onKpiDelete: (id: string) => void
  onObjAdd: (title: string) => void
  onObjDelete: (id: string) => void
  onKrSave: (k: { id?: string; objectiveId?: string; title: string; target: number; current: number }) => void
  onKrDelete: (id: string) => void
}

const pct = (c: number, t: number) => (t ? Math.min(100, Math.round((c / t) * 100)) : 0)

export default function Goals({
  kpis,
  okrs,
  isOwner,
  onKpiSave,
  onKpiDelete,
  onObjAdd,
  onObjDelete,
  onKrSave,
  onKrDelete,
}: Props) {
  const [kName, setKName] = useState('')
  const [kTarget, setKTarget] = useState('')
  const [kUnit, setKUnit] = useState('')
  const [objTitle, setObjTitle] = useState('')
  const [krTitle, setKrTitle] = useState<Record<string, string>>({})
  const [krTarget, setKrTarget] = useState<Record<string, string>>({})

  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      {/* KPI */}
      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">KPIs</h3>
        {kpis.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">No KPIs yet.</p>}
        <ul className="mb-3 flex flex-col gap-3">
          {kpis.map((k) => (
            <li key={k.id}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--ink)]">{k.name}</span>
                <span className="flex items-center gap-2 text-[var(--ink3)]">
                  {isOwner ? (
                    <input
                      type="number"
                      defaultValue={k.current}
                      onBlur={(e) =>
                        Number(e.target.value) !== k.current &&
                        onKpiSave({ id: k.id, name: k.name, target: k.target, current: Number(e.target.value) || 0, unit: k.unit ?? '' })
                      }
                      className="field w-20 px-2 py-1 text-right text-[13px]"
                    />
                  ) : (
                    <span className="font-semibold text-[var(--ink)]">{k.current}</span>
                  )}
                  <span>/ {k.target} {k.unit ?? ''}</span>
                  {isOwner && (
                    <button type="button" onClick={() => onKpiDelete(k.id)} aria-label="Delete KPI" className="text-[var(--ink3)] hover:text-[var(--danger)]">
                      <X size={14} />
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct(k.current, k.target)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        {isOwner && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!kName.trim()) return
              onKpiSave({ name: kName, target: Number(kTarget) || 0, current: 0, unit: kUnit })
              setKName('')
              setKTarget('')
              setKUnit('')
            }}
            className="flex flex-wrap gap-2"
          >
            <input value={kName} onChange={(e) => setKName(e.target.value)} placeholder="KPI name" className="field flex-1 text-[13px]" />
            <input value={kTarget} onChange={(e) => setKTarget(e.target.value)} type="number" placeholder="Target" className="field w-24 text-[13px]" />
            <input value={kUnit} onChange={(e) => setKUnit(e.target.value)} placeholder="Unit" className="field w-20 text-[13px]" />
            <button type="submit" className="btn btn-primary btn-square px-3 text-xs">Add</button>
          </form>
        )}
      </div>

      {/* OKR */}
      <div className="card p-5">
        <h3 className="display-title mb-3 text-[17px] font-bold text-[var(--ink)]">OKRs</h3>
        {okrs.length === 0 && <p className="mb-3 py-1 text-sm text-[var(--ink3)]">No objectives yet.</p>}
        <ul className="mb-3 flex flex-col gap-4">
          {okrs.map((o) => (
            <li key={o.id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--ink)]">{o.title}</span>
                <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ink3)]">
                  {o.progress}%
                  {isOwner && (
                    <button type="button" onClick={() => onObjDelete(o.id)} aria-label="Delete objective" className="hover:text-[var(--danger)]">
                      <X size={14} />
                    </button>
                  )}
                </span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${o.progress}%` }} />
              </div>
              <ul className="flex flex-col gap-1.5 pl-3">
                {o.krs.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-[var(--ink2)]">{k.title}</span>
                    {isOwner ? (
                      <input
                        type="number"
                        defaultValue={k.current}
                        onBlur={(e) => Number(e.target.value) !== k.current && onKrSave({ id: k.id, title: k.title, target: k.target, current: Number(e.target.value) || 0 })}
                        className="field w-16 px-2 py-0.5 text-right text-[12px]"
                      />
                    ) : (
                      <span className="text-[var(--ink)]">{k.current}</span>
                    )}
                    <span className="text-[var(--ink3)]">/ {k.target}</span>
                    {isOwner && (
                      <button type="button" onClick={() => onKrDelete(k.id)} aria-label="Delete key result" className="text-[var(--ink3)] hover:text-[var(--danger)]">
                        <X size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {isOwner && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const t = (krTitle[o.id] ?? '').trim()
                    if (!t) return
                    onKrSave({ objectiveId: o.id, title: t, target: Number(krTarget[o.id]) || 100, current: 0 })
                    setKrTitle((s) => ({ ...s, [o.id]: '' }))
                    setKrTarget((s) => ({ ...s, [o.id]: '' }))
                  }}
                  className="mt-1.5 flex gap-2 pl-3"
                >
                  <input value={krTitle[o.id] ?? ''} onChange={(e) => setKrTitle((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="Key result" className="field flex-1 text-[12px]" />
                  <input value={krTarget[o.id] ?? ''} onChange={(e) => setKrTarget((s) => ({ ...s, [o.id]: e.target.value }))} type="number" placeholder="Tgt" className="field w-16 text-[12px]" />
                  <button type="submit" className="btn btn-ghost btn-square px-2 text-xs">+</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!objTitle.trim()) return
              onObjAdd(objTitle)
              setObjTitle('')
            }}
            className="flex gap-2"
          >
            <input value={objTitle} onChange={(e) => setObjTitle(e.target.value)} placeholder="New objective" className="field flex-1 text-[13px]" />
            <button type="submit" className="btn btn-primary btn-square px-3 text-xs">Add</button>
          </form>
        )}
      </div>
    </div>
  )
}

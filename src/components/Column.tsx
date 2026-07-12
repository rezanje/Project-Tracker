import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Card, { type CardAssignee } from './Card'
import type { ColumnRow, CardRow } from '#/lib/board-data'

interface ColumnProps {
  column: ColumnRow
  isOwner?: boolean
  onAddCard?: (columnId: string, title: string) => Promise<void>
  onCardClick?: (card: CardRow) => void
  members?: CardAssignee[]
}

const DOTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function dotFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return DOTS[h % DOTS.length]
}

export default function Column({ column, isOwner, onAddCard, onCardClick, members }: ColumnProps) {
  const memberById = new Map((members ?? []).map((m) => [m.id, m]))
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState(false)
  const { setNodeRef } = useDroppable({ id: column.id })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !onAddCard) return
    setBusy(true)
    setAddError(false)
    try {
      await onAddCard(column.id, newTitle.trim())
      setNewTitle('')
    } catch {
      setAddError(true)
    } finally {
      setBusy(false)
    }
  }

  const cardIds = column.cards.map((c) => c.id)

  const inner = (
    <section
      ref={setNodeRef}
      className="col-surface flex w-[300px] shrink-0 flex-col gap-[var(--gap)] p-[var(--pad)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="display-title text-[15px] font-bold text-[var(--ink)]">
            {column.title}
          </h3>
          <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] px-1.5 text-xs font-bold text-[var(--ink2)]">
            {column.cards.length}
          </span>
        </div>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: dotFor(column.id) }}
          aria-hidden="true"
        />
      </div>

      <div className="flex min-h-1.5 flex-col gap-[var(--gap)]">
        {column.cards.length === 0 ? (
          <div className="rounded-xl border-[1.5px] border-dashed border-[var(--line)] p-4 text-center text-xs font-semibold text-[var(--ink3)]">
            {isOwner ? 'Drop cards here' : 'No cards'}
          </div>
        ) : (
          column.cards.map((c) => (
            <Card
              key={c.id}
              card={c}
              isDraggable={isOwner}
              onCardClick={onCardClick}
              assignee={c.assignee_id ? memberById.get(c.assignee_id) : null}
            />
          ))
        )}
      </div>

      {isOwner && onAddCard && (
        <>
          <form onSubmit={handleAdd} className="flex gap-1.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a card…"
              className="field min-w-0 flex-1 rounded-[10px] px-3 py-2.5 text-[13px]"
            />
            <button
              type="submit"
              disabled={busy}
              aria-label="Add card"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--btn)] text-[19px] leading-none text-white transition hover:opacity-90 disabled:opacity-55"
            >
              +
            </button>
          </form>
          {addError && (
            <p className="text-xs text-[var(--danger)]">Failed to add card.</p>
          )}
        </>
      )}
    </section>
  )

  if (isOwner) {
    return (
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {inner}
      </SortableContext>
    )
  }

  return inner
}

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Card from './Card'
import type { ColumnRow, CardRow } from '#/lib/board-data'

interface ColumnProps {
  column: ColumnRow
  isOwner?: boolean
  onAddCard?: (columnId: string, title: string) => Promise<void>
  onCardClick?: (card: CardRow) => void
}

export default function Column({ column, isOwner, onAddCard, onCardClick }: ColumnProps) {
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
    <div ref={setNodeRef} className="col-surface flex w-72 shrink-0 flex-col p-3">
      <h3 className="mb-3 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--sea-ink-soft)]">
        {column.title}
        <span className="rounded-full bg-[var(--chip-bg)] px-1.5 text-[0.65rem] font-semibold text-[var(--sea-ink-soft)]">
          {column.cards.length}
        </span>
      </h3>
      <div className="flex flex-col gap-2">
        {column.cards.length === 0 ? (
          <p className="px-1 text-xs text-[var(--sea-ink-soft)]">No cards</p>
        ) : (
          column.cards.map((c) => (
            <Card key={c.id} card={c} isDraggable={isOwner} onCardClick={onCardClick} />
          ))
        )}
      </div>
      {isOwner && onAddCard && (
        <>
          <form onSubmit={handleAdd} className="mt-3 flex gap-1">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add card…"
              className="field flex-1 px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary px-2.5 py-1.5 text-xs"
              aria-label="Add card"
            >
              +
            </button>
          </form>
          {addError && (
            <p className="mt-1 px-1 text-xs text-[#b23b3b]">Failed to add card.</p>
          )}
        </>
      )}
    </div>
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

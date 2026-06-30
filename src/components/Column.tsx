import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Card from './Card'
import type { ColumnRow } from '#/lib/board-data'

interface ColumnProps {
  column: ColumnRow
  isOwner?: boolean
  onAddCard?: (columnId: string, title: string) => Promise<void>
}

export default function Column({ column, isOwner, onAddCard }: ColumnProps) {
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
    <div ref={setNodeRef} className="island-shell w-72 shrink-0 rounded-2xl p-3">
      <h3 className="mb-3 px-1 text-sm font-semibold text-[var(--sea-ink)]">
        {column.title}
      </h3>
      <div className="flex flex-col gap-2">
        {column.cards.length === 0 ? (
          <p className="px-1 text-xs text-[var(--sea-ink-soft)]">No cards</p>
        ) : (
          column.cards.map((c) => <Card key={c.id} card={c} isDraggable={isOwner} />)
        )}
      </div>
      {isOwner && onAddCard && (
        <>
          <form onSubmit={handleAdd} className="mt-3 flex gap-1">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add card…"
              className="flex-1 rounded-lg border border-[rgba(23,58,64,0.2)] px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--lagoon-deep)] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              +
            </button>
          </form>
          {addError && (
            <p className="mt-1 px-1 text-xs text-red-600">Failed to add card.</p>
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

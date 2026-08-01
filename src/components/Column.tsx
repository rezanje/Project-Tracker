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
  /** Each set only when that neighbour column exists — per-card move buttons. */
  onMoveCardNext?: (cardId: string) => void
  nextColumnTitle?: string
  onMoveCardPrev?: (cardId: string) => void
  prevColumnTitle?: string
}

export default function Column({
  column,
  isOwner,
  onAddCard,
  onCardClick,
  members,
  onMoveCardNext,
  nextColumnTitle,
  onMoveCardPrev,
  prevColumnTitle,
}: ColumnProps) {
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
      className="col-surface flex min-h-[60vh] w-full shrink-0 flex-col gap-3 p-[18px] md:w-[300px]"
    >
      <div className="flex items-center gap-2.5 px-1 pb-1">
        <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[var(--ink)]">{column.title}</h3>
        <span className="inline-flex items-center justify-center rounded-full bg-[var(--sunk)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--ink2)]">
          {column.cards.length}
        </span>
      </div>

      <div className="flex min-h-1.5 flex-1 flex-col gap-3">
        {column.cards.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--r-md)] border-[1.5px] border-dashed border-[var(--line)] p-4 text-center text-[13px] font-medium text-[var(--ink3)]">
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
              onMoveNext={onMoveCardNext ? () => onMoveCardNext(c.id) : undefined}
              nextColumnTitle={nextColumnTitle}
              onMovePrev={onMoveCardPrev ? () => onMoveCardPrev(c.id) : undefined}
              prevColumnTitle={prevColumnTitle}
            />
          ))
        )}
      </div>

      {isOwner && onAddCard && (
        <>
          {/* One pill, not a field-plus-button pair: the round "+" was a
              second tappable thing doing the same job as pressing Enter, and
              a plain input read as a data field instead of an action. Shape
              (rounded-full + shadow, the same "raised, tappable" language as
              the header's search pill) plus a bold placeholder does the "this
              is a button" job the icon used to. */}
          <form onSubmit={handleAdd} className="mt-auto">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="+ Add a card"
              disabled={busy}
              className="field w-full rounded-full bg-[var(--card)] px-5 py-3 text-[13.5px] font-bold text-[var(--ink2)] shadow-[var(--shadow-sm)] placeholder:font-bold placeholder:text-[var(--ink2)] disabled:opacity-50"
            />
          </form>
          {addError && (
            <p className="text-[12.5px] text-[var(--danger)]">Failed to add card.</p>
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

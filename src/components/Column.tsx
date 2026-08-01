import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
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
          {/* One pill holding both the field and its submit control — not the
              two separate floating shapes this used to be (a plain field plus
              a disconnected round "+"), and not a field alone either: Enter
              submitting a form isn't reliable across every mobile keyboard,
              so a visible button stays the one way this is guaranteed to
              work. The "+" is greyed out until there's text to submit, which
              doubles as "type first, then tap here". */}
          <form
            onSubmit={handleAdd}
            className="mt-auto flex w-full items-center gap-2 rounded-full border border-transparent bg-[var(--card)] py-1.5 pl-5 pr-1.5 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--ring)]"
          >
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a card"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] font-semibold text-[var(--ink)] outline-none placeholder:font-semibold placeholder:text-[var(--ink2)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !newTitle.trim()}
              aria-label="Add card"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--btn)] text-[var(--btn-ink)] transition disabled:opacity-30"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
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

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CardRow } from '#/lib/board-data'

interface CardProps {
  card: CardRow
  isDraggable?: boolean
}

export default function Card({ card, isDraggable }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: !isDraggable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isDraggable ? listeners : {})}
      className="rounded-lg border border-[rgba(23,58,64,0.18)] bg-white/60 p-2.5 text-sm shadow-sm"
    >
      <p className="font-medium text-[var(--sea-ink)]">{card.title}</p>
      {card.due_date && (
        <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">Due {card.due_date}</p>
      )}
      {card.card_labels.length > 0 && (
        <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
          {card.card_labels.length} label{card.card_labels.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}

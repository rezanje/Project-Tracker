import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CardRow } from '#/lib/board-data'

interface CardProps {
  card: CardRow
  isDraggable?: boolean
  onCardClick?: (card: CardRow) => void
}

export default function Card({ card, isDraggable, onCardClick }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: !isDraggable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Separate the drag listeners from the click handler so that:
  // - a short tap (< 5px distance) fires onClick and opens the detail panel
  // - a pointer-drag (>= 5px, enforced by PointerSensor activationConstraint)
  //   triggers DnD without firing onClick
  function handleClick() {
    if (!isDragging) {
      onCardClick?.(card)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isDraggable ? listeners : {})}
      onClick={handleClick}
      className="card card-hover p-2.5 text-sm"
    >
      <p className="font-medium text-[var(--sea-ink)]">{card.title}</p>
      {(card.due_date || card.card_labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.due_date && (
            <span className="chip">{card.due_date}</span>
          )}
          {card.card_labels.length > 0 && (
            <span className="chip">
              {card.card_labels.length} label{card.card_labels.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

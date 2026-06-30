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
      className="cursor-pointer rounded-lg border border-[rgba(23,58,64,0.18)] bg-white/60 p-2.5 text-sm shadow-sm transition-shadow hover:shadow-md"
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

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar, Tag } from 'lucide-react'
import type { CardRow } from '#/lib/board-data'

interface CardProps {
  card: CardRow
  isDraggable?: boolean
  onCardClick?: (card: CardRow) => void
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

  const labelCount = card.card_labels.length

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isDraggable ? listeners : {})}
      onClick={handleClick}
      className="card card-hover p-3.5"
    >
      <p className="text-[14.5px] font-semibold leading-snug text-[var(--ink)]">
        {card.title}
      </p>

      {card.description && (
        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--ink2)]">
          {card.description}
        </p>
      )}

      {(card.due_date || labelCount > 0) && (
        <div className="mt-3 flex items-center gap-2.5">
          {card.due_date && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-ink)]">
              <Calendar size={13} aria-hidden="true" />
              {shortDate(card.due_date)}
            </span>
          )}
          {labelCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink2)]">
              <Tag size={14} aria-hidden="true" />
              {labelCount}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

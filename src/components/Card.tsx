import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  MessageSquare,
  Paperclip,
  Tag,
} from 'lucide-react'
import type { CardRow } from '#/lib/board-data'
import { dueHour } from '#/lib/home'

export type CardAssignee = { id: string; name: string; avatar_url: string | null }

interface CardProps {
  card: CardRow
  isDraggable?: boolean
  onCardClick?: (card: CardRow) => void
  assignee?: CardAssignee | null
  /** Each set only when that neighbour column exists — no-drag move buttons. */
  onMoveNext?: () => void
  nextColumnTitle?: string
  onMovePrev?: () => void
  prevColumnTitle?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Identity tone for a category / assignee. Warm neutrals only — the single
 *  orange accent is reserved for charts and calls to action. */
export { accentFor as catColor } from '#/lib/accent'
import { accentFor as catColor } from '#/lib/accent'

function MoveButton({
  icon: Icon,
  label,
  onMove,
}: {
  icon: typeof ArrowRight
  label: string
  onMove: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Stop propagation on pointer, click, and keyboard so the drag sensor
      // (pointer + keyboard sensors) and the card-detail click never fire.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onMove()
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition hover:bg-[var(--sunk)] hover:text-[var(--ink)]"
    >
      <Icon size={13} aria-hidden="true" />
    </button>
  )
}

export default function Card({
  card,
  isDraggable,
  onCardClick,
  assignee,
  onMoveNext,
  nextColumnTitle,
  onMovePrev,
  prevColumnTitle,
}: CardProps) {
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
      className="card card-hover rounded-[var(--r-md)] px-4 py-[15px]"
    >
      <div className="flex items-start justify-between gap-2.5">
        <p className="min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.35] text-[var(--ink)]">
          {card.title}
        </p>
        {onMovePrev && (
          <MoveButton
            icon={ArrowLeft}
            label={prevColumnTitle ? `Move to ${prevColumnTitle}` : 'Move to previous column'}
            onMove={onMovePrev}
          />
        )}
        {onMoveNext && (
          <MoveButton
            icon={ArrowRight}
            label={nextColumnTitle ? `Move to ${nextColumnTitle}` : 'Move to next column'}
            onMove={onMoveNext}
          />
        )}
        {assignee && (
          <span
            title={assignee.name}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-[var(--card)]"
            style={{ background: catColor(assignee.id) }}
          >
            {assignee.avatar_url ? (
              <img src={assignee.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials(assignee.name)
            )}
          </span>
        )}
      </div>

      {card.description && (
        <p className="mt-2 line-clamp-2 text-[13.5px] leading-[1.5] text-[var(--ink2)]">
          {card.description}
        </p>
      )}

      {(card.category ||
        card.due_date ||
        labelCount > 0 ||
        card.attachment_count > 0 ||
        card.comment_count > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {card.category && <span className="chip">{card.category}</span>}
          {card.due_date && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink3)]">
              <Calendar size={13} aria-hidden="true" />
              {shortDate(card.due_date)}
              {dueHour(card.due_time) && ` ${dueHour(card.due_time)}`}
            </span>
          )}
          {labelCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink3)]">
              <Tag size={13} aria-hidden="true" />
              {labelCount}
            </span>
          )}
          {card.attachment_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink3)]">
              <Paperclip size={13} aria-hidden="true" />
              {card.attachment_count}
            </span>
          )}
          {card.comment_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink3)]">
              <MessageSquare size={13} aria-hidden="true" />
              {card.comment_count}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

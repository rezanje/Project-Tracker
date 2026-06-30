import type { CardRow } from '#/lib/board-data'

export default function Card({ card }: { card: CardRow }) {
  return (
    <div className="rounded-lg border border-[rgba(23,58,64,0.18)] bg-white/60 p-2.5 text-sm shadow-sm">
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

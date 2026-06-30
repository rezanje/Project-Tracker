import Card from './Card'
import type { ColumnRow } from '#/lib/board-data'

export default function Column({ column }: { column: ColumnRow }) {
  return (
    <div className="island-shell w-72 shrink-0 rounded-2xl p-3">
      <h3 className="mb-3 px-1 text-sm font-semibold text-[var(--sea-ink)]">
        {column.title}
      </h3>
      <div className="flex flex-col gap-2">
        {column.cards.length === 0 ? (
          <p className="px-1 text-xs text-[var(--sea-ink-soft)]">No cards</p>
        ) : (
          column.cards.map((c) => <Card key={c.id} card={c} />)
        )}
      </div>
    </div>
  )
}

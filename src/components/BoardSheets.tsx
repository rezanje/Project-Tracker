import { Search } from 'lucide-react'
import { Sheet } from '#/components/WorkspaceSwitcher'

/** A pill track of mutually exclusive options — the comp's segmented control. */
function Segments<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onPick: (next: T) => void
}) {
  return (
    <div className="mb-4">
      <p className="mb-[9px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
        {label}
      </p>
      <div className="flex gap-1.5 rounded-full bg-[var(--col)] p-1">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            aria-pressed={value === id}
            className={`flex-1 rounded-full py-[9px] text-[12.5px] font-bold transition ${
              value === id
                ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

export type FilterSheetProps = {
  onClose: () => void
  view: 'board' | 'list'
  onView: (v: 'board' | 'list') => void
  groupBy: 'phase' | 'category'
  onGroupBy: (g: 'phase' | 'category') => void
  search: string
  onSearch: (q: string) => void
  category: string
  onCategory: (c: string) => void
  categories: string[]
  sortBy: 'none' | 'due' | 'title'
  onSortBy: (s: 'none' | 'due' | 'title') => void
}

/** The sliders button's sheet: everything the desktop toolbar row carries. */
export function BoardFilterSheet({
  onClose, view, onView, groupBy, onGroupBy, search, onSearch,
  category, onCategory, categories, sortBy, onSortBy,
}: FilterSheetProps) {
  const active = (category ? 1 : 0) + (search.trim() ? 1 : 0) + (sortBy === 'none' ? 0 : 1)

  return (
    <Sheet
      onClose={onClose}
      label="Filter & urutan"
      className="max-h-[80%]"
      header={
        <div className="mb-4 flex items-center gap-3">
          <h2 className="flex-1 text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">
            Filter & urutan
          </h2>
          {active > 0 && (
            <button
              type="button"
              onClick={() => {
                onSearch('')
                onCategory('')
                onSortBy('none')
              }}
              className="text-[13px] font-bold text-[var(--accent-ink)]"
            >
              Reset
            </button>
          )}
        </div>
      }
    >
      <label className="mb-4 flex items-center gap-2.5 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
        <Search size={17} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          type="search"
          placeholder="Cari task…"
          className="w-full min-w-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
        />
      </label>

      <Segments
        label="Tampilan"
        value={view}
        options={[['board', 'Board'], ['list', 'List']]}
        onPick={onView}
      />

      {view === 'board' && (
        <Segments
          label="Kelompokkan"
          value={groupBy}
          options={[['phase', 'Fase'], ['category', 'Kategori']]}
          onPick={onGroupBy}
        />
      )}

      {view === 'list' && (
        <Segments
          label="Urutkan"
          value={sortBy}
          options={[['none', 'Default'], ['due', 'Deadline'], ['title', 'Judul']]}
          onPick={onSortBy}
        />
      )}

      {categories.length > 0 && (
        <div className="mb-2">
          <p className="mb-[9px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
            Kategori
          </p>
          <div className="flex flex-wrap gap-2">
            {[['', 'Semua'] as const, ...categories.map((c) => [c, c] as const)].map(([id, text]) => (
              <button
                key={id || 'all'}
                type="button"
                onClick={() => onCategory(id)}
                aria-pressed={category === id}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                  category === id
                    ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                    : 'bg-[var(--col)] text-[var(--ink2)]'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/** The more button's sheet: the owner actions that used to sprawl across the
 *  desktop header — edit the project, and get people onto it. */
export function BoardMoreSheet({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Sheet
      onClose={onClose}
      label="Kelola project"
      className="max-h-[82%]"
      header={
        <h2 className="mb-4 text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">
          Kelola project
        </h2>
      }
    >
      {children}
    </Sheet>
  )
}

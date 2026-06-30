import { useState, useEffect, useRef } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { loadBoard, type ColumnRow } from '#/lib/board-data'
import { inviteClient } from '#/lib/invites'
import { createCard, moveCard, updateCard, setCardLabels } from '#/lib/cards'
import Column from '#/components/Column'
import CardDetail from '#/components/CardDetail'
import type { CardRow } from '#/lib/board-data'

export type BoardMeta = {
  members: { id: string; name: string }[]
  labels: { id: string; name: string; color: string }[]
}

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchBoard = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const id = (d as { boardId?: unknown })?.boardId
    if (typeof id !== 'string') throw new Error('boardId required')
    return { boardId: id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const board = await loadBoard(supabase, data.boardId)
    flush(headers)
    return board
  })

const inviteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, email } = (d ?? {}) as { boardId?: unknown; email?: unknown }
    if (typeof boardId !== 'string' || typeof email !== 'string' || !email.trim())
      throw new Error('boardId and email required')
    return { boardId, email: email.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: m } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', data.boardId)
      .eq('user_id', user.id)
      .single()
    if (m?.role !== 'owner') throw new Error('forbidden')
    const res = await inviteClient(getServiceSupabase(), data.boardId, data.email)
    flush(headers)
    return res
  })

const addCardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { columnId, title } = (d ?? {}) as { columnId?: unknown; title?: unknown }
    if (typeof columnId !== 'string' || typeof title !== 'string' || !title.trim())
      throw new Error('columnId and title required')
    return { columnId, title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const card = await createCard(supabase, data.columnId, data.title)
    flush(headers)
    return card
  })

const moveCardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { cardId, toColumnId, orderedIds, sourceOrderedIds } = (d ?? {}) as {
      cardId?: unknown
      toColumnId?: unknown
      orderedIds?: unknown
      sourceOrderedIds?: unknown
    }
    const isStringArray = (x: unknown): x is string[] =>
      Array.isArray(x) && x.every((v) => typeof v === 'string')
    if (
      typeof cardId !== 'string' ||
      typeof toColumnId !== 'string' ||
      !isStringArray(orderedIds) ||
      (sourceOrderedIds !== undefined && !isStringArray(sourceOrderedIds))
    )
      throw new Error('cardId, toColumnId, orderedIds required')
    return {
      cardId,
      toColumnId,
      orderedIds,
      sourceOrderedIds: (sourceOrderedIds as string[] | undefined) ?? [],
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await moveCard(
      supabase,
      data.cardId,
      data.toColumnId,
      data.orderedIds,
      data.sourceOrderedIds,
    )
    flush(headers)
  })

const fetchBoardMeta = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const id = (d as { boardId?: unknown })?.boardId
    if (typeof id !== 'string') throw new Error('boardId required')
    return { boardId: id }
  })
  .handler(async ({ data }): Promise<BoardMeta> => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { data: members, error: mErr } = await supabase
      .from('board_members')
      .select('user_id, profiles(id,name)')
      .eq('board_id', data.boardId)
    if (mErr) throw mErr
    const { data: labels, error: lErr } = await supabase
      .from('labels')
      .select('id,name,color')
      .eq('board_id', data.boardId)
    if (lErr) throw lErr
    flush(headers)
    return {
      members: (members ?? []).map((m) => {
        const p = (m.profiles as unknown) as { id: string; name: string } | null
        return { id: p?.id ?? (m.user_id as string), name: p?.name ?? 'Unknown' }
      }),
      labels: (labels ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    }
  })

const updateCardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { cardId, fields } = (d ?? {}) as {
      cardId?: unknown
      fields?: unknown
    }
    if (typeof cardId !== 'string') throw new Error('cardId required')
    const f = (fields ?? {}) as Record<string, unknown>
    return {
      cardId,
      fields: {
        ...(typeof f.title === 'string' ? { title: f.title } : {}),
        ...(typeof f.description === 'string' || f.description === null
          ? { description: f.description as string | null }
          : {}),
        ...(typeof f.due_date === 'string' || f.due_date === null
          ? { due_date: f.due_date as string | null }
          : {}),
        ...(typeof f.assignee_id === 'string' || f.assignee_id === null
          ? { assignee_id: f.assignee_id as string | null }
          : {}),
      } as Partial<{ title: string; description: string; due_date: string | null; assignee_id: string | null }>,
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await updateCard(supabase, data.cardId, data.fields)
    flush(headers)
  })

const setCardLabelsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { cardId, labelIds } = (d ?? {}) as { cardId?: unknown; labelIds?: unknown }
    if (typeof cardId !== 'string') throw new Error('cardId required')
    if (!Array.isArray(labelIds) || !labelIds.every((v) => typeof v === 'string'))
      throw new Error('labelIds must be string[]')
    return { cardId, labelIds: labelIds as string[] }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await setCardLabels(supabase, data.cardId, data.labelIds)
    flush(headers)
  })

export const Route = createFileRoute('/board/$boardId')({
  component: BoardView,
  loader: async ({ params }) => await fetchBoard({ data: { boardId: params.boardId } }),
})

function BoardView() {
  const initialBoard = Route.useLoaderData()
  const router = useRouter()
  const isOwner = initialBoard.role === 'owner'
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<string | null>(null)
  // Local optimistic columns state for drag reordering
  const [columns, setColumns] = useState<ColumnRow[]>(initialBoard.columns)
  // The column a card started in, captured at drag-start (handleDragOver moves
  // the card across columns optimistically, so by drag-end the origin is lost).
  const dragOriginColRef = useRef<string | null>(null)
  // Selected card for detail panel
  const [selectedCard, setSelectedCard] = useState<CardRow | null>(null)
  const [boardMeta, setBoardMeta] = useState<BoardMeta | null>(null)
  // Sync back from server whenever the loader re-runs (e.g. after router.invalidate)
  useEffect(() => {
    setColumns(initialBoard.columns)
  }, [initialBoard])
  const board = { ...initialBoard, columns }

  async function openCardDetail(card: CardRow) {
    setSelectedCard(card)
    if (!boardMeta) {
      const meta = await fetchBoardMeta({ data: { boardId: board.id } })
      setBoardMeta(meta)
    }
  }

  function closeCardDetail() {
    setSelectedCard(null)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setResult(null)
    try {
      const r = await inviteFn({ data: { boardId: board.id, email } })
      setResult(r.status === 'added' ? 'Added existing user as client.' : 'Invite sent.')
      setEmail('')
    } catch {
      setResult('Failed to invite.')
    }
  }

  async function onAddCard(columnId: string, title: string) {
    await addCardFn({ data: { columnId, title } })
    router.invalidate()
  }

  /** Find which column a card or column id belongs to. */
  function findColumnId(id: string): string | undefined {
    // id might be a column id itself
    if (columns.some((c) => c.id === id)) return id
    // or a card id
    return columns.find((c) => c.cards.some((card) => card.id === id))?.id
  }

  function handleDragStart(event: DragStartEvent) {
    dragOriginColRef.current = findColumnId(String(event.active.id)) ?? null
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeColId = findColumnId(String(active.id))
    const overColId = findColumnId(String(over.id))

    if (!activeColId || !overColId || activeColId === overColId) return

    // Optimistically move the card to the target column
    setColumns((prev) => {
      const activeCol = prev.find((c) => c.id === activeColId)!
      const overCol = prev.find((c) => c.id === overColId)!
      const draggedCard = activeCol.cards.find((c) => c.id === String(active.id))!
      const overIndex = overCol.cards.findIndex((c) => c.id === String(over.id))
      const insertAt = overIndex >= 0 ? overIndex : overCol.cards.length

      return prev.map((col) => {
        if (col.id === activeColId) {
          return { ...col, cards: col.cards.filter((c) => c.id !== String(active.id)) }
        }
        if (col.id === overColId) {
          const newCards = [...col.cards]
          newCards.splice(insertAt, 0, { ...draggedCard, position: insertAt })
          return { ...col, cards: newCards }
        }
        return col
      })
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const originColId = dragOriginColRef.current
    dragOriginColRef.current = null
    if (!over) return

    // handleDragOver has already moved the card into the destination column in
    // local state, so `over`'s column is the destination.
    const destColId = findColumnId(String(over.id))
    if (!destColId || !originColId) return

    const crossColumn = originColId !== destColId

    // No-op: same column AND no positional change → skip the optimistic update
    // and the 1+N writes entirely.
    if (!crossColumn && String(active.id) === String(over.id)) return

    const destCol = columns.find((c) => c.id === destColId)!
    let destCards = [...destCol.cards]
    if (!crossColumn) {
      const oldIndex = destCards.findIndex((c) => c.id === String(active.id))
      const newIndex = destCards.findIndex((c) => c.id === String(over.id))
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return // no-op
      destCards = arrayMove(destCards, oldIndex, newIndex)
    }

    const orderedIds = destCards.map((c) => c.id)
    const sourceOrderedIds = crossColumn
      ? (columns.find((c) => c.id === originColId)?.cards.map((c) => c.id) ?? [])
      : []

    // Apply final order to local state (same-column reorder needs it; cross-
    // column was already applied by handleDragOver).
    if (!crossColumn) {
      setColumns((prev) =>
        prev.map((col) => (col.id === destColId ? { ...col, cards: destCards } : col)),
      )
    }

    // Persist outside any state updater so it fires exactly once.
    moveCardFn({
      data: {
        cardId: String(active.id),
        toColumnId: destColId,
        orderedIds,
        sourceOrderedIds,
      },
    }).catch(() => {
      router.invalidate()
    })
  }

  const columnsContent = (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {board.columns.map((col) => (
        <Column
          key={col.id}
          column={col}
          isOwner={isOwner}
          onAddCard={onAddCard}
          onCardClick={openCardDetail}
        />
      ))}
    </div>
  )

  return (
    <main className="page-wrap mx-auto max-w-6xl px-4 pb-12 pt-14" style={{ position: 'relative' }}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-[var(--sea-ink-soft)]">
            ← Boards
          </Link>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">{board.title}</h1>
        </div>
        <span className="rounded-full bg-[rgba(79,184,178,0.18)] px-3 py-1 text-xs font-semibold text-[var(--lagoon-deep)]">
          {board.role}
        </span>
      </div>

      {isOwner && (
        <form onSubmit={onInvite} className="mb-6 flex max-w-md gap-2">
          <input
            type="email"
            placeholder="Invite client by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-full bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white"
          >
            Invite
          </button>
        </form>
      )}
      {result && <p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{result}</p>}

      {board.columns.length === 0 ? (
        <p className="text-[var(--sea-ink-soft)]">No columns yet.</p>
      ) : (
        // Always wrap in DndContext so Column's useDroppable hook is inside a
        // context even for clients. Drag is a no-op for clients anyway: cards
        // are disabled (disabled:!isDraggable) and SortableContext is owner-only.
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {columnsContent}
        </DndContext>
      )}

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          meta={boardMeta ?? { members: [], labels: [] }}
          isOwner={isOwner}
          onClose={closeCardDetail}
          onSaved={() => {
            router.invalidate()
            closeCardDetail()
          }}
          onUpdateCard={(cardId, fields) => updateCardFn({ data: { cardId, fields } })}
          onSetLabels={(cardId, labelIds) => setCardLabelsFn({ data: { cardId, labelIds } })}
        />
      )}
    </main>
  )
}

import { useState } from 'react'
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
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { loadBoard, type ColumnRow } from '#/lib/board-data'
import { inviteClient } from '#/lib/invites'
import { createCard, moveCard } from '#/lib/cards'
import Column from '#/components/Column'

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
    const { cardId, toColumnId, orderedIds } = (d ?? {}) as {
      cardId?: unknown
      toColumnId?: unknown
      orderedIds?: unknown
    }
    if (
      typeof cardId !== 'string' ||
      typeof toColumnId !== 'string' ||
      !Array.isArray(orderedIds) ||
      !orderedIds.every((x) => typeof x === 'string')
    )
      throw new Error('cardId, toColumnId, orderedIds required')
    return { cardId, toColumnId, orderedIds: orderedIds as string[] }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await moveCard(supabase, data.cardId, data.toColumnId, data.orderedIds)
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
  // Local optimistic columns state (ids only, for drag ordering)
  const [columns, setColumns] = useState<ColumnRow[]>(initialBoard.columns)
  // Sync columns when loader data changes (e.g. after router.invalidate)
  const board = { ...initialBoard, columns }

  const sensors = useSensors(
    useSensor(PointerSensor),
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
    if (!over) return

    const activeColId = findColumnId(String(active.id))
    const overColId = findColumnId(String(over.id))

    if (!activeColId || !overColId) return

    setColumns((prev) => {
      const overCol = prev.find((c) => c.id === overColId)!

      let newCards = [...overCol.cards]
      if (activeColId === overColId) {
        // Same column reorder
        const oldIndex = newCards.findIndex((c) => c.id === String(active.id))
        const newIndex = newCards.findIndex((c) => c.id === String(over.id))
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          newCards = arrayMove(newCards, oldIndex, newIndex)
        }
      }

      const orderedIds = newCards.map((c) => c.id)

      // Persist to DB (fire-and-forget, optimistic UI already applied)
      moveCardFn({
        data: { cardId: String(active.id), toColumnId: overColId, orderedIds },
      }).catch(() => {
        // On error, refresh from server
        router.invalidate()
      })

      if (activeColId === overColId) {
        return prev.map((col) =>
          col.id === overColId ? { ...col, cards: newCards } : col,
        )
      }
      return prev
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
        />
      ))}
    </div>
  )

  return (
    <main className="page-wrap mx-auto max-w-6xl px-4 pb-12 pt-14">
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
      ) : isOwner ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {columnsContent}
        </DndContext>
      ) : (
        columnsContent
      )}
    </main>
  )
}

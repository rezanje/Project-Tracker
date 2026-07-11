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
import { ChevronLeft } from 'lucide-react'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { loadBoard, distinctCategories, groupByCategory, type ColumnRow } from '#/lib/board-data'
import { inviteClient } from '#/lib/invites'
import { createCard, moveCard, updateCard, setCardLabels, deleteCard } from '#/lib/cards'
import { updateBoard, setBoardFinance, deleteBoard, type BoardMetaUpdate } from '#/lib/boards'
import { createPillar, deletePillar } from '#/lib/pillars'
import Column from '#/components/Column'
import CardDetail from '#/components/CardDetail'
import ProjectEdit from '#/components/ProjectEdit'
import TaskCreate from '#/components/TaskCreate'
import CalendarView from '#/components/CalendarView'
import PillarManager from '#/components/PillarManager'
import { BoardStats, BoardRail, BoardRoadmap } from '#/components/BoardPanels'
import { ContentStats, ContentPipeline, ContentRail } from '#/components/ContentPanels'
import { isDoneColumn } from '#/lib/home'
import type { CardRow } from '#/lib/board-data'

export type BoardMeta = {
  members: { id: string; name: string }[]
  labels: { id: string; name: string; color: string }[]
}

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

// Deterministic accent per board (matches the boards grid) — derived from id.
const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']
function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
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
    const { boardId, email, role } = (d ?? {}) as { boardId?: unknown; email?: unknown; role?: unknown }
    if (typeof boardId !== 'string' || typeof email !== 'string' || !email.trim())
      throw new Error('boardId and email required')
    return {
      boardId,
      email: email.trim(),
      role: role === 'member' ? ('member' as const) : ('client' as const),
    }
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
    const res = await inviteClient(getServiceSupabase(), data.boardId, data.email, data.role)
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
        ...(typeof f.category === 'string' || f.category === null
          ? { category: f.category as string | null }
          : {}),
        ...(typeof f.contact === 'string' || f.contact === null ? { contact: f.contact as string | null } : {}),
        ...(typeof f.phone === 'string' || f.phone === null ? { phone: f.phone as string | null } : {}),
        ...(typeof f.source === 'string' || f.source === null ? { source: f.source as string | null } : {}),
        ...(typeof f.deal_value === 'number' || f.deal_value === null ? { deal_value: f.deal_value as number | null } : {}),
        ...(typeof f.pillar_id === 'string' || f.pillar_id === null ? { pillar_id: f.pillar_id as string | null } : {}),
        ...(typeof f.content_status === 'string' || f.content_status === null ? { content_status: f.content_status as string | null } : {}),
        ...((Array.isArray(f.channels) && f.channels.every((x) => typeof x === 'string')) || f.channels === null ? { channels: f.channels as string[] | null } : {}),
        ...(typeof f.format === 'string' || f.format === null ? { format: f.format as string | null } : {}),
      } as Partial<{ title: string; description: string | null; due_date: string | null; assignee_id: string | null; category: string | null; contact: string | null; phone: string | null; source: string | null; deal_value: number | null; pillar_id: string | null; content_status: string | null; channels: string[] | null; format: string | null }>,
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

const deleteCardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const cardId = (d as { cardId?: unknown })?.cardId
    if (typeof cardId !== 'string') throw new Error('cardId required')
    return { cardId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await deleteCard(supabase, data.cardId)
    flush(headers)
  })

const addTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const f = (d ?? {}) as Record<string, unknown>
    if (typeof f.columnId !== 'string' || typeof f.title !== 'string' || !f.title.trim())
      throw new Error('columnId and title required')
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const arr = (v: unknown) =>
      Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length ? (v as string[]) : null
    return {
      columnId: f.columnId,
      title: f.title.trim(),
      due_date: s(f.due_date),
      assignee_id: s(f.assignee_id),
      category: s(f.category),
      description: s(f.description),
      pillar_id: s(f.pillar_id),
      content_status: s(f.content_status),
      channels: arr(f.channels),
      format: s(f.format),
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const { columnId, title, ...extra } = data
    await createCard(supabase, columnId, title, extra)
    flush(headers)
  })

const META_KEYS = [
  'title', 'description', 'type', 'pic', 'status', 'client_name', 'start_date', 'deadline', 'priority',
] as const

const updateBoardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, fields } = (d ?? {}) as { boardId?: unknown; fields?: unknown }
    if (typeof boardId !== 'string') throw new Error('boardId required')
    const f = (fields ?? {}) as Record<string, unknown>
    const out: Record<string, string | null> = {}
    for (const k of META_KEYS) {
      const v = f[k]
      if (typeof v === 'string') out[k] = v
      else if (v === null) out[k] = null
    }
    return { boardId, fields: out as BoardMetaUpdate }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await updateBoard(supabase, data.boardId, data.fields)
    flush(headers)
  })

const setFinanceFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, valueIdr } = (d ?? {}) as { boardId?: unknown; valueIdr?: unknown }
    if (typeof boardId !== 'string') throw new Error('boardId required')
    return { boardId, valueIdr: Math.max(0, Math.floor(Number(valueIdr) || 0)) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await setBoardFinance(supabase, data.boardId, data.valueIdr)
    flush(headers)
  })

const deleteBoardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const boardId = (d as { boardId?: unknown })?.boardId
    if (typeof boardId !== 'string') throw new Error('boardId required')
    return { boardId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await deleteBoard(supabase, data.boardId)
    flush(headers)
  })

const addPillarFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, name, color } = (d ?? {}) as {
      workspaceId?: unknown; name?: unknown; color?: unknown
    }
    if (typeof workspaceId !== 'string' || typeof name !== 'string' || !name.trim())
      throw new Error('workspaceId and name required')
    return {
      workspaceId,
      name: name.trim(),
      color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2563eb',
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await createPillar(supabase, data.workspaceId, data.name, data.color)
    flush(headers)
  })

const deletePillarFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const pillarId = (d as { pillarId?: unknown })?.pillarId
    if (typeof pillarId !== 'string') throw new Error('pillarId required')
    return { pillarId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    await deletePillar(supabase, data.pillarId)
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
  const canEdit = initialBoard.role === 'owner' || initialBoard.role === 'member'
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'client'>('member')
  const [result, setResult] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  // Local optimistic columns state for drag reordering
  const [columns, setColumns] = useState<ColumnRow[]>(initialBoard.columns)
  // The column a card started in, captured at drag-start (handleDragOver moves
  // the card across columns optimistically, so by drag-end the origin is lost).
  const dragOriginColRef = useRef<string | null>(null)
  // Selected card for detail panel
  const [selectedCard, setSelectedCard] = useState<CardRow | null>(null)
  const [boardMeta, setBoardMeta] = useState<BoardMeta | null>(null)
  const [editing, setEditing] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [addInitialDate, setAddInitialDate] = useState<string>('')
  const [groupBy, setGroupBy] = useState<'phase' | 'category'>('phase')
  const [filterCat, setFilterCat] = useState<string>('')
  // Sync back from server whenever the loader re-runs (e.g. after router.invalidate)
  useEffect(() => {
    setColumns(initialBoard.columns)
  }, [initialBoard])
  // Load members/labels on mount so the Add-task assignee list is ready.
  useEffect(() => {
    if (!boardMeta) fetchBoardMeta({ data: { boardId: initialBoard.id } }).then(setBoardMeta)
  }, [initialBoard.id, boardMeta])
  const board = { ...initialBoard, columns }
  const isContent = board.kind === 'content'

  function openAddContent(date: string) {
    setAddInitialDate(date)
    setAddingTask(true)
  }

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

  // Deferred delete + undo: hide the card immediately, but only commit the DB
  // delete after a grace window. Undo re-syncs from the server, where the card
  // still exists — so nothing (comments/labels/attachments) is ever lost.
  const [pendingDelete, setPendingDelete] = useState<CardRow | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleDeleteCard(card: CardRow) {
    const columnId = findColumnId(card.id)
    if (!columnId) return
    setSelectedCard(null)
    setColumns((prev) =>
      prev.map((col) =>
        col.id === columnId ? { ...col, cards: col.cards.filter((c) => c.id !== card.id) } : col,
      ),
    )
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    setPendingDelete(card)
    deleteTimerRef.current = setTimeout(() => {
      deleteCardFn({ data: { cardId: card.id } }).then(() => router.invalidate())
      deleteTimerRef.current = null
      setPendingDelete(null)
    }, 5000)
  }

  function undoDelete() {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    deleteTimerRef.current = null
    setPendingDelete(null)
    router.invalidate() // card was never deleted server-side; refetch restores it
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setResult(null)
    setInviteLink(null)
    try {
      const r = await inviteFn({ data: { boardId: board.id, email, role: inviteRole } })
      if (r.status === 'added') {
        setResult(`Added existing user as ${inviteRole}.`)
      } else {
        setResult(`Invite created (${inviteRole}). Share the link below.`)
        setInviteLink(`${window.location.origin}/signup?invite=${r.token}`)
      }
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

  const allCards = board.columns.flatMap((c) => c.cards)
  const today = new Date().toISOString().slice(0, 10)
  let completedCount = 0
  let dueTodayCount = 0
  let overdueCount = 0
  for (const col of board.columns) {
    const done = isDoneColumn(col.title)
    for (const c of col.cards) {
      if (done) completedCount++
      else if (c.due_date) {
        if (c.due_date < today) overdueCount++
        else if (c.due_date === today) dueTodayCount++
      }
    }
  }
  let draftCount = 0
  let scheduledCount = 0
  let postedCount = 0
  for (const c of allCards) {
    if (c.content_status === 'draft') draftCount++
    else if (c.content_status === 'scheduled') scheduledCount++
    else if (c.content_status === 'posted') postedCount++
  }
  const todayContent = allCards
    .filter((c) => c.due_date === today)
    .map((c) => ({ id: c.id, title: c.title, status: c.content_status ?? null }))
  const categories = distinctCategories(allCards)
  const keep = (card: CardRow) => !filterCat || card.category === filterCat
  const phaseColumns: ColumnRow[] = board.columns.map((c) => ({
    ...c,
    cards: c.cards.filter(keep),
  }))
  const categoryColumns: ColumnRow[] = groupByCategory(allCards.filter(keep)).map((g) => ({
    id: `cat:${g.category}`,
    title: g.category,
    position: 0,
    cards: g.cards,
  }))

  const columnsContent = (
    <div className="gt-scroll flex items-start gap-4 overflow-x-auto pb-3.5">
      {groupBy === 'phase'
        ? phaseColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              isOwner={canEdit}
              onAddCard={onAddCard}
              onCardClick={openCardDetail}
            />
          ))
        : categoryColumns.map((col) => (
            // Read-only view: no owner tools / drag in category mode.
            <Column key={col.id} column={col} isOwner={false} onCardClick={openCardDetail} />
          ))}
    </div>
  )

  return (
    <main className="relative px-4 pb-11 pt-6 sm:px-6 gt-fade">
      <div className="mx-auto mb-5 flex max-w-[1400px] flex-wrap items-start justify-between gap-5">
        <div>
          <Link
            to="/"
            className="mb-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink2)] no-underline hover:text-[var(--ink)]"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="h-3.5 w-3.5 rounded-full"
              style={{ background: accentFor(board.id) }}
              aria-hidden="true"
            />
            <h1 className="display-title text-[32px] font-extrabold text-[var(--ink)]">
              {board.title}
            </h1>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${
                isOwner
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                  : 'bg-[var(--col)] text-[var(--ink2)]'
              }`}
            >
              {board.role}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {board.type && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ background: `${accentFor(board.type)}22`, color: accentFor(board.type) }}
              >
                {board.type}
              </span>
            )}
            <span className="rounded-full bg-[var(--col)] px-2.5 py-1 text-[11px] font-bold capitalize text-[var(--ink2)]">
              {board.status.replace('_', ' ')}
            </span>
            {board.priority && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold capitalize"
                style={
                  board.priority === 'urgent'
                    ? { background: 'var(--danger)', color: '#fff' }
                    : { background: 'var(--col)', color: 'var(--ink2)' }
                }
              >
                {board.priority}{board.priority === 'urgent' ? '' : ' priority'}
              </span>
            )}
            {board.client_name && (
              <span className="text-[12px] text-[var(--ink3)]">· {board.client_name}</span>
            )}
            {board.deadline && (
              <span className="text-[12px] text-[var(--ink3)]">
                · Due {new Date(board.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            )}
            {board.pic && <span className="text-[12px] text-[var(--ink3)]">· PIC {board.pic}</span>}
            {isOwner && board.value_idr != null && (
              <span className="text-[12px] font-bold text-[var(--accent-ink)]">
                · Rp {board.value_idr.toLocaleString('id-ID')}
              </span>
            )}
          </div>

          {board.description && (
            <p className="mt-2.5 max-w-[640px] text-[14px] leading-relaxed text-[var(--ink2)]">
              {board.description}
            </p>
          )}
        </div>

        {canEdit ? (
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openAddContent('')}
                className="btn btn-primary shrink-0"
              >
                {isContent ? '+ Add content' : '+ Add task'}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="btn btn-ghost shrink-0"
                >
                  Edit project
                </button>
              )}
            </div>
            {isOwner && (
              <>
                <form onSubmit={onInvite} className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:flex-nowrap">
                  <input
                    type="email"
                    placeholder="Invite by email…"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field flex-1 rounded-full px-4 py-2.5 text-[13px] sm:w-[190px]"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'member' | 'client')}
                    className="field w-auto rounded-full px-3 py-2.5 text-[13px]"
                  >
                    <option value="member">Member</option>
                    <option value="client">Client</option>
                  </select>
                  <button type="submit" className="btn btn-primary shrink-0">
                    Invite
                  </button>
                </form>
                {result && (
                  <span className="text-xs font-semibold text-[var(--accent-ink)]">{result}</span>
                )}
                {inviteLink && (
                  <div className="flex w-full items-center gap-2 sm:w-[360px]">
                    <input
                      readOnly
                      value={inviteLink}
                      onFocus={(e) => e.target.select()}
                      className="field flex-1 rounded-full px-3 py-2 text-[12px]"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(inviteLink)}
                      className="btn btn-ghost shrink-0 px-3 py-2 text-xs"
                    >
                      Copy
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="max-w-[290px] rounded-[14px] border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ink2)]">
            You're viewing as a{' '}
            <b className="text-[var(--ink)]">client</b> — read-only. You can still
            comment and upload files.
          </p>
        )}
      </div>

      {!isContent && (
        <BoardStats
          dueToday={dueTodayCount}
          overdue={overdueCount}
          completed={completedCount}
          total={allCards.length}
          members={(boardMeta?.members ?? []).length}
          budgetIdr={board.value_idr ?? null}
          spentPct={72}
        />
      )}

      {!isContent && (
      <div className="mx-auto mb-4 flex max-w-[1400px] flex-wrap items-center gap-3 px-1">
        <span className="text-[13px] font-semibold text-[var(--ink3)]">Group by</span>
        <div className="flex overflow-hidden rounded-full border border-[var(--line)]">
          {(['phase', 'category'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              className={`px-3 py-1.5 text-[13px] font-bold capitalize ${
                groupBy === g ? 'bg-[var(--btn)] text-white' : 'text-[var(--ink2)]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="field w-auto rounded-full px-3 py-1.5 text-[13px]"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      )}

      {isContent ? (
        <div className="gt-fade">
          {isOwner && (
            <PillarManager
              pillars={board.pillars}
              onAdd={(name, color) =>
                addPillarFn({ data: { workspaceId: board.workspaceId ?? '', name, color } }).then(() =>
                  router.invalidate(),
                )
              }
              onDelete={(id) => deletePillarFn({ data: { pillarId: id } }).then(() => router.invalidate())}
            />
          )}
          <ContentStats
            total={allCards.length}
            draft={draftCount}
            scheduled={scheduledCount}
            posted={postedCount}
          />
          <ContentPipeline scheduled={scheduledCount} posted={postedCount} />
          <div className="mx-auto flex max-w-[1400px] items-start gap-4">
            <div className="min-w-0 flex-1">
              <CalendarView
                cards={board.columns.flatMap((c) => c.cards)}
                pillars={board.pillars}
                canEdit={canEdit}
                onCardClick={openCardDetail}
                onAddOnDay={openAddContent}
              />
            </div>
            <ContentRail today={todayContent} />
          </div>
        </div>
      ) : board.columns.length === 0 ? (
        <div className="card mx-auto grid max-w-[1400px] place-items-center px-6 py-16 text-center text-[var(--ink2)]">
          No columns yet.
        </div>
      ) : (
        // Always wrap in DndContext so Column's useDroppable hook is inside a
        // context even for clients. Drag is a no-op for clients anyway: cards
        // are disabled (disabled:!isDraggable) and SortableContext is owner-only.
        <div className="mx-auto flex max-w-[1400px] items-start gap-4">
          <div className="min-w-0 flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              {columnsContent}
            </DndContext>
          </div>
          <BoardRail
            members={boardMeta?.members ?? []}
            budgetIdr={board.value_idr ?? null}
            spentPct={72}
          />
        </div>
      )}

      {!isContent && board.columns.length > 0 && <BoardRoadmap />}

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          boardId={board.id}
          meta={boardMeta ?? { members: [], labels: [] }}
          isOwner={canEdit}
          onClose={closeCardDetail}
          onSaved={() => {
            router.invalidate()
            closeCardDetail()
          }}
          onDelete={() => handleDeleteCard(selectedCard)}
          onUpdateCard={(cardId, fields) => updateCardFn({ data: { cardId, fields } })}
          onSetLabels={(cardId, labelIds) => setCardLabelsFn({ data: { cardId, labelIds } })}
          categorySuggestions={distinctCategories(columns.flatMap((c) => c.cards))}
          isLeads={board.kind === 'leads'}
          isContent={isContent}
          pillars={board.pillars}
        />
      )}

      {addingTask && (
        <TaskCreate
          columns={columns.map((c) => ({ id: c.id, title: c.title }))}
          members={(boardMeta ?? { members: [], labels: [] }).members}
          categorySuggestions={distinctCategories(columns.flatMap((c) => c.cards))}
          isContent={isContent}
          pillars={board.pillars}
          initialDueDate={addInitialDate}
          onClose={() => {
            setAddingTask(false)
            setAddInitialDate('')
          }}
          onCreated={() => {
            setAddingTask(false)
            setAddInitialDate('')
            router.invalidate()
          }}
          onCreate={(t) => addTaskFn({ data: t })}
        />
      )}

      {editing && (
        <ProjectEdit
          board={board}
          typeSuggestions={['Design', 'Development', 'Branding', 'Marketing', 'Consulting', 'Content']}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            router.invalidate()
          }}
          onSave={async (fields, valueIdr) => {
            await updateBoardFn({ data: { boardId: board.id, fields } })
            await setFinanceFn({ data: { boardId: board.id, valueIdr } })
          }}
          onDelete={async () => {
            await deleteBoardFn({ data: { boardId: board.id } })
            router.navigate({ to: '/' })
          }}
        />
      )}

      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-4 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-[var(--bg)] shadow-[0_12px_40px_-8px_rgba(16,28,22,0.5)] gt-back">
          <span>Card deleted</span>
          <button
            type="button"
            onClick={undoDelete}
            className="font-bold text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Undo
          </button>
        </div>
      )}
    </main>
  )
}

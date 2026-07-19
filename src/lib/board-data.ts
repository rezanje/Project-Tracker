import type { SupabaseClient } from '@supabase/supabase-js'

export type CardRow = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  assignee_id: string | null
  category: string | null
  contact: string | null
  phone: string | null
  source: string | null
  deal_value: number | null
  pillar_id: string | null
  content_status: string | null
  channels: string[] | null
  format: string | null
  position: number
  card_labels: { label_id: string }[]
  attachment_count: number
  comment_count: number
}
export type Pillar = { id: string; name: string; color: string }

// Content-board vocab (kept here so forms + calendar share one source).
export const CONTENT_CHANNELS = [
  'Instagram', 'TikTok', 'LinkedIn', 'YouTube', 'Facebook', 'X', 'Threads',
] as const
export const CONTENT_FORMATS = [
  'Reel', 'Carousel', 'Story', 'Single image', 'Video', 'Thread', 'Article',
] as const
export const CONTENT_STATUSES = ['draft', 'scheduled', 'posted'] as const
export const STATUS_COLOR: Record<string, string> = {
  draft: '#9ca3af', scheduled: '#d97706', posted: '#1f9d55',
}
export type ColumnRow = {
  id: string
  title: string
  position: number
  cards: CardRow[]
}
export type ProjectMeta = {
  description: string | null
  type: string | null
  pic: string | null
  status: string
  client_name: string | null
  start_date: string | null
  deadline: string | null
  priority: string | null
  // Owner-only: null for client viewers (RLS blocks the finance table for them).
  value_idr: number | null
}
export type BoardWithColumns = ProjectMeta & {
  id: string
  title: string
  role: string
  kind: string
  workspaceId: string | null
  columns: ColumnRow[]
  pillars: Pillar[]
  activity: ActivityItem[]
  files: FileItem[]
}

export type ActivityItem = {
  id: string
  cardId: string
  authorName: string
  text: string
  createdAt: string
}

export type FileItem = {
  id: string
  cardId: string
  filename: string
  createdAt: string
}

/** Recent comments + attachment uploads across a board's cards, merged and
 * sorted newest-first. No move-history exists yet, so card moves aren't
 * included. Attachment rows are also returned as `files`, board-wide. */
async function fetchBoardActivity(
  supabase: SupabaseClient,
  cardIds: string[],
  cardTitleById: Map<string, string>,
  limit = 8,
): Promise<{ activity: ActivityItem[]; files: FileItem[] }> {
  if (cardIds.length === 0) return { activity: [], files: [] }

  const [{ data: comments }, { data: attachments }] = await Promise.all([
    supabase
      .from('comments')
      .select('id,card_id,created_at,profiles(name)')
      .in('card_id', cardIds)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('attachments')
      .select('id,card_id,filename,created_at,profiles(name)')
      .in('card_id', cardIds)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  const authorName = (row: { profiles?: { name?: string | null } | { name?: string | null }[] | null }): string => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return p?.name ?? 'Someone'
  }
  const cardTitle = (cardId: string) => cardTitleById.get(cardId) ?? 'a card'

  const fromComments: ActivityItem[] = (comments ?? []).map((c) => ({
    id: `comment:${c.id as string}`,
    cardId: c.card_id as string,
    authorName: authorName(c as { profiles?: { name?: string | null } | null }),
    text: `commented on "${cardTitle(c.card_id as string)}"`,
    createdAt: c.created_at as string,
  }))
  const fromAttachments: ActivityItem[] = (attachments ?? []).map((a) => ({
    id: `attachment:${a.id as string}`,
    cardId: a.card_id as string,
    authorName: authorName(a as { profiles?: { name?: string | null } | null }),
    text: `uploaded ${a.filename as string} to "${cardTitle(a.card_id as string)}"`,
    createdAt: a.created_at as string,
  }))

  const activity = [...fromComments, ...fromAttachments]
    .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())
    .slice(0, limit)

  const files: FileItem[] = (attachments ?? [])
    .map((a) => ({
      id: a.id as string,
      cardId: a.card_id as string,
      filename: a.filename as string,
      createdAt: a.created_at as string,
    }))
    .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())

  return { activity, files }
}

/**
 * Load a board with its columns and nested cards, plus the caller's role.
 * Must be called with a request-scoped (RLS) client: board visibility and the
 * single-row membership lookup both rely on RLS limiting rows to the caller.
 */
export async function loadBoard(
  supabase: SupabaseClient,
  boardId: string,
): Promise<BoardWithColumns> {
  const { data: board, error } = await supabase
    .from('boards')
    .select(
      'id,title,kind,description,type,pic,status,client_name,start_date,deadline,priority,workspace_id',
    )
    .eq('id', boardId)
    .single()
  if (error || !board) throw new Error('board not found')

  const { data: columns } = await supabase
    .from('columns')
    .select(
      'id,title,position,cards(id,title,description,due_date,assignee_id,category,contact,phone,source,deal_value,pillar_id,content_status,channels,format,position,card_labels(label_id),attachments(count),comments(count))',
    )
    .eq('board_id', boardId)
    .order('position')

  // Supabase's `rel(count)` embed returns [{ count: N }] per row; flatten to a
  // plain number so CardRow stays simple for components to consume.
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  function withCounts(rawCards: unknown[]): CardRow[] {
    return (rawCards ?? []).map((raw) => {
      const c = raw as Record<string, unknown>
      const att = one(c.attachments as unknown) as { count: number } | null
      const com = one(c.comments as unknown) as { count: number } | null
      return {
        ...(c as unknown as CardRow),
        attachment_count: att?.count ?? 0,
        comment_count: com?.count ?? 0,
      }
    })
  }

  // members_read RLS returns every member of the board, so scope to the caller
  // (otherwise .single() breaks once a board has more than one member).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: membership } = await supabase
    .from('board_members')
    .select('role')
    .eq('board_id', boardId)
    .eq('user_id', user?.id ?? '')
    .maybeSingle()

  // No direct board membership → the caller reaches this board through the
  // workspace; map their workspace role (owner/member) onto the board.
  let wsRole: string | null = null
  const workspaceId = (board as { workspace_id?: string | null }).workspace_id ?? null
  if (!membership && workspaceId) {
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user?.id ?? '')
      .maybeSingle()
    wsRole = wm?.role ?? null
  }

  const cols: ColumnRow[] = (columns ?? []).map((c) => {
    const raw = c as { id: string; title: string; position: number; cards?: unknown[] }
    return {
      id: raw.id,
      title: raw.title,
      position: raw.position,
      cards: withCounts(raw.cards ?? []).sort((a, b) => a.position - b.position),
    }
  })

  const role = membership?.role ?? wsRole ?? 'client'

  // Financials are owner-only; RLS also blocks the row for clients, so this
  // query simply returns nothing for them — the guard just avoids the round-trip.
  let value_idr: number | null = null
  if (role === 'owner') {
    const { data: fin } = await supabase
      .from('project_finance')
      .select('value_idr')
      .eq('board_id', boardId)
      .maybeSingle()
    value_idr = fin?.value_idr ?? 0
  }

  // Content boards colour their calendar chips by pillar; pillars are
  // workspace-wide, so load them once here for the whole board.
  let pillars: Pillar[] = []
  if ((board as { kind?: string }).kind === 'content' && workspaceId) {
    const { data: pl } = await supabase
      .from('pillars')
      .select('id,name,color')
      .eq('workspace_id', workspaceId)
      .order('position')
    pillars = (pl ?? []) as Pillar[]
  }

  const cardTitleById = new Map(cols.flatMap((c) => c.cards.map((card) => [card.id, card.title] as const)))
  const { activity, files } = await fetchBoardActivity(
    supabase,
    [...cardTitleById.keys()],
    cardTitleById,
    50,
  )

  const b = board as Record<string, unknown>
  return {
    id: board.id,
    title: board.title,
    role,
    kind: (b.kind as string) ?? 'tasks',
    workspaceId,
    pillars,
    description: (b.description as string | null) ?? null,
    type: (b.type as string | null) ?? null,
    pic: (b.pic as string | null) ?? null,
    status: (b.status as string) ?? 'active',
    client_name: (b.client_name as string | null) ?? null,
    start_date: (b.start_date as string | null) ?? null,
    deadline: (b.deadline as string | null) ?? null,
    priority: (b.priority as string | null) ?? null,
    value_idr,
    columns: cols,
    activity,
    files,
  }
}

/** Sorted, unique, non-empty category names across the given cards. */
export function distinctCategories(cards: { category: string | null }[]): string[] {
  const set = new Set<string>()
  for (const c of cards) if (c.category) set.add(c.category)
  return [...set].sort()
}

/** Bucket cards by category; null/empty categories fall into "Uncategorised". */
export function groupByCategory(cards: CardRow[]): { category: string; cards: CardRow[] }[] {
  const map = new Map<string, CardRow[]>()
  for (const c of cards) {
    const key = c.category ?? 'Uncategorised'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return [...map.entries()].map(([category, cards]) => ({ category, cards }))
}

import type { SupabaseClient } from '@supabase/supabase-js'

export type CardRow = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  assignee_id: string | null
  position: number
  card_labels: { label_id: string }[]
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
  columns: ColumnRow[]
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
      'id,title,description,type,pic,status,client_name,start_date,deadline,priority',
    )
    .eq('id', boardId)
    .single()
  if (error || !board) throw new Error('board not found')

  const { data: columns } = await supabase
    .from('columns')
    .select(
      'id,title,position,cards(id,title,description,due_date,assignee_id,position,card_labels(label_id))',
    )
    .eq('board_id', boardId)
    .order('position')

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
    .single()

  const cols: ColumnRow[] = (columns ?? []).map((c) => ({
    ...(c as ColumnRow),
    cards: [...((c as ColumnRow).cards ?? [])].sort(
      (a, b) => a.position - b.position,
    ),
  }))

  const role = membership?.role ?? 'client'

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

  const b = board as Record<string, unknown>
  return {
    id: board.id,
    title: board.title,
    role,
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
  }
}

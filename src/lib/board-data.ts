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
export type BoardWithColumns = {
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
    .select('id,title')
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

  return {
    id: board.id,
    title: board.title,
    role: membership?.role ?? 'client',
    columns: cols,
  }
}

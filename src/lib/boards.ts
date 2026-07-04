import type { SupabaseClient } from '@supabase/supabase-js'

export type Board = {
  id: string
  owner_id: string
  title: string
  created_at: string
}

/**
 * Insert a board. The owner `board_members` row is added automatically by the
 * `on_board_created` DB trigger (security definer), which keeps it atomic and
 * sidesteps the RLS chicken-and-egg of inserting the first owner membership.
 */
export async function createBoard(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  workspaceId: string,
  kind: 'tasks' | 'leads' = 'tasks',
): Promise<{ id: string }> {
  // Generate the id client-side and skip RETURNING. The boards SELECT policy
  // (is_board_member, which is `stable`) can't see the owner membership row the
  // after-insert trigger adds within the same statement, so insert().select()
  // trips RLS with "new row violates row-level security policy".
  const id = crypto.randomUUID()
  const { error } = await supabase
    .from('boards')
    .insert({ id, title, owner_id: userId, workspace_id: workspaceId, kind })
  if (error) throw error
  return { id }
}

/** Boards the caller can see — RLS already limits this to member boards. */
export async function listMyBoards(supabase: SupabaseClient): Promise<Board[]> {
  const { data } = await supabase.from('boards').select('*').order('created_at')
  return data ?? []
}

export type BoardMetaUpdate = Partial<{
  title: string
  description: string | null
  type: string | null
  pic: string | null
  status: string
  client_name: string | null
  start_date: string | null
  deadline: string | null
  priority: string | null
}>

/** Update project metadata. RLS restricts this to the board owner. */
export async function updateBoard(
  supabase: SupabaseClient,
  boardId: string,
  fields: BoardMetaUpdate,
): Promise<void> {
  const { error } = await supabase.from('boards').update(fields).eq('id', boardId)
  if (error) throw error
}

/** Upsert the owner-only project value (whole rupiah). RLS restricts to owner. */
export async function setBoardFinance(
  supabase: SupabaseClient,
  boardId: string,
  valueIdr: number,
): Promise<void> {
  const { error } = await supabase
    .from('project_finance')
    .upsert({ board_id: boardId, value_idr: valueIdr })
  if (error) throw error
}

/**
 * Hard-delete a board and everything under it. All child tables (columns,
 * cards, comments, attachments, labels, members, invites, finance) cascade via
 * FK `on delete cascade`; Storage objects do NOT cascade, so we clear the
 * board's files first. Every attachment path is `{boardId}/{cardId}/{file}`,
 * collected via the attachment → card → column → board chain. RLS restricts
 * this to the board owner.
 */
export async function deleteBoard(supabase: SupabaseClient, boardId: string): Promise<void> {
  const { data: files } = await supabase
    .from('attachments')
    .select('path, cards!inner(columns!inner(board_id))')
    .eq('cards.columns.board_id', boardId)
  const paths = (files ?? []).map((f) => (f as { path: string }).path)
  if (paths.length) await supabase.storage.from('card-files').remove(paths)

  const { error } = await supabase.from('boards').delete().eq('id', boardId)
  if (error) throw error
}

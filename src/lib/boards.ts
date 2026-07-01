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
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('boards')
    .insert({ title, owner_id: userId })
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** Boards the caller can see — RLS already limits this to member boards. */
export async function listMyBoards(supabase: SupabaseClient): Promise<Board[]> {
  const { data } = await supabase.from('boards').select('*').order('created_at')
  return data ?? []
}

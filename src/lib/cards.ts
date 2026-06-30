import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardRow } from '#/lib/board-data'

/**
 * Pure helper: map an ordered array of ids to sequential position values.
 * Used by moveCard and by callers doing optimistic reordering.
 */
export function reorderPositions(ids: string[]): { id: string; position: number }[] {
  return ids.map((id, i) => ({ id, position: i }))
}

/**
 * Insert a new card at the end of a column.
 * The supabase client must have write access to `cards`
 * (use the RLS-scoped client for the owner, or the service client in tests).
 */
export async function createCard(
  supabase: SupabaseClient,
  columnId: string,
  title: string,
): Promise<CardRow> {
  const { count } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', columnId)

  const { data, error } = await supabase
    .from('cards')
    .insert({ column_id: columnId, title, position: count ?? 0 })
    .select('id,title,due_date,assignee_id,position,card_labels(label_id)')
    .single()

  if (error) throw error
  return data as CardRow
}

/**
 * Move a card to toColumnId and re-sequence positions for that column.
 * orderedIds must be the complete ordered list of card ids for the
 * destination column *after* the move (including cardId itself).
 *
 * Note: this is N+1 writes per reorder — acceptable at small scale (ponytail).
 */
export async function moveCard(
  supabase: SupabaseClient,
  cardId: string,
  toColumnId: string,
  orderedIds: string[],
): Promise<void> {
  const { error: moveErr } = await supabase
    .from('cards')
    .update({ column_id: toColumnId })
    .eq('id', cardId)
  if (moveErr) throw moveErr

  for (const { id, position } of reorderPositions(orderedIds)) {
    const { error } = await supabase.from('cards').update({ position }).eq('id', id)
    if (error) throw error
  }
}

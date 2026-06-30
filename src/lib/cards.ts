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
 * Uses max(position)+1 rather than a row count: moveCard re-sequences both
 * affected columns so positions stay contiguous, but max+1 is collision-safe
 * even if a column's positions ever drift out of a clean 0..n-1 range.
 * The supabase client must have write access to `cards`
 * (use the RLS-scoped client for the owner, or the service client in tests).
 */
export async function createCard(
  supabase: SupabaseClient,
  columnId: string,
  title: string,
): Promise<CardRow> {
  const { data: last } = await supabase
    .from('cards')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPosition = last ? last.position + 1 : 0

  const { data, error } = await supabase
    .from('cards')
    .insert({ column_id: columnId, title, position: nextPosition })
    .select('id,title,due_date,assignee_id,position,card_labels(label_id)')
    .single()

  if (error) throw error
  return data as CardRow
}

/**
 * Move a card to toColumnId and re-sequence positions.
 *
 * - `destOrderedIds`: the complete ordered list of the DESTINATION column's
 *   card ids *after* the move (including cardId itself).
 * - `sourceOrderedIds` (optional): the SOURCE column's remaining ordered ids
 *   after the card left. Pass it for a cross-column move so the source column's
 *   positions stay contiguous (0,1,2,…) instead of leaving a gap. Omit (or pass
 *   []) for a same-column reorder.
 *
 * Note: this is N writes per reorder — acceptable at small scale (ponytail).
 */
export async function moveCard(
  supabase: SupabaseClient,
  cardId: string,
  toColumnId: string,
  destOrderedIds: string[],
  sourceOrderedIds: string[] = [],
): Promise<void> {
  const { error: moveErr } = await supabase
    .from('cards')
    .update({ column_id: toColumnId })
    .eq('id', cardId)
  if (moveErr) throw moveErr

  const updates = [
    ...reorderPositions(destOrderedIds),
    ...reorderPositions(sourceOrderedIds),
  ]
  for (const { id, position } of updates) {
    const { error } = await supabase.from('cards').update({ position }).eq('id', id)
    if (error) throw error
  }
}

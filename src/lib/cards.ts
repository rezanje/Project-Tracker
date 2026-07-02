import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardRow } from '#/lib/board-data'

/**
 * Update card fields (title, description, due_date, assignee_id).
 * Uses the RLS-scoped client so Postgres owner-write policy is enforced.
 */
export async function updateCard(
  supabase: SupabaseClient,
  cardId: string,
  fields: Partial<{ title: string; description: string | null; due_date: string | null; assignee_id: string | null; category: string | null }>,
): Promise<void> {
  const { error } = await supabase.from('cards').update(fields).eq('id', cardId)
  if (error) throw error
}

/**
 * Delete a card. Comments, labels and attachments cascade via their FK
 * `on delete cascade`. RLS restricts this to the board owner.
 */
export async function deleteCard(supabase: SupabaseClient, cardId: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('id', cardId)
  if (error) throw error
}

/**
 * Replace a card's labels (delete-then-insert).
 * An empty labelIds array clears all labels.
 */
export async function setCardLabels(
  supabase: SupabaseClient,
  cardId: string,
  labelIds: string[],
): Promise<void> {
  const { error: delErr } = await supabase.from('card_labels').delete().eq('card_id', cardId)
  if (delErr) throw delErr
  if (labelIds.length) {
    const { error: insErr } = await supabase
      .from('card_labels')
      .insert(labelIds.map((label_id) => ({ card_id: cardId, label_id })))
    if (insErr) throw insErr
  }
}

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
  extra: {
    description?: string | null
    due_date?: string | null
    assignee_id?: string | null
    category?: string | null
  } = {},
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
    .insert({ column_id: columnId, title, position: nextPosition, ...extra })
    .select('id,title,description,due_date,assignee_id,category,position,card_labels(label_id)')
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

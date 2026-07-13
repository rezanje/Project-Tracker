import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal note create/update/delete. RLS (notes_own) scopes all three to
 *  user_id = auth.uid(), so no ownership check is needed here beyond passing
 *  the caller's id on create. */
export async function createNote(
  supabase: SupabaseClient,
  userId: string,
  body: string,
  category: string | null = null,
): Promise<void> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, body, category })
  if (error) throw error
}

export async function updateNote(
  supabase: SupabaseClient,
  noteId: string,
  body: string,
  category: string | null,
): Promise<void> {
  const { error } = await supabase.from('notes').update({ body, category }).eq('id', noteId)
  if (error) throw error
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', noteId)
  if (error) throw error
}

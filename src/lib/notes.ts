import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal note create/delete. RLS (notes_own) scopes both to user_id = auth.uid(),
 *  so no ownership check is needed here beyond passing the caller's id. */
export async function createNote(supabase: SupabaseClient, userId: string, body: string): Promise<void> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, body })
  if (error) throw error
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', noteId)
  if (error) throw error
}

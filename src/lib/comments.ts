import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Insert a comment on a card. RLS restricts inserts to board members with
 * author_id = auth.uid(), so call this with an authenticated (RLS) client.
 */
export async function addComment(
  supabase: SupabaseClient,
  cardId: string,
  authorId: string,
  body: string,
) {
  const { error } = await supabase
    .from('comments')
    .insert({ card_id: cardId, author_id: authorId, body })
  if (error) throw error
}

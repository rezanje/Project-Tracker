import type { SupabaseClient } from '@supabase/supabase-js'

export type Attachment = {
  id: string
  card_id: string
  path: string
  filename: string
  uploaded_by: string
  created_at: string
}

/**
 * Upload a file to the card-files Storage bucket and insert an attachments row.
 * Must be called with an authenticated (RLS) browser client.
 * Path format: {boardId}/{cardId}/{uuid}-{filename}
 */
export async function uploadAttachment(
  supabase: SupabaseClient,
  boardId: string,
  cardId: string,
  file: File,
): Promise<Attachment> {
  const path = `${boardId}/${cardId}/${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from('card-files').upload(path, file)
  if (uploadError) throw uploadError

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    await supabase.storage.from('card-files').remove([path])
    throw new Error('not signed in')
  }

  const { data, error: insertError } = await supabase
    .from('attachments')
    .insert({ card_id: cardId, path, filename: file.name, uploaded_by: user.id })
    .select()
    .single()
  if (insertError) {
    // Avoid orphaning the uploaded object if the row insert fails.
    await supabase.storage.from('card-files').remove([path])
    throw insertError
  }

  return data as Attachment
}

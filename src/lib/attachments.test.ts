import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { uploadAttachment } from './attachments'

// Creds from gitignored .dev.vars (keeps service_role key out of the repo).
const env = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

test('uploadAttachment stores file in Storage and inserts an attachments row (RLS path)', async () => {
  const email = `attach.${Date.now()}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Attacher' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  let uploadedPath: string | undefined
  try {
    // Create board (owner membership trigger auto-fires).
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Attach Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: col } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'To Do', position: 0 })
      .select('id')
      .single()
    const { data: card } = await admin
      .from('cards')
      .insert({ column_id: col!.id, title: 'Card', position: 0 })
      .select('id')
      .single()
    const cardId = card!.id

    // Sign in as the member (owner) to exercise real RLS + Storage policies.
    const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
    await userClient.auth.signInWithPassword({ email, password })

    // Node 22 has File/Blob as globals.
    const file = new File(['hello attachment'], 'note.txt', { type: 'text/plain' })
    const row = await uploadAttachment(userClient, boardId!, cardId, file)

    uploadedPath = row.path

    // Verify returned row shape.
    expect(row.card_id).toBe(cardId)
    expect(row.filename).toBe('note.txt')
    expect(row.uploaded_by).toBe(uid)
    expect(row.path).toMatch(new RegExp(`^${boardId}/${cardId}/`))

    // Confirm DB row persisted (checked via admin to bypass any caching).
    const { data: rows } = await admin
      .from('attachments')
      .select('id, card_id, filename, uploaded_by, path')
      .eq('card_id', cardId)
    expect(rows).toHaveLength(1)
    expect(rows![0].filename).toBe('note.txt')
    expect(rows![0].uploaded_by).toBe(uid)

    // Verify the file is retrievable via signed URL.
    const { data: urlData } = await userClient.storage
      .from('card-files')
      .createSignedUrl(row.path, 60)
    expect(urlData?.signedUrl).toBeTruthy()

    // Fetch the signed URL to confirm the bytes match.
    const resp = await fetch(urlData!.signedUrl)
    expect(resp.ok).toBe(true)
    const text = await resp.text()
    expect(text).toBe('hello attachment')
  } finally {
    // Clean up Storage object first, then cascade-delete removes DB rows.
    if (uploadedPath) {
      await admin.storage.from('card-files').remove([uploadedPath])
    }
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 40000)

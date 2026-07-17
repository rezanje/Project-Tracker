// src/lib/notifications.test.ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'

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

async function makeSignedInUser(prefix: string) {
  const email = `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const password = 'Babikeguling1!'
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: prefix },
  })
  const uid = u.user!.id
  const userClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!)
  await userClient.auth.signInWithPassword({ email, password })
  return { uid, userClient }
}

/** Board owned by `ownerUid`, one column, one card assigned to `assigneeUid` (or null). */
async function boardWithCard(ownerUid: string, assigneeUid: string | null) {
  const { data: board } = await admin
    .from('boards')
    .insert({ owner_id: ownerUid, title: `Notif Board ${Date.now()}` })
    .select('id')
    .single()
  const boardId = board!.id as string
  const { data: col } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0 })
    .select('id')
    .single()
  const { data: card } = await admin
    .from('cards')
    .insert({ column_id: col!.id, title: 'Task', position: 0, assignee_id: assigneeUid })
    .select('id')
    .single()
  return { boardId, columnId: col!.id as string, cardId: card!.id as string }
}

async function addMember(boardId: string, userId: string) {
  await admin.from('board_members').insert({ board_id: boardId, user_id: userId, role: 'client' })
}

async function cleanup(boardId: string, ...uids: string[]) {
  await admin.from('boards').delete().eq('id', boardId) // cascades columns/cards/comments/notifications
  for (const uid of uids) await admin.auth.admin.deleteUser(uid)
}

test('@mention creates a mention notification for the matched board member', async () => {
  const author = await makeSignedInUser('mention-author')
  const target = await makeSignedInUser('mention-target')
  const { boardId, cardId } = await boardWithCard(author.uid, null)
  await addMember(boardId, target.uid)
  try {
    await author.userClient
      .from('comments')
      .insert({ card_id: cardId, author_id: author.uid, body: `@mention-target check this out` })

    const { data: rows } = await admin
      .from('notifications')
      .select('kind, message')
      .eq('user_id', target.uid)
      .eq('card_id', cardId)
    expect(rows).toHaveLength(1)
    expect(rows![0].kind).toBe('mention')
    expect(rows![0].message).toContain('mentioned you')
  } finally {
    await cleanup(boardId, author.uid, target.uid)
  }
}, 25000)

test('comment author is never notified even mentioning their own name', async () => {
  const author = await makeSignedInUser('self-mention')
  const { boardId, cardId } = await boardWithCard(author.uid, null)
  try {
    await author.userClient
      .from('comments')
      .insert({ card_id: cardId, author_id: author.uid, body: `@self-mention hello self` })

    const { data: rows } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', author.uid)
      .eq('card_id', cardId)
    expect(rows).toHaveLength(0)
  } finally {
    await cleanup(boardId, author.uid)
  }
}, 25000)

test('a plain comment on an assigned card notifies the assignee without an @mention', async () => {
  const author = await makeSignedInUser('assignee-notify-author')
  const assignee = await makeSignedInUser('assignee-notify-target')
  const { boardId, cardId } = await boardWithCard(author.uid, assignee.uid)
  await addMember(boardId, assignee.uid)
  try {
    await author.userClient
      .from('comments')
      .insert({ card_id: cardId, author_id: author.uid, body: 'no mention here' })

    const { data: rows } = await admin
      .from('notifications')
      .select('kind, message')
      .eq('user_id', assignee.uid)
      .eq('card_id', cardId)
      .eq('kind', 'mention')
    expect(rows).toHaveLength(1)
    expect(rows![0].kind).toBe('mention')
    expect(rows![0].message).toContain('assigned to you')
  } finally {
    await cleanup(boardId, author.uid, assignee.uid)
  }
}, 25000)

test('mentioning a name that is not a board member creates no notification', async () => {
  const author = await makeSignedInUser('nonmember-author')
  const stranger = await makeSignedInUser('nonmember-target')
  const { boardId, cardId } = await boardWithCard(author.uid, null)
  // Note: stranger is deliberately NOT added as a board_members row.
  try {
    await author.userClient
      .from('comments')
      .insert({ card_id: cardId, author_id: author.uid, body: `@nonmember-target hey` })

    const { data: rows } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', stranger.uid)
      .eq('card_id', cardId)
    expect(rows).toHaveLength(0)
  } finally {
    await cleanup(boardId, author.uid, stranger.uid)
  }
}, 25000)

test('mentioning the assignee by name produces exactly one notification, not two', async () => {
  const author = await makeSignedInUser('dedupe-author')
  const assignee = await makeSignedInUser('dedupe-target')
  const { boardId, cardId } = await boardWithCard(author.uid, assignee.uid)
  await addMember(boardId, assignee.uid)
  try {
    await author.userClient
      .from('comments')
      .insert({ card_id: cardId, author_id: author.uid, body: `@dedupe-target please check` })

    const { data: rows } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', assignee.uid)
      .eq('card_id', cardId)
      .eq('kind', 'mention')
    expect(rows).toHaveLength(1)
  } finally {
    await cleanup(boardId, author.uid, assignee.uid)
  }
}, 25000)

test('moving a card to a different column notifies the assignee', async () => {
  const owner = await makeSignedInUser('move-owner')
  const assignee = await makeSignedInUser('move-assignee')
  const { boardId, cardId } = await boardWithCard(owner.uid, assignee.uid)
  await addMember(boardId, assignee.uid)
  const { data: col2 } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'Done', position: 1 })
    .select('id')
    .single()
  try {
    await owner.userClient.from('cards').update({ column_id: col2!.id }).eq('id', cardId)

    const { data: rows } = await admin
      .from('notifications')
      .select('kind, message')
      .eq('user_id', assignee.uid)
      .eq('card_id', cardId)
      .eq('kind', 'status')
    expect(rows).toHaveLength(1)
    expect(rows![0].kind).toBe('status')
    expect(rows![0].message).toContain('To Do')
    expect(rows![0].message).toContain('Done')
  } finally {
    await cleanup(boardId, owner.uid, assignee.uid)
  }
}, 25000)

test('no status notification when the assignee moves their own card', async () => {
  const owner = await makeSignedInUser('self-move-owner')
  const { boardId, cardId } = await boardWithCard(owner.uid, owner.uid)
  const { data: col2 } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'Done', position: 1 })
    .select('id')
    .single()
  try {
    await owner.userClient.from('cards').update({ column_id: col2!.id }).eq('id', cardId)

    const { data: rows } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', owner.uid)
      .eq('card_id', cardId)
      .eq('kind', 'status')
    expect(rows).toHaveLength(0)
  } finally {
    await cleanup(boardId, owner.uid)
  }
}, 25000)

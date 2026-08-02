import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'

// Creds from gitignored .dev.vars (keeps the service_role key out of the repo).
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

/** A calendar date N days from now, in WIB. Reminders are computed from the
 *  WIB wall clock, so the UTC day would be up to 7 hours off. */
function wibPlusDays(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 + days * 86_400_000).toISOString().slice(0, 10)
}

/** The timestamp a (date, time) pair means in WIB, as epoch ms. */
function wibAt(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00+07:00`)
}

async function newUser(tag: string) {
  const { data } = await admin.auth.admin.createUser({
    email: `rem.${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: `Rem ${tag}` },
  })
  return data.user!.id
}

/** A board owned by uid with one plain column; returns both ids. The board
 *  insert trigger seeds default columns and the owner's board_members row. */
async function newBoardWithColumn(uid: string, colTitle = 'Backlog') {
  const { data: board } = await admin
    .from('boards')
    .insert({ owner_id: uid, title: 'Reminder Test Board' })
    .select('id')
    .single()
  const { data: col } = await admin
    .from('columns')
    .insert({ board_id: board!.id, title: colTitle, position: 99 })
    .select('id')
    .single()
  return { boardId: board!.id as string, columnId: col!.id as string }
}

function remindersFor(cardId: string) {
  return admin
    .from('reminders')
    .select('user_id,remind_at,message,source_key,link_path')
    .like('source_key', `duer:card:${cardId}:%`)
    .order('remind_at')
}

test('card with offsets schedules one reminder per offset', async () => {
  const uid = await newUser('card-basic')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const due = wibPlusDays(5)

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Kirim laporan',
        due_date: due,
        due_time: '14:00',
        reminder_offsets: [1440, 60],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(2)
    // Assignee IS the board owner here, so the recipient set dedupes to one.
    expect(new Set(rows!.map((r) => r.user_id))).toEqual(new Set([uid]))

    const dueMs = wibAt(due, '14:00')
    expect(Date.parse(rows![0].remind_at)).toBe(dueMs - 1440 * 60_000)
    expect(Date.parse(rows![1].remind_at)).toBe(dueMs - 60 * 60_000)
    expect(rows![1].message).toContain('Kirim laporan')
    expect(rows![1].message).toContain('1 jam')
    expect(rows![1].link_path).toBe(`/board/${boardId}`)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('missing due_time is treated as 17:00 WIB', async () => {
  const uid = await newUser('card-default-time')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const due = wibPlusDays(3)

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Tanpa jam',
        due_date: due,
        reminder_offsets: [60],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(1)
    expect(Date.parse(rows![0].remind_at)).toBe(wibAt(due, '17:00') - 60 * 60_000)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('offsets already in the past are skipped', async () => {
  const uid = await newUser('card-past')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId

    // Due tomorrow at noon WIB: "30 menit" is still ahead, "2 hari" is long gone.
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Mepet',
        due_date: wibPlusDays(1),
        due_time: '12:00',
        reminder_offsets: [2880, 30],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].source_key).toBe(`duer:card:${card!.id}:30:${uid}`)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('changing the deadline reschedules, clearing it cancels', async () => {
  const uid = await newUser('card-reschedule')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const first = wibPlusDays(5)
    const second = wibPlusDays(9)

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Geser',
        due_date: first,
        due_time: '09:00',
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    await admin.from('cards').update({ due_date: second }).eq('id', card!.id)
    const { data: moved } = await remindersFor(card!.id)
    expect(moved).toHaveLength(1)
    expect(Date.parse(moved![0].remind_at)).toBe(wibAt(second, '09:00') - 1440 * 60_000)

    await admin.from('cards').update({ due_date: null }).eq('id', card!.id)
    const { data: cleared } = await remindersFor(card!.id)
    expect(cleared).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('moving a card to a Done column cancels its reminders', async () => {
  const uid = await newUser('card-done')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: doneCol } = await admin
      .from('columns')
      .insert({ board_id: boardId, title: 'Done', position: 100 })
      .select('id')
      .single()

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Kelar',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect((await remindersFor(card!.id)).data).toHaveLength(1)

    await admin.from('cards').update({ column_id: doneCol!.id }).eq('id', card!.id)
    expect((await remindersFor(card!.id)).data).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('reminders go to the assignee and every board owner', async () => {
  const owner = await newUser('card-owner')
  const worker = await newUser('card-worker')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(owner)
    boardId = b.boardId
    await admin.from('board_members').insert({ board_id: boardId, user_id: worker, role: 'member' })

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Berdua',
        due_date: wibPlusDays(6),
        reminder_offsets: [1440],
        assignee_id: worker,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(2)
    expect(new Set(rows!.map((r) => r.user_id))).toEqual(new Set([owner, worker]))
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner)
    await admin.auth.admin.deleteUser(worker)
  }
})

test('deleting a card leaves no orphaned reminders', async () => {
  const uid = await newUser('card-delete')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Buang',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect((await remindersFor(card!.id)).data).toHaveLength(1)

    await admin.from('cards').delete().eq('id', card!.id)
    expect((await remindersFor(card!.id)).data).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('an offset outside the allowed set is rejected', async () => {
  const uid = await newUser('card-bad-offset')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { error } = await admin.from('cards').insert({
      column_id: b.columnId,
      title: 'Offset ngawur',
      due_date: wibPlusDays(4),
      reminder_offsets: [45],
      position: 0,
    })
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('cards_reminder_offsets_check')

    // Positive control: the same insert with a permitted offset must succeed,
    // or the assertion above could be passing for the wrong reason.
    const { error: okErr } = await admin.from('cards').insert({
      column_id: b.columnId,
      title: 'Offset bener',
      due_date: wibPlusDays(4),
      reminder_offsets: [30],
      position: 1,
    })
    expect(okErr).toBeNull()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('an archived board schedules nothing', async () => {
  const uid = await newUser('card-archived')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    await admin.from('boards').update({ status: 'archived' }).eq('id', boardId)

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Diarsipkan',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    expect((await remindersFor(card!.id)).data).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('a reminder that already fired survives an unrelated edit', async () => {
  const uid = await newUser('card-fired')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Judul lama',
        due_date: wibPlusDays(2),
        due_time: '12:00',
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    // Simulate the emailer having sent it: the row is now history, not a
    // pending job, and the bell still shows it until dismissed.
    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(1)
    await admin
      .from('reminders')
      .update({ emailed_at: new Date().toISOString() })
      .eq('source_key', rows![0].source_key)

    // An edit that does not move the deadline must not wipe it.
    await admin.from('cards').update({ title: 'Judul baru' }).eq('id', card!.id)
    const { data: after } = await remindersFor(card!.id)
    expect(after).toHaveLength(1)
    expect(after![0].message).toContain('Judul baru')
    const { data: still } = await admin
      .from('reminders')
      .select('emailed_at')
      .eq('source_key', rows![0].source_key)
      .single()
    expect(still!.emailed_at).not.toBeNull()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

function remindersForTask(taskId: string) {
  return admin
    .from('reminders')
    .select('user_id,remind_at,message,source_key,link_path')
    .like('source_key', `duer:standalone:${taskId}:%`)
    .order('remind_at')
}

test('standalone task schedules reminders for its owner', async () => {
  const uid = await newUser('sa-basic')
  try {
    const due = wibPlusDays(4)
    const { data: task } = await admin
      .from('standalone_tasks')
      .insert({
        user_id: uid,
        title: 'Bayar listrik',
        due_date: due,
        due_time: '08:30',
        reminder_offsets: [1440, 30],
      })
      .select('id')
      .single()

    const { data: rows } = await remindersForTask(task!.id)
    expect(rows).toHaveLength(2)
    expect(rows!.every((r) => r.user_id === uid)).toBe(true)
    expect(Date.parse(rows![0].remind_at)).toBe(wibAt(due, '08:30') - 1440 * 60_000)
    expect(rows![1].message).toContain('30 menit')
    expect(rows![1].link_path).toBe('/my-tasks')
  } finally {
    await admin.auth.admin.deleteUser(uid)
  }
})

test('completing a standalone task cancels its reminders', async () => {
  const uid = await newUser('sa-done')
  try {
    const { data: task } = await admin
      .from('standalone_tasks')
      .insert({
        user_id: uid,
        title: 'Beresin',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
      })
      .select('id')
      .single()
    expect((await remindersForTask(task!.id)).data).toHaveLength(1)

    await admin.from('standalone_tasks').update({ done: true }).eq('id', task!.id)
    expect((await remindersForTask(task!.id)).data).toHaveLength(0)
  } finally {
    await admin.auth.admin.deleteUser(uid)
  }
})

test('deleting a standalone task leaves no orphaned reminders', async () => {
  const uid = await newUser('sa-delete')
  try {
    const { data: task } = await admin
      .from('standalone_tasks')
      .insert({
        user_id: uid,
        title: 'Hapus',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
      })
      .select('id')
      .single()
    expect((await remindersForTask(task!.id)).data).toHaveLength(1)

    await admin.from('standalone_tasks').delete().eq('id', task!.id)
    expect((await remindersForTask(task!.id)).data).toHaveLength(0)
  } finally {
    await admin.auth.admin.deleteUser(uid)
  }
})

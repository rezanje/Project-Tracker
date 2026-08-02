import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { REMINDER_OFFSETS } from './board-data'

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

test('clearing every offset cancels a card\'s reminders', async () => {
  const uid = await newUser('card-clear-offsets')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Kosongkan offset',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect((await remindersFor(card!.id)).data).toHaveLength(1)

    // The path a user hits by un-ticking their last reminder chip.
    await admin.from('cards').update({ reminder_offsets: null }).eq('id', card!.id)
    expect((await remindersFor(card!.id)).data).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('removing one offset keeps the reminder for the rest', async () => {
  const uid = await newUser('card-partial-offset')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Offset sebagian',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440, 60],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect((await remindersFor(card!.id)).data).toHaveLength(2)

    // Only the case where the sweep must delete some rows and keep others.
    await admin.from('cards').update({ reminder_offsets: [60] }).eq('id', card!.id)
    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(1)
    expect(rows![0].source_key.endsWith(`:60:${uid}`)).toBe(true)
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

test('reassigning a card sweeps the old assignee\'s pending reminder', async () => {
  const owner = await newUser('card-reassign-owner')
  const member = await newUser('card-reassign-member')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(owner)
    boardId = b.boardId
    await admin.from('board_members').insert({ board_id: boardId, user_id: member, role: 'member' })

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Pindah tangan',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: member,
        position: 0,
      })
      .select('id')
      .single()

    const { data: before } = await remindersFor(card!.id)
    expect(new Set(before!.map((r) => r.user_id))).toEqual(new Set([owner, member]))

    // The "email to the wrong person" case: reassigning must cancel the
    // former assignee's pending row, not just add one for the new assignee.
    await admin.from('cards').update({ assignee_id: owner }).eq('id', card!.id)
    const { data: after } = await remindersFor(card!.id)
    expect(after!.some((r) => r.user_id === member)).toBe(false)
    expect(after!.some((r) => r.user_id === owner)).toBe(true)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner)
    await admin.auth.admin.deleteUser(member)
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

    // Stamp it as sent first: a deleted card takes its reminders with it,
    // sent or not, so this must not be passing merely because the DELETE
    // branch happens to share the update path's `emailed_at is null` filter.
    await admin
      .from('reminders')
      .update({ emailed_at: new Date().toISOString() })
      .like('source_key', `duer:card:${card!.id}:%`)

    await admin.from('cards').delete().eq('id', card!.id)
    expect((await remindersFor(card!.id)).data).toHaveLength(0)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('duplicate offsets collapse instead of failing the save', async () => {
  const uid = await newUser('card-dupe')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card, error } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Offset dobel',
        due_date: wibPlusDays(4),
        reminder_offsets: [60, 60],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect((await remindersFor(card!.id)).data).toHaveLength(1)
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
  let activeBoardId: string | undefined
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

    // Positive control: an identical card on a board that is NOT archived
    // must schedule, or this test would pass even with the trigger dropped.
    const active = await newBoardWithColumn(uid)
    activeBoardId = active.boardId
    const { data: activeCard } = await admin
      .from('cards')
      .insert({
        column_id: active.columnId,
        title: 'Aktif',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()
    expect((await remindersFor(activeCard!.id)).data).toHaveLength(1)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (activeBoardId) await admin.from('boards').delete().eq('id', activeBoardId)
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

test('moving the deadline re-arms a reminder that already fired', async () => {
  const uid = await newUser('card-rearm')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Digeser',
        due_date: wibPlusDays(2),
        due_time: '12:00',
        reminder_offsets: [1440],
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(1)
    const key = rows![0].source_key
    await admin.from('reminders').update({ emailed_at: new Date().toISOString() }).eq('source_key', key)

    const moved = wibPlusDays(6)
    await admin.from('cards').update({ due_date: moved }).eq('id', card!.id)

    const { data: after } = await admin
      .from('reminders')
      .select('remind_at,emailed_at')
      .eq('source_key', key)
      .single()
    expect(after!.emailed_at).toBeNull()
    expect(Date.parse(after!.remind_at)).toBe(wibAt(moved, '12:00') - 1440 * 60_000)
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test(
  'a reminder whose time has arrived is not swept by an unrelated edit',
  async () => {
    const uid = await newUser('card-sweep-window')
    let boardId: string | undefined
    try {
      const b = await newBoardWithColumn(uid)
      boardId = b.boardId

      // Schedule the reminder to land a few seconds from now (30-minute
      // offset, due_time picked so remind_at is ~5s out), wait for that
      // moment to actually pass, then fire the trigger with an edit that has
      // nothing to do with the deadline. This is the regression case for the
      // 0045 fix: the instant remind_at passes, the offset drops out of the
      // freshly recomputed "wanted" set on its own, even though the mailer
      // hasn't run yet — before 0045 the sweep read that as "cancelled" and
      // deleted a reminder that was never sent.
      const wibNow = new Date(Date.now() + 7 * 3600 * 1000)
      const dueAt = new Date(wibNow.getTime() + 30 * 60_000 + 5000)
      const { data: card } = await admin
        .from('cards')
        .insert({
          column_id: b.columnId,
          title: 'Waktu tiba',
          due_date: dueAt.toISOString().slice(0, 10),
          due_time: dueAt.toISOString().slice(11, 19),
          reminder_offsets: [30],
          assignee_id: uid,
          position: 0,
        })
        .select('id')
        .single()

      const { data: before } = await remindersFor(card!.id)
      expect(before).toHaveLength(1)

      await new Promise((r) => setTimeout(r, 7000))

      await admin.from('cards').update({ title: 'Waktu tiba (edited)' }).eq('id', card!.id)

      const { data: after } = await remindersFor(card!.id)
      expect(after).toHaveLength(1)
      const { data: full } = await admin
        .from('reminders')
        .select('emailed_at')
        .eq('source_key', before![0].source_key)
        .single()
      expect(full!.emailed_at).toBeNull()
    } finally {
      if (boardId) await admin.from('boards').delete().eq('id', boardId)
      await admin.auth.admin.deleteUser(uid)
    }
  },
  20_000,
)

test('the offset vocabulary agrees across board-data, the CHECK constraint, and the label function', async () => {
  const uid = await newUser('card-vocab')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId

    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Semua offset',
        due_date: wibPlusDays(5),
        due_time: '23:59',
        reminder_offsets: REMINDER_OFFSETS.map((o) => o.mins),
        assignee_id: uid,
        position: 0,
      })
      .select('id')
      .single()

    const { data: rows } = await remindersFor(card!.id)
    expect(rows).toHaveLength(REMINDER_OFFSETS.length)
    for (const { mins, label } of REMINDER_OFFSETS) {
      const row = rows!.find((r) => r.source_key.endsWith(`:${mins}:${uid}`))
      expect(row).toBeTruthy()
      expect(row!.message).toContain(label)
    }
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

test('clearing every offset cancels a standalone task\'s reminders', async () => {
  const uid = await newUser('sa-clear-offsets')
  try {
    const { data: task } = await admin
      .from('standalone_tasks')
      .insert({
        user_id: uid,
        title: 'Kosongkan offset pribadi',
        due_date: wibPlusDays(4),
        reminder_offsets: [1440],
      })
      .select('id')
      .single()
    expect((await remindersForTask(task!.id)).data).toHaveLength(1)

    await admin.from('standalone_tasks').update({ reminder_offsets: null }).eq('id', task!.id)
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

    // Stamp it as sent first: a deleted task takes its reminders with it,
    // sent or not, so this must not be passing merely because the DELETE
    // branch happens to share the update path's `emailed_at is null` filter.
    await admin
      .from('reminders')
      .update({ emailed_at: new Date().toISOString() })
      .like('source_key', `duer:standalone:${task!.id}:%`)

    await admin.from('standalone_tasks').delete().eq('id', task!.id)
    expect((await remindersForTask(task!.id)).data).toHaveLength(0)
  } finally {
    await admin.auth.admin.deleteUser(uid)
  }
})

test('updateCard writes due_time and reminder_offsets', async () => {
  const { updateCard } = await import('./cards')
  const uid = await newUser('roundtrip')
  let boardId: string | undefined
  try {
    const b = await newBoardWithColumn(uid)
    boardId = b.boardId
    const { data: card } = await admin
      .from('cards')
      .insert({ column_id: b.columnId, title: 'Round trip', position: 0 })
      .select('id')
      .single()

    await updateCard(admin, card!.id, {
      due_date: wibPlusDays(3),
      due_time: '09:15',
      reminder_offsets: [60],
    })

    const { data: read } = await admin
      .from('cards')
      .select('due_time,reminder_offsets')
      .eq('id', card!.id)
      .single()
    expect(read!.due_time).toBe('09:15:00')
    expect(read!.reminder_offsets).toEqual([60])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})

test('updateStandaloneTask writes the deadline and schedules reminders', async () => {
  const { updateStandaloneTask, deleteStandaloneTask } = await import('./standalone-tasks')
  const uid = await newUser('sa-update')
  try {
    const { data: task } = await admin
      .from('standalone_tasks')
      .insert({ user_id: uid, title: 'Pribadi' })
      .select('id')
      .single()

    await updateStandaloneTask(admin, uid, task!.id, {
      due_date: wibPlusDays(3),
      due_time: '10:00',
      reminder_offsets: [60],
    })
    expect((await remindersForTask(task!.id)).data).toHaveLength(1)

    await deleteStandaloneTask(admin, uid, task!.id)
    const { data: gone } = await admin.from('standalone_tasks').select('id').eq('id', task!.id)
    expect(gone).toHaveLength(0)
    expect((await remindersForTask(task!.id)).data).toHaveLength(0)
  } finally {
    await admin.auth.admin.deleteUser(uid)
  }
})

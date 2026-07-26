import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'

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

/** "Today" in WIB (UTC+7). Mirrors localDateStr() semantics: due dates are plain
 *  calendar dates, so the UTC day would mis-bucket by up to 7 hours. The Edge
 *  Function computes today the same way. */
function wibToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

function wibPlusDays(days: number): string {
  return wibToday(new Date(Date.now() + days * 86_400_000))
}

/** The card "is done" rule, copied from isDoneColumn() in src/lib/home.ts. */
function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

test('standalone selection picks only not-done tasks due today', async () => {
  const email = `due.standalone.${Date.now()}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Due Standalone' },
  })
  const uid = u.user!.id
  try {
    await admin.from('standalone_tasks').insert([
      { user_id: uid, title: 'due today open', due_date: wibToday(), done: false },
      { user_id: uid, title: 'due today done', due_date: wibToday(), done: true },
      { user_id: uid, title: 'due tomorrow', due_date: wibPlusDays(1), done: false },
      { user_id: uid, title: 'no due date', due_date: null, done: false },
    ])

    // The Edge Function's standalone query.
    const { data: picked, error } = await admin
      .from('standalone_tasks')
      .select('id,user_id,title')
      .eq('done', false)
      .eq('due_date', wibToday())
      .eq('user_id', uid)

    expect(error).toBeNull()
    expect(picked!.map((r) => r.title)).toEqual(['due today open'])
  } finally {
    await admin.from('standalone_tasks').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test('card selection skips done columns, unassigned cards, and archived boards', async () => {
  const email = `due.card.${Date.now()}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: 'Due Card' },
  })
  const uid = u.user!.id
  let boardId: string | undefined
  let archivedBoardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Due Board' })
      .select('id')
      .single()
    boardId = board!.id

    const { data: cols } = await admin
      .from('columns')
      .insert([
        { board_id: boardId, title: 'In Progress', position: 0 },
        { board_id: boardId, title: 'Done', position: 1 },
      ])
      .select('id,title')
    const active = cols!.find((c) => c.title === 'In Progress')!.id
    const doneCol = cols!.find((c) => c.title === 'Done')!.id

    const { data: archBoard } = await admin
      .from('boards')
      .insert({ owner_id: uid, title: 'Archived Board', status: 'archived' })
      .select('id')
      .single()
    archivedBoardId = archBoard!.id
    const { data: archCol } = await admin
      .from('columns')
      .insert({ board_id: archivedBoardId, title: 'Todo', position: 0 })
      .select('id')
      .single()

    await admin.from('cards').insert([
      { column_id: active, title: 'pick me', due_date: wibToday(), assignee_id: uid, position: 0 },
      { column_id: active, title: 'unassigned', due_date: wibToday(), assignee_id: null, position: 1 },
      { column_id: active, title: 'due tomorrow', due_date: wibPlusDays(1), assignee_id: uid, position: 2 },
      { column_id: doneCol, title: 'already done', due_date: wibToday(), assignee_id: uid, position: 0 },
      { column_id: archCol!.id, title: 'archived board', due_date: wibToday(), assignee_id: uid, position: 0 },
    ])

    // The Edge Function's card query: filter what SQL can, then apply the
    // done-column and archived-board rules in JS (same regex as isDoneColumn).
    const { data: rows, error } = await admin
      .from('cards')
      .select('id,title,assignee_id,columns!inner(title,boards!inner(id,title,status))')
      .eq('due_date', wibToday())
      .not('assignee_id', 'is', null)
      .eq('assignee_id', uid)

    expect(error).toBeNull()
    const picked = (rows ?? []).filter((r) => {
      const col = r.columns as unknown as { title: string; boards: { status: string } }
      return !isDoneColumn(col.title) && col.boards.status !== 'archived'
    })

    expect(picked.map((r) => r.title)).toEqual(['pick me'])
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    if (archivedBoardId) await admin.from('boards').delete().eq('id', archivedBoardId)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

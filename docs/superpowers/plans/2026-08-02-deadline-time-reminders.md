# Timed Deadlines + Opt-In Reminder Emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task carry a time-of-day alongside its deadline, and let the user pick per-task reminder offsets (2 days / 1 day / 2 hours / 1 hour / 30 minutes) that email the assignee and board owners before it comes due.

**Architecture:** `due_date` stays a Postgres `date`; a new nullable `due_time` column carries the hour, so the ~40 places that compare due dates as `'YYYY-MM-DD'` strings keep working. Chosen offsets live in an `int[]` column on the task. Database triggers translate `(due_date, due_time, reminder_offsets)` into rows in the existing `reminders` table, so every write path — server function, quick form, drag handler — is covered without touching any of them. From there the existing per-minute `send-reminders` cron does the emailing unchanged.

**Tech Stack:** Postgres (Supabase, remote-only), plpgsql triggers, pg_cron, Deno edge functions, TanStack Start server functions, React 19, Tailwind, vitest (integration tests hit the real remote DB).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-deadline-time-reminders-design.md`.
- Allowed offsets, in minutes: **`30, 60, 120, 1440, 2880`**. Nothing else is valid.
- Offset labels (Indonesian, used in chips and email copy): `30 → "30 menit"`, `60 → "1 jam"`, `120 → "2 jam"`, `1440 → "1 hari"`, `2880 → "2 hari"`.
- Default time when `due_time` is null: **`17:00`** in timezone **`Asia/Jakarta`**.
- Reminder `source_key` formats: `duer:card:<card_id>:<offset>:<user_id>` and `duer:standalone:<task_id>:<offset>:<user_id>`.
- Reminder recipients: card = assignee ∪ board members with `role = 'owner'`, deduplicated. Standalone task = its `user_id`.
- Offsets whose computed time is already in the past are skipped silently — not an error.
- UI copy is Indonesian, informal (`gue`/`lo` register elsewhere in the app; labels here are plain nouns).
- Typecheck gate: `npx tsc --noEmit -p .` must print `TypeScript: No errors found`. There is no ESLint config.
- Migrations are **not** applied by `npm run deploy`. Each migration task ends with a human-gated apply step (see "Applying migrations" below).

## Applying migrations

This project has no local Postgres. Every migration in this plan must be applied to the remote Supabase project (`tzhquesopfxevsucoapb`) before its tests can pass.

Preferred: the Supabase MCP tool `apply_migration` (name + SQL, no password needed). Ask the user to confirm before applying — it writes to the production database.

Fallback if that tool is unavailable: hand the SQL to the user to paste into Supabase Dashboard → SQL Editor → Run, then have them run
`npx supabase migration repair --status applied <NNNN> --db-url "<pooler-url>"`.
The DB password is the user's secret. Never ask for it and never run a migration with it on their behalf.

Do not use `--include-all` on repair: two files share the `0011` prefix and it mis-applies them.

---

## Task 1: Schema + card reminder trigger

Adds the columns to both task tables, the `link_path` column to `reminders`, the shared label function, and the trigger that keeps a card's reminders in sync.

**Files:**
- Create: `supabase/migrations/0040_task_due_time_reminders.sql`
- Create: `src/lib/task-reminders.test.ts`

**Interfaces:**
- Consumes: existing tables `cards`, `standalone_tasks`, `reminders`, `board_members`, `columns`, `boards`.
- Produces:
  - `cards.due_time time null`, `cards.reminder_offsets int[] null`
  - `standalone_tasks.due_time time null`, `standalone_tasks.reminder_offsets int[] null`
  - `reminders.link_path text null`
  - SQL function `reminder_offset_label(mins int) returns text`
  - SQL function `sync_card_reminders() returns trigger`
  - Triggers `cards_sync_reminders` (insert/update) and `cards_sync_reminders_delete` (delete) on `cards`

- [ ] **Step 1: Write the failing test**

Create `src/lib/task-reminders.test.ts`:

```ts
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

    // Due today at 23:59 WIB: "30 menit" is still ahead, "2 hari" is long gone.
    const { data: card } = await admin
      .from('cards')
      .insert({
        column_id: b.columnId,
        title: 'Mepet',
        due_date: wibPlusDays(0),
        due_time: '23:59',
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
    expect(error).toBeTruthy()
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(uid)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/task-reminders.test.ts`
Expected: FAIL — every test errors on the unknown `due_time` / `reminder_offsets` columns (PostgREST `PGRST204`, "Could not find the 'due_time' column of 'cards' in the schema cache").

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0040_task_due_time_reminders.sql`:

```sql
-- Timed deadlines + opt-in reminders.
--
-- due_date stays a plain `date`: it is compared as a 'YYYY-MM-DD' string in
-- ~40 places (sorting, calendar bucketing, month prefixes). The hour lives in
-- a separate nullable column that only the detail UI and this trigger read.
--
-- reminder_offsets holds minutes-before-due. The trigger below turns them into
-- rows in `reminders`, which the existing per-minute send-reminders cron (0022)
-- emails and the notifications bell already merges. No new cron, no new mailer.

alter table cards add column if not exists due_time time;
alter table cards add column if not exists reminder_offsets int[];
alter table standalone_tasks add column if not exists due_time time;
alter table standalone_tasks add column if not exists reminder_offsets int[];

-- Where the reminder email should land. Null falls back to /home, so existing
-- rows and user-created reminders (QuickReminderForm) are unaffected.
alter table reminders add column if not exists link_path text;

do $$ begin
  alter table cards add constraint cards_reminder_offsets_check
    check (reminder_offsets is null or reminder_offsets <@ array[30, 60, 120, 1440, 2880]);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table standalone_tasks add constraint standalone_tasks_reminder_offsets_check
    check (reminder_offsets is null or reminder_offsets <@ array[30, 60, 120, 1440, 2880]);
exception when duplicate_object then null; end $$;

-- Shared by both task triggers so the wording can't drift between them.
create or replace function reminder_offset_label(mins int) returns text
language sql immutable as $$
  select case mins
    when 2880 then '2 hari'
    when 1440 then '1 hari'
    when 120  then '2 jam'
    when 60   then '1 jam'
    when 30   then '30 menit'
    else mins || ' menit'
  end;
$$;

-- Rebuilds a card's reminder rows from scratch on every relevant change.
-- security definer because the recipients are rarely auth.uid() — same reason
-- the notify_* triggers in 0020/0031 are.
create or replace function sync_card_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_card_id     uuid := coalesce(new.id, old.id);
  v_due_ts      timestamptz;
  v_col_title   text;
  v_board_id    uuid;
  v_board_title text;
  v_status      text;
  v_offs        int;
  v_uid         uuid;
begin
  -- The reset. Emailed rows go too: if the deadline moved, the reminder for the
  -- new deadline is a different event and should send again.
  delete from reminders where source_key like 'duer:card:' || v_card_id || ':%';

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.due_date is null or coalesce(array_length(new.reminder_offsets, 1), 0) = 0 then
    return new;
  end if;

  select c.title, b.id, b.title, b.status
    into v_col_title, v_board_id, v_board_title, v_status
  from columns c
  join boards b on b.id = c.board_id
  where c.id = new.column_id;

  -- Same rule as isDoneColumn() in src/lib/home.ts.
  if v_col_title is null or v_col_title ~* 'done|complete' or v_status = 'archived' then
    return new;
  end if;

  v_due_ts := (new.due_date + coalesce(new.due_time, time '17:00')) at time zone 'Asia/Jakarta';

  foreach v_offs in array new.reminder_offsets loop
    if v_due_ts - make_interval(mins => v_offs) > now() then
      for v_uid in
        select new.assignee_id where new.assignee_id is not null
        union
        select bm.user_id from board_members bm
        where bm.board_id = v_board_id and bm.role = 'owner'
      loop
        insert into reminders (user_id, message, remind_at, source_key, link_path)
        values (
          v_uid,
          'Deadline "' || new.title || '" ' || reminder_offset_label(v_offs)
            || ' lagi — ' || v_board_title,
          v_due_ts - make_interval(mins => v_offs),
          'duer:card:' || v_card_id || ':' || v_offs || ':' || v_uid,
          '/board/' || v_board_id
        )
        on conflict (source_key) do nothing;
      end loop;
    end if;
  end loop;

  return new;
end $$;

-- `title` is in the UPDATE OF list so a renamed task doesn't keep emailing its
-- old name. `column_id` is there so moving to Done cancels.
drop trigger if exists cards_sync_reminders on cards;
create trigger cards_sync_reminders
  after insert or update of due_date, due_time, reminder_offsets, assignee_id, column_id, title
  on cards
  for each row execute function sync_card_reminders();

drop trigger if exists cards_sync_reminders_delete on cards;
create trigger cards_sync_reminders_delete
  after delete on cards
  for each row execute function sync_card_reminders();
```

- [ ] **Step 4: Apply the migration to the remote database**

Confirm with the user first — this writes to production. Then apply with the Supabase MCP `apply_migration` tool (name `0040_task_due_time_reminders`, body = the file contents), or hand the SQL over for the dashboard route described in "Applying migrations" above.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/task-reminders.test.ts`
Expected: PASS, 8 tests.

If PostgREST still reports the columns as unknown, its schema cache is stale — wait ~30s or run `notify pgrst, 'reload schema';` in the SQL editor, then re-run.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0040_task_due_time_reminders.sql src/lib/task-reminders.test.ts
git commit -m "Give cards a time-of-day and reminder offsets

The hour goes in its own column rather than widening due_date to a
timestamp: due_date is compared as a 'YYYY-MM-DD' string in about forty
places, and none of them needed to change. A trigger turns the offsets
into rows in the reminders table that already exists, so every write
path is covered without any of them knowing about reminders."
```

---

## Task 2: Standalone task reminder trigger

Same behaviour for personal tasks. Recipient is the task's owner; the skip condition is `done` rather than a Done column.

**Files:**
- Create: `supabase/migrations/0041_standalone_task_reminders.sql`
- Modify: `src/lib/task-reminders.test.ts` (append)

**Interfaces:**
- Consumes: `reminder_offset_label(int)` and the columns from Task 1.
- Produces: SQL function `sync_standalone_reminders() returns trigger`; triggers `standalone_sync_reminders` and `standalone_sync_reminders_delete` on `standalone_tasks`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/task-reminders.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/lib/task-reminders.test.ts -t standalone`
Expected: FAIL — the first assertion gets 0 rows back, because no trigger exists yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0041_standalone_task_reminders.sql`:

```sql
-- Personal-task half of the reminder triggers (see 0040 for the card half and
-- the reasoning). Recipient is always the task's owner, and "finished" is the
-- done flag rather than a Done column.

create or replace function sync_standalone_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task_id uuid := coalesce(new.id, old.id);
  v_due_ts  timestamptz;
  v_offs    int;
begin
  delete from reminders where source_key like 'duer:standalone:' || v_task_id || ':%';

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.done
     or new.due_date is null
     or coalesce(array_length(new.reminder_offsets, 1), 0) = 0 then
    return new;
  end if;

  v_due_ts := (new.due_date + coalesce(new.due_time, time '17:00')) at time zone 'Asia/Jakarta';

  foreach v_offs in array new.reminder_offsets loop
    if v_due_ts - make_interval(mins => v_offs) > now() then
      insert into reminders (user_id, message, remind_at, source_key, link_path)
      values (
        new.user_id,
        'Deadline "' || new.title || '" ' || reminder_offset_label(v_offs) || ' lagi',
        v_due_ts - make_interval(mins => v_offs),
        'duer:standalone:' || v_task_id || ':' || v_offs || ':' || new.user_id,
        '/my-tasks'
      )
      on conflict (source_key) do nothing;
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists standalone_sync_reminders on standalone_tasks;
create trigger standalone_sync_reminders
  after insert or update of due_date, due_time, reminder_offsets, done, title
  on standalone_tasks
  for each row execute function sync_standalone_reminders();

drop trigger if exists standalone_sync_reminders_delete on standalone_tasks;
create trigger standalone_sync_reminders_delete
  after delete on standalone_tasks
  for each row execute function sync_standalone_reminders();
```

- [ ] **Step 4: Apply the migration to the remote database**

Same flow as Task 1 Step 4, migration name `0041_standalone_task_reminders`.

- [ ] **Step 5: Run the whole file to verify everything passes**

Run: `npx vitest run src/lib/task-reminders.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0041_standalone_task_reminders.sql src/lib/task-reminders.test.ts
git commit -m "Schedule reminders for personal tasks too

Same trigger shape as cards, minus the board: the owner is the only
recipient and the done flag is what cancels."
```

---

## Task 3: Retire the daily 08:00 scan, deep-link the emails

The blanket morning scan contradicts opt-in reminders and would double-send. Unschedule it. While the mailer is open, use the new `link_path` so a reminder email opens the board it came from.

**Files:**
- Create: `supabase/migrations/0042_disable_daily_due_scan.sql`
- Modify: `supabase/functions/send-reminders/index.ts:28-31` (select list) and `:69` (email body)

**Interfaces:**
- Consumes: `reminders.link_path` from Task 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0042_disable_daily_due_scan.sql`:

```sql
-- The 08:00 WIB blanket scan (0033) emailed every assignee of every task due
-- that day. Reminders are now opt-in per task (0040/0041), so the scan is both
-- redundant and a source of duplicate mail. Unscheduled, not deleted: the
-- due-reminders edge function and its tests stay in the repo, and re-enabling
-- is a one-line cron.schedule away.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scan-due-tasks') then
    perform cron.unschedule('scan-due-tasks');
  end if;
end $$;
```

- [ ] **Step 2: Apply the migration to the remote database**

Same flow as Task 1 Step 4, migration name `0042_disable_daily_due_scan`.

- [ ] **Step 3: Verify the job is gone**

Run this via the Supabase MCP `execute_sql` tool (or the dashboard SQL editor):

```sql
select jobname, schedule from cron.job order by jobname;
```

Expected: `send-reminder-emails  * * * * *` is present; `scan-due-tasks` is absent.

- [ ] **Step 4: Make reminder emails link to the task**

In `supabase/functions/send-reminders/index.ts`, add `link_path` to the select:

```ts
    const { data: due, error } = await svc
      .from('reminders')
      .select('id,user_id,message,link_path')
      .is('emailed_at', null)
      .is('dismissed_at', null)
      .lte('remind_at', new Date().toISOString())
```

and use it in the body (replacing the hardcoded `${appUrl}/home`):

```ts
          html: `<p>${r.message}</p><p><a href="${appUrl}${(r.link_path as string | null) ?? '/home'}">Open Rakit</a></p>`,
```

- [ ] **Step 5: Deploy the edge function**

Run: `npx supabase functions deploy send-reminders --no-verify-jwt`
Expected: `Deployed Functions on project tzhquesopfxevsucoapb: send-reminders`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0042_disable_daily_due_scan.sql supabase/functions/send-reminders/index.ts
git commit -m "Stop the blanket morning email, point reminders at their task

Reminders are opt-in per task now, so the 08:00 scan is duplicate mail
nobody asked for. Unscheduled rather than deleted. The mail it does send
now deep-links to the board instead of dumping you on /home."
```

---

## Task 4: Carry the new fields through the app's server layer

Nothing in TypeScript knows about `due_time` or `reminder_offsets` yet. This wires them from the database to the component boundary, with no UI change.

**Files:**
- Modify: `src/lib/board-data.ts:3-22` (type), `:165` (select list)
- Modify: `src/lib/cards.ts:11` (update field type), `:66-78` (create field type), `:92` (select list)
- Modify: `src/routes/board.$boardId.tsx:314-339` (validator whitelist)
- Modify: `src/components/CardDetail.tsx:30-47` (`onUpdateCard` prop type)

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces:
  - `CardRow` gains `due_time: string | null` and `reminder_offsets: number[] | null`
  - `REMINDER_OFFSETS: ReadonlyArray<{ mins: number; label: string }>` exported from `src/lib/board-data.ts`
  - `updateCardFn` accepts `due_time` and `reminder_offsets` in `fields`

- [ ] **Step 1: Add the fields to `CardRow` and the shared offset list**

In `src/lib/board-data.ts`, extend the type (after `due_date` on line 7):

```ts
export type CardRow = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  /** Local (WIB) time-of-day, 'HH:MM' or 'HH:MM:SS'. Null means 17:00. */
  due_time: string | null
  /** Minutes-before-due to remind at. Only 30/60/120/1440/2880 are valid. */
  reminder_offsets: number[] | null
  assignee_id: string | null
```

and add the shared vocabulary next to `CONTENT_CHANNELS` (around line 26):

```ts
/** The reminder offsets a user can pick, longest first — one source for the
 *  chips in both task detail sheets. Mirrors reminder_offset_label() in
 *  migration 0040; change both together. */
export const REMINDER_OFFSETS = [
  { mins: 2880, label: '2 hari' },
  { mins: 1440, label: '1 hari' },
  { mins: 120, label: '2 jam' },
  { mins: 60, label: '1 jam' },
  { mins: 30, label: '30 menit' },
] as const
```

- [ ] **Step 2: Add the fields to every select list and write path**

`src/lib/board-data.ts:165` — the columns/cards embed. Insert `due_time,reminder_offsets` after `due_date`:

```ts
      'id,title,position,cards(id,title,description,due_date,due_time,reminder_offsets,assignee_id,category,contact,phone,source,deal_value,pillar_id,content_status,channels,format,position,card_labels(label_id),attachments(count),comments(count))',
```

`src/lib/cards.ts:11` — the `updateCard` field type:

```ts
  fields: Partial<{ title: string; description: string | null; due_date: string | null; due_time: string | null; reminder_offsets: number[] | null; assignee_id: string | null; category: string | null; contact: string | null; phone: string | null; source: string | null; deal_value: number | null; pillar_id: string | null; content_status: string | null; channels: string[] | null; format: string | null }>,
```

`src/lib/cards.ts:66-78` — the `createCard` extra type, after `due_date`:

```ts
    due_date?: string | null
    due_time?: string | null
    reminder_offsets?: number[] | null
```

`src/lib/cards.ts:92` — the insert's returning select:

```ts
    .select('id,title,description,due_date,due_time,reminder_offsets,assignee_id,category,contact,phone,source,deal_value,pillar_id,content_status,channels,format,position,card_labels(label_id)')
```

- [ ] **Step 3: Whitelist the fields in the server function**

In `src/routes/board.$boardId.tsx`, add two clauses to the `updateCardFn` validator immediately after the `due_date` clause (line 321-323):

```ts
        ...(typeof f.due_time === 'string' || f.due_time === null
          ? { due_time: f.due_time as string | null }
          : {}),
        ...((Array.isArray(f.reminder_offsets) && f.reminder_offsets.every((x) => typeof x === 'number')) ||
        f.reminder_offsets === null
          ? { reminder_offsets: f.reminder_offsets as number[] | null }
          : {}),
```

and add both to the trailing cast on line 338:

```ts
      } as Partial<{ title: string; description: string | null; due_date: string | null; due_time: string | null; reminder_offsets: number[] | null; assignee_id: string | null; category: string | null; contact: string | null; phone: string | null; source: string | null; deal_value: number | null; pillar_id: string | null; content_status: string | null; channels: string[] | null; format: string | null }>,
```

- [ ] **Step 4: Widen the CardDetail prop type**

In `src/components/CardDetail.tsx`, add to the `onUpdateCard` fields union after `due_date` (line 35):

```ts
      due_date: string | null
      due_time: string | null
      reminder_offsets: number[] | null
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Verify the fields round-trip**

Append to `src/lib/task-reminders.test.ts`:

```ts
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
```

Run: `npx vitest run src/lib/task-reminders.test.ts -t 'updateCard writes'`
Expected: PASS.

Note the `'09:15:00'` assertion: Postgres `time` renders with seconds. The UI must normalise this to `HH:MM` before feeding an `<input type="time">` — Task 5 does that.

- [ ] **Step 7: Commit**

```bash
git add src/lib/board-data.ts src/lib/cards.ts src/routes/board.\$boardId.tsx src/components/CardDetail.tsx src/lib/task-reminders.test.ts
git commit -m "Thread due_time and reminder_offsets through the card layer

Types, select lists and the update whitelist only — no UI yet."
```

---

## Task 5: Deadline time + reminder chips in the card detail sheet

**Files:**
- Modify: `src/components/CardDetail.tsx` — the deadline block (currently lines 254-292 after the earlier tap-to-edit change), the `Edit detail` disclosure's duplicate date field, and the save handler
- Test: manual, via the browser preview (this is presentation; the behaviour it drives is covered by Tasks 1-4)

**Interfaces:**
- Consumes: `REMINDER_OFFSETS` and `CardRow` from Task 4; the existing `onUpdateCard` / `onRefresh` props.
- Produces: no new exports.

- [ ] **Step 1: Replace the single-field save handler with a shared one**

`CardDetail.tsx` currently has `handleDueDateChange`. Replace it (and the `dueSaving` state it uses) with a handler that takes any deadline-shaped patch, so the date, the time and the chips all share one optimistic-save path. Add the `dueTime` and `offsets` state beside the existing `dueDate` state:

```tsx
const [dueTime, setDueTime] = useState(hhmm(card.due_time))
const [offsets, setOffsets] = useState<number[]>(card.reminder_offsets ?? [])
const [dueSaving, setDueSaving] = useState(false)

/** Postgres `time` comes back as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

/** The deadline block saves on every change — no Save button. On failure the
 *  control snaps back, matching how the status pills behave. */
async function saveDeadline(
  patch: Partial<{ due_date: string | null; due_time: string | null; reminder_offsets: number[] | null }>,
  revert: () => void,
  okMessage: string,
) {
  setDueSaving(true)
  try {
    await onUpdateCard(card.id, patch)
    toast(okMessage)
    onRefresh?.()
  } catch {
    revert()
    toast('Gagal menyimpan')
  } finally {
    setDueSaving(false)
  }
}
```

Place `hhmm` next to the existing `longDate` helper at module scope (above the component), not inside it.

- [ ] **Step 2: Render the time next to the date**

Replace the `isOwner` branch of the deadline block so the date and time sit side by side, each a visible label with a transparent native input over it:

```tsx
{isOwner ? (
  <div className={`mt-[3px] flex items-baseline gap-2 ${dueSaving ? 'opacity-60' : ''}`}>
    {/* A bare input[type=date] reads as an empty slot ("dd/mm/yyyy"), so keep
        the sentence and lay the real control over it invisibly. */}
    <div className="relative w-fit">
      <p className="text-[14.5px] font-semibold text-[var(--ink)] underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px]">
        {dueDate ? longDate(dueDate) : <span className="text-[var(--ink3)]">Belum diatur</span>}
      </p>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => {
          const prev = dueDate
          setDueDate(e.target.value)
          saveDeadline(
            { due_date: e.target.value || null },
            () => setDueDate(prev),
            e.target.value ? `Deadline: ${longDate(e.target.value)}` : 'Deadline dihapus',
          )
        }}
        disabled={dueSaving}
        aria-label="Tanggal deadline"
        className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
      />
    </div>
    {dueDate && (
      <div className="relative w-fit">
        {/* 17:00 shown in muted ink when unset — the default the reminder maths
            uses, so hiding it would make the reminder times look arbitrary. */}
        <p
          className={`text-[14.5px] font-semibold underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px] ${
            dueTime ? 'text-[var(--ink)]' : 'text-[var(--ink3)]'
          }`}
        >
          {dueTime || '17:00'}
        </p>
        <input
          type="time"
          value={dueTime}
          onChange={(e) => {
            const prev = dueTime
            setDueTime(e.target.value)
            saveDeadline(
              { due_time: e.target.value || null },
              () => setDueTime(prev),
              e.target.value ? `Jam: ${e.target.value}` : 'Jam direset ke 17:00',
            )
          }}
          disabled={dueSaving}
          aria-label="Jam deadline"
          className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
        />
      </div>
    )}
  </div>
) : (
  <p className="mt-[3px] text-[14.5px] font-semibold text-[var(--ink)]">
    {card.due_date ? (
      <>
        {longDate(card.due_date)}
        {card.due_time ? ` · ${card.due_time.slice(0, 5)}` : ''}
      </>
    ) : (
      <span className="text-[var(--ink3)]">Belum diatur</span>
    )}
  </p>
)}
```

- [ ] **Step 3: Render the reminder chips**

Immediately after the deadline block's closing `</div>` (before the `Status` section), add:

```tsx
{isOwner && dueDate && (
  <>
    <p className={`mb-[9px] mt-[18px] ${eyebrow}`}>Pengingat</p>
    <div className="flex flex-wrap gap-2">
      {REMINDER_OFFSETS.map(({ mins, label }) => {
        const on = offsets.includes(mins)
        return (
          <button
            key={mins}
            type="button"
            onClick={() => {
              const prev = offsets
              const next = on ? offsets.filter((m) => m !== mins) : [...offsets, mins]
              setOffsets(next)
              saveDeadline(
                { reminder_offsets: next.length ? next : null },
                () => setOffsets(prev),
                on ? `Pengingat ${label} dimatikan` : `Diingetin ${label} sebelum deadline`,
              )
            }}
            disabled={dueSaving}
            aria-pressed={on}
            className={`rounded-full px-3.5 py-[9px] text-[12.5px] font-bold transition active:scale-[.96] ${
              on
                ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                : 'bg-[var(--col)] text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
    <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink3)]">
      Email ke yang ditugasin dan owner project. Pengingat yang waktunya udah
      lewat dilewati.
    </p>
  </>
)}
```

Add `REMINDER_OFFSETS` to the existing import from `#/lib/board-data`.

- [ ] **Step 4: Delete the duplicate date field from `Edit detail`**

Two editors for one field is how they drift apart. In the `<details>` block, remove the `cd-due` `<div>` wrapper entirely and let the Assignee select take the full row:

```tsx
          <div className="mt-3">
            <label className={fieldLabel} htmlFor="cd-assignee">Assignee</label>
            <select
              id="cd-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="field cursor-pointer"
            >
              <option value="">Belum ditugaskan</option>
              {meta.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
```

Then drop `due_date: dueDate || null` from the `handleSave` payload — the deadline block owns that field now. Keep the `dueDate` state itself; the deadline block still uses it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Verify in the browser**

Start the preview with `preview_start` (`name: "dev"`, port 4321), open a board, open a card.

Check, in order:
1. The deadline row shows date and time side by side; time reads `17:00` in grey when unset.
2. Setting a time saves — `read_network_requests` shows `updateCardFn` → 200 followed by a `fetchBoard` refetch.
3. The `Pengingat` chips appear only once a date is set, and toggling one saves the same way.
4. `read_console_messages` shows no new errors (the dnd-kit `aria-describedby` hydration warning is pre-existing).
5. Take a screenshot of the deadline block for the user.

- [ ] **Step 7: Commit**

```bash
git add src/components/CardDetail.tsx
git commit -m "Put the hour and the reminder switches on the deadline itself

The date, the time and the reminder chips all save on change through
one path. The duplicate date input inside Edit detail is gone — one
field, one editor."
```

---

## Task 6: A detail sheet for personal tasks

Personal tasks have no edit surface at all today: `my-tasks.tsx:273-275` only navigates for tasks that belong to a board, so clicking a personal one does nothing. This adds the smallest sheet that lets the feature reach them.

**Files:**
- Create: `src/components/StandaloneTaskSheet.tsx`
- Modify: `src/lib/standalone-tasks.ts` (add update + delete helpers)
- Modify: `src/lib/actions.ts` (add the two server functions, beside `completeStandaloneTaskFn` at line 126)
- Modify: `src/lib/my-tasks.ts:4-16` (the `Task` type)
- Modify: `src/routes/my-tasks.tsx` — loader select (`:28`), the two loader mappings (`~:57` board tasks, `~:81` standalone), and `openTask` (`:273-275`)

**Interfaces:**
- Consumes: `REMINDER_OFFSETS` from Task 4; the `Sheet` primitive exported from `src/components/WorkspaceSwitcher.tsx`; the trigger from Task 2.
- Produces:
  - `updateStandaloneTask(supabase, userId, taskId, fields)` and `deleteStandaloneTask(supabase, userId, taskId)` in `src/lib/standalone-tasks.ts`
  - server functions `updateStandaloneTaskFn` and `deleteStandaloneTaskFn` exported from `src/lib/actions.ts`
  - `Task` gains `dueTime: string | null` and `offsets: number[] | null`
  - default-exported `StandaloneTaskSheet` component

Note on placement: `src/routes/my-tasks.tsx` has no `flush()` helper and does not own the `Task` type — the type lives in `src/lib/my-tasks.ts` and the sibling `completeStandaloneTaskFn` lives in `src/lib/actions.ts`. Follow that split rather than adding a second home for either.

- [ ] **Step 1: Write the failing test for the data helpers**

Append to `src/lib/task-reminders.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/task-reminders.test.ts -t updateStandaloneTask`
Expected: FAIL — `updateStandaloneTask is not a function`.

- [ ] **Step 3: Add the data helpers**

Append to `src/lib/standalone-tasks.ts`:

```ts
/** Edit a personal task's deadline and reminders. Scoped by user_id as well as
 *  id so a service-role caller can't cross accounts by mistake; RLS already
 *  covers the browser path. */
export async function updateStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  fields: Partial<{
    title: string
    due_date: string | null
    due_time: string | null
    reminder_offsets: number[] | null
    done: boolean
  }>,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .update(fields)
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/task-reminders.test.ts -t updateStandaloneTask`
Expected: PASS.

- [ ] **Step 5: Add the server functions**

In `src/lib/actions.ts`, directly after `completeStandaloneTaskFn` (which ends at line 138), add the two functions below. Extend that file's existing import from `./standalone-tasks` to also pull in `updateStandaloneTask` and `deleteStandaloneTask`; `createServerFn`, `requireUser`, `getRequest` and the local `flush()` are already imported there.

```ts
const updateStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { id, fields } = (d ?? {}) as { id?: unknown; fields?: unknown }
    if (typeof id !== 'string' || !id) throw new Error('id required')
    const f = (fields ?? {}) as Record<string, unknown>
    return {
      id,
      fields: {
        ...(typeof f.due_date === 'string' || f.due_date === null
          ? { due_date: f.due_date as string | null }
          : {}),
        ...(typeof f.due_time === 'string' || f.due_time === null
          ? { due_time: f.due_time as string | null }
          : {}),
        ...((Array.isArray(f.reminder_offsets) && f.reminder_offsets.every((x) => typeof x === 'number')) ||
        f.reminder_offsets === null
          ? { reminder_offsets: f.reminder_offsets as number[] | null }
          : {}),
      },
    }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await updateStandaloneTask(supabase, user.id, data.id, data.fields)
    flush(headers)
    return { ok: true }
  })

const deleteStandaloneTaskFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const id = (d as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) throw new Error('id required')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    await deleteStandaloneTask(supabase, user.id, data.id)
    flush(headers)
    return { ok: true }
  })
```

- [ ] **Step 6: Load the new fields**

Extend the `Task` type in `src/lib/my-tasks.ts` (after `due` on line 12):

```ts
  due: string | null
  /** Personal tasks only — board cards edit their hour in the card sheet. */
  dueTime: string | null
  offsets: number[] | null
```

In `src/routes/my-tasks.tsx`, widen the standalone select (line 28):

```ts
    .select('id,title,due_date,due_time,reminder_offsets,workspace_id,workspaces(name),done')
```

widen that loop's inline row type (around line 63) with `due_time: string | null` and `reminder_offsets: number[] | null`, and set both in the standalone `tasks.push` (around line 81):

```ts
        due: s.due_date,
        dueTime: s.due_time,
        offsets: s.reminder_offsets,
        done: s.done,
```

In the board-card `tasks.push` (around line 57), set both to `null` — the card sheet owns those:

```ts
        due: c.due_date,
        dueTime: null,
        offsets: null,
        done: colDone,
```

- [ ] **Step 7: Build the sheet**

Create `src/components/StandaloneTaskSheet.tsx`:

```tsx
import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { Sheet } from '#/components/WorkspaceSwitcher'
import { toast } from '#/components/Toast'
import { REMINDER_OFFSETS } from '#/lib/board-data'

const eyebrow =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]'

function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Postgres `time` comes back as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

/** Personal tasks have no board, so this is deliberately thin: a deadline, its
 *  reminders, and a way out. Everything saves on change. */
export default function StandaloneTaskSheet({
  task,
  onClose,
  onSaved,
  onUpdate,
  onDelete,
}: {
  task: { id: string; title: string; due: string | null; dueTime: string | null; offsets: number[] | null }
  onClose: () => void
  onSaved: () => void
  onUpdate: (
    id: string,
    fields: Partial<{ due_date: string | null; due_time: string | null; reminder_offsets: number[] | null }>,
  ) => Promise<unknown>
  onDelete: (id: string) => void
}) {
  const [dueDate, setDueDate] = useState(task.due ?? '')
  const [dueTime, setDueTime] = useState(hhmm(task.dueTime))
  const [offsets, setOffsets] = useState<number[]>(task.offsets ?? [])
  const [saving, setSaving] = useState(false)

  async function save(
    patch: Partial<{ due_date: string | null; due_time: string | null; reminder_offsets: number[] | null }>,
    revert: () => void,
    okMessage: string,
  ) {
    setSaving(true)
    try {
      await onUpdate(task.id, patch)
      toast(okMessage)
      onSaved()
    } catch {
      revert()
      toast('Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      label={task.title}
      className="max-h-[86%]"
      header={
        <div className="flex items-start gap-3">
          <span
            className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--ink3)]"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className={`truncate ${eyebrow}`}>Task pribadi</p>
            <h2 className="mt-1 text-[21px] font-extrabold leading-[1.2] tracking-[-0.03em] text-[var(--ink)]">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] transition hover:text-[var(--ink)] active:scale-[.92]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <p className={`mt-[18px] ${eyebrow}`}>Deadline</p>
      <div className={`mt-[3px] flex items-baseline gap-2 ${saving ? 'opacity-60' : ''}`}>
        <div className="relative w-fit">
          <p className="text-[14.5px] font-semibold text-[var(--ink)] underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px]">
            {dueDate ? longDate(dueDate) : <span className="text-[var(--ink3)]">Belum diatur</span>}
          </p>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              const prev = dueDate
              setDueDate(e.target.value)
              save(
                { due_date: e.target.value || null },
                () => setDueDate(prev),
                e.target.value ? `Deadline: ${longDate(e.target.value)}` : 'Deadline dihapus',
              )
            }}
            disabled={saving}
            aria-label="Tanggal deadline"
            className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
          />
        </div>
        {dueDate && (
          <div className="relative w-fit">
            <p
              className={`text-[14.5px] font-semibold underline decoration-[var(--ink3)] decoration-dotted underline-offset-[5px] ${
                dueTime ? 'text-[var(--ink)]' : 'text-[var(--ink3)]'
              }`}
            >
              {dueTime || '17:00'}
            </p>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => {
                const prev = dueTime
                setDueTime(e.target.value)
                save(
                  { due_time: e.target.value || null },
                  () => setDueTime(prev),
                  e.target.value ? `Jam: ${e.target.value}` : 'Jam direset ke 17:00',
                )
              }}
              disabled={saving}
              aria-label="Jam deadline"
              className="absolute -inset-y-2.5 inset-x-0 h-[44px] w-full cursor-pointer opacity-0"
            />
          </div>
        )}
      </div>

      {dueDate && (
        <>
          <p className={`mb-[9px] mt-[18px] ${eyebrow}`}>Pengingat</p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_OFFSETS.map(({ mins, label }) => {
              const on = offsets.includes(mins)
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    const prev = offsets
                    const next = on ? offsets.filter((m) => m !== mins) : [...offsets, mins]
                    setOffsets(next)
                    save(
                      { reminder_offsets: next.length ? next : null },
                      () => setOffsets(prev),
                      on ? `Pengingat ${label} dimatikan` : `Diingetin ${label} sebelum deadline`,
                    )
                  }}
                  disabled={saving}
                  aria-pressed={on}
                  className={`rounded-full px-3.5 py-[9px] text-[12.5px] font-bold transition active:scale-[.96] ${
                    on
                      ? 'bg-[var(--btn)] text-[var(--btn-ink)]'
                      : 'bg-[var(--col)] text-[var(--ink3)] hover:text-[var(--ink2)]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-[var(--ink3)]">
            Email ke kamu sendiri. Pengingat yang waktunya udah lewat dilewati.
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => onDelete(task.id)}
        className="mt-6 mb-6 flex h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--col)] text-[14px] font-bold text-[var(--ink2)] transition hover:text-[var(--danger-ink)] active:scale-[.99]"
      >
        <Trash2 size={17} aria-hidden="true" />
        Hapus task
      </button>
    </Sheet>
  )
}
```

- [ ] **Step 8: Open the sheet from the task list**

In `src/routes/my-tasks.tsx`, add state and change `openTask`:

```tsx
  const [sheetTask, setSheetTask] = useState<Task | null>(null)

  function openTask(task: Task) {
    if (task.boardId) navigate({ to: '/board/$boardId', params: { boardId: task.boardId } })
    else setSheetTask(task)
  }
```

and render it at the end of the component's JSX:

```tsx
      {sheetTask && (
        <StandaloneTaskSheet
          task={sheetTask}
          onClose={() => setSheetTask(null)}
          onSaved={() => router.invalidate()}
          onUpdate={(id, fields) => updateStandaloneTaskFn({ data: { id, fields } })}
          onDelete={async (id) => {
            setSheetTask(null)
            setTasks((prev) => prev.filter((t) => t.id !== id))
            toast('Task dihapus')
            try {
              await deleteStandaloneTaskFn({ data: { id } })
            } catch {
              router.invalidate()
              toast('Gagal hapus — coba lagi')
            }
          }}
        />
      )}
```

`my-tasks.tsx` currently imports only `createFileRoute, useNavigate` from `@tanstack/react-router` and has no `router` — add `useRouter` to that import and `const router = useRouter()` beside the existing `const navigate = useNavigate()`. Import `StandaloneTaskSheet` from `#/components/StandaloneTaskSheet`, and add `updateStandaloneTaskFn, deleteStandaloneTaskFn` to the existing `#/lib/actions` import.

- [ ] **Step 9: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p .`
Expected: `TypeScript: No errors found`

Run: `npm test`
Expected: all tests pass, including the pre-existing `src/lib/due-reminders.test.ts` (that function is unscheduled, not changed).

- [ ] **Step 10: Verify in the browser**

With the preview running, go to `/my-tasks`, click a task that has no project. Confirm the sheet opens, the date/time/chips save (watch for `updateStandaloneTaskFn` → 200 in `read_network_requests`), the page behind it does not scroll, and closing restores the scroll position. Screenshot for the user.

- [ ] **Step 11: Commit**

```bash
git add src/components/StandaloneTaskSheet.tsx src/lib/standalone-tasks.ts src/lib/actions.ts src/lib/my-tasks.ts src/routes/my-tasks.tsx src/lib/task-reminders.test.ts
git commit -m "Give personal tasks a detail sheet

Clicking one used to do nothing unless it belonged to a board. It now
opens a thin sheet with the same deadline and reminder controls the
board cards got, plus a delete."
```

---

## Done criteria

- `npx tsc --noEmit -p .` clean, `npm test` green.
- A board card and a personal task can each be given a date, a time, and any combination of the five offsets, and the matching `reminders` rows exist with the right `remind_at`.
- `cron.job` no longer lists `scan-due-tasks`.
- Nothing schedules a reminder unless the user picked one.

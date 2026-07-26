# Due-date reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a user in the app bell and by email on the morning a task is due, for both standalone tasks and assigned board cards.

**Architecture:** A daily `pg_cron` job at 01:00 UTC (08:00 WIB) POSTs to a new `due-reminders` Edge Function. The function queries the two task sources for rows due today and not done, then inserts rows into the **existing** `reminders` table with `remind_at = now()`. Everything downstream is untouched and already works: `fetchNotificationsFn` merges due `reminders` into the header bell, and the existing per-minute `send-reminder-emails` cron (migration 0022) emails them via Resend. A `source_key` unique index makes a double-fired cron a no-op.

**Tech Stack:** Supabase (Postgres, pg_cron, pg_net, Deno Edge Functions), Resend, Vitest (integration tests against the real remote DB).

## Global Constraints

- **Remote-only Supabase — no local Docker.** Migrations are written as files here
  but **applied to the remote DB by the user** (Dashboard SQL Editor, or `db push`
  with a pooler URL). The DB password is the user's secret — never ask for it,
  never run migrations on their behalf.
- **Edge Functions are deployed by the user**: `supabase functions deploy <name> --no-verify-jwt`.
- Tests hit the real remote DB via gitignored `.dev.vars` (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`). No mocks, no local DB.
- `vitest.config.ts` sets `fileParallelism: false` — test files run sequentially
  because the shared remote Supabase auth API rate-limits under parallel load.
  Do not re-enable parallelism.
- No ESLint config — `npx tsc --noEmit -p .` is the only automated code-quality gate.
- **Do not add a Deno test toolchain.** The existing Edge Functions (`notify`,
  `send-reminders`) have no tests; this plan does not change that. The Edge
  Function's *selection rules* are pinned by a vitest integration test instead.
- New Edge Function must mirror `supabase/functions/send-reminders/index.ts`
  conventions exactly: optional `CRON_SECRET` bearer check, service-role client
  from env, errors logged and returned as HTTP 200 (so pg_net does not retry-storm).
- "Done" for a card is the existing heuristic in `src/lib/home.ts:2-4`:
  `/done|complete/i` tested against the **column title**. Do not invent a new rule.
- "Today" is computed in **WIB (UTC+7)**, matching `localDateStr()` semantics used
  throughout the UI. Due dates are plain `date` columns with no time component.

---

### Task 1: Migration `0033_due_reminders_cron.sql`

**Files:**
- Create: `supabase/migrations/0033_due_reminders_cron.sql`

**Interfaces:**
- Produces: `reminders.source_key text` (nullable) with a plain unique index
  (NULLs distinct, so user-created reminders are unconstrained); a `pg_cron` job
  named `scan-due-tasks` on `0 1 * * *` POSTing to `.../functions/v1/due-reminders`.
  Task 3's Edge Function upserts with `onConflict: 'source_key'`, which requires
  this index to be non-partial — see the migration's comment.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0033_due_reminders_cron.sql`:

```sql
-- Due-date reminders. A daily scan inserts `reminders` rows for tasks due today;
-- from there the existing machinery takes over unchanged — the bell merges due
-- reminders (fetchNotificationsFn) and the per-minute cron from 0022 emails them.

-- Idempotency key for machine-generated reminders. Null for user-created ones
-- (QuickReminderForm). A plain (not partial) unique index is deliberate: Postgres
-- treats NULLs as distinct in a unique index, so any number of user-created
-- reminders coexist, while generated keys stay unique. A partial index
-- (`where source_key is not null`) would NOT work here — ON CONFLICT (source_key)
-- cannot infer a partial index without repeating its predicate, which PostgREST's
-- upsert has no way to send.
alter table reminders add column if not exists source_key text;
create unique index if not exists reminders_source_key_idx
  on reminders (source_key);

-- 01:00 UTC = 08:00 WIB. Due dates are plain calendar dates, so the reminder
-- fires on the morning of the due day, local time. Same pg_net-on-a-timer
-- pattern as 0022; that job (every minute) is what actually emails these rows.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scan-due-tasks') then
    perform cron.unschedule('scan-due-tasks');
  end if;
end $$;

select cron.schedule(
  'scan-due-tasks',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://tzhquesopfxevsucoapb.supabase.co/functions/v1/due-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

- [ ] **Step 2: Ask the user to apply it to the remote DB**

This is **not** an agent step — per CLAUDE.md, migrations are applied by the user,
who holds the DB password. Ask them to run one of:

- Supabase Dashboard → SQL Editor → paste the file contents → Run, then:
  ```bash
  npx supabase migration repair --status applied 0033 --db-url "<pooler-url>"
  ```
- Or: `npx supabase db push --db-url "<pooler-url>"`

Task 2's tests do **not** need this applied (they only exercise SELECT rules on
pre-existing tables). Task 3's function does. Do not block Task 2 on it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0033_due_reminders_cron.sql
git commit -m "feat: add source_key to reminders and schedule daily due-date scan"
```

---

### Task 2: Selection-rule integration test

**Files:**
- Test: `src/lib/due-reminders.test.ts`

**Interfaces:**
- Produces: an executable specification of exactly which tasks the Edge Function
  must select. Task 3's function must reproduce these same rules.

**Note:** this is a test file with **no** corresponding `src/lib/due-reminders.ts`
module, and that is deliberate — the queries under test live in the Deno Edge
Function, and this test re-states them against the same schema to pin the rules.
Do **not** create a source module; it would be a second copy of the query with no
caller.

- [ ] **Step 1: Write the failing test**

Create `src/lib/due-reminders.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- src/lib/due-reminders.test.ts`
Expected: PASS, 2 tests.

This test encodes rules against tables that already exist, so it passes on first
run rather than failing first — there is no production code for it to drive out.
Its value is as a regression gate on the selection rules Task 3 must implement,
and as proof the query shapes (including the `columns!inner(...boards!inner...)`
embed) actually work against the real schema before they are written into Deno.

If the embed syntax errors, fix the query here **first** — that is exactly the
failure this task exists to catch early, and Task 3 copies whatever shape works.

- [ ] **Step 3: Commit**

```bash
git add src/lib/due-reminders.test.ts
git commit -m "test: pin due-date reminder task-selection rules"
```

---

### Task 3: Edge Function `due-reminders`

**Files:**
- Create: `supabase/functions/due-reminders/index.ts`

**Interfaces:**
- Consumes: `reminders.source_key` + its unique index (Task 1); the exact query
  shapes and filter rules proven in Task 2.
- Produces: rows in `reminders` with `remind_at = now()` and a deterministic
  `source_key`. The existing `send-reminders` function and bell merge consume
  these with no changes.

**Requires:** Task 1's migration must be applied to the remote DB before this
function can run successfully (it upserts on `source_key`).

- [ ] **Step 1: Write the function**

Create `supabase/functions/due-reminders/index.ts`:

```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Polled by pg_cron once a day at 01:00 UTC / 08:00 WIB (see migration 0033).
// Inserts a `reminders` row for every task due today that isn't finished; the
// per-minute send-reminders cron (0022) emails them and the notifications bell
// merges them, so this function only has to pick the right tasks.

/** "Today" in WIB (UTC+7). Due dates are plain calendar dates, so using the UTC
 *  day would fire up to 7 hours off for the local user. Mirrors localDateStr(). */
function wibToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Copy of isDoneColumn() in src/lib/home.ts — a card in a "Done"/"Complete"
 *  column is finished, so it gets no reminder. */
function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 })
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = wibToday()
    const nowIso = new Date().toISOString()
    const rows: Array<{ user_id: string; message: string; remind_at: string; source_key: string }> = []

    // Standalone tasks: owner is the recipient.
    const { data: standalone, error: sErr } = await svc
      .from('standalone_tasks')
      .select('id,user_id,title')
      .eq('done', false)
      .eq('due_date', today)
    if (sErr) {
      console.error('due-reminders: standalone fetch failed', sErr)
    } else {
      for (const t of standalone ?? []) {
        rows.push({
          user_id: t.user_id as string,
          message: `Due today: "${t.title}"`,
          remind_at: nowIso,
          source_key: `due:standalone:${t.id}:${today}`,
        })
      }
    }

    // Board cards: assignee is the recipient. The done-column and archived-board
    // rules are applied here rather than in SQL so the regex stays identical to
    // isDoneColumn()'s.
    const { data: cards, error: cErr } = await svc
      .from('cards')
      .select('id,title,assignee_id,columns!inner(title,boards!inner(id,title,status))')
      .eq('due_date', today)
      .not('assignee_id', 'is', null)
    if (cErr) {
      console.error('due-reminders: card fetch failed', cErr)
    } else {
      for (const c of cards ?? []) {
        const col = c.columns as unknown as { title: string; boards: { title: string; status: string } }
        if (isDoneColumn(col.title) || col.boards.status === 'archived') continue
        rows.push({
          user_id: c.assignee_id as string,
          message: `Due today: "${c.title}" in ${col.boards.title}`,
          remind_at: nowIso,
          source_key: `due:card:${c.id}:${today}`,
        })
      }
    }

    if (rows.length === 0) return new Response('ok (0 queued)', { status: 200 })

    // source_key is uniquely indexed, so a re-fired cron is a no-op rather than
    // a duplicate email.
    const { error: insErr } = await svc
      .from('reminders')
      .upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true })
    if (insErr) {
      console.error('due-reminders: insert failed', insErr)
      return new Response('error', { status: 200 })
    }

    return new Response(`ok (${rows.length} queued)`, { status: 200 })
  } catch (err) {
    // Returned as 200 on purpose: pg_net has no backoff, and a 5xx would make it
    // hammer this endpoint. The error is logged for debugging.
    console.error('due-reminders function error:', err)
    return new Response('error', { status: 200 })
  }
})
```

- [ ] **Step 2: Verify the selection rules still pass**

Run: `npm test -- src/lib/due-reminders.test.ts`
Expected: PASS, 2 tests. (The function is not itself under test — this confirms
the query shapes it copied still hold against the live schema.)

- [ ] **Step 3: Typecheck the app**

Run: `npx tsc --noEmit -p .`
Expected: no errors. (`supabase/functions/` is Deno and outside the app tsconfig;
this confirms nothing in `src/` regressed.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/due-reminders/index.ts
git commit -m "feat: add due-reminders edge function for daily due-date scan"
```

---

### Task 4: Deploy and verify end to end

**Files:** none (deployment + verification only)

- [ ] **Step 1: Confirm the migration is applied**

Task 1 Step 2 must be done. Verify the column and cron job exist by asking the
user to run this in the Dashboard SQL Editor and report the output:

```sql
select column_name from information_schema.columns
  where table_name = 'reminders' and column_name = 'source_key';
select jobname, schedule from cron.job where jobname = 'scan-due-tasks';
```

Expected: one row each. If either is empty, the migration has not been applied —
stop and go back to Task 1 Step 2.

- [ ] **Step 2: Ask the user to deploy the Edge Function**

```bash
supabase functions deploy due-reminders --no-verify-jwt
```

- [ ] **Step 3: Trigger the function manually and confirm it queues rows**

Rather than waiting for 08:00 WIB, seed a task due today and invoke the function
directly. Ask the user to run (or run yourself if the anon key is available from
`.dev.vars`):

```bash
curl -s -X POST https://tzhquesopfxevsucoapb.supabase.co/functions/v1/due-reminders
```

Expected output: `ok (N queued)` where N is at least 1 if any task is due today.

Then confirm the rows landed, with a script using the service-role key from
`.dev.vars`:

```javascript
// Check reminders created by the scan today
const { data } = await admin
  .from('reminders')
  .select('user_id,message,source_key,remind_at,emailed_at')
  .like('source_key', 'due:%')
```

Expected: one row per due task, `source_key` matching `due:standalone:<id>:<today>`
or `due:card:<id>:<today>`.

- [ ] **Step 4: Confirm idempotency**

Run the same curl a second time. Expected: same `ok (N queued)` response, but the
`reminders` table must still hold exactly the same number of `due:%` rows — the
unique index on `source_key` swallows the repeat. If row count grew, the upsert
`onConflict` is wrong; fix it in Task 3 and re-verify.

- [ ] **Step 5: Confirm delivery**

Within ~60 seconds the existing per-minute cron should stamp `emailed_at` on the
new rows and Resend should deliver the email. Re-run the query from Step 3 and
confirm `emailed_at` is no longer null. Then open the app and confirm the new
reminder appears in the header notifications bell.

- [ ] **Step 6: Clean up test rows**

Delete any reminder rows and throwaway tasks created purely for this verification,
so the user's real bell is not left with test noise:

```javascript
await admin.from('reminders').delete().like('source_key', 'due:%')
```

(Only do this for rows you created during verification. Real reminders generated
for genuinely-due tasks should be left alone — check with the user first if any
`due:%` rows correspond to their actual tasks.)

- [ ] **Step 7: Full suite + typecheck**

Run: `npm test`
Expected: all tests pass, including the 2 new ones.

Run: `npx tsc --noEmit -p .`
Expected: no errors.

No commit for this task — it is verification only.

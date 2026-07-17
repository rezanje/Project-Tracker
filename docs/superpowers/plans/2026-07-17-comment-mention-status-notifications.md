# Comment Mentions & Card Status-Change Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new notification kinds — `mention` (comment @-tags you, or a card assigned to you gets a new comment) and `status` (a card assigned to you moves to a different board column) — surfaced in the existing bell and, for mentions, a new tab on `/inbox`; plus an `@`-autocomplete dropdown in the comment composer.

**Architecture:** Two new Postgres `security definer` triggers on `comments` and `cards`, mirroring the existing `notify_card_assignee()` pattern, writing into the existing `notifications` table (which gains a `kind` column). The app layer needs almost no new plumbing: the bell already renders any `notifications` row generically; only `fetchNotificationsFn`'s hardcoded `kind: 'assignment'` needs to read the real column. New UI work is limited to the mention autocomplete and an Inbox tab switcher.

**Tech Stack:** TanStack Start (React) + Supabase Postgres/RLS, Tailwind, Vitest (integration tests against the real remote DB via `.dev.vars`, no mocks).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-comment-mention-status-notifications-design.md`.
- **Migrations are never applied by the agent.** Per `CLAUDE.md`, the user applies
  `supabase/migrations/*.sql` to the remote DB themselves (Dashboard SQL editor or
  `db push` with their own pooler URL/password). Task 1 below has an explicit stop for
  this.
- No mocks anywhere — all DB-touching tests hit the real remote Supabase project via
  credentials in the gitignored `.dev.vars` (see any existing `src/lib/*.test.ts` for
  the pattern).
- Typecheck is the only automated code-quality gate: `npx tsc --noEmit -p .`.
- Test runner: `npm test` = `vitest run`. Run a single file with
  `npx vitest run <path>`.
- Existing schema facts this plan depends on (do not re-derive, just use):
  `profiles(id, name, avatar_url)`, `boards(id, owner_id, title)`,
  `board_members(board_id, user_id, role)` (`role in ('owner','client')`),
  `columns(id, board_id, title, position)`, `cards(id, column_id, title, assignee_id, position)`
  — **no `status` column on `cards`; status is which column a card sits in.**
  `comments(id, card_id, author_id, body, created_at)`.
  `notifications(id, user_id, card_id, board_id, message, read_at, created_at)` — no
  `kind` column yet, added in Task 1.
- Only the board **owner** can write/move `cards` (RLS: `cards_write` requires
  `is_board_owner`, `supabase/migrations/0002_rls.sql:43-45`) — relevant when writing
  the card-move test in Task 1: the mover in a test must be the board owner.
- A board's owner row in `board_members` is auto-inserted by a trigger when the board
  is created (`supabase/migrations/0004_board_owner_trigger.sql`) — tests only need to
  explicitly insert the *second* member's `board_members` row.

---

### Task 1: Database migration — `kind` column + two new triggers + trigger tests

**Files:**
- Create: `supabase/migrations/0031_comment_status_notifications.sql`
- Create: `src/lib/notifications.test.ts`

**Interfaces:**
- Produces: `notifications.kind` column (`text not null default 'assignment' check (kind in ('assignment','mention','status'))`) — every later task that reads `notifications` rows relies on this column existing.
- Produces: trigger functions `notify_comment()` (on `comments` insert) and
  `notify_card_column_change()` (on `cards` update of `column_id`) — no application
  code calls these directly; they fire automatically.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0031_comment_status_notifications.sql
-- Adds `kind` to notifications (was implicitly always "assignment"), and two new
-- triggers: comment mentions/assignee-notify, and card column-change notify.

alter table notifications
  add column if not exists kind text not null default 'assignment'
  check (kind in ('assignment', 'mention', 'status'));

-- Re-create explicitly with `kind` passed, for clarity (functionally unchanged —
-- 'assignment' is also the column default).
create or replace function notify_card_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;

  select b.id, b.title into v_board_id, v_board_title
    from columns c join boards b on b.id = c.board_id where c.id = new.column_id;

  insert into notifications (user_id, card_id, board_id, message, kind)
  values (new.assignee_id, new.id, v_board_id, 'Assigned you to "' || new.title || '" in ' || coalesce(v_board_title, 'a board'), 'assignment');
  return new;
end $$;

-- Comment mentions: `@Name` substring match against board members, plus an
-- auto-notify for the card's assignee (if not already matched by name).
create or replace function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
  v_card_title text;
  v_assignee_id uuid;
  v_author_name text;
  v_matched_assignee boolean := false;
  m record;
begin
  select b.id, b.title, ca.title, ca.assignee_id
    into v_board_id, v_board_title, v_card_title, v_assignee_id
    from cards ca
    join columns co on co.id = ca.column_id
    join boards b on b.id = co.board_id
    where ca.id = new.card_id;

  select coalesce(name, 'Someone') into v_author_name from profiles where id = new.author_id;

  begin
    for m in
      select p.id, p.name
      from board_members bm
      join profiles p on p.id = bm.user_id
      where bm.board_id = v_board_id
        and bm.user_id <> new.author_id
        and p.name is not null and p.name <> ''
        and position(lower('@' || p.name) in lower(new.body)) > 0
    loop
      insert into notifications (user_id, card_id, board_id, message, kind)
      values (m.id, new.card_id, v_board_id,
        v_author_name || ' mentioned you in a comment on "' || v_card_title || '"', 'mention');
      if m.id = v_assignee_id then
        v_matched_assignee := true;
      end if;
    end loop;

    if v_assignee_id is not null and v_assignee_id <> new.author_id and not v_matched_assignee then
      insert into notifications (user_id, card_id, board_id, message, kind)
      values (v_assignee_id, new.card_id, v_board_id,
        v_author_name || ' commented on "' || v_card_title || '", assigned to you', 'mention');
    end if;
  exception when others then
    null; -- never let a notification failure block the comment insert
  end;

  return new;
end $$;

drop trigger if exists on_comment_insert on comments;
create trigger on_comment_insert
  after insert on comments
  for each row execute function notify_comment();

-- Card status (column) change: notify the assignee when the card moves to a
-- different column, unless they're the one moving it.
create or replace function notify_card_column_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
  v_old_col_title text;
  v_new_col_title text;
begin
  if new.column_id is not distinct from old.column_id then return new; end if;
  if new.assignee_id is null then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;

  select co.title, b.id, b.title into v_new_col_title, v_board_id, v_board_title
    from columns co join boards b on b.id = co.board_id where co.id = new.column_id;
  select title into v_old_col_title from columns where id = old.column_id;

  begin
    insert into notifications (user_id, card_id, board_id, message, kind)
    values (
      new.assignee_id, new.id, v_board_id,
      'Moved "' || new.title || '" from ' || coalesce(v_old_col_title, '?') ||
        ' to ' || coalesce(v_new_col_title, '?') || ' in ' || coalesce(v_board_title, 'a board'),
      'status'
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists on_card_column_change on cards;
create trigger on_card_column_change
  after update of column_id on cards
  for each row execute function notify_card_column_change();
```

- [ ] **Step 2: Commit the migration**

```bash
git add supabase/migrations/0031_comment_status_notifications.sql
git commit -m "feat(db): add comment-mention and card-status notification triggers"
```

- [ ] **Step 3: STOP — ask the user to apply the migration**

Tell the user: *"Migration `0031_comment_status_notifications.sql` is ready. Please
apply it to the remote DB yourself (Supabase Dashboard → SQL Editor → paste & run, or
`npx supabase db push` with your pooler URL) before I continue — I can't run it with
your DB password. Let me know once it's applied."* Wait for confirmation before Step 4.

- [ ] **Step 4: Write the trigger integration tests**

```typescript
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/notifications.test.ts`
Expected: all 7 tests PASS. If any fail with a Postgres error about a missing column
or function, the migration from Step 1 hasn't been applied yet — stop and re-confirm
with the user (do not proceed to Step 6 until green).

- [ ] **Step 6: Commit the tests**

```bash
git add src/lib/notifications.test.ts
git commit -m "test(notifications): cover mention and status-change triggers"
```

---

### Task 2: `src/lib/notifications.ts` — read the real `kind` column

**Files:**
- Modify: `src/lib/notifications.ts:5-12` (type), `src/lib/notifications.ts:49-62` (mapping)

**Interfaces:**
- Consumes: `notifications.kind` column from Task 1 (values: `'assignment' | 'mention' | 'status'`).
- Produces: `Notification['kind']` widened to `'assignment' | 'reminder' | 'approval' | 'mention' | 'status'` — `NotificationsBell` (`src/components/Header.tsx`) and the new Inbox Mentions tab (Task 4) both consume this type as-is, no other changes needed there for the bell (see spec: it already renders any kind generically).

- [ ] **Step 1: Update the `Notification` type**

In `src/lib/notifications.ts`, change:

```typescript
export type Notification = {
  id: string
  kind: 'assignment' | 'reminder' | 'approval'
  message: string
  boardId: string | null
  read: boolean
  createdAt: string
}
```

to:

```typescript
export type Notification = {
  id: string
  kind: 'assignment' | 'reminder' | 'approval' | 'mention' | 'status'
  message: string
  boardId: string | null
  read: boolean
  createdAt: string
}
```

- [ ] **Step 2: Read `kind` from the row instead of hardcoding it**

In the same file, the `notifications` table select and mapping currently hardcode
`kind: 'assignment'`:

```typescript
      supabase
        .from('notifications')
        .select('id,message,board_id,read_at,created_at')
        .order('created_at', { ascending: false })
        .limit(20),
```
```typescript
    const fromNotifs: Notification[] = ((notifs ?? []) as Array<{
      id: string
      message: string
      board_id: string | null
      read_at: string | null
      created_at: string
    }>).map((n) => ({
      id: n.id,
      kind: 'assignment',
      message: n.message,
      boardId: n.board_id,
      read: n.read_at != null,
      createdAt: n.created_at,
    }))
```

Change the select to include `kind`, and the mapping to read it:

```typescript
      supabase
        .from('notifications')
        .select('id,message,board_id,read_at,created_at,kind')
        .order('created_at', { ascending: false })
        .limit(20),
```
```typescript
    const fromNotifs: Notification[] = ((notifs ?? []) as Array<{
      id: string
      message: string
      board_id: string | null
      read_at: string | null
      created_at: string
      kind: 'assignment' | 'mention' | 'status'
    }>).map((n) => ({
      id: n.id,
      kind: n.kind,
      message: n.message,
      boardId: n.board_id,
      read: n.read_at != null,
      createdAt: n.created_at,
    }))
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat(notifications): surface mention and status kinds from the DB"
```

---

### Task 3: `@`-mention autocomplete in the comment composer

**Files:**
- Modify: `src/components/Comments.tsx`

**Interfaces:**
- Consumes: the existing `members: { id: string; name: string }[]` prop
  (`CommentsProps`, already passed in from `CardDetail.tsx`) — no new fetch.
- Produces: no new exports; purely internal component behavior. The text it writes
  into `body` (`@Full Name `) is what `notify_comment()` (Task 1) matches against, so
  the inserted mention text must be the member's exact `name` field.

- [ ] **Step 1: Add mention-dropdown state and a ref to the input**

In `src/components/Comments.tsx`, add to the imports and component state (near the
existing `useState` calls, after `const [error, setError] = useState<string | null>(null)`):

```typescript
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
```

(`useRef` is already imported at the top of the file alongside `useEffect, useState`.)

- [ ] **Step 2: Add the input-change handler that detects an open `@` token**

Add this function above `handlePost`:

```typescript
  function onBodyChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    setBody(value)

    const upToCursor = value.slice(0, cursor)
    const at = upToCursor.lastIndexOf('@')
    if (at === -1 || /\s/.test(upToCursor.slice(at + 1))) {
      setMentionOpen(false)
      return
    }
    setMentionStart(at)
    setMentionQuery(upToCursor.slice(at + 1))
    setMentionOpen(true)
  }

  function selectMention(name: string) {
    if (mentionStart === null) return
    const cursor = inputRef.current?.selectionStart ?? body.length
    const before = body.slice(0, mentionStart)
    const after = body.slice(cursor)
    const next = `${before}@${name} ${after}`
    setBody(next)
    setMentionOpen(false)
    setMentionStart(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = before.length + name.length + 2
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const mentionMatches = mentionOpen
    ? members.filter((m) => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : []
```

- [ ] **Step 3: Wire the input to the handler and render the dropdown**

Replace the composer form:

```tsx
      <form onSubmit={handlePost} className="flex items-center gap-2">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment…"
          className="field flex-1"
        />
        <button
          type="submit"
          disabled={posting || !body.trim()}
          className="btn btn-primary btn-square shrink-0"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>
```

with:

```tsx
      <form onSubmit={handlePost} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={body}
            onChange={onBodyChange}
            placeholder="Write a comment… (@ to mention)"
            className="field w-full"
          />
          {mentionOpen && mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-48 rounded-lg border border-[var(--line)] bg-[var(--card)] p-1 shadow-lg">
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectMention(m.name)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={posting || !body.trim()}
          className="btn btn-primary btn-square shrink-0"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Start the dev server preview, open a card with 2+ board members, in the comment
composer type `@` and confirm a dropdown of member names appears; type a few more
letters and confirm it filters; click a name and confirm it inserts `@Full Name ` at
the cursor and the dropdown closes; post the comment and confirm it still saves
correctly (existing behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/Comments.tsx
git commit -m "feat(comments): add @-mention autocomplete in the composer"
```

---

### Task 4: `/inbox` — add a "Mentions" tab

**Files:**
- Modify: `src/routes/inbox.tsx`

**Interfaces:**
- Consumes: `fetchNotificationsFn(): Promise<Notification[]>` and the
  `Notification` type, both from `src/lib/notifications.ts` (Task 2) — filters
  client-side to `kind === 'mention'`.
- Produces: no new exports; purely adds a second view inside the existing route
  component.

- [ ] **Step 1: Replace the whole file**

`src/routes/inbox.tsx` needs a tab switcher wrapping the existing two-pane layout,
plus a new Mentions pane, while the "Member picker" modal stays a sibling of the tab
switch (not nested inside either branch — it's reachable only from the Messages tab's
"New" button, but its own render doesn't depend on which tab is active). This is
easiest to get right as one full-file replacement rather than a partial patch. Replace
the entire contents of `src/routes/inbox.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import {
  fetchThreadsFn,
  fetchMessagesFn,
  sendMessageFn,
  openDmFn,
  markThreadReadFn,
  fetchMessageableMembersFn,
  type Thread,
  type Message,
  type MessageableMember,
} from '#/lib/messages'
import { fetchNotificationsFn, type Notification } from '#/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function InboxPage() {
  const [tab, setTab] = useState<'messages' | 'mentions'>('messages')
  const [mentions, setMentions] = useState<Notification[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState('')
  const meIdRef = useRef('')
  const [picking, setPicking] = useState(false)
  const [members, setMembers] = useState<MessageableMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const active = threads.find((t) => t.id === activeId) ?? null

  useEffect(() => {
    getBrowserSupabase()
      .auth.getUser()
      .then((res: { data: { user: { id: string } | null } }) => {
        const id = res.data.user?.id ?? ''
        setMeId(id)
        meIdRef.current = id
      })
    fetchThreadsFn().then(setThreads).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'mentions') return
    fetchNotificationsFn()
      .then((items) => setMentions(items.filter((n) => n.kind === 'mention')))
      .catch(() => {})
  }, [tab])

  // Load messages + realtime for the active thread.
  useEffect(() => {
    if (!activeId) return
    let alive = true
    setMessages([])
    fetchMessagesFn({ data: { threadId: activeId } }).then((m) => {
      if (alive) setMessages(m)
    })
    markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
    setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t)))

    const otherName = active?.title ?? 'Unknown'
    const supabase = getBrowserSupabase()
    const channel = supabase
      .channel(`messages:${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${activeId}` },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as { id: string; sender_id: string; body: string; created_at: string }
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev
            return [
              ...prev,
              {
                id: row.id,
                threadId: activeId,
                senderId: row.sender_id,
                senderName: row.sender_id === meIdRef.current ? 'Me' : otherName,
                body: row.body,
                createdAt: row.created_at,
              },
            ]
          })
          if (row.sender_id !== meIdRef.current) markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
        },
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
    // meId is read via meIdRef inside the realtime handler, so it is intentionally
    // omitted from deps to avoid tearing down/re-subscribing the channel when it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close the member picker on Escape.
  useEffect(() => {
    if (!picking) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  async function send() {
    const body = draft.trim()
    if (!body || !activeId) return
    setDraft('')
    setError(null)
    try {
      await sendMessageFn({ data: { threadId: activeId, body } })
      fetchThreadsFn().then(setThreads).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
      setDraft(body)
    }
  }

  async function startDm(member: MessageableMember) {
    setPicking(false)
    try {
      const { threadId } = await openDmFn({ data: { otherUserId: member.id } })
      const list = await fetchThreadsFn()
      setThreads(list)
      setActiveId(threadId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat')
    }
  }

  function openPicker() {
    setPicking(true)
    setMembers([])
    fetchMessageableMembersFn().then(setMembers).catch(() => {})
  }

  return (
    <div className="page-wrap py-6">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab('messages')}
          className={`btn ${tab === 'messages' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Messages
        </button>
        <button
          type="button"
          onClick={() => setTab('mentions')}
          className={`btn ${tab === 'mentions' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Mentions
        </button>
      </div>

      {tab === 'mentions' ? (
        <div className="card p-2">
          {mentions.length === 0 ? (
            <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No mentions yet.</p>
          ) : (
            mentions.map((n) => (
              <a
                key={n.id}
                href={n.boardId ? `/board/${n.boardId}` : '#'}
                className="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 no-underline hover:bg-[var(--col)]"
              >
                <span className="text-[13px] font-semibold text-[var(--ink)]">{n.message}</span>
                <span className="text-[11px] text-[var(--ink3)]">{timeAgo(n.createdAt)}</span>
              </a>
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Thread list */}
          <aside className="card p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">Messages</p>
              <Button size="sm" variant="secondary" onClick={openPicker}>New</Button>
            </div>
            {threads.length === 0 && (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No conversations yet.</p>
            )}
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--col)] ${
                  t.id === activeId ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className={`text-[13px] ${t.unread ? 'font-extrabold text-[var(--ink)]' : 'font-semibold text-[var(--ink)]'}`}>
                    {t.title}
                  </span>
                  {t.unread > 0 && (
                    <span className="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-white">
                      {t.unread}
                    </span>
                  )}
                </span>
                {t.lastMessage && <span className="truncate text-[11px] text-[var(--ink3)]">{t.lastMessage}</span>}
              </button>
            ))}
          </aside>

          {/* Conversation */}
          <section className="card flex min-h-[60vh] flex-col p-0">
            {!active ? (
              <div className="grid flex-1 place-items-center text-[13px] text-[var(--ink3)]">
                Pick a conversation, or start a new one.
              </div>
            ) : (
              <>
                <div className="border-b-2 border-[var(--ink)] px-4 py-2.5">
                  <p className="display-title text-lg font-extrabold text-[var(--ink)]">{active.title}</p>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex flex-col ${m.senderId === meId ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-lg border-2 border-[var(--ink)] px-3 py-1.5 text-[13px] ${
                          m.senderId === meId ? 'bg-[var(--accent-soft)]' : 'bg-[var(--card)]'
                        }`}
                      >
                        {m.body}
                      </div>
                      <span className="mt-0.5 text-[10px] text-[var(--ink3)]">{timeAgo(m.createdAt)}</span>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                {error && <p className="px-4 pb-1 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    send()
                  }}
                  className="flex gap-2 border-t-2 border-[var(--ink)] p-3"
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message"
                    className="flex-1"
                  />
                  <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                    <Send size={16} />
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      {/* Member picker */}
      {picking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setPicking(false)}>
          <div
            className="card w-full max-w-sm p-3"
            role="dialog"
            aria-modal="true"
            aria-label="New message"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">New message</p>
            {members.length === 0 && (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No members to message.</p>
            )}
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => startDm(m)}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Manual browser verification**

Open `/inbox`, confirm the "Messages" tab still works exactly as before (thread list,
conversation, new message). Switch to "Mentions" — with no mentions yet it should show
the empty state; after Task 1/3 produce a real mention notification for the logged-in
user, confirm it appears here and clicking it navigates to the right board.

- [ ] **Step 4: Commit**

```bash
git add src/routes/inbox.tsx
git commit -m "feat(inbox): add a Mentions tab backed by mention notifications"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new `src/lib/notifications.test.ts`.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: End-to-end manual check in the browser**

With two test accounts sharing a board: post a comment mentioning the other user →
confirm a bell notification appears for them and, once Task 4 is live, it also shows
under Inbox → Mentions. Move a card assigned to the other user to a different column →
confirm a bell notification appears for them. Confirm clicking either notification
navigates to the correct board.

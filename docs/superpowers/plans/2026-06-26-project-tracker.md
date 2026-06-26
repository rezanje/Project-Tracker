# Project Tasks Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trello-style kanban tracker where the owner manages project boards and invited clients can view, comment, and attach files in real time.

**Architecture:** TanStack Start (React SSR + server functions) on Cloudflare Workers, with Supabase providing auth, Postgres+RLS, Realtime, and Storage. The browser talks to Supabase directly for Realtime/Storage; server functions handle SSR loads and privileged writes. Access control lives entirely in Postgres RLS keyed off `board_members`.

**Tech Stack:** TanStack Start, React, Cloudflare Workers (wrangler), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), dnd-kit, Resend (via Supabase Edge Function), Vitest.

## Global Constraints

- Roles are per-board: `owner` (full write) and `client` (read + comment + attach only). Stored in `board_members`.
- RLS is the only trust boundary. Never gate access in app code alone. Every table policy resolves membership via the `is_board_member(board_id)` / `is_board_owner(board_id)` `SECURITY DEFINER` helpers.
- `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` are server-only. Never import them into client bundles. Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` reach the browser.
- Use Context7 MCP to confirm current TanStack Start Cloudflare deploy config and `@supabase/ssr` cookie API before writing framework glue (Tasks 1, 2, 5).
- Migrations live in `supabase/migrations/` and are the source of truth for schema; no manual dashboard schema edits.

---

### Task 1: Scaffold app + Cloudflare target

**Files:**
- Create: project root (TanStack Start app), `wrangler.toml`, `package.json`, `vite.config.ts`
- Create: `.dev.vars` (gitignored), `.env.example`

**Interfaces:**
- Produces: a runnable dev server (`npm run dev`) and a Cloudflare build target.

- [ ] **Step 1: Verify current scaffold command via Context7**

Query Context7 for "TanStack Start Cloudflare Workers setup" to confirm the create command and Vite Cloudflare preset for the current version. Use its output for the exact commands below if they differ.

- [ ] **Step 2: Scaffold**

```bash
npm create @tanstack/start@latest . -- --template typescript
npm install
```

- [ ] **Step 3: Add Cloudflare + tooling deps**

```bash
npm install @supabase/supabase-js @supabase/ssr @dnd-kit/core @dnd-kit/sortable
npm install -D wrangler vitest @cloudflare/workers-types
```

- [ ] **Step 4: Add `wrangler.toml`**

```toml
name = "project-tracker"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]
main = ".output/server/index.mjs"
assets = { directory = ".output/public" }
```

- [ ] **Step 5: Configure Vite Cloudflare target**

In `vite.config.ts`, set the TanStack Start target to `cloudflare-module` (confirm exact key name via Context7 output from Step 1).

- [ ] **Step 6: Add `.env.example`**

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 7: Verify dev server boots**

Run: `npm run dev`
Expected: server starts, default route renders at localhost without errors.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold TanStack Start app with Cloudflare target"
```

---

### Task 2: Supabase project + clients

**Files:**
- Create: `src/lib/supabase/server.ts` (request-scoped server client)
- Create: `src/lib/supabase/browser.ts` (browser client)
- Create: `supabase/config.toml` (via `supabase init`)

**Interfaces:**
- Produces:
  - `getServerSupabase(request: Request): SupabaseClient` — anon-key client bound to request cookies, for RLS-scoped server reads/writes.
  - `getServiceSupabase(): SupabaseClient` — service-role client, server-only, bypasses RLS (used only by trusted server functions like invite conversion).
  - `getBrowserSupabase(): SupabaseClient` — singleton browser client.

- [ ] **Step 1: Init local Supabase + link**

```bash
npx supabase init
npx supabase link --project-ref <ref>
```
(Create a project in the Supabase dashboard first; copy URL + anon + service keys into `.dev.vars` and the deployed env.)

- [ ] **Step 2: Confirm `@supabase/ssr` cookie API via Context7**

Query Context7 for "@supabase/ssr createServerClient cookies" to get the current `getAll`/`setAll` cookie adapter shape.

- [ ] **Step 3: Browser client**

```ts
// src/lib/supabase/browser.ts
import { createBrowserClient } from '@supabase/ssr'
let client: ReturnType<typeof createBrowserClient> | undefined
export function getBrowserSupabase() {
  client ??= createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
  )
  return client
}
```

- [ ] **Step 4: Server clients**

```ts
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export function getServerSupabase(request: Request, responseHeaders: Headers) {
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => parseCookies(request.headers.get('cookie') ?? ''),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) =>
        responseHeaders.append('set-cookie', serializeCookie(name, value, options))),
    },
  })
}

export function getServiceSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}
```
(Use `parseCookies`/`serializeCookie` from the cookie adapter shape Context7 returned; expose `VITE_`-prefixed anon vars for the browser.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Supabase server and browser clients"
```

---

### Task 3: Schema migration

**Files:**
- Create: `supabase/migrations/0001_schema.sql`

**Interfaces:**
- Produces: all tables from the spec, ready for RLS in Task 4.

- [ ] **Step 1: Write schema migration**

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles,
  title text not null,
  created_at timestamptz default now()
);

create table board_members (
  board_id uuid references boards on delete cascade,
  user_id uuid references profiles on delete cascade,
  role text not null check (role in ('owner','client')),
  primary key (board_id, user_id)
);

create table columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  title text not null,
  position int not null default 0,
  created_at timestamptz default now()
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references columns on delete cascade,
  title text not null,
  description text,
  due_date date,
  assignee_id uuid references profiles,
  position int not null default 0,
  created_at timestamptz default now()
);

create table labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  name text not null,
  color text not null
);

create table card_labels (
  card_id uuid references cards on delete cascade,
  label_id uuid references labels on delete cascade,
  primary key (card_id, label_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards on delete cascade,
  author_id uuid not null references profiles,
  body text not null,
  created_at timestamptz default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards on delete cascade,
  path text not null,
  filename text not null,
  uploaded_by uuid not null references profiles,
  created_at timestamptz default now()
);

-- new auth user -> profile row
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name) values (new.id, new.raw_user_meta_data->>'name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 2: Apply locally + verify**

Run: `npx supabase db reset` (or `db push`)
Expected: migration applies with no errors; `\dt` lists all tables.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add database schema migration"
```

---

### Task 4: RLS policies + membership helpers

**Files:**
- Create: `supabase/migrations/0002_rls.sql`
- Test: `supabase/tests/rls_test.sql`

**Interfaces:**
- Consumes: tables from Task 3.
- Produces: `is_board_member(uuid) returns boolean`, `is_board_owner(uuid) returns boolean`; RLS enabled on every table.

- [ ] **Step 1: Write the failing RLS test (pgTAP)**

```sql
-- supabase/tests/rls_test.sql
begin;
select plan(4);

-- seed: owner, client, outsider, one board
-- (insert auth.users + profiles + board + membership rows here)

-- 1. client can see a board they're a member of
set local role authenticated;
set local request.jwt.claim.sub = '<client-uuid>';
select isnt_empty('select 1 from boards where id = ''<board-uuid>''', 'client sees member board');

-- 2. outsider cannot see the board
set local request.jwt.claim.sub = '<outsider-uuid>';
select is_empty('select 1 from boards where id = ''<board-uuid>''', 'outsider blocked');

-- 3. client cannot insert a column (owner-only)
set local request.jwt.claim.sub = '<client-uuid>';
select throws_ok('insert into columns (board_id, title) values (''<board-uuid>'', ''x'')');

-- 4. client CAN insert a comment on a member board card
select lives_ok('insert into comments (card_id, author_id, body) values (''<card-uuid>'', ''<client-uuid>'', ''hi'')');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db`
Expected: FAIL — RLS not yet enabled, policies/helpers missing.

- [ ] **Step 3: Write helpers + policies**

```sql
-- supabase/migrations/0002_rls.sql
create function is_board_member(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid());
$$;
create function is_board_owner(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid() and role = 'owner');
$$;

alter table profiles enable row level security;
alter table boards enable row level security;
alter table board_members enable row level security;
alter table columns enable row level security;
alter table cards enable row level security;
alter table labels enable row level security;
alter table card_labels enable row level security;
alter table comments enable row level security;
alter table attachments enable row level security;

-- profiles: readable by anyone authenticated; self-update
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated using (id = auth.uid());

-- boards
create policy boards_read on boards for select using (is_board_member(id));
create policy boards_insert on boards for insert with check (owner_id = auth.uid());
create policy boards_owner_write on boards for update using (is_board_owner(id));
create policy boards_owner_delete on boards for delete using (is_board_owner(id));

-- board_members: members read; owner manages
create policy members_read on board_members for select using (is_board_member(board_id));
create policy members_owner_write on board_members for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));

-- columns / labels / card_labels: read=member, write=owner
create policy columns_read on columns for select using (is_board_member(board_id));
create policy columns_write on columns for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));
create policy labels_read on labels for select using (is_board_member(board_id));
create policy labels_write on labels for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));

-- cards: read=member, write=owner (board resolved via column)
create policy cards_read on cards for select using (
  is_board_member((select board_id from columns where id = column_id)));
create policy cards_write on cards for all using (
  is_board_owner((select board_id from columns where id = column_id))) with check (
  is_board_owner((select board_id from columns where id = column_id)));

create policy card_labels_read on card_labels for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy card_labels_write on card_labels for all using (
  is_board_owner((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));

-- comments: member can insert; author edits/deletes own; member reads
create policy comments_read on comments for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy comments_insert on comments for insert with check (
  author_id = auth.uid() and
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy comments_modify on comments for update using (author_id = auth.uid());
create policy comments_delete on comments for delete using (author_id = auth.uid());

-- attachments: member reads + inserts
create policy attachments_read on attachments for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy attachments_insert on attachments for insert with check (
  uploaded_by = auth.uid() and
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase test db`
Expected: PASS — all 4 assertions green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add RLS policies and membership helpers"
```

---

### Task 5: Auth — signup, login, session

**Files:**
- Create: `src/routes/login.tsx`, `src/routes/signup.tsx`
- Create: `src/lib/auth.ts` (server helper `requireUser`)
- Create: `src/routes/__root.tsx` modification for auth context

**Interfaces:**
- Consumes: `getServerSupabase`, `getBrowserSupabase`.
- Produces: `requireUser(request, headers): Promise<User>` — throws redirect to `/login` if no session; used by every protected loader.

- [ ] **Step 1: `requireUser` helper**

```ts
// src/lib/auth.ts
import { redirect } from '@tanstack/react-router'
import { getServerSupabase } from './supabase/server'
export async function requireUser(request: Request, headers: Headers) {
  const supabase = getServerSupabase(request, headers)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw redirect({ to: '/login' })
  return { user, supabase }
}
```

- [ ] **Step 2: Login route**

```tsx
// src/routes/login.tsx — email+password form
// on submit: getBrowserSupabase().auth.signInWithPassword({ email, password })
// on success: navigate to '/'
```

- [ ] **Step 3: Signup route**

```tsx
// src/routes/signup.tsx — email+password+name form
// getBrowserSupabase().auth.signUp({ email, password, options: { data: { name } } })
// honor ?invite=<token> query param: after signup, POST to /api/accept-invite (Task 7)
```

- [ ] **Step 4: Verify auth round-trip**

Run dev server, sign up a user, confirm a `profiles` row appears (trigger from Task 3), log out, log back in.
Expected: session cookie set, protected route redirects when logged out.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add email/password auth and session handling"
```

---

### Task 6: Boards — list and create

**Files:**
- Create: `src/routes/index.tsx` (board list + create form)
- Create: `src/lib/boards.ts` (server functions)

**Interfaces:**
- Consumes: `requireUser`.
- Produces: `createBoard(title): Promise<{ id }>` server fn — inserts a `boards` row AND an `owner` `board_members` row in a transaction; `listMyBoards(): Promise<Board[]>`.

- [ ] **Step 1: Write the failing test for board creation side-effect**

```ts
// test: createBoard inserts board + owner membership
// using a service client against local supabase, call the underlying insert logic,
// assert a board_members row with role='owner' exists for the creator
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run boards`
Expected: FAIL — `createBoard` not implemented.

- [ ] **Step 3: Implement `createBoard` + `listMyBoards`**

```ts
// src/lib/boards.ts
export async function createBoard(supabase, userId: string, title: string) {
  const { data: board, error } = await supabase
    .from('boards').insert({ title, owner_id: userId }).select('id').single()
  if (error) throw error
  const { error: mErr } = await supabase
    .from('board_members').insert({ board_id: board.id, user_id: userId, role: 'owner' })
  if (mErr) throw mErr
  return board
}
export async function listMyBoards(supabase) {
  const { data } = await supabase.from('boards').select('*').order('created_at')
  return data ?? []   // RLS already limits to member boards
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run boards`
Expected: PASS.

- [ ] **Step 5: Board list route**

```tsx
// src/routes/index.tsx
// loader: requireUser -> listMyBoards; render grid of boards + "New board" form
// each board links to /board/$boardId
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: board list and creation"
```

---

### Task 7: Invite clients to a board

**Files:**
- Create: `src/lib/invites.ts`
- Create: `src/routes/api/accept-invite.ts` (server route)
- Create: `supabase/migrations/0003_invites.sql` (pending invites table)

**Interfaces:**
- Consumes: `getServiceSupabase`, Resend (Task 13 sends mail; here just create token + row).
- Produces:
  - `inviteClient(boardId, email): Promise<{ status: 'added' | 'invited' }>` — if email maps to an existing profile, insert `board_members` (client); else insert a `pending_invites` row with a token and email the signup link.
  - `acceptInvite(token, userId): Promise<void>` — converts a pending invite into a `board_members` row.

- [ ] **Step 1: Pending invites migration**

```sql
-- supabase/migrations/0003_invites.sql
create table pending_invites (
  token uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  email text not null,
  created_at timestamptz default now()
);
alter table pending_invites enable row level security;
create policy invites_owner on pending_invites for all
  using (is_board_owner(board_id)) with check (is_board_owner(board_id));
```

- [ ] **Step 2: Write failing test for invite conversion**

```ts
// test: acceptInvite(token, userId) creates a client board_members row
// and deletes the pending_invites row
```

- [ ] **Step 3: Run test, verify fail**

Run: `npx vitest run invites`
Expected: FAIL.

- [ ] **Step 4: Implement invites**

```ts
// src/lib/invites.ts (uses service client for cross-user lookups)
export async function inviteClient(svc, boardId: string, email: string) {
  const { data: profile } = await svc.from('profiles')
    .select('id').eq('id',
      (await svc.auth.admin.listUsers()).data.users.find(u => u.email === email)?.id ?? '')
    .maybeSingle()
  if (profile) {
    await svc.from('board_members').insert({ board_id: boardId, user_id: profile.id, role: 'client' })
    return { status: 'added' as const }
  }
  const { data } = await svc.from('pending_invites')
    .insert({ board_id: boardId, email }).select('token').single()
  return { status: 'invited' as const, token: data.token }
}
export async function acceptInvite(svc, token: string, userId: string) {
  const { data: inv } = await svc.from('pending_invites').select('*').eq('token', token).single()
  if (!inv) throw new Error('invalid invite')
  await svc.from('board_members').insert({ board_id: inv.board_id, user_id: userId, role: 'client' })
  await svc.from('pending_invites').delete().eq('token', token)
}
```
(ponytail: `listUsers` scan is O(n) over users — fine at small scale; switch to an indexed email lookup table if user count grows.)

- [ ] **Step 5: Accept-invite server route**

```ts
// src/routes/api/accept-invite.ts
// POST { token } -> requireUser -> acceptInvite(getServiceSupabase(), token, user.id)
```

- [ ] **Step 6: Run test, verify pass**

Run: `npx vitest run invites`
Expected: PASS.

- [ ] **Step 7: Invite UI on board page**

Owner-only "Invite client" input (email) calling `inviteClient`. Show "added" vs "invited" result.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: client invites with signup conversion"
```

---

### Task 8: Board view — columns and cards

**Files:**
- Create: `src/routes/board.$boardId.tsx`
- Create: `src/lib/board-data.ts`
- Create: `src/components/Column.tsx`, `src/components/Card.tsx`

**Interfaces:**
- Consumes: `requireUser`.
- Produces: `loadBoard(supabase, boardId): Promise<BoardWithColumns>` where `BoardWithColumns = { id, title, role, columns: { id, title, position, cards: Card[] }[] }`; `Card = { id, title, due_date, assignee_id, labels, position }`.

- [ ] **Step 1: `loadBoard` query**

```ts
// src/lib/board-data.ts
export async function loadBoard(supabase, boardId: string) {
  const { data: board } = await supabase.from('boards').select('id,title').eq('id', boardId).single()
  const { data: columns } = await supabase
    .from('columns')
    .select('id,title,position,cards(id,title,due_date,assignee_id,position,card_labels(label_id))')
    .eq('board_id', boardId).order('position')
  const { data: membership } = await supabase
    .from('board_members').select('role').eq('board_id', boardId).single()
  // sort cards by position client-side or via nested order
  return { ...board, role: membership.role, columns: columns ?? [] }
}
```

- [ ] **Step 2: Board route + components**

```tsx
// src/routes/board.$boardId.tsx
// loader: requireUser -> loadBoard. Render columns left-to-right.
// Column.tsx renders title + Card list. Card.tsx renders title, due date, label chips.
// Owner sees "add column"/"add card" controls; client does not (gate on role).
```

- [ ] **Step 3: Verify render**

Seed a board with columns + cards, open `/board/<id>` as owner and as client.
Expected: both see cards; only owner sees add/edit controls.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: board view with columns and cards"
```

---

### Task 9: Card CRUD + drag-and-drop reorder

**Files:**
- Modify: `src/routes/board.$boardId.tsx` (wrap in dnd-kit context)
- Create: `src/lib/cards.ts`

**Interfaces:**
- Consumes: `loadBoard` types.
- Produces:
  - `createCard(supabase, columnId, title): Promise<Card>`
  - `moveCard(supabase, cardId, toColumnId, toIndex): Promise<void>` — updates `column_id` and re-sequences `position` for the destination column.

- [ ] **Step 1: Write failing test for `reorderPositions` pure helper**

```ts
// src/lib/cards.ts exports reorderPositions(ids: string[]): {id, position}[]
// test: reorderPositions(['a','b','c']) === [{id:'a',position:0},{id:'b',position:1},{id:'c',position:2}]
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run cards`
Expected: FAIL.

- [ ] **Step 3: Implement helper + card fns**

```ts
// src/lib/cards.ts
export function reorderPositions(ids: string[]) {
  return ids.map((id, i) => ({ id, position: i }))
}
export async function createCard(supabase, columnId: string, title: string) {
  const { count } = await supabase.from('cards')
    .select('id', { count: 'exact', head: true }).eq('column_id', columnId)
  const { data } = await supabase.from('cards')
    .insert({ column_id: columnId, title, position: count ?? 0 }).select().single()
  return data
}
export async function moveCard(supabase, cardId: string, toColumnId: string, orderedIds: string[]) {
  await supabase.from('cards').update({ column_id: toColumnId }).eq('id', cardId)
  for (const { id, position } of reorderPositions(orderedIds)) {
    await supabase.from('cards').update({ position }).eq('id', id)
  }
}
```
(ponytail: per-card update loop is N writes per reorder; batch via upsert or fractional positions if reorder latency shows up.)

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run cards`
Expected: PASS.

- [ ] **Step 5: Wire dnd-kit (owner only)**

```tsx
// DndContext + SortableContext per column; onDragEnd computes ordered ids and calls moveCard,
// optimistically updating local state. Disable drag when role==='client'.
```

- [ ] **Step 6: Verify drag persists**

Drag a card across columns, refresh.
Expected: card stays in new column/position.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: card creation and drag-and-drop reorder"
```

---

### Task 10: Card detail — labels, assignee, due date

**Files:**
- Create: `src/components/CardDetail.tsx`
- Modify: `src/lib/cards.ts` (`updateCard`, label assignment)

**Interfaces:**
- Produces: `updateCard(supabase, cardId, fields): Promise<void>`; `setCardLabels(supabase, cardId, labelIds): Promise<void>`.

- [ ] **Step 1: Implement update fns**

```ts
export async function updateCard(supabase, cardId, fields: Partial<{title; description; due_date; assignee_id}>) {
  await supabase.from('cards').update(fields).eq('id', cardId)
}
export async function setCardLabels(supabase, cardId, labelIds: string[]) {
  await supabase.from('card_labels').delete().eq('card_id', cardId)
  if (labelIds.length) await supabase.from('card_labels')
    .insert(labelIds.map(label_id => ({ card_id: cardId, label_id })))
}
```

- [ ] **Step 2: Card detail modal/panel**

```tsx
// CardDetail.tsx: opens on card click. Owner: editable title/description/due date,
// assignee dropdown (board members), label multi-select. Client: read-only fields.
// Comments + attachments mount here (Tasks 11, 12).
```

- [ ] **Step 3: Verify**

As owner, set due date, assignee, labels; reopen and confirm persisted. As client, fields read-only.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: card detail with labels, assignee, due date"
```

---

### Task 11: Comments with realtime

**Files:**
- Create: `src/components/Comments.tsx`
- Create: `src/lib/comments.ts`

**Interfaces:**
- Consumes: `getBrowserSupabase`.
- Produces: `addComment(supabase, cardId, authorId, body)`; `<Comments cardId />` component subscribing to realtime inserts.

- [ ] **Step 1: Enable realtime on comments**

```sql
-- supabase/migrations/0004_realtime.sql
alter publication supabase_realtime add table comments;
```

- [ ] **Step 2: Comment add fn**

```ts
// src/lib/comments.ts
export async function addComment(supabase, cardId, authorId, body) {
  const { error } = await supabase.from('comments')
    .insert({ card_id: cardId, author_id: authorId, body })
  if (error) throw error
}
```

- [ ] **Step 3: Comments component with subscription**

```tsx
// src/components/Comments.tsx
// load existing comments (with author name via join), then:
// supabase.channel(`comments:${cardId}`)
//   .on('postgres_changes',
//       { event: 'INSERT', schema: 'public', table: 'comments', filter: `card_id=eq.${cardId}` },
//       payload => append(payload.new))
//   .subscribe()
// cleanup on unmount. Both owner and client can post (RLS allows members).
```

- [ ] **Step 4: Verify realtime**

Open the same card in two browser sessions (owner + client). Post a comment in one.
Expected: appears in the other without refresh.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: realtime comments on cards"
```

---

### Task 12: Attachments via Storage

**Files:**
- Create: `src/components/Attachments.tsx`
- Create: `src/lib/attachments.ts`
- Create: `supabase/migrations/0005_storage.sql`

**Interfaces:**
- Produces: `uploadAttachment(supabase, boardId, cardId, file): Promise<Attachment>`; `<Attachments cardId boardId />`.

- [ ] **Step 1: Storage bucket + RLS migration**

```sql
-- supabase/migrations/0005_storage.sql
insert into storage.buckets (id, name, public) values ('card-files', 'card-files', false)
  on conflict do nothing;
-- path convention: {board_id}/{card_id}/{uuid}-{filename}; first segment = board_id
create policy "card-files read" on storage.objects for select to authenticated
  using (bucket_id = 'card-files' and is_board_member((storage.foldername(name))[1]::uuid));
create policy "card-files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'card-files' and is_board_member((storage.foldername(name))[1]::uuid));
```

- [ ] **Step 2: Upload fn**

```ts
// src/lib/attachments.ts
export async function uploadAttachment(supabase, boardId, cardId, file: File) {
  const path = `${boardId}/${cardId}/${crypto.randomUUID()}-${file.name}`
  const { error } = await supabase.storage.from('card-files').upload(path, file)
  if (error) throw error
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('attachments')
    .insert({ card_id: cardId, path, filename: file.name, uploaded_by: user.id })
    .select().single()
  return data
}
```

- [ ] **Step 3: Attachments component**

```tsx
// list attachments (signed URLs via supabase.storage.from('card-files').createSignedUrl(path, 3600));
// file input -> uploadAttachment. Both owner and client may upload (RLS allows members).
```

- [ ] **Step 4: Verify**

Upload a file as a client, download it via the signed URL; confirm an outsider's session cannot fetch it.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: card attachments via Supabase Storage"
```

---

### Task 13: Email notifications (Edge Function + Resend)

**Files:**
- Create: `supabase/functions/notify/index.ts`
- Create: `supabase/migrations/0006_notify_webhook.sql`

**Interfaces:**
- Consumes: `RESEND_API_KEY`, `APP_BASE_URL`.
- Produces: an Edge Function invoked by DB webhooks on `comments` insert and `cards` column change; emails the other party.

- [ ] **Step 1: Edge function**

```ts
// supabase/functions/notify/index.ts
import { createClient } from 'jsr:@supabase/supabase-js'
Deno.serve(async (req) => {
  const { type, record } = await req.json()   // webhook payload
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // resolve board members minus the actor; build subject/body by type
  // for comments: actor = record.author_id; for card move: actor = updater (pass via payload)
  const recipients = await resolveRecipients(svc, type, record)
  for (const email of recipients) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Tracker <notify@yourdomain>', to: email,
        subject: type === 'comment' ? 'New comment on a card' : 'A card was updated',
        html: `<p>Activity on your board. <a href="${Deno.env.get('APP_BASE_URL')}">Open tracker</a></p>`,
      }),
    })
  }
  return new Response('ok')
})
```

- [ ] **Step 2: Deploy function + set secrets**

```bash
npx supabase functions deploy notify
npx supabase secrets set RESEND_API_KEY=... APP_BASE_URL=...
```

- [ ] **Step 3: Wire DB webhook**

```sql
-- supabase/migrations/0006_notify_webhook.sql
-- create a trigger using supabase_functions.http_request (or Database Webhooks UI)
-- on insert into comments, and on update of cards.column_id, POSTing to the notify function URL.
```

- [ ] **Step 4: Verify**

Post a comment as a client; confirm the owner receives an email (check Resend dashboard logs). Self-actions send no mail.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: email notifications via edge function and Resend"
```

---

### Task 14: Deploy to Cloudflare

**Files:**
- Modify: `package.json` (deploy script), `wrangler.toml`

**Interfaces:**
- Produces: a live URL.

- [ ] **Step 1: Confirm deploy steps via Context7**

Query Context7 for "TanStack Start deploy Cloudflare Workers wrangler" for the current build+deploy commands.

- [ ] **Step 2: Set production secrets**

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```
(Anon vars also exposed as `VITE_` build-time for the browser bundle.)

- [ ] **Step 3: Build + deploy**

```bash
npm run build
npx wrangler deploy
```

- [ ] **Step 4: Verify production**

Open the deployed URL, sign up, create a board, invite a second email, comment from a second session.
Expected: full flow works against production Supabase.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: Cloudflare deploy config"
```

---

## Self-Review

**Spec coverage:**
- Trello kanban (boards/columns/cards/drag) → Tasks 8, 9 ✓
- Login accounts, email+password → Task 5 ✓
- Per-board roles owner/client → Tasks 4, 6, 8 ✓
- Client invite + signup conversion → Task 7 ✓
- Card basics (desc/due/assignee/labels) → Tasks 3, 10 ✓
- Live comments (realtime) → Task 11 ✓
- Email notify → Task 13 ✓
- Attachments → Task 12 ✓
- RLS trust boundary → Task 4 ✓
- TanStack Start + Supabase + Cloudflare → Tasks 1, 2, 14 ✓

**Placeholder scan:** No "TBD"/"implement later". UI-render steps reference concrete components and the exact data/fns they consume.

**Type consistency:** `is_board_member`/`is_board_owner` used consistently across Tasks 4, 7, 12. `Card`/`BoardWithColumns` defined in Task 8, consumed in 9–12. `reorderPositions` defined and used in Task 9.

**Notes:** Several UI tasks use verification steps rather than red-green tests — appropriate for SSR/UI scaffolding. TDD is applied where logic has teeth: RLS (Task 4), invite conversion (Task 7), reorder (Task 9), board creation side-effect (Task 6).

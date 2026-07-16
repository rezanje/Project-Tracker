# Inbox — Team Messaging (Phase 1: 1-on-1 DM)

**Date:** 2026-07-17
**Status:** Approved — Phase 1 scoped for implementation

## Problem

The sidebar `Inbox` item is a placeholder: it links to `/coming-soon` and shows a
hardcoded badge of `8` (`src/components/Sidebar.tsx:49`, mirrored in
`src/components/MobileNav.tsx`). Users want a real communication surface between
workspace members — distinct from the existing notification bell.

The existing **notification bell** (`NotificationsBell` in `src/components/Header.tsx`)
covers *system* events (card assignments, due reminders, join approvals) and stays
as-is. Inbox is for *person-to-person* messaging.

## Full feature vision (for context — only Phase 1 is in scope here)

Inbox is a team-messaging hub, workspace-scoped, realtime, with two streams:

1. **Direct & group messages** between workspace members.
2. **Task-comment mentions** — a comment on a task assigned to me surfaces as an item.

Delivered in three independent phases:

- **Phase 1 — DM spine (THIS SPEC):** 1-on-1 realtime messaging, real unread badge,
  `/inbox` route.
- **Phase 2 — Groups:** `kind='group'` threads with a name and add/remove participants.
  Builds on the same tables.
- **Phase 3 — Mentions:** DB trigger creating notifications on task comments, surfaced
  in the existing bell and an Inbox "Mentions" tab.

## Phase 1 scope

Ship the messaging spine: one-on-one realtime DMs between members who share a
workspace, a real unread badge replacing the hardcoded `8`, and the `/inbox` page.

**In scope**
- New tables + RLS for threads, participants, messages (schema designed to also carry
  Phase 2 groups, so no migration rework later).
- `/inbox` route: thread list (left) + active conversation (right) + composer.
- "New message" flow: pick a workspace member → find-or-create the DM thread.
- Realtime append of incoming messages (reusing the `Comments.tsx` pattern).
- Real unread badge in `Sidebar` and `MobileNav`.

**Out of scope (later phases)**
- Group threads (naming, add/remove participants).
- Task-comment mentions / the "Mentions" tab.
- Typing indicators, read receipts beyond a single `last_read_at`, attachments,
  message edit/delete, search.

## Data model — `supabase/migrations/0030_messaging.sql`

Designed once to serve Phases 1–2. Phase 1 only ever writes `kind='dm'`.

```
message_threads
  id           uuid pk default gen_random_uuid()
  workspace_id uuid not null references workspaces(id) on delete cascade
  kind         text not null check (kind in ('dm','group'))
  name         text                    -- null for dm; set for group (Phase 2)
  created_by   uuid not null references profiles(id)
  created_at   timestamptz not null default now()

thread_participants
  thread_id    uuid not null references message_threads(id) on delete cascade
  user_id      uuid not null references profiles(id) on delete cascade
  last_read_at timestamptz not null default now()
  primary key (thread_id, user_id)

messages
  id           uuid pk default gen_random_uuid()
  thread_id    uuid not null references message_threads(id) on delete cascade
  sender_id    uuid not null references profiles(id)
  body         text not null
  created_at   timestamptz not null default now()
```

**Realtime:** add `messages` to the `supabase_realtime` publication, idempotently —
same shape as `0006_realtime.sql` did for `comments`.

**RLS** (follows the established security-definer-helper pattern from
`0012_workspaces.sql`):

- `is_thread_participant(t uuid)` — security definer stable:
  `exists (select 1 from thread_participants where thread_id = t and user_id = auth.uid())`
- `message_threads`
  - read: `is_thread_participant(id)`
  - insert: `is_workspace_member(workspace_id) and created_by = auth.uid()`
- `thread_participants`
  - read: `is_thread_participant(thread_id)`
  - insert/write: rows for a thread the caller created
    (`exists (select 1 from message_threads t where t.id = thread_id and t.created_by = auth.uid())`).
    Phase 1 writes exactly the two participant rows at thread creation.
- `messages`
  - read: `is_thread_participant(thread_id)`
  - insert: `is_thread_participant(thread_id) and sender_id = auth.uid()`
  - no update/delete policy (immutable in Phase 1).

**DM find-or-create:** no DB uniqueness constraint on the member pair. A server fn
resolves or creates the canonical DM thread. `// ponytail: a race can create a
duplicate DM thread — very rare; upgrade to a unique index on a canonical sorted-pair
key if it ever happens.`

## Server functions — `src/lib/messages.ts` (new)

All use `createServerFn` + `requireUser` + cookie flush, matching
`src/lib/notifications.ts`.

- `fetchThreadsFn(): Thread[]` — threads the caller participates in, across their
  workspaces, newest-activity first. Each carries: `id`, `kind`, display title (for a
  DM, the *other* participant's name), `lastMessage` preview, `lastAt`, and `unread`
  (count of messages newer than my `last_read_at`, from other senders).
- `openDmFn({ otherUserId }): { threadId }` — validate we share a workspace with
  `otherUserId`; find an existing `kind='dm'` thread whose exactly-two participants are
  {me, other}; else create thread + two participant rows. Returns the thread id.
- `fetchMessagesFn({ threadId }): Message[]` — participant-guarded (RLS enforces too);
  ordered ascending; resolves sender names.
- `sendMessageFn({ threadId, body }): void` — insert with `sender_id = auth.uid()`;
  trims, rejects empty.
- `markThreadReadFn({ threadId }): void` — set my `last_read_at = now()`.
- `fetchInboxUnreadFn(): number` — total unread across my threads, for the badge.
- `fetchMessageableMembersFn(): { id, name }[]` — distinct approved members across the
  caller's workspaces (the "New message" picker source). Excludes self.

`Message` type: `{ id, threadId, senderId, senderName, body, createdAt }`.
`Thread` type: `{ id, kind, title, lastMessage, lastAt, unread }`.

## UI

### Route `src/routes/inbox.tsx`
Two-pane layout inside the standard app shell:

- **Left — thread list.** Rows show title (other member for a DM), last-message
  preview, relative time, and a bold/badge state when `unread > 0`. A "New message"
  button opens the member picker; selecting a member calls `openDmFn` and selects the
  resulting thread. Empty state when no threads yet.
- **Right — conversation.** Header with the thread title. Scrollable message list
  (mine right-aligned, theirs left, with sender name + `timeAgo`). Composer = dotto
  `Input` + `Button` (`sendMessageFn`, optimistic append, clear on send). On thread
  open and on new incoming message while focused, call `markThreadReadFn`.
- **Realtime.** Subscribe per open thread:
  `supabase.channel(\`messages:\${threadId}\`).on('postgres_changes', { event:'INSERT',
  table:'messages', filter:\`thread_id=eq.\${threadId}\` }, …).subscribe()`, dedupe our
  own echoed insert by id, `removeChannel` on cleanup — identical to `Comments.tsx:85`.
- Reuse dotto `Card`/`Input`/`Button`; match the pixel theme (`.card`, `.field`
  fallbacks where a dotto equivalent is missing).

Mobile: single pane — thread list, tapping a thread swaps to the conversation with a
back affordance. (Keep it simple; no separate route.)

### Badge wiring
- `Sidebar.tsx:49` — change `to: '/coming-soon'` → `to: '/inbox'`; replace the literal
  `badge: 8` with a value from `fetchInboxUnreadFn` (fetched once on mount, like the
  nav data already loads). Hide the badge when `0`.
- `MobileNav.tsx` — same `to` change and real count.

## Data flow

1. Open `/inbox` → `fetchThreadsFn` populates the list; badge sources
   `fetchInboxUnreadFn`.
2. "New message" → `fetchMessageableMembersFn` fills the picker → `openDmFn` →
   thread selected → `fetchMessagesFn` + realtime subscribe + `markThreadReadFn`.
3. Type + send → `sendMessageFn` inserts; optimistic append; realtime echo deduped.
4. Incoming message (realtime) appends; if the thread is open, `markThreadReadFn`
   keeps it read; otherwise the list row goes unread and the badge grows on next fetch.

## Error handling

- Server fns throw on RLS/validation failure; UI surfaces a small inline error on the
  composer and in the thread list load (matching existing `.catch(() => {})` +
  error-text patterns in `Header.tsx` / `QuickTaskForm.tsx`).
- `openDmFn` rejects if the target user shares no workspace with the caller.
- Empty/whitespace message bodies are rejected client- and server-side.

## Testing

Integration tests hit the real remote DB (per project convention, no mocks). Add
`src/lib/messages.test.ts` covering:

- `openDmFn` find-or-create: second call for the same pair returns the same thread.
- `sendMessageFn` + `fetchMessagesFn` round-trip; ordering.
- `fetchInboxUnreadFn` reflects unread from other senders and clears after
  `markThreadReadFn`.
- RLS: a non-participant cannot read a thread's messages; a member of a *different*
  workspace cannot `openDmFn` the target.

## Migration application

Per `CLAUDE.md`: `0030_messaging.sql` is applied to the remote Supabase DB by the user
(Dashboard SQL editor or `db push` with their pooler URL). Do not run migrations with
their DB password on their behalf.

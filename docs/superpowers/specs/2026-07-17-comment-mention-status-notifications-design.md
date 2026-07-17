# Comment Mentions & Card Status-Change Notifications

**Date:** 2026-07-17
**Status:** Approved — scoped for implementation

## Problem

The notification bell (`NotificationsBell`, `src/components/Header.tsx`) already surfaces
three event kinds: card assignment, due-date reminders, and signup approvals (super
admin only) — see `src/lib/notifications.ts`. Two event types users actually asked for
are missing:

1. **Comments that target you** — no notification today when someone comments on a
   card, whether or not they explicitly tag you.
2. **Card status change** — no notification when a card you're assigned to moves
   between board columns (this app has no `status` enum on `cards`; a card's status is
   implicitly which column it sits in — `cards.column_id`, `supabase/migrations/0001_schema.sql:30-39`).

This was partially anticipated: `docs/superpowers/specs/2026-07-17-inbox-messaging-design.md`
names "Phase 3 — Mentions" as future work (a DB trigger creating notifications from task
comments, surfaced in the bell and an Inbox "Mentions" tab). This spec is that phase,
scoped concretely, plus the new status-change trigger and an `@`-mention autocomplete
in the comment composer (not part of the original Phase 3 note).

Two other event types were considered and are **already implemented, out of scope
here**: task assignment (`notify_card_assignee()` trigger,
`supabase/migrations/0020_notifications.sql`) and due-date reminders (`reminders` table,
already merged into `fetchNotificationsFn`).

## Scope

**In scope**
- `notifications.kind` gains two new values: `'mention'`, `'status'` (existing rows are
  all implicitly `'assignment'` today — see Data Model).
- DB trigger on `comments` insert: matches `@Name` substrings in the comment body
  against board members, notifies each matched member (`kind='mention'`); separately
  notifies the card's assignee if not already matched and not the comment author.
- DB trigger on `cards` update of `column_id`: notifies the assignee (if set and not the
  mover) that the card moved columns (`kind='status'`).
- `@`-mention autocomplete dropdown in the comment composer, sourced from the `members`
  prop already passed into `Comments.tsx` — no new fetch.
- Bell renders the two new kinds (message + click-to-board, matching existing kinds).
- `/inbox` route gains a lightweight **Messages | Mentions** tab switcher; the Mentions
  tab lists `kind='mention'` notifications.

**Out of scope**
- KPI/OKR checkin approval notifications (a different "approval" concept from
  `smart-kpi`, unrelated to this feature).
- Fuzzy/partial mention matching beyond plain case-insensitive substring (see caveat
  below).
- Read receipts, notification preferences/muting, email/push delivery — the bell stays
  poll-on-load, same as today.

## Data model

`supabase/migrations/0031_comment_status_notifications.sql`:

```sql
alter table notifications
  add column kind text not null default 'assignment'
  check (kind in ('assignment', 'mention', 'status'));
```

Existing rows (all written by `notify_card_assignee()`) keep the default `'assignment'`
— no backfill needed. `notify_card_assignee()` is updated to insert `kind='assignment'`
explicitly (matches the default but stays explicit for clarity).

### Trigger: `notify_comment()`

`after insert on comments`, `security definer`, mirrors the structure of
`notify_card_assignee()`:

1. Resolve the comment's card → column → board (for the board title and to scope the
   member match to actual board members) and the author's name.
2. For every board member (via `board_members` → `profiles.name`) whose name appears as
   `@Name` in `NEW.body` (case-insensitive substring, skip the author) — insert one
   `notifications` row: `kind='mention'`, `card_id`, `board_id`,
   message `"<Author> mentioned you in a comment on \"<Card title>\""`.
3. If the card's `assignee_id` is set, is not the author, and was **not** already
   matched in step 2 — insert one more row, `kind='mention'`,
   message `"<Author> commented on \"<Card title>\", assigned to you"`.
4. Wrapped so a failure here never blocks the comment insert itself (`exception when
   others then null` around the notification-insert block, same defensive shape as
   `notify_card_assignee`).

`// ponytail: matching is plain case-insensitive substring — "Reza" inside "Reza Rahman"
can double-match if both are members of the same board. Acceptable for small teams;
upgrade to longest-name-first matching (stop once a longer containing name has matched)
if it becomes a real collision.`

### Trigger: `notify_card_column_change()`

`after update of column_id on cards`, `security definer`:

1. Skip if `column_id` didn't actually change, or `assignee_id` is null, or the mover
   (`auth.uid()`) is the assignee.
2. Resolve old/new column names + board title.
3. Insert one `notifications` row: `kind='status'`, `card_id`, `board_id`,
   message `"Moved \"<Card title>\" from <Old column> to <New column> in <Board>"`.
4. Same defensive exception-swallow as above.

## Application layer

### `src/lib/notifications.ts`

- `Notification['kind']` type: `'assignment' | 'reminder' | 'approval' | 'mention' | 'status'`.
- `fetchNotificationsFn`: the `notifications` table select adds `kind`; the
  `fromNotifs` mapping reads `n.kind` instead of hardcoding `'assignment'`.
- `markNotificationReadFn` needs no change: its validator already dispatches on
  "reminder vs. everything else" (reminders live in a separate table; the ternary's
  `'assignment'` fallback is just an internal branch tag, never written to the DB) —
  `mention`/`status` rows already fall into the "everything else" branch that updates
  `notifications.read_at`.

### `src/components/Comments.tsx` — mention autocomplete

- New local state: `mentionQuery: string | null` (null = dropdown closed),
  `mentionStart: number | null` (cursor index of the triggering `@`).
- On input change: find the `@` immediately before the cursor with no whitespace
  between it and the cursor; if found, open the dropdown with the text after `@` as the
  filter query against `members` (prop already available, `{id, name}[]`).
  Case-insensitive `startsWith` filter, list capped to a handful of matches.
- Render dropdown: simple absolutely-positioned list under the input (reuse existing
  `.card`/list styling patterns from the codebase, no new dependency).
- On selecting a member: splice `@Full Name ` into `body` at `mentionStart`, close the
  dropdown, refocus the input.
- No changes to `handlePost` / the insert path — the trigger reads whatever text ends
  up in `body`, so the client only needs to write the right literal text.

### `src/components/Header.tsx` — `NotificationsBell`

- **No code change needed.** `NotificationsBell` (`Header.tsx:238-316`) already renders
  every item generically — `n.message` + `timeAgo(n.createdAt)` — with no per-kind
  icon/label mapping. `onItemClick` only special-cases `kind === 'approval'`
  (navigates to `/admin/approvals`); everything else falls through to
  `if (n.boardId) navigate(...)`, which `mention`/`status` rows satisfy the same way
  `assignment` rows do today. The two new kinds work automatically once
  `fetchNotificationsFn` includes them.

### `src/routes/inbox.tsx` — Mentions tab

- Add a small tab switcher above the current two-pane layout:
  `Messages | Mentions`, plain local `useState<'messages' | 'mentions'>('messages')` —
  no route/query-param change, no new route file.
- `Messages` tab renders the existing thread-list/conversation pane unchanged.
- `Mentions` tab: fetch `fetchNotificationsFn()` (already exists), filter client-side to
  `kind === 'mention'`, render as a flat list (message + relative time), click navigates
  to the card's board — same click behavior as the bell.
- No new server fn needed; reuses `fetchNotificationsFn`.

## Data flow

1. Someone posts a comment (existing `addComment` client-side insert path, unchanged) →
   `notify_comment()` trigger fires → 0, 1, or 2 `notifications` rows inserted
   (mentioned members + optionally the assignee).
2. Someone drags/moves a card to a different column (existing card-update path,
   wherever `column_id` is written today) → `notify_card_column_change()` fires → 0 or 1
   row inserted.
3. Bell: next `fetchNotificationsFn()` poll picks up the new rows alongside existing
   kinds, merged and sorted as today.
4. Inbox → Mentions tab: same fetch, filtered to `kind='mention'`.
5. Composer: typing `@` filters the already-loaded `members` list client-side; no round
   trip until the comment itself is submitted.

## Error handling

- Both new triggers wrap their notification-insert logic in an exception handler that
  swallows failures — a broken mention match or a lookup failure must never block the
  comment or the card move itself. Matches the existing defensive posture of
  `notify_card_assignee()`.
- Autocomplete dropdown: if `members` is empty, the dropdown simply shows no matches
  (no error state needed — it's a derived, always-available prop).

## Testing

Per project convention (integration tests hit the real remote DB, no mocks). Extend or
add `src/lib/notifications.test.ts`:

- Posting a comment containing `@<member name>` creates a `kind='mention'` row for that
  member; a name that isn't a board member creates nothing.
- The comment author is never notified even if they type their own name.
- A comment on a card with an `assignee_id` (not the author, not otherwise mentioned)
  creates a `kind='mention'` row for the assignee; if the assignee was already matched
  by name, only one row exists (no duplicate).
- Moving a card to a different column notifies the assignee (`kind='status'`); no row
  is inserted if the assignee is the one moving it, or if there's no assignee.
- `fetchNotificationsFn` returns the new kinds correctly merged/sorted alongside
  existing `assignment`/`reminder`/`approval` rows.

## Migration application

Per `CLAUDE.md`: `0031_comment_status_notifications.sql` is applied to the remote
Supabase DB by the user (Dashboard SQL editor or `db push` with their pooler URL). Do
not run migrations with their DB password on their behalf.

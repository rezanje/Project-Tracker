# Project Tasks Tracker — Design

Date: 2026-06-26
Status: Approved

## Purpose

A Trello-style kanban tracker so the owner can track their projects and invite
clients to monitor specific boards and comment. Owner has full edit control;
clients can view and comment (and attach files) on boards shared with them.

## Stack

- **TanStack Start** (React, SSR + server functions), deployed to **Cloudflare Workers**
- **Supabase**: Auth (email + password), Postgres + Row-Level Security, Realtime, Storage
- **dnd-kit** for drag-and-drop of cards between columns
- **Resend** for transactional email, called from a Supabase Edge Function
- **Context7** MCP wired during setup for current TanStack/Supabase/Cloudflare docs

Browser connects to Supabase directly for Realtime (websockets) and Storage.
Server functions handle SSR data loading and any privileged writes.

## Roles

- `owner` — full write on a board: columns, cards, labels, invite/remove members
- `client` — read the board, insert comments, upload attachments. No structural edits.

Roles are stored per board in `board_members`, so one user can be owner of their
own boards and client on someone else's.

## Data Model (Postgres)

```
profiles(id PK → auth.users.id, name, avatar_url, created_at)

boards(id PK, owner_id → profiles, title, created_at)

board_members(board_id → boards, user_id → profiles, role text check in ('owner','client'),
              PK(board_id, user_id))

columns(id PK, board_id → boards, title, position int, created_at)

cards(id PK, column_id → columns, title, description, due_date date,
      assignee_id → profiles null, position int, created_at)

labels(id PK, board_id → boards, name, color)
card_labels(card_id → cards, label_id → labels, PK(card_id, label_id))

comments(id PK, card_id → cards, author_id → profiles, body, created_at)

attachments(id PK, card_id → cards, path text, filename text,
            uploaded_by → profiles, created_at)
```

`position` is an integer ordering within a column/board. Reorder updates positions
of affected rows. (ponytail: integer positions, switch to fractional ranking if
reorder write volume becomes a problem.)

## Access Control (RLS)

The trust boundary. Every policy keys off membership in `board_members`.

- **SELECT** on boards/columns/cards/labels/comments/attachments:
  allowed if `auth.uid()` has a `board_members` row for that board.
- **INSERT/UPDATE/DELETE** on columns/cards/labels/card_labels and
  board_members (invites):
  allowed only if `auth.uid()` has `role='owner'` for that board.
- **INSERT** on comments: allowed if member of the board (owner or client).
  UPDATE/DELETE comment: only the `author_id`.
- **INSERT** on attachments: allowed if member of the board.
- Storage bucket `card-files`: read/write gated by board membership via a
  storage RLS policy that resolves the card's board.

Membership lookups go through a `SECURITY DEFINER` helper function to avoid
recursive RLS on `board_members`.

## Flows

### Invite a client
Owner enters a client email. If the email maps to an existing profile, insert a
`board_members` row (`role='client'`). If not, send an invite email (Resend) with
a signup link; on signup, the pending invite is converted to a membership.

### Board view
Server function loads board + columns + cards (membership-checked). Client renders
columns with draggable cards (dnd-kit). Dropping a card calls a server function
that updates `column_id` + `position`.

### Comments (realtime)
Card detail subscribes to `comments` filtered by `card_id` via Supabase Realtime.
New inserts append live. Posting a comment inserts directly (RLS enforces membership).

### Email notifications
A Postgres trigger / Database Webhook on `comments` insert and on card column
change calls a Supabase Edge Function. The function looks up the other party
(owner ↔ commenting client) and sends a Resend email. Self-actions don't notify.

### Attachments
Upload to Storage bucket `card-files` under `{board_id}/{card_id}/{uuid}-{filename}`.
Insert an `attachments` row. Display via signed URLs. Membership enforced by
storage RLS.

## Environment / Secrets

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client)
- `SUPABASE_SERVICE_ROLE_KEY` (server functions / edge function only — never client)
- `RESEND_API_KEY` (edge function only)
- App base URL for invite/signup links

## Out of Scope (v1)

Checklists, activity/audit log, @mentions, cross-board client dashboards, mobile
app, card archiving, search. Add when asked.

## Testing

- RLS policy tests: a client cannot read/edit a board they're not a member of,
  cannot perform owner-only writes, cannot edit another user's comment.
- Card reorder: positions stay consistent after moves.
- Invite flow: existing-user invite vs new-user signup conversion.
- Comment realtime: insert appears in a second subscribed session.

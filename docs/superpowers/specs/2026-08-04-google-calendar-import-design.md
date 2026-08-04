# Google Calendar import (read-only, single user)

## Problem

Reza wants Rakit's Schedule page (`/calendar`) to be the one place he checks
for everything he has to do — including personal events that already live in
his Google Calendar (meetings, appointments), so he doesn't have to keep
switching apps. Today `/calendar` only shows Rakit tasks (`due_date`) and
Rakit-native schedule events (`listSchedule`, `#/lib/events`); nothing from
Google reaches it.

## Approach

One-way import: Google → Rakit, read-only, single Google account (Reza's).
No write-back to Google, no multi-user rollout, no Apple/iCloud import (that
stays on the existing ICS-subscribe idea, tracked separately, not part of
this spec).

- **Auth**: standard OAuth 2.0 Authorization Code flow against Google's
  Calendar API, scope `calendar.readonly`. This is a *second*, independent
  OAuth grant — nothing to do with Supabase auth/login. A row in a new table
  holds the refresh token; the access token is refreshed on demand.
- **Fetch model**: no background job, no webhook, no stored copy of events.
  Every time `/calendar`'s loader runs, it calls the Google Calendar API
  live for a fixed window (today − 7d to today + 60d) on the primary
  calendar, and merges the result into the existing day/month view models.
  Simplest thing that works; revisit only if API latency on that page
  becomes a real problem.
- **Google Cloud setup is external and manual** — creating the OAuth client
  in Google Cloud Console requires Reza's own Google login, so it cannot be
  done from here. Because scope is "Reza only," the OAuth consent screen can
  stay in **Testing** publish status with Reza added as a test user — this
  skips Google's app-verification review entirely (which otherwise can take
  days to weeks). Steps handed to Reza separately, not part of this repo.

## Environment variables

Both server-only — go in `.dev.vars` locally and as Worker secrets in
production (same treatment as `SUPABASE_SERVICE_ROLE_KEY`; **not**
`VITE_`-prefixed, since nothing in this feature builds the Google auth URL
client-side — `startGoogleCalendarConnectFn` does it server-side).

| Var | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | From the Google Cloud OAuth client Reza creates |
| `GOOGLE_CLIENT_SECRET` | Same |

Redirect URI registered on that OAuth client (must match exactly, both
entries — dev and prod are separate registered URIs on the same client):

- Prod: `https://rakit.rezarezanje.workers.dev/auth/google-calendar-callback`
- Dev: `http://localhost:3000/auth/google-calendar-callback`

## Changes

### 1. Migration `0046_google_calendar_connections.sql`

```sql
create table google_calendar_connections (
  user_id uuid primary key references profiles on delete cascade,
  access_token text not null,
  refresh_token text not null,
  -- Google access tokens are short-lived (~1h); this is when the current
  -- access_token stops working, so we know when to use the refresh_token.
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

-- Same shape as every other per-user table in this app: the request-scoped
-- client (see requireUser) carries the session, so auth.uid() is enough —
-- no service-role client needed anywhere in this feature.
create policy "own connection" on google_calendar_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

No `reminder_offsets`-style check constraints needed — this table is a
single opaque credential pair, not domain data.

### 2. `src/lib/google-calendar.ts` (new)

Server-only module (never imported by client code — holds a client secret).

- `getGoogleAuthUrl(state: string): string` — builds the Google consent-screen
  URL from `GOOGLE_CLIENT_ID` (public, safe to embed) + the fixed redirect
  URI + `scope=https://www.googleapis.com/auth/calendar.readonly` +
  `access_type=offline` + `prompt=consent` (forces Google to hand back a
  `refresh_token` — it's only issued on the *first* consent otherwise).
- `exchangeCodeForTokens(code: string): Promise<{access_token, refresh_token, expires_in}>`
  — POSTs to `https://oauth2.googleapis.com/token` with
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (both from `process.env`, same
  `.dev.vars` / Worker-secret pattern as `SUPABASE_SERVICE_ROLE_KEY` — see
  `src/lib/supabase/server.ts`).
- `refreshAccessToken(refresh_token: string): Promise<{access_token, expires_in}>`
  — same endpoint, `grant_type=refresh_token`.
- `fetchEvents(access_token: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]>`
  — `GET https://www.googleapis.com/calendar/v3/calendars/primary/events`
  with `timeMin`/`timeMax`/`singleEvents=true`/`orderBy=startTime`. Maps the
  response down to `{ id, title, start, end, allDay, htmlLink }` — nothing
  else from Google's payload is kept.

### 3. Server functions — `src/lib/google-calendar-actions.ts` (new)

Follows the `profile.ts` / `actions.ts` convention (`createServerFn` +
`requireUser`):

- `startGoogleCalendarConnectFn` (GET) — returns `{ url: getGoogleAuthUrl(...) }`
  for the client to `window.location.assign` to. `state` is a short random
  token stashed in a signed cookie, checked on callback (CSRF guard on the
  OAuth flow — standard practice, not optional).
- `completeGoogleCalendarConnectFn` (POST, called from the callback route's
  loader with the `code` query param) — validates `state`, calls
  `exchangeCodeForTokens`, upserts the row in `google_calendar_connections`
  keyed on `user.id`.
- `disconnectGoogleCalendarFn` (POST) — deletes the user's row.
- `fetchGoogleCalendarEventsFn` (GET) — loads the row for `user.id`; if
  `expires_at` has passed, calls `refreshAccessToken` and writes the new
  `access_token`/`expires_at` back; then calls `fetchEvents` for the fixed
  window and returns the mapped list. Returns `{ connected: false }` (not an
  error) when there's no row, so callers can render "not connected" instead
  of a crash.

### 4. New route `src/routes/auth.google-calendar-callback.tsx`

Thin page — Google redirects the browser here with `?code=...&state=...`.
Its loader calls `completeGoogleCalendarConnectFn` server-side, then the
component immediately client-redirects to `/calendar` (success) or back to
settings with a `toast('Gagal menyambungkan')` (failure — user denied
consent, code exchange failed, etc.). No visible UI beyond a brief spinner;
this route is a hop, not a destination.

### 5. `SettingsSheet.tsx` — new "Kalender" section

A row matching the file's existing style (see `Toggle`, the profile fields
above it): shows connected state (fetched via a lightweight
`googleCalendarStatusFn` GET, or piggybacked on the settings loader) —

- Not connected: "Hubungkan Google Calendar" button →
  `startGoogleCalendarConnectFn()` then `window.location.assign(url)`.
- Connected: "Terhubung" indicator + "Putuskan" button →
  `disconnectGoogleCalendarFn()` then refetch status.

### 6. `src/routes/calendar.tsx` — merge into the existing views

- Loader (`fetchCalendar`, lines 28–71) additionally calls
  `fetchGoogleCalendarEventsFn`. Failure here (network, expired refresh
  token) must not fail the whole page load — catch it, fall back to
  `{ connected: false, events: [] }`, same graceful-degradation shape as any
  other optional widget in this app.
- Mapped Google events get their own bucket, parallel to the existing
  `CalTask[]`/`ScheduleEvent[]`, e.g. `GCalEvent[]` — grouped by day the same
  way `byDay`/`eventsByDay` already are (lines 122–133), feeding both
  `DayTimeline` and `MonthGrid`.
- Visual treatment: a distinct chip style (Google's own blue reads as
  "external," which is the right signal — these aren't Rakit tasks).
  Read-only: no click-to-edit. Clicking a chip opens `htmlLink` in a new tab
  (jumps straight to the event in Google Calendar) rather than doing
  nothing.
- If `connected: false`, the day/month views render exactly as they do
  today — no empty-state clutter for the common case where nothing's wrong,
  it's just not connected yet (mirrors point 3's "not an error" contract).

## Error handling

| Failure | Behavior |
|---|---|
| User denies Google consent | Callback route redirects to Settings, toast "Gagal menyambungkan." No row written. |
| `refresh_token` revoked (user removed access on Google's side) | `fetchGoogleCalendarEventsFn` catches the refresh failure, deletes the now-dead row, returns `{ connected: false }` — Settings will show "not connected" again next time it's opened, prompting reconnect. `/calendar` degrades per point 6. |
| Google API timeout/5xx | Same graceful `{ connected: false, events: [] }` fallback on `/calendar`; logged server-side, not surfaced as a page-level error. |
| Stale `state` / CSRF check fails on callback | Treated the same as denied consent. |

## Security notes

- `GOOGLE_CLIENT_SECRET` and both tokens are touched only in
  `google-calendar.ts`/`google-calendar-actions.ts`, server-side — never
  serialized to the client.
- Scope is the minimum that does the job: `calendar.readonly`. No write
  scopes requested, so even a compromised token can't alter Reza's real
  Google Calendar.
- RLS on `google_calendar_connections` mirrors every other per-user table —
  a user can only ever see/touch their own row, enforced at the DB layer,
  not just in application code.
- Testing-mode consent screen (point in Approach) means only Google
  accounts explicitly added as test users in the Cloud Console can complete
  the OAuth flow at all — an incidental extra access control, not the
  primary one.

## Out of scope (explicit)

- Writing events *to* Google Calendar (two-way sync).
- More than one connected Google account, or any account other than Reza's.
- Apple/iCloud import (CalDAV) — no official API, materially more setup
  friction per user; separate idea, not bundled here.
- Background refresh / push notifications (Google Calendar push channels)
  — fetch-on-page-load is the whole sync model for v1.
- Per-project calendars showing Google events — confirmed scoped to
  `/calendar` (Schedule) only.

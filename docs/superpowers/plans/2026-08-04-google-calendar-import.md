# Google Calendar Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Reza's Google Calendar events (read-only) into Rakit's `/calendar` Schedule page, so it becomes the one place he checks for everything — no write-back, single user, fetched live on every page load.

**Architecture:** A new `google_calendar_connections` table holds one OAuth token pair (Reza's). A server-only module wraps the three Google HTTP calls (auth URL, token exchange, token refresh, event fetch). A thin callback route completes the OAuth handshake. `/calendar`'s existing loader gains a second, independently-failing fetch that feeds a new event bucket into the existing day/month views, which already merge two heterogeneous event sources (`CalTask`, `ScheduleEvent`) into one display — this becomes a third.

**Tech Stack:** TanStack Start `createServerFn`, Supabase (Postgres + RLS), Google Calendar API v3 + OAuth 2.0, existing `requireUser`/`Sheet` conventions.

Full design context: `docs/superpowers/specs/2026-08-04-google-calendar-import-design.md`.

---

## Before you start

This plan produces working code, but the feature stays inert until Reza:
1. Creates the Google Cloud OAuth client (external, manual — see spec's "Approach" section) and hands over `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. Applies the migration in Task 1 to the remote Supabase DB himself (Supabase Dashboard → SQL Editor, per this repo's `CLAUDE.md` — migrations are never run with the DB password by an agent).

Tasks 1–8 can all be written and unit-tested without those two things. The RLS test in Task 2 and any live-Google manual check in Task 9 need the migration applied first; Task 9 additionally needs real credentials.

---

### Task 1: Migration — `google_calendar_connections` table

**Files:**
- Create: `supabase/migrations/0046_google_calendar_connections.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One row per connected Google account. Single-user feature for now (Reza
-- only), but keyed by user_id so it's already correct if that ever changes.
create table google_calendar_connections (
  user_id uuid primary key references profiles on delete cascade,
  access_token text not null,
  refresh_token text not null,
  -- Google access tokens are short-lived (~1h). When this has passed,
  -- fetchGoogleCalendarEventsFn refreshes before calling the API.
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

-- Same shape as every other per-user table in this app (see
-- standalone_tasks): the request-scoped client from requireUser carries the
-- session, so auth.uid() alone is enough — no service-role client anywhere
-- in this feature.
create policy "own connection" on google_calendar_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply it**

This is a `create table` migration, no data to preserve — hand it to Reza to
run via Supabase Dashboard → SQL Editor (paste the file's contents → Run),
per this repo's `CLAUDE.md` migration instructions. Do **not** attempt to run
it with `db push` or a pooler URL yourself.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0046_google_calendar_connections.sql
git commit -m "Add google_calendar_connections table"
```

---

### Task 2: RLS integration test for the new table

**Files:**
- Create: `src/lib/google-calendar.test.ts`

Mirrors `src/lib/standalone-tasks.test.ts`'s pattern exactly: a real signed-in
Supabase user, real inserts, real RLS. **Requires Task 1's migration to
already be applied to the remote DB** — this test will fail with a "relation
does not exist" error otherwise; if that happens, stop and ask Reza to apply
it before continuing.

- [ ] **Step 1: Write the failing tests**

```typescript
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
  const email = `${prefix}.${Date.now()}@gmail.com`
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

test('a user can insert and read their own google_calendar_connections row', async () => {
  const { uid, userClient } = await makeSignedInUser('gcal-owner')
  try {
    const { error: insertError } = await userClient.from('google_calendar_connections').insert({
      user_id: uid,
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    expect(insertError).toBeNull()

    const { data: rows } = await userClient.from('google_calendar_connections').select('user_id, access_token')
    expect(rows).toHaveLength(1)
    expect(rows![0].user_id).toBe(uid)
    expect(rows![0].access_token).toBe('a')
  } finally {
    await admin.from('google_calendar_connections').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
}, 25000)

test("a user cannot read another user's google_calendar_connections row", async () => {
  const { uid: ownerUid } = await makeSignedInUser('gcal-owner2')
  const { uid: otherUid, userClient: otherClient } = await makeSignedInUser('gcal-other')
  try {
    await admin.from('google_calendar_connections').insert({
      user_id: ownerUid,
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })

    const { data: rows } = await otherClient.from('google_calendar_connections').select('user_id')
    expect(rows).toHaveLength(0)
  } finally {
    await admin.from('google_calendar_connections').delete().eq('user_id', ownerUid)
    await admin.auth.admin.deleteUser(ownerUid)
    await admin.auth.admin.deleteUser(otherUid)
  }
}, 25000)
```

- [ ] **Step 2: Run it**

Run: `npm test -- google-calendar`
Expected: both tests PASS if the migration is applied; a clear Postgres
"relation \"google_calendar_connections\" does not exist" error if not —
that error means stop and go apply Task 1's migration first, not a code bug
to fix here.

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar.test.ts
git commit -m "Add RLS test for google_calendar_connections"
```

---

### Task 3: Document the new env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the two new server-only vars**

Add to the `--- Server-only secrets -> put in .dev.vars ---` section (after
`RESEND_API_KEY`):

```
# Google Calendar import (read-only). See docs/superpowers/specs/2026-08-04-google-calendar-import-design.md
# for how to create these in Google Cloud Console.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Document GOOGLE_CLIENT_ID/SECRET env vars"
```

(Reza fills the real values into his own `.dev.vars` and the Cloudflare
Worker secrets — both gitignored/out-of-repo, nothing further to do here.)

---

### Task 4: `src/lib/google-calendar.ts` — Google API wrapper

**Files:**
- Create: `src/lib/google-calendar.ts`
- Test: `src/lib/google-calendar-url.test.ts`

Two pure, unit-testable functions (`getGoogleAuthUrl`, `mapGoogleEvent`) plus
three thin network functions that call Google directly. The network
functions are intentionally not unit tested here — there's no fake/mocked
Google API in this codebase's test philosophy (see `CLAUDE.md`: tests hit
the real remote Supabase, no mocks), and there's no way to hit the *real*
Google OAuth token endpoint from an automated test without a live user
consent flow. They're covered by Task 9's manual end-to-end check instead.

- [ ] **Step 1: Write the failing tests for the pure functions**

```typescript
import { expect, test } from 'vitest'
import { getGoogleAuthUrl, mapGoogleEvent } from './google-calendar'

test('getGoogleAuthUrl builds a Google OAuth consent URL with the right scope and offline access', () => {
  const url = new URL(
    getGoogleAuthUrl({
      clientId: 'client-123',
      redirectUri: 'http://localhost:3000/auth/google-calendar-callback',
      state: 'abc',
    }),
  )
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  expect(url.searchParams.get('client_id')).toBe('client-123')
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google-calendar-callback')
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly')
  expect(url.searchParams.get('access_type')).toBe('offline')
  expect(url.searchParams.get('prompt')).toBe('consent')
  expect(url.searchParams.get('state')).toBe('abc')
})

test('mapGoogleEvent maps a timed event', () => {
  const mapped = mapGoogleEvent({
    id: 'evt1',
    summary: 'Ketemu klien',
    start: { dateTime: '2026-08-10T14:00:00+07:00' },
    end: { dateTime: '2026-08-10T15:00:00+07:00' },
    htmlLink: 'https://calendar.google.com/event?eid=evt1',
  })
  expect(mapped).toEqual({
    id: 'evt1',
    title: 'Ketemu klien',
    start: '2026-08-10T14:00:00+07:00',
    end: '2026-08-10T15:00:00+07:00',
    allDay: false,
    htmlLink: 'https://calendar.google.com/event?eid=evt1',
  })
})

test('mapGoogleEvent maps an all-day event and falls back to "(Untitled)"', () => {
  const mapped = mapGoogleEvent({
    id: 'evt2',
    start: { date: '2026-08-12' },
    end: { date: '2026-08-13' },
    htmlLink: 'https://calendar.google.com/event?eid=evt2',
  })
  expect(mapped.title).toBe('(Untitled)')
  expect(mapped.allDay).toBe(true)
  expect(mapped.start).toBe('2026-08-12')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- google-calendar-url`
Expected: FAIL — `getGoogleAuthUrl`/`mapGoogleEvent` not defined yet.

- [ ] **Step 3: Write the implementation**

```typescript
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export function getGoogleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  // offline + consent: without both, Google only hands back a refresh_token
  // on a user's *first-ever* consent for this app, which breaks reconnect
  // after a disconnect.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export type GCalEvent = {
  id: string
  title: string
  /** ISO datetime for timed events, 'YYYY-MM-DD' for all-day events. */
  start: string
  end: string
  allDay: boolean
  htmlLink: string
}

type RawGoogleEvent = {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  htmlLink: string
}

export function mapGoogleEvent(raw: RawGoogleEvent): GCalEvent {
  const allDay = Boolean(raw.start.date)
  return {
    id: raw.id,
    title: raw.summary?.trim() || '(Untitled)',
    start: (raw.start.dateTime ?? raw.start.date)!,
    end: (raw.end.dateTime ?? raw.end.date)!,
    allDay,
    htmlLink: raw.htmlLink,
  }
}

export type GoogleTokens = { accessToken: string; refreshToken: string; expiresAt: string }

export async function exchangeCodeForTokens(opts: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  }
}

export async function refreshAccessToken(opts: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<{ accessToken: string; expiresAt: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  }
}

export async function fetchGoogleEvents(opts: {
  accessToken: string
  timeMin: string
  timeMax: string
}): Promise<GCalEvent[]> {
  const url = new URL(GOOGLE_EVENTS_URL)
  url.searchParams.set('timeMin', opts.timeMin)
  url.searchParams.set('timeMax', opts.timeMax)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.accessToken}` } })
  if (!res.ok) throw new Error(`Google events fetch failed: ${res.status}`)
  const json = (await res.json()) as { items: RawGoogleEvent[] }
  return (json.items ?? []).map(mapGoogleEvent)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- google-calendar-url`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-calendar.ts src/lib/google-calendar-url.test.ts
git commit -m "Add Google Calendar API wrapper (auth URL, token exchange, event fetch)"
```

---

### Task 5: `src/lib/google-calendar-actions.ts` — server functions

**Files:**
- Create: `src/lib/google-calendar-actions.ts`

Follows `src/lib/profile.ts`'s `createServerFn` + `requireUser` convention.
No unit tests here — every path either wraps `google-calendar.ts` (already
tested for its pure parts) or does a Supabase read/write already covered by
Task 2's RLS test; the wiring itself is exercised by Task 9's manual check.

- [ ] **Step 1: Write the module**

```typescript
import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getCookie, getRequest, setCookie, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from './auth'
import {
  exchangeCodeForTokens,
  fetchGoogleEvents,
  getGoogleAuthUrl,
  refreshAccessToken,
  type GCalEvent,
} from './google-calendar'

const REDIRECT_URI =
  process.env['APP_BASE_URL'] ?
    `${process.env['APP_BASE_URL']}/auth/google-calendar-callback` :
    'http://localhost:3000/auth/google-calendar-callback'

// Fixed fetch window, matching the design spec — no user-adjustable range.
const WINDOW_PAST_DAYS = 7
const WINDOW_FUTURE_DAYS = 60

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

/** Random per-attempt token, stashed in a short-lived cookie and checked back
 *  on the callback — the standard OAuth CSRF guard. Not cryptographically
 *  precious (nothing sensitive is gated behind guessing it beyond "which
 *  browser tab initiated this"), so Math.random is fine here. */
function randomState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const startGoogleCalendarConnectFn = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  await requireUser(getRequest(), headers)
  const state = randomState()
  setCookie('gcal_oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600 })
  flush(headers)
  const clientId = process.env['GOOGLE_CLIENT_ID']
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not configured')
  return { url: getGoogleAuthUrl({ clientId, redirectUri: REDIRECT_URI, state }) }
})

export const completeGoogleCalendarConnectFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { code, state } = (d ?? {}) as { code?: unknown; state?: unknown }
    if (typeof code !== 'string' || !code) throw new Error('code required')
    if (typeof state !== 'string' || !state) throw new Error('state required')
    return { code, state }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)

    const cookieState = getCookie('gcal_oauth_state')
    deleteCookie('gcal_oauth_state')
    if (!cookieState || cookieState !== data.state) throw new Error('state mismatch')

    const clientId = process.env['GOOGLE_CLIENT_ID']
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
    if (!clientId || !clientSecret) throw new Error('Google credentials not configured')

    const tokens = await exchangeCodeForTokens({
      code: data.code,
      clientId,
      clientSecret,
      redirectUri: REDIRECT_URI,
    })

    const { error } = await supabase.from('google_calendar_connections').upsert({
      user_id: user.id,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    })
    flush(headers)
    if (error) throw error
    return { ok: true }
  })

export const disconnectGoogleCalendarFn = createServerFn({ method: 'POST' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const { error } = await supabase.from('google_calendar_connections').delete().eq('user_id', user.id)
  flush(headers)
  if (error) throw error
  return { ok: true }
})

export const googleCalendarStatusFn = createServerFn({ method: 'GET' }).handler(async (): Promise<{ connected: boolean }> => {
  const headers = new Headers()
  const { user, supabase } = await requireUser(getRequest(), headers)
  const { data } = await supabase
    .from('google_calendar_connections')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  flush(headers)
  return { connected: Boolean(data) }
})

export const fetchGoogleCalendarEventsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ connected: boolean; events: GCalEvent[] }> => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    flush(headers)

    const { data: row } = await supabase
      .from('google_calendar_connections')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!row) return { connected: false, events: [] }

    try {
      const clientId = process.env['GOOGLE_CLIENT_ID']
      const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
      if (!clientId || !clientSecret) throw new Error('Google credentials not configured')

      let accessToken = row.access_token as string
      const expiresAt = new Date(row.expires_at as string)
      if (expiresAt.getTime() <= Date.now()) {
        const refreshed = await refreshAccessToken({
          refreshToken: row.refresh_token as string,
          clientId,
          clientSecret,
        })
        accessToken = refreshed.accessToken
        await supabase
          .from('google_calendar_connections')
          .update({ access_token: refreshed.accessToken, expires_at: refreshed.expiresAt })
          .eq('user_id', user.id)
      }

      const now = Date.now()
      const timeMin = new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString()
      const timeMax = new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString()
      const events = await fetchGoogleEvents({ accessToken, timeMin, timeMax })
      return { connected: true, events }
    } catch {
      // Revoked/expired refresh token, Google API hiccup, missing creds —
      // all degrade to "not connected" rather than failing the page. A
      // revoked token also gets its dead row cleaned up so Settings shows
      // "not connected" and prompts reconnect next time it's opened.
      await supabase.from('google_calendar_connections').delete().eq('user_id', user.id)
      return { connected: false, events: [] }
    }
  },
)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors mentioning `google-calendar-actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar-actions.ts
git commit -m "Add server functions for Google Calendar connect/disconnect/fetch"
```

---

### Task 6: OAuth callback route

**Files:**
- Create: `src/routes/auth.google-calendar-callback.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { completeGoogleCalendarConnectFn } from '#/lib/google-calendar-actions'
import { toast } from '#/components/Toast'

export const Route = createFileRoute('/auth/google-calendar-callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  component: GoogleCalendarCallback,
})

function GoogleCalendarCallback() {
  const { code, state } = Route.useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!code || !state) {
        toast('Gagal menyambungkan')
        navigate({ to: '/calendar' })
        return
      }
      try {
        await completeGoogleCalendarConnectFn({ data: { code, state } })
        if (!cancelled) {
          toast('Google Calendar tersambung')
          navigate({ to: '/calendar' })
        }
      } catch {
        if (!cancelled) {
          toast('Gagal menyambungkan')
          navigate({ to: '/calendar' })
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [code, state, navigate])

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <p className="text-[14px] text-[var(--ink3)]">Menyambungkan…</p>
    </main>
  )
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run generate-routes`
Expected: `src/routeTree.gen.ts` picks up the new route with no errors.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auth.google-calendar-callback.tsx src/routeTree.gen.ts
git commit -m "Add Google Calendar OAuth callback route"
```

---

### Task 7: Settings UI — connect / disconnect

**Files:**
- Modify: `src/components/SettingsSheet.tsx`

- [ ] **Step 1: Read the current file to find where to add the section**

Look at how the existing profile fields render (`Toggle`, the fields fetched
via `fetchProfileFn`) — add the new section using the same `useState` +
`useEffect`-on-mount fetch pattern already used for the profile data in this
file, so it's consistent rather than introducing a second data-fetching
style in the same component.

- [ ] **Step 2: Add state + fetch for connection status**

Near the component's existing `useState`/`useEffect` for profile data, add:

```tsx
import { disconnectGoogleCalendarFn, googleCalendarStatusFn, startGoogleCalendarConnectFn } from '#/lib/google-calendar-actions'

// ...inside the component, alongside the existing profile state:
const [gcalConnected, setGcalConnected] = useState<boolean | null>(null)
const [gcalBusy, setGcalBusy] = useState(false)

useEffect(() => {
  googleCalendarStatusFn().then((r) => setGcalConnected(r.connected))
}, [])

async function connectGoogleCalendar() {
  setGcalBusy(true)
  try {
    const { url } = await startGoogleCalendarConnectFn()
    window.location.assign(url)
  } catch {
    toast('Gagal menyambungkan')
    setGcalBusy(false)
  }
}

async function disconnectGoogleCalendar() {
  setGcalBusy(true)
  try {
    await disconnectGoogleCalendarFn()
    setGcalConnected(false)
    toast('Google Calendar diputus')
  } catch {
    toast('Gagal memutus koneksi')
  } finally {
    setGcalBusy(false)
  }
}
```

- [ ] **Step 3: Add the section to the JSX**

Add a new section below the existing profile fields, matching the file's
existing row style (rounded `bg-[var(--col)]` block, same as `Toggle`'s
wrapper):

```tsx
<div className="mt-5">
  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
    Kalender
  </p>
  <div className="flex items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
    <span className="min-w-0 flex-1">
      <span className="block text-[14px] font-bold text-[var(--ink)]">Google Calendar</span>
      <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ink3)]">
        {gcalConnected ? 'Terhubung — jadwal masuk ke Schedule.' : 'Belum terhubung.'}
      </span>
    </span>
    {gcalConnected === null ? null : gcalConnected ? (
      <button
        type="button"
        onClick={disconnectGoogleCalendar}
        disabled={gcalBusy}
        className="shrink-0 rounded-full bg-[var(--card)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--ink2)]"
      >
        Putuskan
      </button>
    ) : (
      <button
        type="button"
        onClick={connectGoogleCalendar}
        disabled={gcalBusy}
        className="shrink-0 rounded-full bg-[var(--btn)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--btn-ink)]"
      >
        Hubungkan
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Manual check**

Start the dev server, open Settings, confirm the new "Kalender" row renders
with "Belum terhubung." and a "Hubungkan" button (clicking it will 500 until
Task 3's env vars are real — that's expected at this point in the plan).

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsSheet.tsx
git commit -m "Add Google Calendar connect/disconnect to Settings"
```

---

### Task 8: Merge Google events into `/calendar`

**Files:**
- Modify: `src/routes/calendar.tsx`

- [ ] **Step 1: Extend the loader's data shape and fetch**

```tsx
// Add to the imports at the top:
import { fetchGoogleCalendarEventsFn } from '#/lib/google-calendar-actions'
import type { GCalEvent } from '#/lib/google-calendar'
```

Change `CalendarData` and `fetchCalendar` (existing code shown for context —
the diff is the added `gcalEvents` field and the third parallel fetch):

```tsx
type CalendarData = { tasks: CalTask[]; events: ScheduleEvent[]; gcalEvents: GCalEvent[] }

const fetchCalendar = createServerFn({ method: 'GET' }).handler(async (): Promise<CalendarData> => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  try {
    const [{ data: boards }, events, gcal] = await Promise.all([
      supabase
        .from('boards')
        .select('id,title,workspace_id,columns(title,cards(id,title,due_date,due_time))')
        .neq('status', 'archived'),
      listSchedule(supabase),
      // Independent of the boards/events queries above: a Google API hiccup
      // must not take down the rest of the page (design spec's error-handling
      // table), so its own failure is caught right here, not left to bubble
      // into the outer catch that would also blank out tasks/events.
      fetchGoogleCalendarEventsFn().catch(() => ({ connected: false, events: [] as GCalEvent[] })),
    ])

    const tasks: CalTask[] = []
    for (const b of (boards ?? []) as Array<{
      id: string
      title: string
      workspace_id: string | null
      columns?: Array<{ title: string; cards?: Array<{ id: string; title: string; due_date: string | null; due_time: string | null }> }>
    }>) {
      for (const col of b.columns ?? []) {
        const done = isDoneColumn(col.title)
        for (const c of col.cards ?? []) {
          if (c.due_date)
            tasks.push({
              id: c.id,
              title: c.title,
              boardTitle: b.title,
              boardId: b.id,
              wsId: b.workspace_id,
              due: c.due_date,
              dueTime: c.due_time,
              done,
            })
        }
      }
    }
    for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
    return { tasks, events, gcalEvents: gcal.events }
  } catch {
    return { tasks: [], events: [], gcalEvents: [] }
  }
})
```

- [ ] **Step 2: Group by day and pass down**

In `CalendarPage`, alongside the existing `byDay`/`eventsByDay`:

```tsx
const { tasks: allTasks, events, gcalEvents } = Route.useLoaderData() as CalendarData
// ...
const gcalByDay = new Map<string, GCalEvent[]>()
for (const e of gcalEvents) {
  const day = e.start.slice(0, 10) // 'YYYY-MM-DDTHH:mm:ss...' or 'YYYY-MM-DD' — first 10 chars are the date either way
  const arr = gcalByDay.get(day) ?? []
  arr.push(e)
  gcalByDay.set(day, arr)
}
```

Pass it to both view components:

```tsx
{view === 'day' ? (
  <>
    <WeekStrip selected={selected} onSelect={setSelected} todayStr={todayStr} />
    <DayTimeline
      events={eventsByDay.get(keyOf(selected)) ?? []}
      tasks={byDay.get(keyOf(selected)) ?? []}
      gcalEvents={gcalByDay.get(keyOf(selected)) ?? []}
      onOpenBoard={openBoard}
    />
  </>
) : (
  <MonthGrid
    y={selected.getFullYear()}
    m={selected.getMonth()}
    byDay={byDay}
    eventsByDay={eventsByDay}
    gcalByDay={gcalByDay}
    todayStr={todayStr}
    onPickDay={(d) => {
      setSelected(d)
      setView('day')
    }}
  />
)}
```

- [ ] **Step 3: Render in `DayTimeline`**

Google events carry a real hour, so they slot into the same hourly rail as
`ScheduleEvent`s — a distinct card style marks them as external. Add a
`GOOGLE_TONE` constant near the file's other constants (`HOURS`, `DOW`):

```tsx
const GOOGLE_TONE = '#4285F4' // Google's own blue — reads as "external" at a glance
```

Update `DayTimeline`'s signature and hour-bucketing:

```tsx
function DayTimeline({
  events,
  tasks,
  gcalEvents,
  onOpenBoard,
}: {
  events: ScheduleEvent[]
  tasks: CalTask[]
  gcalEvents: GCalEvent[]
  onOpenBoard: (boardId: string) => void
}) {
  const byHour = new Map<number, Array<{ kind: 'event'; e: ScheduleEvent } | { kind: 'gcal'; e: GCalEvent }>>()
  for (const e of events) {
    const h = Number(e.time.slice(0, 2))
    const slot = Math.min(Math.max(h, HOURS[0]), HOURS[HOURS.length - 1])
    const arr = byHour.get(slot) ?? []
    arr.push({ kind: 'event', e })
    byHour.set(slot, arr)
  }
  for (const e of gcalEvents) {
    if (e.allDay) continue // shown separately below, same reasoning as tasks having no "hour"
    const h = Number(e.start.slice(11, 13))
    const slot = Math.min(Math.max(h, HOURS[0]), HOURS[HOURS.length - 1])
    const arr = byHour.get(slot) ?? []
    arr.push({ kind: 'gcal', e })
    byHour.set(slot, arr)
  }
  const allDayGcal = gcalEvents.filter((e) => e.allDay)
```

Update the render loop (the `slot.map((e) => ...)` block) to branch on
`kind`, and add the all-day section above the hourly rail, right after the
existing `{tasks.length > 0 && (...)}` block:

```tsx
{allDayGcal.length > 0 && (
  <section>
    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
      Google Calendar
    </p>
    <div className="flex flex-col gap-2.5">
      {allDayGcal.map((e) => (
        <a
          key={e.id}
          href={e.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="card card-hover flex gap-3.5 px-4 py-[15px] text-left no-underline"
        >
          <span className="w-[3px] shrink-0 rounded-full" style={{ background: GOOGLE_TONE }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[var(--ink)]">{e.title}</span>
        </a>
      ))}
    </div>
  </section>
)}
```

And inside the hourly loop, replace `{slot.map((e) => (...))}` with a branch:

```tsx
{slot.map((item) =>
  item.kind === 'event' ? (
    <article key={item.e.id} className="card flex gap-3.5 px-4 py-[14px]">
      <span className="w-[3px] shrink-0 rounded-full" style={{ background: accentFor(item.e.type) }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{item.e.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-[var(--ink3)]">{item.e.sub || item.e.type}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Attendees n={item.e.people} />
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink2)]">
            <Clock size={13} aria-hidden="true" />
            {prettyTime(item.e.time)}
          </span>
        </div>
      </div>
    </article>
  ) : (
    <a
      key={item.e.id}
      href={item.e.htmlLink}
      target="_blank"
      rel="noreferrer"
      className="card flex gap-3.5 px-4 py-[14px] no-underline"
    >
      <span className="w-[3px] shrink-0 rounded-full" style={{ background: GOOGLE_TONE }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold text-[var(--ink)]">{item.e.title}</p>
        <p className="mt-0.5 text-[13px] text-[var(--ink3)]">Google Calendar</p>
      </div>
    </a>
  ),
)}
```

Also update the empty-state check just above the hourly rail:

```tsx
{events.length === 0 && tasks.length === 0 && gcalEvents.length === 0 && (
  <p className="py-6 text-[14px] text-[var(--ink3)]">Nothing scheduled 🎉</p>
)}
```

- [ ] **Step 4: Render in `MonthGrid`**

Google events join the existing unified `items` array — no new visual
pattern needed here, just another source feeding the same chips (matching
how tasks and schedule events already combine):

```tsx
function MonthGrid({
  y,
  m,
  byDay,
  eventsByDay,
  gcalByDay,
  todayStr,
  onPickDay,
}: {
  y: number
  m: number
  byDay: Map<string, CalTask[]>
  eventsByDay: Map<string, ScheduleEvent[]>
  gcalByDay: Map<string, GCalEvent[]>
  todayStr: string
  onPickDay: (d: Date) => void
}) {
```

And in the cell-building code:

```tsx
const items = [
  ...(eventsByDay.get(ds) ?? []).map((e) => ({ id: e.id, title: e.title, tone: accentFor(e.type), done: false })),
  ...(gcalByDay.get(ds) ?? []).map((e) => ({ id: e.id, title: e.title, tone: GOOGLE_TONE, done: false })),
  ...(byDay.get(ds) ?? []).map((t) => ({ id: t.id, title: t.title, tone: accentFor(t.boardId), done: t.done })),
]
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Manual check**

Start the dev server, open `/calendar` while not connected to Google —
confirm day and month views render exactly as before (empty `gcalEvents`
array is a no-op everywhere it's threaded through).

- [ ] **Step 7: Commit**

```bash
git add src/routes/calendar.tsx
git commit -m "Merge Google Calendar events into the Schedule day/month views"
```

---

### Task 9: End-to-end manual verification (blocked on Reza's Google Cloud setup)

**Files:** none — this is a checklist, run once real credentials exist.

Not automatable: requires a live Google OAuth consent screen and a real
Google account. Run this after Reza has:
- Created the Google Cloud OAuth client and added `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` to `.dev.vars` (dev) and Worker secrets (prod).
- Applied Task 1's migration.

- [ ] Open Settings → "Kalender" shows "Belum terhubung." + "Hubungkan".
- [ ] Click "Hubungkan" → lands on Google's real consent screen, requesting
      only calendar read access.
- [ ] Approve → redirected back to `/calendar`, toast "Google Calendar
      tersambung", Settings now shows "Terhubung."
- [ ] A known event on Reza's real Google Calendar (create a test one if
      needed, within the next 60 days) appears in both day and month view,
      in the Google-blue color, and clicking it (day view) opens the real
      event in a new Google Calendar tab.
- [ ] An event more than 60 days out, or more than 7 days in the past, does
      **not** appear (window boundary check).
- [ ] Reload `/calendar` after editing that event's title directly in Google
      Calendar — confirm the new title shows in Rakit (proves live
      fetch-on-load, not a stale cache).
- [ ] Settings → "Putuskan" → status flips to "Belum terhubung.", and
      `/calendar` no longer shows any Google events on next reload.
- [ ] In Google Account settings (myaccount.google.com → Security → Third-party
      access), manually revoke Rakit's access, then reload `/calendar` without
      clicking "Putuskan" first — confirm the page still renders (tasks/events
      intact) rather than erroring, and Settings shows "Belum terhubung." on
      next visit (dead-token cleanup path from Task 5).

---

## Deploy

Once Task 9 passes: `npm run deploy` (per this repo's standard deploy
command), then re-run the parts of Task 9 that touch the live callback URL
against `https://rakit.rezarezanje.workers.dev` specifically — the prod
redirect URI is a separate registered entry on the same Google OAuth client
(see the spec's "Environment variables" section) and is worth confirming
independently of the localhost run.

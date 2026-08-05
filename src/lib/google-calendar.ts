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
  // A malformed/cancelled recurring-instance exception can have neither
  // start.dateTime nor start.date — mapGoogleEvent's non-null assertion would
  // otherwise let `start: undefined` through as a typed string, which crashes
  // the calendar page's date-slicing logic downstream. Drop those here so
  // every GCalEvent this module returns has a real, usable start.
  return (json.items ?? []).map(mapGoogleEvent).filter((e) => e.start)
}

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
 *  on the callback — the standard OAuth CSRF guard. */
function randomState(): string {
  return crypto.randomUUID()
}

export const startGoogleCalendarConnectFn = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  await requireUser(getRequest(), headers)
  const state = randomState()
  setCookie('gcal_oauth_state', state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    secure: process.env['APP_BASE_URL']?.startsWith('https://') ?? false,
  })
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

    const clientId = process.env['GOOGLE_CLIENT_ID']
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
    if (!clientId || !clientSecret) {
      console.error('fetchGoogleCalendarEventsFn: Google credentials not configured')
      return { connected: false, events: [] }
    }

    let accessToken = row.access_token as string
    const expiresAt = new Date(row.expires_at as string)
    if (expiresAt.getTime() <= Date.now()) {
      try {
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
      } catch (error) {
        // Refresh token itself is dead (revoked, expired) — the connection
        // can never recover on its own, so clean it up. Settings will show
        // "not connected" and prompt reconnect next time it's opened.
        console.error('fetchGoogleCalendarEventsFn: token refresh failed, dropping connection', error)
        await supabase.from('google_calendar_connections').delete().eq('user_id', user.id)
        return { connected: false, events: [] }
      }
    }

    try {
      const now = Date.now()
      const timeMin = new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString()
      const timeMax = new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString()
      const events = await fetchGoogleEvents({ accessToken, timeMin, timeMax })
      return { connected: true, events }
    } catch (error) {
      // The token is still good — this is a transient Google-side hiccup
      // (rate limit, 5xx, network blip). Leave the connection row alone so
      // the next fetch just retries, rather than forcing a full reconnect.
      console.error('fetchGoogleCalendarEventsFn: event fetch failed, connection kept', error)
      return { connected: false, events: [] }
    }
  },
)

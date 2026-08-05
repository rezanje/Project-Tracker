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

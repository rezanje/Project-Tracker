import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptions,
} from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Minimal cookie helpers (no external dep)
// ---------------------------------------------------------------------------

/** Parse a raw Cookie header string into an array of {name, value} pairs. */
function parseCookies(cookieHeader: string): { name: string; value: string }[] {
  if (!cookieHeader) return []
  return cookieHeader.split(';').flatMap((pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return []
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    return name ? [{ name, value }] : []
  })
}

/** Serialize a cookie name/value and options into a Set-Cookie header string. */
function serializeCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): string {
  let cookie = `${name}=${value}`
  if (!options) return cookie

  if (options.maxAge != null) cookie += `; Max-Age=${options.maxAge}`
  if (options.domain) cookie += `; Domain=${options.domain}`
  if (options.path) cookie += `; Path=${options.path}`
  if (options.expires instanceof Date)
    cookie += `; Expires=${options.expires.toUTCString()}`
  if (options.httpOnly) cookie += '; HttpOnly'
  if (options.secure) cookie += '; Secure'
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  return cookie
}

// ---------------------------------------------------------------------------
// Server clients
// ---------------------------------------------------------------------------

/**
 * Request-scoped Supabase client using the anon key + request cookies.
 * Passes RLS policies — always prefer this for route loaders / actions.
 *
 * @param request        The incoming Fetch API Request
 * @param responseHeaders  A mutable Headers object; set-cookie headers are
 *                         appended here so the caller can attach them to the
 *                         response (important for session refresh).
 */
export function getServerSupabase(request: Request, responseHeaders: Headers) {
  const cookies: CookieMethodsServer = {
    getAll: () => parseCookies(request.headers.get('cookie') ?? ''),
    setAll: (cookiesToSet) =>
      cookiesToSet.forEach(({ name, value, options }) =>
        responseHeaders.append('set-cookie', serializeCookie(name, value, options)),
      ),
  }

  return createServerClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_ANON_KEY']!,
    { cookies },
  )
}

/**
 * Service-role Supabase client — bypasses RLS entirely.
 * SERVER-ONLY. Never import this from browser code or expose its return value
 * to the client.
 *
 * NOTE (Cloudflare prod): process.env works in local dev via `nodejs_compat`
 * + the Vite plugin loading `.dev.vars`. In production the Worker `env`
 * bindings must be forwarded to process.env (or read directly from `env`) —
 * wire this up in the deploy/binding task.
 */
export function getServiceSupabase() {
  return createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    { auth: { persistSession: false } },
  )
}

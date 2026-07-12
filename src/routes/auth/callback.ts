import { createFileRoute } from '@tanstack/react-router'
import { getServerSupabase } from '#/lib/supabase/server'

/**
 * OAuth (PKCE) redirect target. Supabase sends the user back here with a `?code`
 * after Google auth; we exchange it for a session on the server so the auth
 * cookies are set before the next SSR render (avoids a login redirect race).
 */
export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const headers = new Headers()
        if (code) {
          const supabase = getServerSupabase(request, headers)
          await supabase.auth.exchangeCodeForSession(code)
        }
        // 303 → GET on `/home`, carrying the freshly-set session Set-Cookie headers.
        headers.set('Location', new URL(code ? '/home' : '/login', url.origin).toString())
        return new Response(null, { status: 303, headers })
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { acceptInvite } from '#/lib/invites'

export const Route = createFileRoute('/api/accept-invite')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = new Headers()
        const { user } = await requireUser(request, headers)
        const { token } = (await request.json()) as { token?: string }
        if (!token)
          return Response.json({ error: 'token required' }, { status: 400 })
        await acceptInvite(getServiceSupabase(), token, user.id)
        return Response.json({ ok: true }, { headers })
      },
    },
  },
})

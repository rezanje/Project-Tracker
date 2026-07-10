import { createFileRoute } from '@tanstack/react-router'
import { getSessionUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { acceptInvite } from '#/lib/invites'
import { acceptWorkspaceInvite } from '#/lib/workspaces'

export const Route = createFileRoute('/api/accept-invite')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = new Headers()
        const { user } = await getSessionUser(request, headers)
        const { token, wtoken } = (await request.json()) as {
          token?: string
          wtoken?: string
        }
        if (!token && !wtoken)
          return Response.json({ error: 'token required' }, { status: 400 })
        const svc = getServiceSupabase()
        if (token) await acceptInvite(svc, token, user.id)
        if (wtoken) await acceptWorkspaceInvite(svc, wtoken, user.id)
        return Response.json({ ok: true }, { headers })
      },
    },
  },
})

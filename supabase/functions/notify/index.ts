import { createClient } from 'jsr:@supabase/supabase-js@2'

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE'
  table: string
  record: Record<string, unknown>
  old_record?: Record<string, unknown>
}

async function resolveRecipients(
  svc: ReturnType<typeof createClient>,
  eventType: 'comment' | 'card',
  payload: WebhookPayload,
): Promise<string[]> {
  let boardId: string | null = null
  let actorId: string | null = null

  if (eventType === 'comment') {
    // actor is the comment author
    actorId = payload.record.author_id as string | null
    const cardId = payload.record.card_id as string

    // card -> column -> board
    const { data: card, error: cardErr } = await svc
      .from('cards')
      .select('column_id')
      .eq('id', cardId)
      .single()
    if (cardErr || !card) {
      console.error('resolveRecipients: could not fetch card', cardErr)
      return []
    }

    const { data: column, error: colErr } = await svc
      .from('columns')
      .select('board_id')
      .eq('id', card.column_id)
      .single()
    if (colErr || !column) {
      console.error('resolveRecipients: could not fetch column', colErr)
      return []
    }

    boardId = column.board_id as string
  } else {
    // card move: use the new column_id -> board
    const columnId = payload.record.column_id as string
    const { data: column, error: colErr } = await svc
      .from('columns')
      .select('board_id')
      .eq('id', columnId)
      .single()
    if (colErr || !column) {
      console.error('resolveRecipients: could not fetch column for card move', colErr)
      return []
    }
    boardId = column.board_id as string
    // No reliable actor for card moves; notify everyone
    actorId = null
  }

  if (!boardId) return []

  // Get all board members
  const { data: members, error: membersErr } = await svc
    .from('board_members')
    .select('user_id')
    .eq('board_id', boardId)
  if (membersErr || !members) {
    console.error('resolveRecipients: could not fetch board_members', membersErr)
    return []
  }

  // Collect emails, excluding the actor
  const emails: string[] = []
  for (const member of members) {
    const userId = member.user_id as string
    if (actorId && userId === actorId) continue

    const { data: userData, error: userErr } = await svc.auth.admin.getUserById(userId)
    if (userErr || !userData?.user?.email) continue
    emails.push(userData.user.email)
  }

  return emails
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload

    const { type, table, record, old_record } = payload

    // Determine event type; skip if not relevant
    let eventType: 'comment' | 'card' | null = null
    if (table === 'comments' && type === 'INSERT') {
      eventType = 'comment'
    } else if (
      table === 'cards' &&
      type === 'UPDATE' &&
      old_record &&
      record.column_id !== old_record.column_id
    ) {
      eventType = 'card'
    }

    if (!eventType) {
      return new Response('ok (no-op)', { status: 200 })
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const recipients = await resolveRecipients(svc, eventType, payload)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const appUrl = Deno.env.get('APP_BASE_URL') ?? 'http://localhost:5180'

    for (const email of recipients) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Tracker <onboarding@resend.dev>',
          to: email,
          subject: eventType === 'comment' ? 'New comment on a card' : 'A card was updated',
          html: `<p>Activity on your board. <a href="${appUrl}">Open tracker</a></p>`,
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        console.error(`Resend send failed to ${email}: ${res.status} ${body}`)
      }
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('notify function error:', err)
    return new Response('error', { status: 500 })
  }
})

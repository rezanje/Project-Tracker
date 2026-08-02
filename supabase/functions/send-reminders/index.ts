import { createClient } from 'jsr:@supabase/supabase-js@2'

/** The message carries a user-supplied task title, and the mail goes to people
 *  who did not write it — escape before it becomes markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** link_path is trigger-written today, but the column is plain text and this
 *  is the other injection point into the email — only accept an in-app path. */
function safeLinkPath(p: unknown): string {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/home'
}

// Polled by pg_cron every minute (see migration 0022). Emails every reminder
// whose remind_at has passed and hasn't been emailed yet, then stamps
// emailed_at so the same reminder never sends twice.
Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('missing RESEND_API_KEY')
      return new Response('ok (no api key)', { status: 200 })
    }
    const appUrl = Deno.env.get('APP_BASE_URL') ?? 'http://localhost:5180'

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: due, error } = await svc
      .from('reminders')
      .select('id,user_id,message,link_path')
      .is('emailed_at', null)
      .is('dismissed_at', null)
      .lte('remind_at', new Date().toISOString())
    if (error) {
      console.error('send-reminders: fetch failed', error)
      return new Response('error', { status: 200 })
    }

    // Who has switched reminder emails off (profiles.email_reminders, 0037).
    // One query rather than one per reminder: the opted-out set is small and a
    // missing row falls through to "send", matching the column default.
    const optedOut = new Set<string>()
    const { data: offRows, error: offErr } = await svc
      .from('profiles')
      .select('id')
      .eq('email_reminders', false)
    if (offErr) console.error('send-reminders: opt-out fetch failed', offErr)
    for (const p of offRows ?? []) optedOut.add(p.id as string)

    let sent = 0
    for (const r of due ?? []) {
      // Stamp opted-out reminders as handled too, or every run re-reads them
      // forever. The bell still shows them in-app — this switch is email-only.
      if (optedOut.has(r.user_id as string)) {
        await svc.from('reminders').update({ emailed_at: new Date().toISOString() }).eq('id', r.id as string)
        continue
      }

      const { data: userData, error: userErr } = await svc.auth.admin.getUserById(r.user_id as string)
      const email = userData?.user?.email
      if (userErr || !email) {
        // No usable address — stamp it as handled or this row gets re-read
        // and re-looked-up every minute forever.
        console.error(`send-reminders: no email for user ${r.user_id as string}`, userErr)
        await svc.from('reminders').update({ emailed_at: new Date().toISOString() }).eq('id', r.id as string)
        continue
      }

      // Claim the row before sending. The endpoint is unauthenticated and
      // pg_net has no overlap guard, so two invocations can reach the same
      // reminder; whoever wins the conditional update owns it.
      const { data: claimed } = await svc
        .from('reminders')
        .update({ emailed_at: new Date().toISOString() })
        .eq('id', r.id as string)
        .is('emailed_at', null)
        .select('id')
      if (!claimed?.length) continue

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Rakit <onboarding@resend.dev>',
          to: email,
          subject: 'Reminder',
          html: `<p>${escapeHtml(r.message as string)}</p><p><a href="${appUrl}${safeLinkPath(r.link_path)}">Open Rakit</a></p>`,
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        console.error(`send-reminders: Resend failed for ${email}: ${res.status} ${body}`)
        // 429 and 5xx are worth another minute; a 4xx is the address or the
        // payload, and retrying it every minute forever helps nobody.
        if (res.status === 429 || res.status >= 500) {
          await svc.from('reminders').update({ emailed_at: null }).eq('id', r.id as string)
        }
        continue
      }
      sent++
    }

    return new Response(`ok (${sent} sent)`, { status: 200 })
  } catch (err) {
    console.error('send-reminders function error:', err)
    return new Response('error', { status: 200 })
  }
})

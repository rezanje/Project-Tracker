import { createClient } from 'jsr:@supabase/supabase-js@2'

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
      .select('id,user_id,message')
      .is('emailed_at', null)
      .is('dismissed_at', null)
      .lte('remind_at', new Date().toISOString())
    if (error) {
      console.error('send-reminders: fetch failed', error)
      return new Response('error', { status: 200 })
    }

    let sent = 0
    for (const r of due ?? []) {
      const { data: userData, error: userErr } = await svc.auth.admin.getUserById(r.user_id as string)
      const email = userData?.user?.email
      if (userErr || !email) continue

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
          html: `<p>${r.message}</p><p><a href="${appUrl}/home">Open Rakit</a></p>`,
        }),
      })
      if (!res.ok) {
        console.error(`send-reminders: Resend failed for ${email}: ${res.status} ${await res.text()}`)
        continue
      }
      await svc.from('reminders').update({ emailed_at: new Date().toISOString() }).eq('id', r.id as string)
      sent++
    }

    return new Response(`ok (${sent} sent)`, { status: 200 })
  } catch (err) {
    console.error('send-reminders function error:', err)
    return new Response('error', { status: 200 })
  }
})

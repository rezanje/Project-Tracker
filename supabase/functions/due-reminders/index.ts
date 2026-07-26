import { createClient } from 'jsr:@supabase/supabase-js@2'

// Polled by pg_cron once a day at 01:00 UTC / 08:00 WIB (see migration 0033).
// Inserts a `reminders` row for every task due today that isn't finished; the
// per-minute send-reminders cron (0022) emails them and the notifications bell
// merges them, so this function only has to pick the right tasks.

/** "Today" in WIB (UTC+7). Due dates are plain calendar dates, so using the UTC
 *  day would fire up to 7 hours off for the local user. Mirrors localDateStr(). */
function wibToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Copy of isDoneColumn() in src/lib/home.ts — a card in a "Done"/"Complete"
 *  column is finished, so it gets no reminder. */
function isDoneColumn(title: string): boolean {
  return /done|complete/i.test(title)
}

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return new Response('unauthorized', { status: 401 })
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = wibToday()
    const nowIso = new Date().toISOString()
    const rows: Array<{ user_id: string; message: string; remind_at: string; source_key: string }> = []

    // Standalone tasks: owner is the recipient.
    const { data: standalone, error: sErr } = await svc
      .from('standalone_tasks')
      .select('id,user_id,title')
      .eq('done', false)
      .eq('due_date', today)
    if (sErr) {
      console.error('due-reminders: standalone fetch failed', sErr)
    } else {
      for (const t of standalone ?? []) {
        rows.push({
          user_id: t.user_id as string,
          message: `Due today: "${t.title}"`,
          remind_at: nowIso,
          source_key: `due:standalone:${t.id}:${today}`,
        })
      }
    }

    // Board cards: assignee is the recipient. The done-column and archived-board
    // rules are applied here rather than in SQL so the regex stays identical to
    // isDoneColumn()'s.
    const { data: cards, error: cErr } = await svc
      .from('cards')
      .select('id,title,assignee_id,columns!inner(title,boards!inner(id,title,status))')
      .eq('due_date', today)
      .not('assignee_id', 'is', null)
    if (cErr) {
      console.error('due-reminders: card fetch failed', cErr)
    } else {
      for (const c of cards ?? []) {
        const col = c.columns as unknown as { title: string; boards: { title: string; status: string } }
        if (isDoneColumn(col.title) || col.boards.status === 'archived') continue
        rows.push({
          user_id: c.assignee_id as string,
          message: `Due today: "${c.title}" in ${col.boards.title}`,
          remind_at: nowIso,
          source_key: `due:card:${c.id}:${today}`,
        })
      }
    }

    if (rows.length === 0) return new Response('ok (0 queued)', { status: 200 })

    // source_key is uniquely indexed, so a re-fired cron is a no-op rather than
    // a duplicate email.
    const { error: insErr } = await svc
      .from('reminders')
      .upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true })
    if (insErr) {
      console.error('due-reminders: insert failed', insErr)
      return new Response('error', { status: 200 })
    }

    return new Response(`ok (${rows.length} queued)`, { status: 200 })
  } catch (err) {
    // Returned as 200 on purpose: pg_net has no backoff, and a 5xx would make it
    // hammer this endpoint. The error is logged for debugging.
    console.error('due-reminders function error:', err)
    return new Response('error', { status: 200 })
  }
})

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Vitest globalSetup: the exported teardown runs once after every file, whether
// the run passed, failed or timed out. Each test cleans up its own users in a
// `finally`, but a timeout or a dropped connection skips that — and the orphans
// pile up as pending sign-ups the super admin sees forever.

/** Test users are created as `${prefix}.${Date.now()}@gmail.com`. */
const TEST_EMAIL = /^[a-z0-9-]+\.\d{13}@gmail\.com$/

function devVars(): Record<string, string> {
  return Object.fromEntries(
    readFileSync('.dev.vars', 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

/** Rows that reference profiles without `on delete cascade` — deleting the auth
 *  user fails on these. Boards cascade to columns/cards/comments/attachments,
 *  so clearing boards and workspaces covers almost everything in practice. */
async function clearOwnedRows(admin: SupabaseClient, uid: string) {
  await admin.from('cards').update({ assignee_id: null }).eq('assignee_id', uid)
  await admin.from('comments').delete().eq('author_id', uid)
  await admin.from('attachments').delete().eq('uploaded_by', uid)
  await admin.from('notes').delete().eq('user_id', uid)
  await admin.from('announcements').delete().eq('author_id', uid)
  await admin.from('boards').delete().eq('owner_id', uid)
  await admin.from('workspaces').delete().eq('owner_id', uid)
}

export async function teardown() {
  let admin: SupabaseClient
  try {
    const env = devVars()
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  } catch {
    return // no .dev.vars — nothing to sweep against
  }

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error || !data) return

  // Two conditions, not one: the email shape says "made by a test", and
  // not-approved says "never became a real account". Anything approved is left
  // alone, so a real sign-up that happened to match the pattern survives.
  // Not `= pending`: a super admin who clears the queue by rejecting them
  // leaves the accounts behind as 'rejected', which is just as much litter.
  const candidates = data.users.filter((u) => u.email && TEST_EMAIL.test(u.email))
  if (candidates.length === 0) return

  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .neq('status', 'approved')
    .in(
      'id',
      candidates.map((u) => u.id),
    )
  const doomed = new Set((profiles ?? []).map((p) => p.id as string))
  if (doomed.size === 0) return

  let swept = 0
  for (const id of doomed) {
    try {
      await clearOwnedRows(admin, id)
      const { error: delErr } = await admin.auth.admin.deleteUser(id)
      if (!delErr) swept++
    } catch {
      // Best effort: one stubborn leftover shouldn't fail the whole run.
    }
  }
  if (swept > 0) console.log(`[sweep] removed ${swept} leftover test user(s)`)
}

import type { SupabaseClient } from '@supabase/supabase-js'

export type PicMemberRow = { board_id: string; user_id: string; is_pic: boolean }

/**
 * Which of these boards the given user is PIC of. Pure so it can be tested
 * without a request context — `fetchDashboard` is a server function and can't
 * be called directly from a test.
 */
export function myPicBoardIds(rows: PicMemberRow[], userId: string): Set<string> {
  const out = new Set<string>()
  for (const r of rows) if (r.is_pic && r.user_id === userId) out.add(r.board_id)
  return out
}

/**
 * PIC ("person in charge") of a project, stored as a flag on the membership row
 * rather than its own table — a PIC is therefore always a project member, and
 * removing the membership removes the PIC with it.
 *
 * Writes are restricted to the board owner by the existing
 * `members_owner_write` RLS policy on `board_members`; no policy of our own.
 */
export async function listBoardPicIds(
  supabase: SupabaseClient,
  boardId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('board_members')
    .select('user_id')
    .eq('board_id', boardId)
    .eq('is_pic', true)
  if (error) throw error
  return (data ?? []).map((r) => r.user_id as string)
}

/** Make exactly `userIds` the PICs of `boardId`; everyone else is cleared. */
export async function setBoardPics(
  supabase: SupabaseClient,
  boardId: string,
  userIds: string[],
): Promise<void> {
  // Clear first, then set — two statements rather than a diff, because the
  // member list is small and this stays correct no matter what was there
  // before. ponytail: full rewrite, switch to a diff only if boards ever grow
  // membership lists big enough for it to matter.
  const { error: clearErr } = await supabase
    .from('board_members')
    .update({ is_pic: false })
    .eq('board_id', boardId)
    .eq('is_pic', true)
  if (clearErr) throw clearErr

  if (userIds.length === 0) return

  const { error: setErr } = await supabase
    .from('board_members')
    .update({ is_pic: true })
    .eq('board_id', boardId)
    .in('user_id', userIds)
  if (setErr) throw setErr
}

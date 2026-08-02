import type { SupabaseClient } from '@supabase/supabase-js'

/** Personal, project-less tasks. RLS (standalone_tasks_own) scopes all rows
 *  to user_id = auth.uid(), so no ownership check is needed here beyond
 *  passing the caller's id on create and scoping the update by it. */
export async function createStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  workspaceId: string,
  dueDate: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .insert({ user_id: userId, title, workspace_id: workspaceId, due_date: dueDate })
  if (error) throw error
}

export async function completeStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .update({ done: true })
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

/** Edit a personal task's deadline and reminders. Scoped by user_id as well as
 *  id so a service-role caller can't cross accounts by mistake; RLS already
 *  covers the browser path. */
export async function updateStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  fields: Partial<{
    title: string
    due_date: string | null
    due_time: string | null
    reminder_offsets: number[] | null
    done: boolean
  }>,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .update(fields)
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteStandaloneTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('standalone_tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

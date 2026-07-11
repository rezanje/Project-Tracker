import type { SupabaseClient } from '@supabase/supabase-js'

/** Add a workspace pillar. RLS restricts to the workspace owner. */
export async function createPillar(
  supabase: SupabaseClient,
  workspaceId: string,
  name: string,
  color: string,
): Promise<void> {
  const { data: last } = await supabase
    .from('pillars')
    .select('position')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const position = last ? last.position + 1 : 0
  const { error } = await supabase
    .from('pillars')
    .insert({ workspace_id: workspaceId, name, color, position })
  if (error) throw error
}

/** Delete a pillar; cards.pillar_id nulls out via FK on delete set null. */
export async function deletePillar(supabase: SupabaseClient, pillarId: string): Promise<void> {
  const { error } = await supabase.from('pillars').delete().eq('id', pillarId)
  if (error) throw error
}

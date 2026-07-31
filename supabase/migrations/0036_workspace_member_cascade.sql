-- supabase/migrations/0036_workspace_member_cascade.sql
-- Projects can now be staffed by picking someone already in the workspace, which
-- writes an explicit board_members row. That row grants access on its own via
-- is_board_member()'s first arm — so without this trigger, removing someone from
-- a workspace would leave every such row behind and they would keep being able to
-- open and edit those projects. PIC is a flag on the board_members row, so their
-- PIC status is dropped along with it.
--
-- Boards with workspace_id is null are untouched: `b.workspace_id = old.workspace_id`
-- never matches null.
-- Idempotent throughout so a partial re-run can't fail halfway.

create or replace function drop_board_memberships_on_workspace_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from board_members bm
   where bm.user_id = old.user_id
     and bm.board_id in (
       select b.id from boards b where b.workspace_id = old.workspace_id
     );
  return old;
end $$;

drop trigger if exists on_workspace_member_delete on workspace_members;
create trigger on_workspace_member_delete
  after delete on workspace_members
  for each row execute function drop_board_memberships_on_workspace_leave();

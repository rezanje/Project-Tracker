-- An explicit board role now beats the one derived from workspace membership.
--
-- is_board_editor (0012) OR'd the two sources together, so any workspace member
-- could edit every board in that workspace — including boards where an owner
-- had deliberately marked them `client`. The read-only role only ever held for
-- people outside the workspace, which is the opposite of what the board UI
-- shows: board-data.ts resolves the badge as `membership?.role ?? wsRole`, the
-- explicit row winning. The database now agrees with the screen.
--
-- Board owners keep the OR. is_board_owner already covers both a board `owner`
-- row and ownership of the enclosing workspace, and a workspace owner locked
-- out of a board in their own workspace by a stray `client` row would be a
-- worse bug than the one being fixed here.
create or replace function is_board_editor(b uuid) returns boolean language sql security definer stable as $$
  select is_board_owner(b) or case
    when exists (select 1 from board_members where board_id = b and user_id = auth.uid())
      then exists (
        select 1 from board_members
        where board_id = b and user_id = auth.uid() and role in ('owner', 'member')
      )
    else exists (
      select 1 from boards bo
      where bo.id = b and bo.workspace_id is not null and is_workspace_member(bo.workspace_id)
    )
  end;
$$;

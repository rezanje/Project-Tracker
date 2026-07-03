-- Third per-board role: member (task editor), between owner and client.

alter table board_members drop constraint board_members_role_check;
alter table board_members add constraint board_members_role_check
  check (role in ('owner', 'member', 'client'));

alter table pending_invites add column role text not null default 'client'
  check (role in ('member', 'client'));

-- Editor = owner or member. security definer + stable, like the sibling helpers.
create function is_board_editor(b uuid) returns boolean language sql security definer stable as $$
  select exists (
    select 1 from board_members
    where board_id = b and user_id = auth.uid() and role in ('owner', 'member')
  );
$$;

-- Members may write cards and their labels; phases/labels/project stay owner-only.
drop policy cards_write on cards;
create policy cards_write on cards for all using (
  is_board_editor((select board_id from columns where id = column_id))) with check (
  is_board_editor((select board_id from columns where id = column_id)));

drop policy card_labels_write on card_labels;
create policy card_labels_write on card_labels for all using (
  is_board_editor((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id))) with check (
  is_board_editor((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));

-- Membership helpers + RLS for all tables.
-- security definer so the function can read board_members regardless of caller RLS.
create function is_board_member(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid());
$$;
create function is_board_owner(b uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid() and role = 'owner');
$$;

alter table profiles enable row level security;
alter table boards enable row level security;
alter table board_members enable row level security;
alter table columns enable row level security;
alter table cards enable row level security;
alter table labels enable row level security;
alter table card_labels enable row level security;
alter table comments enable row level security;
alter table attachments enable row level security;

-- profiles: any authenticated user reads; self-update only
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated using (id = auth.uid());

-- boards: members read; creator inserts as owner; owner updates/deletes
create policy boards_read on boards for select using (is_board_member(id));
create policy boards_insert on boards for insert with check (owner_id = auth.uid());
create policy boards_owner_write on boards for update using (is_board_owner(id));
create policy boards_owner_delete on boards for delete using (is_board_owner(id));

-- board_members: members read; owner manages all
create policy members_read on board_members for select using (is_board_member(board_id));
create policy members_owner_write on board_members for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));

-- columns / labels: read=member, write=owner
create policy columns_read on columns for select using (is_board_member(board_id));
create policy columns_write on columns for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));
create policy labels_read on labels for select using (is_board_member(board_id));
create policy labels_write on labels for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));

-- cards: board resolved via column
create policy cards_read on cards for select using (
  is_board_member((select board_id from columns where id = column_id)));
create policy cards_write on cards for all using (
  is_board_owner((select board_id from columns where id = column_id))) with check (
  is_board_owner((select board_id from columns where id = column_id)));

-- card_labels: board resolved via card -> column
create policy card_labels_read on card_labels for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy card_labels_write on card_labels for all using (
  is_board_owner((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));

-- comments: member reads; member inserts as self; author edits/deletes own
create policy comments_read on comments for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy comments_insert on comments for insert with check (
  author_id = auth.uid() and
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy comments_modify on comments for update using (author_id = auth.uid());
create policy comments_delete on comments for delete using (author_id = auth.uid());

-- attachments: member reads + inserts as self
create policy attachments_read on attachments for select using (
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));
create policy attachments_insert on attachments for insert with check (
  uploaded_by = auth.uid() and
  is_board_member((select c.board_id from cards ca join columns c on c.id = ca.column_id where ca.id = card_id)));

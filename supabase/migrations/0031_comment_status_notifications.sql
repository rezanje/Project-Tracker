-- supabase/migrations/0031_comment_status_notifications.sql
-- Adds `kind` to notifications (was implicitly always "assignment"), and two new
-- triggers: comment mentions/assignee-notify, and card column-change notify.

alter table notifications
  add column if not exists kind text not null default 'assignment'
  check (kind in ('assignment', 'mention', 'status'));

-- Re-create explicitly with `kind` passed, for clarity (functionally unchanged —
-- 'assignment' is also the column default).
create or replace function notify_card_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;

  select b.id, b.title into v_board_id, v_board_title
    from columns c join boards b on b.id = c.board_id where c.id = new.column_id;

  insert into notifications (user_id, card_id, board_id, message, kind)
  values (new.assignee_id, new.id, v_board_id, 'Assigned you to "' || new.title || '" in ' || coalesce(v_board_title, 'a board'), 'assignment');
  return new;
end $$;

-- Comment mentions: `@Name` substring match against board members, plus an
-- auto-notify for the card's assignee (if not already matched by name).
create or replace function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
  v_card_title text;
  v_assignee_id uuid;
  v_author_name text;
  v_matched_assignee boolean := false;
  m record;
begin
  select b.id, b.title, ca.title, ca.assignee_id
    into v_board_id, v_board_title, v_card_title, v_assignee_id
    from cards ca
    join columns co on co.id = ca.column_id
    join boards b on b.id = co.board_id
    where ca.id = new.card_id;

  select coalesce(name, 'Someone') into v_author_name from profiles where id = new.author_id;

  begin
    for m in
      select p.id, p.name
      from board_members bm
      join profiles p on p.id = bm.user_id
      where bm.board_id = v_board_id
        and bm.user_id <> new.author_id
        and p.name is not null and p.name <> ''
        and position(lower('@' || p.name) in lower(new.body)) > 0
    loop
      insert into notifications (user_id, card_id, board_id, message, kind)
      values (m.id, new.card_id, v_board_id,
        v_author_name || ' mentioned you in a comment on "' || v_card_title || '"', 'mention');
      if m.id = v_assignee_id then
        v_matched_assignee := true;
      end if;
    end loop;

    if v_assignee_id is not null and v_assignee_id <> new.author_id and not v_matched_assignee then
      insert into notifications (user_id, card_id, board_id, message, kind)
      values (v_assignee_id, new.card_id, v_board_id,
        v_author_name || ' commented on "' || v_card_title || '", assigned to you', 'mention');
    end if;
  exception when others then
    null; -- never let a notification failure block the comment insert
  end;

  return new;
end $$;

drop trigger if exists on_comment_insert on comments;
create trigger on_comment_insert
  after insert on comments
  for each row execute function notify_comment();

-- Card status (column) change: notify the assignee when the card moves to a
-- different column, unless they're the one moving it.
create or replace function notify_card_column_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
  v_old_col_title text;
  v_new_col_title text;
begin
  if new.column_id is not distinct from old.column_id then return new; end if;
  if new.assignee_id is null then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;

  select co.title, b.id, b.title into v_new_col_title, v_board_id, v_board_title
    from columns co join boards b on b.id = co.board_id where co.id = new.column_id;
  select title into v_old_col_title from columns where id = old.column_id;

  begin
    insert into notifications (user_id, card_id, board_id, message, kind)
    values (
      new.assignee_id, new.id, v_board_id,
      'Moved "' || new.title || '" from ' || coalesce(v_old_col_title, '?') ||
        ' to ' || coalesce(v_new_col_title, '?') || ' in ' || coalesce(v_board_title, 'a board'),
      'status'
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists on_card_column_change on cards;
create trigger on_card_column_change
  after update of column_id on cards
  for each row execute function notify_card_column_change();

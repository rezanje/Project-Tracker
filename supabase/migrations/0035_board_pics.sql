-- supabase/migrations/0035_board_pics.sql
-- Multiple PICs per project, stored as a flag on the existing membership row.
-- Keeping PIC on board_members (PK: board_id, user_id) means a PIC can never
-- exist without the membership it depends on, and removing someone from the
-- project drops their PIC status with no extra cleanup.
-- Idempotent throughout so a partial re-run can't fail halfway.

alter table board_members
  add column if not exists is_pic boolean not null default false;

-- Partial index: we only ever query for the PICs of a board, never the rest.
create index if not exists board_members_pic_idx
  on board_members (board_id) where is_pic;

-- Widen the notification kinds (was: assignment, mention, status).
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('assignment', 'mention', 'status', 'pic'));

-- Notify every PIC of the board when a task is created, except whoever created
-- it. security definer for the same reason as notify_card_assignee(): the PIC is
-- rarely the acting user, so RLS (user_id = auth.uid()) on notifications would
-- block the insert.
create or replace function notify_card_pics() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_board_title text;
  m record;
begin
  select b.id, b.title into v_board_id, v_board_title
    from columns c join boards b on b.id = c.board_id
    where c.id = new.column_id;

  if v_board_id is null then return new; end if;

  begin
    for m in
      select bm.user_id
      from board_members bm
      where bm.board_id = v_board_id
        and bm.is_pic
        and bm.user_id is distinct from auth.uid()
    loop
      insert into notifications (user_id, card_id, board_id, message, kind)
      values (m.user_id, new.id, v_board_id,
        'New task "' || new.title || '" in ' || coalesce(v_board_title, 'a project'),
        'pic');
    end loop;
  exception when others then
    null; -- never let a notification failure block task creation
  end;

  return new;
end $$;

drop trigger if exists on_card_insert_notify_pics on cards;
create trigger on_card_insert_notify_pics
  after insert on cards
  for each row execute function notify_card_pics();

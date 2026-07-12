-- Minimal notification feed: "you were assigned a task."
-- Idempotent throughout so a partial/re-run (e.g. the table already exists
-- from a prior attempt) can't fail halfway through.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  card_id uuid references cards on delete cascade,
  board_id uuid references boards on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select using (user_id = auth.uid());
drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fires on assignee_id insert/change; security definer since the assignee is
-- rarely the acting user (owner assigning a teammate), so RLS on notifications
-- (user_id = auth.uid()) would otherwise block the insert.
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

  insert into notifications (user_id, card_id, board_id, message)
  values (new.assignee_id, new.id, v_board_id, 'Assigned you to "' || new.title || '" in ' || coalesce(v_board_title, 'a board'));
  return new;
end $$;

drop trigger if exists on_card_assignee_change on cards;
create trigger on_card_assignee_change
  after insert or update of assignee_id on cards
  for each row execute function notify_card_assignee();

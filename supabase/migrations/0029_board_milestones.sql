-- Board Roadmap panel was fully hardcoded (same 4 fake milestones on every
-- board). Real per-board milestones, owner-managed. done/active/upcoming is
-- derived from start_date/end_date vs today — no separate status column.

create table board_milestones (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now()
);
alter table board_milestones enable row level security;
create policy board_milestones_read on board_milestones for select using (is_board_member(board_id));
create policy board_milestones_write on board_milestones for all
  using (is_board_owner(board_id)) with check (is_board_owner(board_id));

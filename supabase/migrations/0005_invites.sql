create table pending_invites (
  token uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  email text not null,
  created_at timestamptz default now()
);
alter table pending_invites enable row level security;
-- only a board owner can create/read/delete its pending invites
create policy invites_owner on pending_invites for all
  using (is_board_owner(board_id)) with check (is_board_owner(board_id));

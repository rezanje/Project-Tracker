-- Project metadata + owner-only financials.

-- Metadata visible to all board members (owner + client viewers).
alter table boards
  add column description text,
  add column type text,                       -- free text; rendered as a coloured label
  add column pic text,                         -- person in charge (owner only, for now)
  add column status text not null default 'active'
    check (status in ('active', 'on_hold', 'done', 'archived')),
  add column client_name text,
  add column start_date date,
  add column deadline date,
  add column priority text
    check (priority in ('low', 'medium', 'high'));

-- Financials live in a separate table so RLS can hide them from client
-- members, who can otherwise SELECT every column of a board they can read.
create table project_finance (
  board_id uuid primary key references boards on delete cascade,
  value_idr bigint not null default 0          -- whole rupiah, never a float
);
alter table project_finance enable row level security;

-- Only the board owner may read or write the value.
create policy finance_owner_all on project_finance
  for all using (is_board_owner(board_id)) with check (is_board_owner(board_id));

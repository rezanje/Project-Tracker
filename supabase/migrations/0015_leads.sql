-- Leads pipeline: a board "kind" + lead-specific card fields.

alter table boards add column kind text not null default 'tasks'
  check (kind in ('tasks', 'leads'));

alter table cards add column contact text;
alter table cards add column phone text;
alter table cards add column source text;
alter table cards add column deal_value bigint;

-- Seed default columns by kind on board create.
create or replace function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members (board_id, user_id, role) values (new.id, new.owner_id, 'owner');
  if new.kind = 'leads' then
    insert into public.columns (board_id, title, position) values
      (new.id, 'New', 0), (new.id, 'Contacted', 1), (new.id, 'Qualified', 2),
      (new.id, 'Proposal', 3), (new.id, 'Won', 4), (new.id, 'Lost', 5);
  else
    insert into public.columns (board_id, title, position) values
      (new.id, 'Backlog', 0), (new.id, 'In Progress', 1), (new.id, 'Done', 2);
  end if;
  return new;
end $$;

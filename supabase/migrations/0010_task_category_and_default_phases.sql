alter table cards add column category text;

-- Seed default phases on every new board so it's usable immediately.
create or replace function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members (board_id, user_id, role)
    values (new.id, new.owner_id, 'owner');
  insert into public.columns (board_id, title, position) values
    (new.id, 'Backlog', 0), (new.id, 'In Progress', 1), (new.id, 'Done', 2);
  return new;
end $$;

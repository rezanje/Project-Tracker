-- Auto-add the creator as an owner member when a board is created.
-- Atomic + security definer so it bypasses the RLS bootstrap problem
-- (is_board_owner is false until the first owner row exists).
create function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members (board_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger on_board_created after insert on boards
  for each row execute function add_owner_membership();

-- handle_new_user runs as supabase_auth_admin via the auth.users trigger.
-- That role's search_path excludes `public`, so the unqualified `profiles`
-- insert failed with "Database error saving new user". Pin search_path and
-- schema-qualify the table.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, new.raw_user_meta_data->>'name');
  return new;
end $$;

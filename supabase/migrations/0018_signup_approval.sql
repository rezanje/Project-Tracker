-- Signup approval gate + single super admin.

alter table profiles add column status text not null default 'pending'
  check (status in ('pending', 'approved'));
alter table profiles add column is_super_admin boolean not null default false;

-- Everyone who already has access today keeps it — only new self-signups
-- (no invite token) start pending from here on.
update profiles set status = 'approved';

-- Flag the super admin by email (auth.users holds email, not profiles).
-- Fail loudly rather than silently no-op if the account doesn't exist yet.
do $$
declare admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'rezarezanje@gmail.com';
  if admin_id is null then
    raise exception 'super admin email rezarezanje@gmail.com not found in auth.users — cannot flag super admin';
  end if;
  update profiles set status = 'approved', is_super_admin = true where id = admin_id;
end $$;

create function is_super_admin() returns boolean language sql security definer stable as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

-- Super admin can flip any profile's status/is_super_admin; the existing
-- self-update policy (id = auth.uid()) still covers name/avatar edits.
create policy profiles_admin_write on profiles for update
  using (is_super_admin()) with check (is_super_admin());

-- Approval inserts a membership row directly (no invite token involved), so
-- the owner-only insert paths need a super-admin escape hatch.
create policy wsm_admin_write on workspace_members for insert
  with check (is_super_admin());
create policy members_admin_write on board_members for insert
  with check (is_super_admin());

-- profiles_update (0002_rls.sql) has no WITH CHECK, so Postgres reuses its
-- USING clause (id = auth.uid()) as the check — any authenticated user could
-- otherwise self-approve/self-promote via that policy, bypassing
-- profiles_admin_write (permissive policies for the same command are OR'd).
-- Pin status/is_super_admin back unless the caller is the super admin or a
-- trusted service-role write (no user JWT, so auth.uid() is null there —
-- acceptInvite/acceptWorkspaceInvite/future approval flows run this way).
create function guard_profile_admin_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.is_super_admin is distinct from old.is_super_admin)
     and auth.uid() is not null and not is_super_admin() then
    new.status := old.status;
    new.is_super_admin := old.is_super_admin;
  end if;
  return new;
end $$;

create trigger guard_profile_admin_columns before update on profiles
  for each row execute function guard_profile_admin_columns();

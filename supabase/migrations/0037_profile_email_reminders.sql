-- Per-user opt-out for reminder emails. Default true so existing users keep the
-- behaviour they have today; the per-minute send-reminders cron reads this
-- column and skips anyone who has switched it off.
--
-- No policy work needed: profiles_update (0002_rls) already lets a user write
-- their own row, and guard_profile_admin_columns (0018) only pins
-- status/is_super_admin, so this column is freely self-writable by design.
alter table profiles add column if not exists email_reminders boolean not null default true;

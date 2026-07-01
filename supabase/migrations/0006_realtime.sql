-- Enable Supabase Realtime on the comments table so card comments
-- broadcast INSERTs to subscribed clients. Idempotent: skip if the
-- table is already part of the supabase_realtime publication.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table comments;
  end if;
end $$;

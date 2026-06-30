-- Storage bucket for card file attachments.
-- Path convention: {board_id}/{card_id}/{uuid}-{filename}
-- The first path segment (board_id) is what the storage RLS uses via
-- storage.foldername(name)[1] to verify board membership.

insert into storage.buckets (id, name, public)
  values ('card-files', 'card-files', false)
  on conflict do nothing;

-- Make policy creation idempotent in case of re-runs.
drop policy if exists "card-files read" on storage.objects;
drop policy if exists "card-files write" on storage.objects;

create policy "card-files read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'card-files'
    and is_board_member((storage.foldername(name))[1]::uuid)
  );

create policy "card-files write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'card-files'
    and is_board_member((storage.foldername(name))[1]::uuid)
  );

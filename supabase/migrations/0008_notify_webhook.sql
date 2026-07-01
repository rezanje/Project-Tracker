-- Webhook triggers that call the notify Edge Function on relevant DB events.
-- Uses pg_net (net.http_post) which must be installed (CREATE EXTENSION pg_net).
-- pg_net is installed by this migration if not already present.
--
-- The Edge Function is deployed at:
--   https://tzhquesopfxevsucoapb.supabase.co/functions/v1/notify
--
-- Security note: the function is deployed with --no-verify-jwt so no bearer
-- token is required in the webhook call. A shared-secret Authorization header
-- can be added here and verified inside the function to harden this later.

-- Ensure pg_net extension is installed
create extension if not exists pg_net;

-- Helper trigger function for comment inserts
create or replace function public.notify_on_comment_fn()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := 'https://tzhquesopfxevsucoapb.supabase.co/functions/v1/notify',
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  'comments',
                 'record', row_to_json(new)::jsonb
               ),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end $$;

-- Helper trigger function for card column_id changes
create or replace function public.notify_on_card_move_fn()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := 'https://tzhquesopfxevsucoapb.supabase.co/functions/v1/notify',
    body    := jsonb_build_object(
                 'type',       'UPDATE',
                 'table',      'cards',
                 'record',     row_to_json(new)::jsonb,
                 'old_record', row_to_json(old)::jsonb
               ),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end $$;

-- Drop existing triggers idempotently before re-creating them
drop trigger if exists notify_on_comment on comments;
drop trigger if exists notify_on_card_move on cards;

-- Trigger: after a new comment is inserted
create trigger notify_on_comment
  after insert on comments
  for each row
  execute function public.notify_on_comment_fn();

-- Trigger: after a card's column_id changes (card moved between columns)
create trigger notify_on_card_move
  after update on cards
  for each row
  when (old.column_id is distinct from new.column_id)
  execute function public.notify_on_card_move_fn();

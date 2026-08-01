-- "Done" has never been a stored fact — it is derived on read from a card's
-- column title (isDoneColumn, src/lib/home.ts: /done|complete/i). That's fine
-- for a snapshot but leaves no record of *when* a card became done, so no
-- completion trend can be drawn without this.
--
-- Existing done cards get no backfilled date — there is no way to know when
-- they actually finished, and guessing (e.g. created_at) would be a made-up
-- number presented as real. completed_at starts null for everyone and fills
-- in only from here forward, as cards actually move.
alter table cards add column if not exists completed_at timestamptz;

-- A card's column only ever changes through moveCard (src/lib/cards.ts, drag
-- and drop), setCardColumnFn or completeCardFn (src/lib/actions.ts) — three
-- call sites today, and a fourth would be an easy thing to forget to update by
-- hand. A trigger makes the stamping unconditional instead of something every
-- future call site has to remember.
--
-- Mirrors isDoneColumn's own regex; Postgres `~*` is case-insensitive match,
-- same as the `/i` flag there. If that heuristic ever changes, this needs to
-- change with it.
create or replace function stamp_card_completed_at() returns trigger
language plpgsql set search_path = public as $$
declare
  moved_to_done boolean;
begin
  if new.column_id is distinct from old.column_id then
    select exists (
      select 1 from columns where id = new.column_id and title ~* 'done|complete'
    ) into moved_to_done;
    -- coalesce: re-entering Done after a prior visit keeps the earlier
    -- timestamp rather than resetting it, so a card dragged out and back in
    -- doesn't look freshly completed. Leaving Done always clears it.
    new.completed_at := case when moved_to_done then coalesce(new.completed_at, now()) else null end;
  end if;
  return new;
end $$;

create trigger cards_stamp_completed_at before update on cards
  for each row execute function stamp_card_completed_at();

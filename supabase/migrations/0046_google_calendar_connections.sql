-- One row per connected Google account. Single-user feature for now (Reza
-- only), but keyed by user_id so it's already correct if that ever changes.
create table google_calendar_connections (
  user_id uuid primary key references profiles on delete cascade,
  access_token text not null,
  refresh_token text not null,
  -- Google access tokens are short-lived (~1h). When this has passed,
  -- fetchGoogleCalendarEventsFn refreshes before calling the API.
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

-- Same shape as every other per-user table in this app (see
-- standalone_tasks): the request-scoped client from requireUser carries the
-- session, so auth.uid() alone is enough — no service-role client anywhere
-- in this feature.
create policy "own connection" on google_calendar_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

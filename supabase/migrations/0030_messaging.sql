-- Inbox messaging: threads, participants, messages. Schema carries a `kind`
-- and nullable `name` so Phase 2 group threads reuse these tables unchanged.
create table message_threads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null check (kind in ('dm','group')),
  name         text,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

create table thread_participants (
  thread_id    uuid not null references message_threads(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references message_threads(id) on delete cascade,
  sender_id  uuid not null references profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);

create index messages_thread_created_idx on messages (thread_id, created_at);
create index thread_participants_user_idx on thread_participants (user_id);

-- Security-definer membership check (same pattern as is_workspace_member in 0012).
create function is_thread_participant(t uuid) returns boolean
  language sql security definer stable as $$
  select exists (
    select 1 from thread_participants
    where thread_id = t and user_id = auth.uid()
  );
$$;

alter table message_threads    enable row level security;
alter table thread_participants enable row level security;
alter table messages            enable row level security;

-- Threads: read if participant; create if a workspace member creating your own.
create policy mt_read on message_threads for select
  using (is_thread_participant(id));
create policy mt_insert on message_threads for insert
  with check (is_workspace_member(workspace_id) and created_by = auth.uid());

-- Participants: read if you're in the thread; write rows for a thread you created.
create policy tp_read on thread_participants for select
  using (is_thread_participant(thread_id));
create policy tp_write on thread_participants for all
  using (exists (select 1 from message_threads t
                 where t.id = thread_id and t.created_by = auth.uid()))
  with check (exists (select 1 from message_threads t
                      where t.id = thread_id and t.created_by = auth.uid()));

-- Messages: read if participant; insert your own into threads you're in. Immutable.
create policy msg_read on messages for select
  using (is_thread_participant(thread_id));
create policy msg_insert on messages for insert
  with check (is_thread_participant(thread_id) and sender_id = auth.uid());

-- Realtime: broadcast message INSERTs (idempotent, same shape as 0006_realtime.sql).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

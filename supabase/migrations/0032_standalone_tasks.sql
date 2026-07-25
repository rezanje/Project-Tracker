-- Personal, project-less tasks: private to their author, not attached to any
-- board/column/card. Surfaced in My Tasks alongside board tasks.
create table standalone_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz default now()
);
alter table standalone_tasks enable row level security;
create policy standalone_tasks_own on standalone_tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

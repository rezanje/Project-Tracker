-- A project-less task still belongs to a workspace: "personal work, but in this
-- office". Nullable so the rows created before this migration keep working;
-- new ones are required to carry it by createStandaloneTaskFn.
alter table standalone_tasks add column workspace_id uuid references workspaces on delete cascade;

-- Still private to the author, plus you can only file a task into a workspace
-- you are a member of.
drop policy standalone_tasks_own on standalone_tasks;
create policy standalone_tasks_own on standalone_tasks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (workspace_id is null or is_workspace_member(workspace_id)));

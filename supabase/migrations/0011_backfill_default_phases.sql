-- Boards created before 0010's seed trigger have zero phase columns, which
-- leaves the "Phase" dropdown in Add Task empty and unusable. Backfill the same
-- three default phases into any board that currently has none. Idempotent: once
-- a board has columns the NOT EXISTS guard skips it, so re-running is a no-op.
insert into columns (board_id, title, position)
select b.id, v.title, v.position
from boards b
cross join (values ('Backlog', 0), ('In Progress', 1), ('Done', 2)) as v(title, position)
where not exists (select 1 from columns c where c.board_id = b.id);

-- Add an "urgent" priority level above high.
alter table boards drop constraint if exists boards_priority_check;
alter table boards add constraint boards_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));

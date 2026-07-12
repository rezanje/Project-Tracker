-- Finding from the SMART-KPI final review: 0023's `revoke update (current)` is
-- a no-op. In Postgres an UPDATE on a column succeeds if the role holds UPDATE
-- privilege at EITHER the column OR the whole-table level, and Supabase grants
-- `authenticated` table-level UPDATE on public tables by default (kpis/
-- key_results were created that way in 0016). A column-level REVOKE does not
-- subtract from a still-present table-level grant, so `current` stayed
-- writable — defeating the "current only moves through an approved check-in"
-- invariant the approve RPCs are supposed to own.
--
-- Fix: drop the table-level UPDATE grant and re-grant it column-by-column,
-- omitting `current`. RLS still decides WHICH ROWS an owner may update; this
-- just makes `current` unwritable by any normal client on every row, leaving
-- the security-definer approve_*_checkin RPCs (which run as the function owner,
-- not `authenticated`) as the only path that can move it.

revoke update on kpis from authenticated;
grant update (name, target, unit, assignee_id, assigned_by, workspace_id, start_date, end_date, status)
  on kpis to authenticated;

revoke update on key_results from authenticated;
grant update (title, target, objective_id)
  on key_results to authenticated;

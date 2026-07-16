# Rakit — Project & Task Tracker

TanStack Start (React) + Supabase (Postgres + RLS), deployed to Cloudflare Workers.

## Deploy & push targets (DEFAULTS — use these unless told otherwise)

- **Git remote:** `origin` → https://github.com/rezanje/Project-Tracker.git, branch `main`.
  Push with `git push` (commit to `main`).
- **Production deploy:** `npm run deploy` (= `vite build && wrangler deploy`, Cloudflare Workers).
  - Live URL: **https://rakit.rezarezanje.workers.dev**
  - Worker name: `rakit`
- **Deploy does NOT apply DB migrations** — those go to Supabase separately (see below).

## Supabase (remote-only — NO local Docker)

- **Project ref:** `tzhquesopfxevsucoapb`
- Migrations live in `supabase/migrations/`. Apply to the remote DB via **either**:
  1. Supabase Dashboard → SQL Editor → paste the migration file → Run, then
     `npx supabase migration repair --status applied <NNNN> --db-url "<pooler-url>"`, or
  2. `npx supabase db push --db-url "<pooler-url>"`
  - Pooler URL shape: `postgresql://postgres.tzhquesopfxevsucoapb:<DB_PASS>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
    (URL-encode special chars in the password, e.g. `!` → `%21`). The DB password is a
    secret the user runs themselves — never ask for it or run migrations with it on their behalf.
- **Migration history is partially out of sync** on the remote: several older migrations were
  applied by hand and not tracked, so `db push` can complain about out-of-order files. Fix per
  file with `migration repair --status applied <NNNN>`; avoid `--include-all` (two files share
  the `0011` prefix, which it mis-applies).

## Commands

- Dev server: `npm run dev` (Vite, port **3000**). NOTE: `.claude/launch.json` runs it on port **4321** for the in-app browser preview.
- Tests: `npm test` (vitest). **Integration tests hit the REAL remote DB** via `.dev.vars`
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) — no mocks, no local DB.
- Typecheck: `npx tsc --noEmit -p .` (only automated code-quality gate; no ESLint config).
- Regenerate route tree: `npm run generate-routes`.

## Gotchas

- Installed `supabase` CLI is 2.101.0 → `supabase/config.toml` must use `[inbucket]`, not
  `[local_smtp]` (a newer CLI renamed that section).
- Edge functions in `supabase/functions/` deploy with `supabase functions deploy <name> --no-verify-jwt`.

## Architecture notes

- Auth is gated: self-signups start `status='pending'`; `requireUser` (src/lib/auth.ts)
  redirects unapproved users to `/pending`. Super admin (`rezarezanje@gmail.com`) approves at
  `/admin/approvals`.
- Landing after login is `/home` (personal dashboard); `/` is the cross-workspace Command Center.
- SMART-KPI system (`src/lib/goals.ts`, `Goals.tsx`, `TeamPanel.tsx`): owner assigns
  KPIs/Objectives to members with periods; assignee self-checks-in; owner approves before the
  `current` value moves (via the `approve_*_checkin` security-definer RPCs). Design +
  implementation notes in `docs/superpowers/specs/2026-07-12-smart-kpi-design.md`.

---

# Productivity Memory

(Working memory for the productivity plugin — people, terms, projects. Separate from the
project instructions above. Bootstrap pending: see `memory/` dir and `TASKS.md`.)

## Me


## People

| Who | Role |
|-----|------|

## Terms

| Term | Meaning |
|------|---------|

## Projects

| Name | What |
|------|------|

## Preferences


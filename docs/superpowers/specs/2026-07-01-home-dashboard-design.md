# GenTrack Home — Hybrid Dashboard Redesign

**Date:** 2026-07-01
**Route:** `src/routes/index.tsx` (`/`)
**Design source:** `App UI Redesign Modern/GenTrack.dc.html` (copy exact styling/tokens)

## Goal

Replace the plain boards grid on `/` with a dashboard that matches the GenTrack
mockup: greeting hero, "Today's tasks" pulled from real cards across all the
user's boards, an aggregate activity strip, a Spotify-embed focus card, and the
existing projects grid below. All data is real (from the DB); only the Spotify
playlist is fixed.

## Layout (top → bottom)

All on the existing `meadow-bg`, reusing existing design tokens (`--ink`,
`card`, `btn`, `display-title`, `page-wrap`, `gt-fade`).

1. **Hero** — current-date line, `Hi, {profile.name}` (fallback "there"),
   subtitle, board-member avatar cluster (right), `+ New project` button.
   Extends the existing hero block already in `index.tsx`.

2. **Two-column band** (stacks to 1 col on mobile):
   - **Left — "Today's tasks":** real cards where `due_date <= today` and the
     card's column is not a "done" column, sorted by `due_date` ascending, top 4.
     Each row: label badge (name + color from `labels`), card title, status
     (column title), due date, owner (assignee `profiles.name`), assignee
     avatar, `Open card` link → `/board/{board_id}`. Empty state when none.
   - **Right rail — "Focus mode":** Spotify embed iframe (see below).

3. **Activity strip** — aggregate across all the user's boards: total cards,
   active count, done count, and a progress-% bar (`done / total`).
   `done` = column whose title matches `/done|complete/i` (named heuristic).

4. **"All projects" grid** — the existing board grid + "Start a new project"
   form, unchanged.

## Data mapping (schema → UI)

| UI element | Source |
|---|---|
| Greeting name | `profiles.name` for the current user |
| Today's task title | `cards.title` |
| Status | `columns.title` |
| Due | `cards.due_date` |
| Owner name + avatar | `profiles` via `cards.assignee_id` |
| Priority/type badge | `labels.name` + `labels.color` via `card_labels` |
| Member avatars (hero) | `board_members` → `profiles.avatar_url/name` |
| Activity totals | count of `cards` grouped by done/active column |

## Backend

New server fn `fetchHome()` in `index.tsx` (co-located with `fetchBoards`;
extract to `src/lib/home.ts` only if it grows past ~40 lines). Returns:

```ts
{
  name: string | null,
  todayTasks: Array<{
    id: string; title: string; boardId: string;
    status: string; due: string | null;
    owner: { name: string | null; avatar_url: string | null } | null;
    label: { name: string; color: string } | null;
  }>,
  stats: { total: number; active: number; done: number },
  members: Array<{ name: string | null; avatar_url: string | null }>,
}
```

Implementation notes:
- Use the RLS-scoped client (same `requireUser` + `flush(headers)` pattern as
  `fetchBoards`). RLS already limits card/column/board rows to boards the user
  is a member of, so queries need no explicit board-id filter for visibility.
- Today's tasks query: `cards` selecting nested `columns(title)`,
  `card_labels(labels(name,color))`, and assignee `profiles(name,avatar_url)`;
  filter `due_date <= today`; drop rows whose column title matches
  `/done|complete/i`; sort by `due_date`; slice top 4.
- Stats: fetch all `columns(title, cards(id))` for the user's boards; a column
  counts as done if its title matches `/done|complete/i`. `active = total - done`.
- Members: `board_members` joined to `profiles`, de-duplicated by user id,
  capped at ~4 shown + "+N".
- `today` computed server-side as `YYYY-MM-DD` (date-only, matches `due_date`
  which is a `date` column).

## Spotify (focus card)

Static embed, no OAuth, no backend:

```html
<iframe
  src="https://open.spotify.com/embed/playlist/37i9dQZF1DZ06evO4pXYMW?utm_source=generator"
  width="100%" height="152" frameborder="0"
  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
  loading="lazy" title="Focus playlist"></iframe>
```

Full tracks if the user is logged into Spotify in the browser; 30s previews
otherwise. Playlist id `37i9dQZF1DZ06evO4pXYMW` hard-coded (single-user app).

## Explicitly out of scope (YAGNI)

- Per-project selector / single-project dashboard mode.
- Real Spotify Web Playback SDK player (needs Premium + OAuth + token backend).
- Mockup's "Quick requests" panel — maps to no real data; folded into Today's
  tasks. Revisit only if a concrete source is defined.

## Testing

- One unit test for the done-column heuristic + stats aggregation (pure helper
  extracted from `fetchHome`, e.g. `computeStats(columns)` in `src/lib/home.ts`
  or inline-exported), asserting active/done/total on a fixture with mixed
  column titles. Follows the existing `*.test.ts` + vitest pattern in `src/lib`.
- Manual: load `/`, confirm today's tasks render from seeded cards, Spotify
  card plays, projects grid still works.

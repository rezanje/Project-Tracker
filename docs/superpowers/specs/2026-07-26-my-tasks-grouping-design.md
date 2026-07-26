# My Tasks — workspace label and grouping modes

## Problem

`/my-tasks` shows every open task in one flat, due-date-bucketed list. Two gaps:

1. A task row's subtitle names its board and column (`Vobia ERP · Backlog`) but not
   its workspace, so with boards of the same shape across several workspaces there
   is no way to tell which workspace a task belongs to.
2. Due-date bucketing is the only view. There is no way to see "everything in this
   project" or "everything in this workspace" without scanning all buckets.

## Approach

Add the workspace to the subtitle, and add a segmented control that switches the
page between three grouping modes: **Due date** (today's behaviour, unchanged and
still the default), **Project**, and **Workspace**.

The key structural decision: all three modes produce the **same** shape —
`{ key, label, tint, tasks }[]` — so the existing render loop is reused verbatim.
Only the function that produces the groups changes. No new JSX branch, no
duplicated row markup.

Grouping state lives in `useState` and resets to Due date on reload. Not persisted
to the URL or localStorage — a view toggle resetting is expected behaviour, and
persistence can be added later if it turns out to be missed.

## Changes

### 1. `src/routes/my-tasks.tsx` — data

Board query gains the workspace:

```ts
.select('id,title,workspace_id,workspaces(name),columns(title,cards(id,title,due_date,assignee_id))')
```

`Task` gains two fields:

```ts
workspaceId: string | null
workspaceName: string
```

- Board tasks: `workspaceId` from `workspace_id`, `workspaceName` from the embedded
  `workspaces.name`, falling back to `'No workspace'`. `boards.workspace_id` is
  nullable in the schema (migration 0012), so the fallback is required even though
  all 11 current boards have one.
- Standalone tasks: `workspaceId: null`, `workspaceName: 'Personal'` (matching the
  existing `boardTitle: 'Personal'`).

### 2. `src/routes/my-tasks.tsx` — subtitle

`TaskRowContent`'s subtitle line becomes:

- Board task: `{workspaceName} · {boardTitle} · {colTitle}`
- Standalone task: `{boardTitle}` (i.e. `Personal`) — unchanged

The line already has `truncate`, so the extra segment degrades by ellipsis on
narrow screens rather than wrapping.

### 3. `src/lib/my-tasks.ts` (new) — grouping

`Task`, the group type, and `bucketize` move here from the route (see Testing for
why). `Bucket` is renamed to `Group` — it no longer describes only date buckets —
keeping the same shape `{ key, label, tint, tasks }`. A second producer is added
alongside `bucketize`:

```ts
type Mode = 'due' | 'project' | 'workspace'

function groupBy(tasks: Task[], pick: (t: Task) => { key: string; label: string }): Group[]
```

- `groupBy` buckets tasks by `pick(t).key`, sorts each group's tasks by due date
  ascending with null due dates last, then sorts the groups themselves by their
  earliest due date (groups with no dated task last), breaking ties by label
  alphabetically. Group `tint` is `accentFor(key)`.
- Project mode: `pick = t => ({ key: t.boardId ?? 'personal', label: t.boardTitle })`
- Workspace mode: `pick = t => ({ key: t.workspaceId ?? 'personal', label: t.workspaceName })`

Keying on the id rather than the label means two boards that happen to share a
title stay separate groups; standalone tasks (both ids null) collapse into one
`Personal` group.

`bucketize` is untouched and still serves Due date mode.

### 4. `src/routes/my-tasks.tsx` — control

A segmented control sits between the page heading and the list:

```
[ Due date ][ Project ][ Workspace ]
```

Three buttons in a bordered row, the active one filled with `var(--accent)`.
`accentFor` is imported from `#/components/Sidebar` (already exported there) so
project and workspace dots match their sidebar colours.

## Out of scope

- No persistence of the selected mode (no URL search param, no localStorage).
- No collapsing/expanding of groups.
- No filtering (by workspace, by project, by status) — grouping only.
- No change to Due date mode's buckets, tints, ordering, or labels.
- No change to how tasks are fetched beyond adding the workspace fields, and no
  change to the standalone-task complete interaction.
- `accentFor` is duplicated in `WorkspaceDashboard.tsx` and `routes/index.tsx`;
  this spec imports the exported copy from `Sidebar.tsx` and does not deduplicate
  the others.

## Testing

`groupBy` is a pure function — array of tasks in, array of groups out — so unlike
the rest of this repo's tests it needs no database. A plain vitest unit test file
(`src/lib/my-tasks.test.ts`) covers:

- project mode puts tasks under their board title, workspace mode under their
  workspace name
- standalone tasks (null board and workspace ids) land in a single `Personal` group
  in both modes
- two boards sharing a title stay separate groups (keyed by id, not label)
- within a group, tasks sort by due date ascending with null due dates last
- groups sort by their earliest due date, with all-undated groups last
- a board with a null workspace surfaces as `No workspace`

`groupBy`, `bucketize`, the `Task` type, and the `Group` type move to a new
`src/lib/my-tasks.ts`, with the route importing them. They cannot stay in
`my-tasks.tsx`: that module imports `@tanstack/react-start/server` at the top
level, so a Node vitest test importing from it would pull server-only code into
the test runner. This mirrors the existing `src/lib/home.ts` + `src/lib/home.test.ts`
pair, whose `isDoneColumn`/`localDateStr` are consumed by this very route.

The segmented control and the subtitle rendering are verified manually in the
browser preview (the user is logged in, so the click-through can be driven
directly): switch between all three modes, confirm group headings and counts,
confirm the subtitle shows workspace · project · column, and confirm Due date mode
is byte-identical to before.

Also: `npx tsc --noEmit -p .` clean, and `npm test` still fully green.

# Handoff — Rakit UI redesign (updated 2026-07-31, second session)

Paste this file's path into a fresh Claude Code session and say:
**"Read HANDOFF.md and continue from 'Next up'."**

---

## Where the work lives

- **Branch:** `feat/soft-ui-redesign` (14 commits ahead of `main`, nothing pushed, nothing deployed).
  `main` still has the old pixel/8-bit UI. Production is untouched.
- Typecheck, build and the 110 vitest tests all pass on this branch.

```
ff1d752 Fix the sheets found broken once the app could be walked
117dda1 Reshape quick-add into the comp's sheet
b3c3fed Fold the board toolbar into sliders and more sheets
74be570 Move notifications from a popover into the bell's sheet
3cd977d Turn card detail into the comp's bottom sheet
b02a804 Reshape Reports into the comp's Performance screen
8074546 Make the workspace pill actually scope the app
68e0c39 Give the orphaned screens a doorway, and add toasts
fa7d5e9 Lead mobile Home with the KPI teaser, not the revenue hero
480e2fb Add the workspace scope, switcher, and mobile Command Center
0e4a368 Match the redesign comps screen by screen
916bffa Replace the pixel UI layer with the soft warm redesign
```

## The design source of truth

**`1_Redesign project dengan UI UX baru/design_handoff_workspace_command_center/`** — this is the
only bundle that matters. It is committed on this branch, so it travels with the code.

- `README.md` — 200-line spec: screens, interactions, state shape, token map, build order. Read in full.
- `project/Rakit Prototype.dc.html` — **primary reference.** Markup is layout, the `class Component`
  script at the bottom is behaviour. `renderVals()` defines every value the screens render.
- `project/Rakit Redesign.dc.html` — static spec sheet: tokens, component inventory, light + dark,
  mobile + desktop (section 05 holds the desktop layouts).
- Do **not** open these in a browser or screenshot them. Everything is in the markup.

Other bundles in the repo root are older or unrelated — ignore them:
`redesign-project-dengan-ui-ux-baru/` and `redesign-project-dengan-ui-ux-baru 2/` are
byte-identical to each other and superseded; `App UI Redesign Modern/` is a different product.

## Decisions already made (don't relitigate)

| Decision | Choice |
|---|---|
| Workspace scope persistence | `localStorage` via `src/lib/workspace-scope.ts`, not `?ws=`. Scope is a sticky personal preference, not a shareable address, and this keeps five routes free of search schemas. |
| Command Center | **Replaces** `/`. It renders its own header, so `__root.tsx` skips the shared `<Header/>` on that route. |
| Old features not drawn in the new design | **Not hidden.** Each got a doorway inside the design's own vocabulary (sheets, pills, tiles). See the placement map below. |
| Mobile "More" | The handoff wanted long-press; rejected as undiscoverable. The FAB opens the quick-add sheet, everything else has its own doorway. |
| Faked numbers | Never invented. Where the schema can't back a figure, the figure is omitted and noted. |

## Placement map (agreed with Reza, "option A")

| Old feature | Doorway | Status |
|---|---|---|
| Inbox / chat | Header bell → "Pesan" entry | done |
| Approvals queue | Command Center "Approval" tile is a link | done |
| All Projects | Home → Projects "See all" | done |
| Reports / KPI | Home KPI card → "Check now" | done |
| Desktop sidebar | Mirrors the four mobile tabs + workspaces; Settings/Log out in the profile menu; Favorites removed (it never worked) | done |
| Comments & attachments | Inside the task-detail sheet | done |
| Board filter / sort / search | Sliders button in the board header → sheet | done |
| Edit project, Team, owner KPIs | More button in the board header → sheet | done (KPIs are a link to Reports — the KPI UI is workspace-scoped, not board-scoped) |
| Notes & Announcements | Bottom of Home | **not moved yet** |
| Heatmap, portfolio, weekly | Reports | weekly done, rest **not moved** |
| Workspace page | To be dissolved; Team + KPI move to Reports | **not done** |
| Content calendar | Stays inside its project (it's a board type) | no change needed |
| Signup / forgot / reset | Outside the app shell, untouched | no change needed |

## What is built

1. **Design language** — `src/styles.css` holds the warm token set (light + dark), radius scale,
   soft shadows, `.card` / `.panel` / `.chip*` / `.progress-*` / `.btn*`. No hard borders. One
   accent (orange) for charts and CTAs; identity colours are the warm neutral ramp in
   `src/lib/accent.ts`. Press Start 2P, the pixel icon set, DottoUI leftovers and 5.7 MB of
   assets are gone. `prefers-reduced-motion` is honoured.
2. **Workspace scope** — `src/lib/workspace-scope.ts` (`useScope`, `setScope`, `inScope`).
   `fetchDashboard` now carries `wsId` on projects, priorities and today's tasks; Schedule carries
   one on its tasks. Home, My tasks, Schedule and Reports all filter by it.
3. **Workspace pill + switcher sheet** — `src/components/WorkspaceSwitcher.tsx`. Also exports the
   shared `Sheet` chrome (scrim, grab handle, slide-up, Escape) that the remaining sheets should reuse.
4. **Command Center** (`src/routes/index.tsx`) — three stat tiles, workspace cards, "Butuh
   perhatian", "Hari ini, semua tim".
5. **My tasks** — pill, conic progress ring, Semua / Hari ini / Selesai chips with live counts,
   working round checkbox. Completed tasks are loaded now (`Task.done`).
6. **Reports** — "Performance": Selesai + Completion cards, "Minggu ini" chart, goal list with
   check-in, "Waiting on you" approve/reject, plus the workspace/project breakdowns below.
7. **Schedule** (`/calendar`) — week strip, hour rail, event cards from the `events` table; the
   month grid is still there behind the header button.
8. **Bottom nav** — four icons with accent dots, accent FAB opening the "Task baru" sheet.
9. **Toast** — `src/components/Toast.tsx`, single slot, 1.9s, mounted in `__root.tsx`.
10. **Task detail sheet** — `src/components/CardDetail.tsx`, now built on `Sheet`. Lane bar,
    project eyebrow, title, note block, deadline + assignee, a status segmented control driven by
    the board's real lanes, `Tandai selesai` / `Buka lagi`, round delete. Everything the old modal
    could edit lives in an "Edit detail" `<details>` block; comments and attachments sit below.
11. **Notifications sheet** — `src/components/NotificationSheet.tsx`. The bell (`NotificationsBell`,
    exported from `Header.tsx`, `compact` for the Command Center) opens it. "Notifikasi | Pesan"
    segments; message rows deep-link into `/inbox?t=<threadId>`.
12. **Board sheets** — `src/components/BoardSheets.tsx`. Three round buttons in the board header:
    swap (next project in the same workspace), sliders (`BoardFilterSheet` — search, view, grouping,
    sort, category), more (`BoardMoreSheet` — edit project, KPI link, invite / add member). The old
    toolbar row is now `hidden md:flex`; swap and sliders sit outside the owner check.
13. **Quick add** — `src/components/QuickTaskForm.tsx` restyled to the comp: title block, scrolling
    project / lane / assignee chips, "Jadwalkan hari ini", accent 54px submit that greys out on an
    empty title. `fetchBoardAssigneesFn` now also returns the board's columns; `quickCreateTaskFn`
    takes an optional `columnId` (validated against the board) and `dueDate`.

## Next up

1. **Move Notes / Announcements / heatmap / portfolio** to their agreed homes; dissolve the
   workspace page into Home + Reports, taking `TeamPanel` (workspace members + KPI assignment)
   with it. The board's "more" sheet already links to `/reports` for KPIs, so that link lands
   correctly once the panel moves.
2. **Desktop pass.** Everything above was built mobile-first from the prototype. Section 05 of
   `Rakit Redesign.dc.html` holds the desktop layouts and has not been worked through.
3. **`QuickProjectForm`** is still on the old shadcn `Input`/`Button` — the task half of that sheet
   is now the comp's, the project half is not.

## Known data gaps — do not invent numbers for these

| The design shows | Why it can't be real |
|---|---|
| "+12.4%" on the KPI card, "On-time 92% · +4 vs bulan lalu" | No revenue or completion history is stored. Both are currently omitted or replaced with a real figure. |
| Event end times ("9:15 AM – 10:15 AM") | `events` has `starts_at` only, no end column. |
| Tasks placed on the hour rail | Cards carry `due_date` (a date). They stack in a "Due today" band above the rail instead. |
| "n task aktif" per workspace in the switcher | Not wired; the prop exists (`taskCounts`) and the row is omitted rather than showing a wrong zero. |
| "Butuh perhatian" = late ∪ in-review | The aggregation exposes due buckets, not column names, so it is the late half only. |
| Un-completing a personal task | `completeStandaloneTaskFn` has no counterpart. Tapping a done task says so rather than failing silently. Needs one new server function. |
| Notification rows scoped to the current workspace, with the sender's face | `notifications` carries neither a workspace id nor an actor id. The sheet shows every notification and puts the kind's icon in the 34px slot. |
| "Workspace · Project" eyebrow in the task detail sheet | Board data carries `workspaceId` but not the workspace name, so the eyebrow is the project alone. |

## Verification

Reza signed the in-app browser in on 2026-07-31, so the signed-in screens **can** now be walked.
Confirmed by hand at 375px, light and dark: notification sheet (both segments, `?t=` deep link),
workspace switcher, board filter and more sheets, task detail (status move + toast, delete),
quick add (created a task into a chosen lane with today's due date, then deleted it). Desktop at
1280px renders, but has not been worked through against section 05 of the spec sheet.

That pass caught four bugs typecheck and tests could not — see `ff1d752`. The lesson: **walk any
new sheet in the browser.** In particular, `position: fixed` inside the header is a trap (the
header's `backdrop-filter` makes it a containing block), which is why `Sheet` portals to
`document.body`.

Note when driving the in-app browser: if the pane is hidden, CSS animations freeze mid-flight, so
a sheet measured via `getBoundingClientRect` looks mispositioned. Screenshot instead of measuring.

Two harmless things you will see and should not chase:
- A `_nonReactive` TypeError from TanStack Router's `preloadRoute` in the dev console. It predates
  this branch (verified by stashing) and does not affect rendering.
- `src/lib/due-reminders.test.ts` is occasionally flaky — it creates a real Supabase user. Re-run.

## How Reza works

Non-technical. Report in Indonesian, business language: one-line conclusion, 2–4 short bullets,
then A/B/C options **only when there is a real decision**. No code, logs, file names or stack
traces in chat. Solve technical problems yourself.

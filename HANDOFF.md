# Handoff — Rakit UI redesign (session ending 2026-07-31)

Paste this file's path into a fresh Claude Code session and say:
**"Read HANDOFF.md and continue from 'Next up'."**

---

## Where the work lives

- **Branch:** `feat/soft-ui-redesign` (7 commits ahead of `main`, nothing pushed, nothing deployed).
  `main` still has the old pixel/8-bit UI. Production is untouched.
- Typecheck, build and the 110 vitest tests all pass on this branch.

```
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
| Comments & attachments | Inside the task-detail sheet | **not built** |
| Board filter / sort / search | Sliders button in the board header → sheet | **not built** |
| Edit project, Team, owner KPIs | More button in the board header → sheet | **not built** |
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

## Next up (build order from the handoff README, steps 5–6)

1. **Task detail sheet** — the design's core interaction and the biggest remaining piece. Opens
   from any task card. 3px status bar, project eyebrow, title, optional note, deadline + avatars,
   a 4-way status segmented control, primary action + delete. Fold **comments and attachments**
   in below Status. `src/components/CardDetail.tsx` is the existing modal to convert; reuse `Sheet`.
2. **Notifications sheet** — bell opens a sheet with "Notifikasi | Pesan" segments, absorbing
   `/inbox`. Rows: 34px avatar, text, timestamp, accent dot when unread.
3. **Board** — swap button cycles projects within the current workspace; sliders and more buttons
   open the filter and owner-action sheets.
4. **Move Notes / Announcements / heatmap / portfolio** to their agreed homes; dissolve the
   workspace page into Home + Reports.

## Known data gaps — do not invent numbers for these

| The design shows | Why it can't be real |
|---|---|
| "+12.4%" on the KPI card, "On-time 92% · +4 vs bulan lalu" | No revenue or completion history is stored. Both are currently omitted or replaced with a real figure. |
| Event end times ("9:15 AM – 10:15 AM") | `events` has `starts_at` only, no end column. |
| Tasks placed on the hour rail | Cards carry `due_date` (a date). They stack in a "Due today" band above the rail instead. |
| "n task aktif" per workspace in the switcher | Not wired; the prop exists (`taskCounts`) and the row is omitted rather than showing a wrong zero. |
| "Butuh perhatian" = late ∪ in-review | The aggregation exposes due buckets, not column names, so it is the late half only. |
| Un-completing a personal task | `completeStandaloneTaskFn` has no counterpart. Tapping a done task says so rather than failing silently. Needs one new server function. |

## Verification limits

The signed-in screens have **never been checked in a browser** — the assistant has no credentials.
Only `/login`, `/signup`, `/forgot`, `/reset` were confirmed visually. Everything else rests on
typecheck + build + tests. **Ask Reza to walk the app and report what looks wrong** before
assuming a screen is right.

Two harmless things you will see and should not chase:
- A `_nonReactive` TypeError from TanStack Router's `preloadRoute` in the dev console. It predates
  this branch (verified by stashing) and does not affect rendering.
- `src/lib/due-reminders.test.ts` is occasionally flaky — it creates a real Supabase user. Re-run.

## How Reza works

Non-technical. Report in Indonesian, business language: one-line conclusion, 2–4 short bullets,
then A/B/C options **only when there is a real decision**. No code, logs, file names or stack
traces in chat. Solve technical problems yourself.

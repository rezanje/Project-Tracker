# Handoff: Workspace switcher + Command Center (mobile redesign)

## Overview

Mobile-first redesign of **Rakit** with a new two-level navigation model:

1. **Workspace level** — every screen (Home, Board, My tasks, Schedule, Reports) is scoped to one company/workspace.
2. **Command Center level ("Semua workspace")** — a monitor view *above* the workspaces that aggregates every company the signed-in user owns: active/late/approval counts, a card per workspace, a cross-workspace "needs attention" list, and a cross-workspace "today" list.

The owner (single user, multiple companies) lands on the Command Center after sign-in and drops into a specific workspace via a **workspace pill** in the header that opens a bottom-sheet switcher.

## About the design files

The files in `project/` are **design references created in HTML** — prototypes of the intended look and behavior, **not production code to copy**. Recreate them in the existing Rakit codebase (Vite + React 19 + TanStack Router/Start + Tailwind v4 + shadcn + Supabase), using its established patterns, components, and data layer.

Read the source directly. **Do not render them in a browser or screenshot them** — every dimension, color, and rule is in the markup.

- `project/Rakit Prototype.dc.html` — **primary reference.** The working prototype: all screens, all states, all interactions.
- `project/Rakit Redesign.dc.html` — the static spec sheet: tokens, component inventory, mobile + desktop screens in light and dark, and an old→new token map.
- `project/support.js` — runtime for the two files above. Ignore it; it is not part of the design.

Prototype structure: the markup between `<x-dc>` tags is the template, the `class Component` script is the state/logic. Template holes like `{{ foo }}` are values returned by `renderVals()` — read that method to understand what drives each screen.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, shadows, and motion are final. Match them. The prototype's own data (Kopi Lintas, Nusa Logistik, etc.) is dummy — wire real Supabase data.

---

## What already exists in the codebase (do NOT rebuild)

Confirmed present — extend these, don't duplicate:

| Concern | Where |
| --- | --- |
| Design tokens (light + dark), already the redesign palette | `src/styles.css` |
| Workspaces table, members, invites, RLS | `supabase/migrations/0012_workspaces.sql`, `0036_workspace_member_cascade.sql` |
| Workspace data access | `src/lib/workspaces.ts`, `src/lib/nav.ts`, `src/lib/workspace-logos.ts` |
| Cross-workspace aggregation (stats, per-workspace rows, priorities) | `src/lib/dashboard.ts` → `fetchDashboard()` |
| Command Center route (desktop-leaning) | `src/routes/index.tsx` |
| Per-workspace dashboard | `src/routes/workspace.$workspaceId.tsx`, `src/components/WorkspaceDashboard.tsx` |
| Bottom nav + workspace list + create sheet | `src/components/MobileNav.tsx` |
| Home / My tasks / Calendar / Board / Reports | `src/routes/home.tsx`, `my-tasks.tsx`, `calendar.tsx`, `board.$boardId.tsx`, `reports.tsx` |
| Approvals | `src/lib/approval-requests.ts` |
| Notifications | `src/lib/notifications.ts` |
| Theme toggle | `src/components/ThemeToggle.tsx` |

## What is new in this handoff

1. **A global workspace scope** — `"all" | workspaceId` — that every screen reads. Today `/` is all-workspaces and `/workspace/$id` is one workspace; the prototype makes scope a *persistent selection* that reshapes Home, Board, My tasks, Schedule, and Reports alike.
2. **Workspace pill + switcher bottom sheet** on Home and My tasks (replaces digging into the nav sheet).
3. **Mobile Command Center layout** — 3 stat tiles, workspace cards with progress + late badge, "Butuh perhatian", "Hari ini, semua tim".
4. **Bottom sheets** for task detail (with a 4-way status segmented control), quick-add task, and notifications.
5. **Toast** confirmations for every mutation.

---

## Screens

### 1. Command Center — `/` (scope = "all")
**Purpose:** owner monitors every company at a glance.

Layout, top to bottom, single column, `padding: 12px 20px 150px`, `gap: 18px`:

- **Header row** (`display:flex; align-items:flex-start; gap:10px`)
  - Left column: workspace pill → title `Command center` (27px/800/-0.03em) → subtitle (13.5px, `--ink2`) reading `{n} perusahaan · {m} project aktif`.
  - Right: notification button and theme button, both 40×40, `border-radius:999px`, `background:var(--card)`, `box-shadow:var(--shadow-sm)`, `flex:none`. Unread dot: 7px, `--accent`, `box-shadow:0 0 0 1.5px var(--card)`, positioned `top:8px; right:9px`.
- **Stat tiles** — 3 equal flex cards, `gap:10px`, `border-radius:22px`, `background:var(--card)`, `padding:15px`, `box-shadow:var(--shadow)`. Each: eyebrow (10.5px/600/0.08em/uppercase/`--ink3`) + number (26px/800/-0.03em, `font-variant-numeric:tabular-nums`). Tiles: **Aktif** (ink), **Telat** (`--accent`), **Approval** (ink).
- **"Workspace kamu"** — h2 20px/700/-0.02em, then one card per workspace: `border-radius:22px`, `background:var(--card)`, `padding:16px`, `box-shadow:var(--shadow-sm)`.
  - Row: 42×42 rounded-15px avatar in the workspace color with 2-letter initials (13.5px/800/#fff) · name (15.5px/700/-0.02em) + role (12.5px/`--ink3`) · optional late badge (`background:var(--accent-soft); color:var(--accent-ink); 11px/700; radius 999px; padding 4px 10px`) · chevron-right 17px `--ink3`.
  - Progress bar 6px, track `--sunk`, fill in the workspace color, with % label (12px/700, tabular-nums).
  - Footer line 12.5px `--ink3`: `{active} aktif · {done} selesai · {projects} project`.
  - Tap → set scope to that workspace and navigate to Home.
- **"Butuh perhatian"** — tasks that are overdue **or** in Review, across all workspaces. Card: 3px left status bar, title (14.5px/600/1.35), flag chip (`Telat` = accent-soft/accent-ink, `Nunggu review` = col/ink2), then a row of: 7px workspace dot · `{Workspace} · {Project}` truncated · due date.
- **"Hari ini, semua tim"** — cross-workspace tasks due today. Round 22px checkbox on the left (toggles complete inline), title, then workspace dot + workspace name + due time. Header has a `See all` link to My tasks.

Empty states are cards with `background:var(--col)`, `padding:28px 18px`, centered: bold line (14.5px/700) + muted line (13px/`--ink3`).

### 2. Workspace switcher — bottom sheet
Triggered by the workspace pill. `position:fixed; left/right:0; bottom:0`, `border-radius:32px 32px 0 0`, `background:var(--bg)`, `padding:14px 22px 30px`, `box-shadow:0 -18px 50px rgba(20,17,14,.28)`, animation `upIn .3s cubic-bezier(.2,.9,.3,1)`. Backdrop `rgba(20,17,14,.42)` + `backdrop-filter: blur(2px)`, fades in over .2s, tap to dismiss. Grab handle 44×5, `--sunk`, centered.

Content: title `Pindah workspace` (22px/800/-0.03em) + sub `Semua perusahaan kamu di satu akun.` Then rows, `gap:9px`:
- Row 1 is always **Semua workspace** with a gradient avatar `linear-gradient(135deg,#E8622C 0%,#8A6A4B 52%,#4F6D7A 100%)`.
- Then one row per workspace: 40×40 rounded-14px avatar (use `workspaceLogoFor`, fall back to initials on the workspace accent), name 15px/700, role/description 12.5px `--ink3`, right side `{n} task aktif` (12px/600/`--ink3`) and, when selected, a 22px `--accent` circle with a white check.
- Selected row: `background:var(--card)` + `box-shadow:var(--shadow-sm)`. Unselected: transparent + `inset 0 0 0 1px var(--line)`.
- Footer button: full width, 50px, `background:var(--col)`, `+ Tambah workspace` — wire to the existing `createWorkspaceFn`.

**Workspace pill** (used in Command Center header, Home header, My tasks header): inline-flex, `gap:8px`, `padding:5px 13px 5px 5px`, `border-radius:999px`, `background:var(--card)`, `box-shadow:var(--shadow-sm)`, 12.5px/700; contains a 22px avatar, the workspace name, and a 13px chevrons-up-down icon in `--ink3`.

### 3. Home — `/home` (scope = one workspace)
Same as the current Home, plus: workspace pill above the `Welcome, {name}` heading (28px/800/-0.03em), and everything below scoped to the selected workspace. Sections: search field (`background:var(--col)`, radius 18, 13px 16px) that live-filters tasks; KPI teaser card (`Lihat progres KPI kamu` + `Check now` pill → `/reports`) with a 7-bar sparkline, last bar `--accent`; horizontally scrolling **Projects** cards (200px wide, radius 24); **Task hari ini** list.

### 4. Board — `/board/$boardId`
Header shows the **workspace name** as the uppercase eyebrow (11px/600/0.08em/`--ink3`) above the board title (18px/700). Summary card: chips row, `Project value` eyebrow + amount (22px/700, tabular-nums), big % on the right, 6px progress bar, avatar stack + `{done} / {total} tasks`. Then horizontally scrolling status chips **with live counts** (active chip = `--btn`/`--btn-ink`, inactive = `--col`/`--ink2`, count at `opacity:.55`), then the filtered card list. The swap-icon button top-right cycles projects **within the current workspace**.

### 5. My tasks — `/my-tasks`
Workspace pill, title `My tasks` (26px/800), summary `{done} selesai · {n} tersisa`, and a 54px conic-gradient progress ring: `conic-gradient(var(--accent) {pct*3.6}deg, var(--sunk) 0)` with a 44px `--card` disc inside showing the %. Filter chips: Semua / Hari ini / Selesai with counts. Rows: 22px round checkbox (checked = `--btn` bg, `--btn-ink` check; unchecked = `inset 0 0 0 1.8px var(--sunk)`), title (strikethrough + `opacity:.45` when done), then status pill + project name + due. **In "Semua workspace" scope the project line is prefixed with the workspace name** (`{Workspace} · {Project}`).

### 6. Schedule — `/calendar`
Month label + 7-day strip. Selected day: `background:var(--card)` + `shadow-sm`, number 16px/700. Days with events show a 4px `--accent` dot. Left hour gutter (40px rows, current hour bold ink). Event cards carry a 3px status bar, title, status, avatar stack, and a clock + time range. Empty day → empty-state card.

### 7. Reports / KPI — `/reports`
Back button + centered title. Two stat cards (`Selesai` = done/total, `On-time` = % in `--accent`). `Minggu ini` bar chart: 120px tall row, `align-items:stretch`, each column `flex:1; height:100%` with the bar wrapper `flex:1; display:flex; align-items:flex-end` — **the column must have a resolved height or percentage bars collapse to 0**. Last bar is `--accent`. Then **Butuh approval** cards: 38px avatar, name (14.5px/700), description (13.5px/1.45/`--ink2`), and Approve (`--btn`) / Decline (`--col`) buttons — wire to `resolveApprovalFn`.

### 8. Task detail — bottom sheet
Opens from any task card. Same sheet chrome as the switcher, `max-height:78%`, scrollable. Content: 3px status bar, project eyebrow, title (21px/800/-0.03em, strikethrough when done), close button (34px, `--col`); optional note in a `--col` block (radius 16, 13.5px/1.55); Deadline + avatar stack row; **Status** segmented control — 4 equal pills inside a `--col` track (radius 999, 4px padding); active segment `background:var(--card)` + `shadow-sm`; then a primary action (`Tandai selesai` / `Buka lagi`, 52px, radius 999) and a 52px square-ish delete button.

### 9. Quick add — bottom sheet
Title input (16px/600 in a `--card` block), horizontally scrolling project chips, a 4-way column segmented control, a `Jadwalkan hari ini` checkbox row, and a full-width `Buat task` button — 54px, `--accent` with `box-shadow:0 8px 24px rgba(232,98,44,.35)` when the title is non-empty, otherwise `--col`/`--ink3` and `cursor:not-allowed`.

### 10. Notifications — bottom sheet
Title + `Tandai dibaca`. Rows: 34px avatar, text (14px/600/1.4), timestamp (12.5px/`--ink3`), 7px accent dot when unread. Unread rows use `--card` + `shadow-sm`; read rows use `--col` with no shadow. Filtered by the current workspace scope.

### 11. Bottom nav + FAB
Pill: `position:absolute; left:20px; right:20px; bottom:22px`, `background:var(--card)` (light) / `--sunk` (dark), `padding:11px 8px`, `border-radius:999px`, `box-shadow:var(--shadow-float)`. 4 tabs, each a column of a 21px lucide icon + a 5px dot; active = icon `--ink` + `--accent` dot, inactive = icon `--ink3` + transparent dot. FAB: 56px circle, `--accent`, white plus, `box-shadow:0 8px 24px rgba(232,98,44,.42)`. Above the nav sits a 132px scrim: `linear-gradient(180deg, transparent 0%, var(--bg) 55%)`, `pointer-events:none`.

---

## Interactions & behavior

| Trigger | Result |
| --- | --- |
| Sign in | validate email contains `@` and password ≥ 4 chars, inline error in `--accent-ink`; spinner in the button (`spin .7s linear`); ~950ms later land on Command Center |
| Workspace pill | open switcher sheet |
| Pick a workspace | set scope, reset board/column/filter/search, navigate to Home, toast `Masuk {name}` |
| Pick "Semua workspace" | scope = all, Home renders the Command Center, toast `Monitor semua workspace` |
| Workspace card (Command Center) | same as picking that workspace |
| Task card | open detail sheet |
| Checkbox | toggle done ⇄ in progress, toast, all progress bars/rings/counters recompute |
| Status segment | move task, toast `Dipindah ke {Column}` |
| Delete | remove task, close sheet, toast |
| Board chip | filter column (counts stay live) |
| Swap button | cycle projects inside the current workspace |
| Day cell | swap the timeline's events |
| Approve / Decline | remove from queue, toast |
| FAB | open quick-add prefilled with the current project |
| Create | prepend the task, switch the board to its project + column, toast `Task ditambahin` |
| Search | live substring filter over title, tag, and project name; `{n} hasil untuk "{q}"` |
| Theme button | toggle light/dark |
| Backdrop tap / close | dismiss any sheet |

**Motion:** screen enter `opacity 0→1, translateY(10px)→0, .28s ease`; sheets `translateY(102%)→0, .3s cubic-bezier(.2,.9,.3,1)`; backdrop `fadeIn .2s`; toast `opacity+translateY(14px)+scale(.95) → .24s cubic-bezier(.2,.9,.3,1)`, auto-dismiss after 1.9s; press feedback `transform:scale(.94–.99)`; card hover `translateY(-1px|-2px)`. Respect `prefers-reduced-motion`.

## State

```ts
scope: 'all' | workspaceId      // persist (localStorage or ?ws= search param) — survives reload
theme: 'light' | 'dark'         // existing ThemeToggle
projectId, columnId             // board view, reset on scope change
myFilter: 'all' | 'today' | 'done'
selectedDay: ISO date
query: string
sheet: null | { kind: 'detail', taskId } | { kind: 'add' } | { kind: 'notif' } | { kind: 'workspace' }
draft: { title, projectId, columnId, today }
toast: string | null            // single slot, replaces previous, 1.9s timer
```

Derived per render: per-workspace done %, active/late counts, column counts, today list, attention list, filtered search results. Everything the prototype shows is derivable from `fetchDashboard()` + the existing board/task queries — **late** = due date in the past and not in a done column; **attention** = late ∪ in-Review.

Guard: when scope changes, if the current `projectId` doesn't belong to the new scope, fall back to the first project in it.

## Design tokens → existing codebase variables

The prototype's tokens already match `src/styles.css`. **Use the codebase variables**, not the prototype's names:

| Prototype | Codebase | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | `--bg` | `#EDE9E3` | `#16130F` |
| `--surf` | `--card` | `#FBFAF8` | `#211D18` |
| `--surf2` | `--col` | `#F4F1EC` | `#1B1813` |
| `--line` | `--sunk` | `#E7E2DA` | `#2A251F` |
| `--ink` | `--ink` | `#1C1A17` | `#F3EFE8` |
| `--ink2` | `--ink2` | `#6E6862` | `#A8A199` |
| `--ink3` | `--ink3` | `#A39C94` | `#79726A` |
| `--acc` | `--accent` | `#E8622C` | `#E8622C` |
| `--acc-soft` | `--accent-soft` | `#FBEDE5` | dark tint |
| `--acc-ink` | `--accent-ink` | `#B8501F` | lighter |
| `--green` | `--done` | `#6E7A66` | `#8A9A80` |
| `--inv` / `--inv-ink` | `--btn` / `--btn-ink` | `#1C1A17` / `#FBFAF8` | inverted |
| `--nav` | `--card` light, `--sunk` dark | — | nav pill must sit above cards |

Radii: 12 / 18 / 20 / 22 / 24 / 32 (sheet top) / 999 (pills). Shadows: `--shadow-sm`, `--shadow`, `--shadow-float` (nav), plus FAB `0 8px 24px rgba(232,98,44,.42)` and sheet `0 -18px 50px rgba(20,17,14,.28)`.

Type — **Hanken Grotesk** only (Space Mono for the design doc's labels, not the app): 27–28/800/-0.03em page titles · 20–22/700–800/-0.02em section + sheet titles · 15.5/700 card titles · 14.5/600/1.35 task titles · 13.5/1.5 body · 12.5/500 meta · 11/600/0.08em uppercase eyebrows · 26–28/800 tabular-nums stats. Minimum tap target 44px.

Workspace accent colors in the prototype (`#E8622C`, `#8A6A4B`, `#4F6D7A`) are illustrative — derive real ones from `workspaceLogoFor` / the existing `accentFor` hash in `Sidebar.tsx`.

## Assets

Icons are inline SVG drawn from the **lucide** set already installed (`bell, calendar, check, check-square, chevron-right, chevrons-up-down, clock, home, arrow-left, more-horizontal, pie-chart, plus, repeat, search, sliders, trash, x, moon, sun`). No raster assets. Avatars are initials on a solid fill.

## Suggested build order

1. Workspace scope store + persistence, and the guard that resets project/filters on change.
2. `WorkspacePill` + `WorkspaceSwitcherSheet` (reuse `fetchNav` / `listMyWorkspaces`).
3. Restyle `/` to the mobile Command Center layout on top of `fetchDashboard()`; add the late/attention derivations.
4. Scope Home, Board, My tasks, Calendar, Reports; add the live counts, ring, and chips.
5. Bottom sheets: task detail (status segmented control) → quick add → notifications.
6. Toast system + motion polish + reduced-motion.

## Files in this bundle

- `README.md` — this document
- `CLAUDE_CODE_PROMPT.md` — paste-ready kickoff prompt for Claude Code
- `project/Rakit Prototype.dc.html` — interactive prototype (primary reference)
- `project/Rakit Redesign.dc.html` — static spec: tokens, components, light + dark, mobile + desktop
- `project/support.js` — prototype runtime, not part of the design

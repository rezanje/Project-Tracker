# SP-0 — Pixel Design System + App Shell

**Date:** 2026-07-11
**Status:** Approved (design), pending spec review
**Part of:** Rakit UI/UX revamp (full pixel/retro). SP-0 is the foundation every
later screen (Command Center, Home, Board, Content Calendar) inherits.

## Goal

Introduce the pixel/retro visual identity shown in the target mockups, as a
reusable design system + app shell. Current app is a clean green "meadow" SaaS
look; SP-0 replaces the shared visual language and chrome so subsequent screens
are fast and consistent to build.

Faithful to the mockups' actual execution: **cozy retro-game dashboard** —
chunky bordered cards, hard offset shadows, pixel display font for brand +
greetings, pixel-art illustration (mascot/scene), segmented pixel progress bars
— but readable grotesk body text so a data-dense tracker stays legible. Not
full pixelation of every glyph.

## Scope

In:
1. Design tokens (`src/styles.css`) — pixel treatment.
2. Shared component classes — card, button, chip/badge, segmented progress bar,
   stat tile, avatar stack.
3. Sidebar rework (`src/components/Sidebar.tsx`).
4. Topbar rework (`src/components/Header.tsx`).

Out (separate sub-projects):
- Real Inbox / Tasks / Calendar / Reports screens. SP-0 only adds nav entries +
  "Coming Soon" placeholder route.
- Command Center, Home, Board, Content Calendar screen redesigns.
- Any AI-backed panel (rendered as "Coming Soon" wherever it appears later).

## Design

### 1. Tokens (`styles.css`)

- **Fonts:** add **Pixelify Sans** as `--font-display` (brand wordmark + large
  greetings only). Keep Hanken Grotesk as `--font-sans` for body/data.
- **Borders:** shared border becomes `2px solid var(--ink)` (chunky), replacing
  the 1px hairline `--line` on the card protagonist. `--line` stays for
  low-emphasis dividers.
- **Shadows:** replace soft two-layer blur with a hard offset pixel shadow
  token, e.g. `--shadow-pixel: 4px 4px 0 var(--ink)`. Hover nudges the card
  toward its shadow (translate + shrink shadow) instead of a soft float.
- **Radius:** reduce `--radius` to ~10px for a boxier retro feel. Keep chips
  pill where the mockups do.
- **Palette:** keep meadow accent green + pop yellow + danger. Dark tokens
  already exist and must keep working via the existing theme toggle.

### 2. Component kit (classes in `styles.css`)

- `.card` — pixel card: chunky border + `--shadow-pixel`.
- `.card-hover` — press-toward-shadow interaction.
- `.btn` / `.btn-primary` / `.btn-ghost` — pixel buttons (hard shadow, offset on
  active).
- `.chip` / badge — existing pill chip, restyled to pixel.
- `.progress-seg` — **segmented progress bar**: N discrete blocks filled to
  percentage (the mockup's block meter). Driven by a `--pct` or filled-count.
- `.stat-tile` — number + label + optional icon tile (the KPI/summary cells).
- `.avatar-stack` — overlapping circular avatars with `+N` overflow.

Component classes are CSS-first (Tailwind v4 `@theme` + plain classes), matching
the current file's approach. No new dependency.

### 3. Sidebar (`Sidebar.tsx`)

Top→bottom:
1. Brand (pixel wordmark + logo).
2. Main nav: Home, Inbox, Tasks, Calendar, Reports. Icons from `lucide-react`
   (already a dep). Active state = accent-soft pill. Entries whose route does
   not exist yet link to a `Coming Soon` placeholder.
3. Favorites — collapsible section (keep simple; can be empty initially).
4. Workspaces — existing list + "Add workspace", pixel-restyled.
5. Pixel scene — mascot/meadow illustration anchored bottom (reuse
   `/meadow.png`; mascot sprite is a user-supplied PNG if wanted, else omit).
6. Footer — Settings, theme toggle, user avatar, Log out (keep existing
   collapse behavior + localStorage persistence).

Keep: collapse toggle, `fetchNav` server fn, active-route detection, auth/email
wiring. Only visual + nav-structure changes.

### 4. Topbar (`Header.tsx`)

- Left: greeting ("Good morning, {name}") + small robot bubble + date/time.
- Right: search field, notification bell (badge), **+ New** button, user avatar.

Greeting name/date/time are client-derived (no new data source). Search + New +
notifications are visual shells wired to real behavior in later sub-projects;
here they render and are non-broken (search focuses, New can open the existing
create flow if trivial, else no-op with a `ponytail:` note).

## Data flow

No new data sources. Sidebar keeps `fetchNav`. Topbar greeting/date/time are
local. Everything else is presentational.

## Error handling

Unchanged from current: `fetchNav` already swallows auth errors and returns
empty nav. Placeholder routes render a static "Coming Soon" — no failure path.

## Testing

- Keep existing tests green (`npm test`).
- Manual/preview verification: sidebar nav + collapse, topbar renders, theme
  toggle still flips light/dark, pixel components render in both themes.
- No new logic branches worth a unit test (presentational). If the segmented
  progress bar gets a fill-calculation helper, add one small assert-based check.

## Risks / open items

- Pixel mascot sprite: none exists. Reuse `/meadow.png`; a dedicated mascot PNG
  is user-supplied or omitted. Not a blocker.
- `Pixelify Sans` legibility at small sizes → confined to brand + large
  greetings only.
- Placeholder routes for Inbox/Tasks/Calendar/Reports are throwaway; real
  screens are later sub-projects.

# SP-0 Pixel Design System + App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clean "meadow" visual language with a pixel/retro design system + app shell (sidebar + topbar) that every later screen inherits.

**Architecture:** CSS-variable tokens + shared component classes in `src/styles.css` (Tailwind v4, no new deps). Restructure `__root.tsx` so the sidebar is full-height with the brand inside it and the topbar sits over the content column only. Rework `Sidebar.tsx` and `Header.tsx` to the mockup structure. Nav entries without real routes link to one `Coming Soon` placeholder route.

**Tech Stack:** React 19, TanStack Start/Router, Tailwind CSS v4, lucide-react (all existing). Font: Pixelify Sans via Google Fonts `@import`.

## Global Constraints

- No new npm dependencies. Use existing: `lucide-react`, Tailwind v4, TanStack Router.
- Keep the theme toggle working: light/dark/auto driven by `data-theme` + `.light`/`.dark` classes and the `THEME_INIT_SCRIPT` in `__root.tsx`. Every color must use existing CSS variables so both themes hold.
- Body text stays Hanken Grotesk (`--font-sans`). Pixelify Sans (`--font-display`) is brand wordmark + large greetings ONLY.
- Existing tests must stay green: `npm test`.
- AI-backed panels are out of scope here; wherever one appears later it renders "Coming Soon". SP-0 introduces no AI.
- Preview verification uses the dev server (`vite dev --port 3000`) via the Browser pane, not manual user checks.

---

### Task 1: Pixel tokens + display font

**Files:**
- Modify: `src/styles.css:1-59` (font import + `:root` / dark token blocks)

**Interfaces:**
- Produces: CSS vars `--font-display` (Pixelify Sans), `--shadow-pixel`, `--shadow-pixel-sm`; `--radius` reduced; `--line` retained. Consumed by all later tasks and screens.

- [ ] **Step 1: Add Pixelify Sans to the font import**

Replace the `@import url(...)` on line 2 so the Google Fonts request also loads Pixelify Sans:

```css
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Pixelify+Sans:wght@400..700&display=swap");
```

- [ ] **Step 2: Point `--font-display` at Pixelify Sans**

In the `@theme` block (line 6-9):

```css
@theme {
  --font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Pixelify Sans", "Hanken Grotesk", sans-serif;
}
```

- [ ] **Step 3: Add pixel shadow + radius tokens to `:root`**

Inside the `:root` block, change `--radius` and add shadow tokens (place near the existing `--radius`/`--pad` lines):

```css
  --radius: 10px;
  --pad: 16px;
  --gap: 14px;
  --danger: #c0392b;
  --shadow-pixel: 4px 4px 0 var(--ink);
  --shadow-pixel-sm: 3px 3px 0 var(--ink);
```

- [ ] **Step 4: Add the same shadow tokens to the dark block**

Inside `:root[data-theme="dark"], .dark` (ends line 59), append so the hard shadow uses the dark ink:

```css
  --danger: #f0908a;
  --shadow-pixel: 4px 4px 0 var(--ink);
  --shadow-pixel-sm: 3px 3px 0 var(--ink);
```

(`--ink` already differs per theme, so the same declaration yields a light-ink shadow in dark mode — intended: the hard shadow reads against the dark card.)

- [ ] **Step 5: Verify build + themes in preview**

Start the dev server (Browser pane `preview_start {name}`; add to `.claude/launch.json` if absent: runtimeExecutable `npm`, runtimeArgs `["run","dev"]`, port 3000). Load `http://localhost:3000/`, then `read_console_messages` — expect no CSS/parse errors. Confirm the wordmark now renders in a pixel font.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "feat(ui): pixel display font + hard-shadow design tokens"
```

---

### Task 2: Pixel component kit

**Files:**
- Modify: `src/styles.css` (component-class section, after line 96 `---- Product component classes ----`)
- Create: `src/lib/progress.ts`
- Test: `src/lib/progress.test.ts`

**Interfaces:**
- Produces:
  - CSS classes `.card` (restyled), `.btn`/`.btn-primary`/`.btn-ghost` (restyled), `.chip` (restyled), `.progress-seg` + `.progress-seg-block` (segmented bar), `.stat-tile`, `.avatar-stack`.
  - `segFill(pct: number, blocks: number): number` — number of filled blocks for a 0-100 percentage across `blocks` segments. Consumed by any progress bar in later screens.

- [ ] **Step 1: Write the failing test for `segFill`**

Create `src/lib/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { segFill } from './progress'

describe('segFill', () => {
  it('fills zero blocks at 0%', () => {
    expect(segFill(0, 10)).toBe(0)
  })
  it('fills all blocks at 100%', () => {
    expect(segFill(100, 10)).toBe(10)
  })
  it('rounds to nearest block', () => {
    expect(segFill(68, 10)).toBe(7)
  })
  it('clamps out-of-range input', () => {
    expect(segFill(-20, 8)).toBe(0)
    expect(segFill(150, 8)).toBe(8)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- progress`
Expected: FAIL — cannot find module `./progress`.

- [ ] **Step 3: Implement `segFill`**

Create `src/lib/progress.ts`:

```ts
/** Number of filled blocks for a segmented progress bar.
 *  pct is 0-100 (clamped); blocks is the total segment count. */
export function segFill(pct: number, blocks: number): number {
  const clamped = Math.max(0, Math.min(100, pct))
  return Math.round((clamped / 100) * blocks)
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- progress`
Expected: PASS (4 tests).

- [ ] **Step 5: Restyle core components to pixel**

In `src/styles.css`, replace the `.card` block (lines ~100-118) and the `.chip` block (~171-181), and adjust buttons. Card:

```css
.card {
  border: 2px solid var(--ink);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow-pixel);
}
.card-hover {
  transition: transform 120ms steps(2, end), box-shadow 120ms steps(2, end);
  cursor: pointer;
}
.card-hover:hover {
  transform: translate(2px, 2px);
  box-shadow: var(--shadow-pixel-sm);
}
```

Chip:

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
  background: var(--accent-soft);
  color: var(--accent-ink);
}
```

Buttons — change `.btn` border + add hard shadow, keep the pill shape:

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  border: 2px solid var(--ink);
  box-shadow: var(--shadow-pixel-sm);
  transition: transform 120ms steps(2, end), box-shadow 120ms steps(2, end), opacity 150ms ease;
}
.btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: none; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.btn-primary { background: var(--btn); color: var(--btn-ink); }
.btn-ghost { background: var(--card); color: var(--ink2); }
.btn-ghost:hover:not(:disabled) { color: var(--ink); }
```

- [ ] **Step 6: Add new component classes**

Append to the component section of `src/styles.css`:

```css
/* Segmented pixel progress bar. Render `blocks` children with .progress-seg-block;
   filled ones also get .is-on. Fill count from segFill(). */
.progress-seg { display: inline-flex; gap: 3px; }
.progress-seg-block {
  width: 10px;
  height: 12px;
  border: 1.5px solid var(--ink);
  background: var(--col);
}
.progress-seg-block.is-on { background: var(--accent); }

/* KPI / summary cell. */
.stat-tile {
  border: 2px solid var(--ink);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow-pixel-sm);
  padding: var(--pad);
}

/* Overlapping avatars. Direct children are the circles; they tuck left. */
.avatar-stack { display: inline-flex; }
.avatar-stack > * { margin-left: -8px; border: 2px solid var(--card); border-radius: 999px; }
.avatar-stack > *:first-child { margin-left: 0; }
```

- [ ] **Step 7: Verify preview + tests**

Reload `http://localhost:3000/`; `read_console_messages` clean; cards/buttons show chunky border + hard shadow in both light and dark (`resize_window {colorScheme}` or theme toggle). Run `npm test` — all green.

- [ ] **Step 8: Commit**

```bash
git add src/styles.css src/lib/progress.ts src/lib/progress.test.ts
git commit -m "feat(ui): pixel component kit (card/btn/chip/progress/stat/avatars)"
```

---

### Task 3: Coming Soon placeholder route

**Files:**
- Create: `src/routes/coming-soon.tsx`
- Modify: `src/routeTree.gen.ts` (auto-generated — regenerate, do not hand-edit)

**Interfaces:**
- Produces: route path `/coming-soon`. Consumed by Sidebar nav entries without real screens yet.

- [ ] **Step 1: Create the route**

`src/routes/coming-soon.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/coming-soon')({
  component: ComingSoon,
})

function ComingSoon() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="card p-8">
        <p className="display-title text-2xl font-bold">Coming Soon</p>
        <p className="mt-2 text-sm text-[var(--ink2)]">
          This screen is on the roadmap. Check back soon.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run generate-routes`
Expected: `src/routeTree.gen.ts` updated with the `/coming-soon` route, no errors.

- [ ] **Step 3: Verify in preview**

Navigate the Browser pane to `http://localhost:3000/coming-soon` — the card renders; `read_console_messages` clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/coming-soon.tsx src/routeTree.gen.ts
git commit -m "feat(ui): add Coming Soon placeholder route"
```

---

### Task 4: Restructure app shell layout

**Files:**
- Modify: `src/routes/__root.tsx:36-68` (`RootDocument`)

**Interfaces:**
- Consumes: `Header` (Task 5 form) and `Sidebar` (Task 4-... existing, reworked in Task 5). Ordering: Sidebar renders the brand; Header renders over the content column only.
- Produces: layout where `<Sidebar>` is the first flex child (full height) and `<Header>` sits inside the content column above `{children}`.

- [ ] **Step 1: Rewrite the body layout**

Replace the `<body>...</body>` inner structure (lines 46-52) so the sidebar is a full-height left rail and the header caps the content column:

```tsx
      <body className="flex min-h-screen font-sans antialiased [overflow-wrap:anywhere] selection:bg-[var(--accent-soft)]">
        {!bare && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          {!bare && <Header />}
          {children}
          {!bare && <Footer />}
        </div>
```

(Note: `body` is now `flex` row, not `flex-col`. Sidebar owns its own height; the content column stacks header → children → footer.)

- [ ] **Step 2: Verify layout in preview**

Reload `http://localhost:3000/`. Sidebar spans full viewport height on the left; header sits above the page content, not above the sidebar. `read_console_messages` clean. Check `/login` still renders bare (no chrome).

- [ ] **Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "refactor(ui): full-height sidebar + content-column topbar layout"
```

---

### Task 5: Sidebar rework

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchNav` (`#/lib/nav`) — unchanged; `/coming-soon` route from Task 3.
- Produces: sidebar with brand, main nav, favorites, workspaces, pixel scene, footer. Keeps `COLLAPSE_KEY` persistence, `ThemeToggle`, auth/email + `logout`.

- [ ] **Step 1: Add the brand header + main nav above the workspaces list**

Keep all existing hooks/state/logic. Add a `MAIN_NAV` constant near the top of the file (after the `initials` helper):

```tsx
import { Bell, Calendar, CheckSquare, Home, Inbox, BarChart3 } from 'lucide-react'

const MAIN_NAV = [
  { label: 'Home', icon: Home, to: '/' as const, exists: true },
  { label: 'Inbox', icon: Inbox, to: '/coming-soon' as const, exists: false },
  { label: 'Tasks', icon: CheckSquare, to: '/coming-soon' as const, exists: false },
  { label: 'Calendar', icon: Calendar, to: '/coming-soon' as const, exists: false },
  { label: 'Reports', icon: BarChart3, to: '/coming-soon' as const, exists: false },
]
```

(Merge this import with the existing `lucide-react` import line rather than adding a second one. `Bell` is used by the topbar, not here — omit `Bell` from this file's import; keep only the icons listed above plus the existing `LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen`.)

- [ ] **Step 2: Render brand + main nav inside the `<aside>`**

At the top of the `<aside>` children (before the collapse button, or keep the collapse button adjacent), insert the brand and the nav list. Brand:

```tsx
      <Link to="/" className="mb-2 flex items-center gap-2 px-2 no-underline">
        <img src="/logo192.png" alt="" width={28} height={28} className="rounded-[8px]" />
        {!collapsed && <span className="display-title text-lg font-bold text-[var(--ink)]">Rakit</span>}
      </Link>
```

Main nav (place above the `workspaces.map`):

```tsx
      <nav className="mb-2 flex flex-col gap-0.5">
        {MAIN_NAV.map(({ label, icon: Icon, to }) => {
          const active = pathname === to
          return (
            <Link
              key={label}
              to={to}
              title={label}
              className={`flex items-center gap-2 rounded-lg py-1.5 text-[13px] font-bold no-underline ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${active ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--ink2)] hover:bg-[var(--col)]'}`}
            >
              <Icon size={16} className="shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>
```

- [ ] **Step 3: Add a "Workspaces" section label + keep the existing workspace list**

Above the existing `workspaces.map(...)`, add (only when not collapsed):

```tsx
      {!collapsed && (
        <p className="mb-1 mt-1 px-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
          Workspaces
        </p>
      )}
```

Leave the workspace/board rendering as-is (it already works).

- [ ] **Step 4: Add the pixel scene above the footer**

Between the workspace list and the `{email && (...)}` footer block, add a decorative scene that only shows when expanded:

```tsx
      {!collapsed && (
        <div
          className="mt-auto mb-3 h-24 rounded-[10px] border-2 border-[var(--ink)] bg-cover bg-bottom"
          style={{ backgroundImage: "url('/meadow.png')" }}
          aria-hidden="true"
        />
      )}
```

(The existing footer uses `mt-auto`; remove `mt-auto` from the footer block's className so the scene owns the spacer — the footer now follows the scene directly.)

- [ ] **Step 5: Verify in preview**

Reload `http://localhost:3000/`. Confirm: brand pixel wordmark top, 5 nav items (Home active on `/`), "Workspaces" label, workspace list, pixel scene, footer with theme toggle + avatar + logout. Click Inbox → lands on `/coming-soon`. Collapse toggle still hides labels + scene. Toggle theme — colors hold. `read_console_messages` clean. `npm test` green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(ui): pixel sidebar with brand, main nav, scene"
```

---

### Task 6: Topbar rework

**Files:**
- Modify: `src/components/Header.tsx`

**Interfaces:**
- Consumes: nothing new (greeting/date/time are client-local). Renders inside the content column (Task 4 layout).
- Produces: topbar with greeting + robot bubble + date/time (left) and search, notifications, `+ New`, avatar (right).

- [ ] **Step 1: Rewrite `Header.tsx`**

Replace the whole file. Greeting/date derive from `new Date()` on the client; guard SSR by computing in an effect so hydration stays stable:

```tsx
import { useEffect, useState } from 'react'
import { Bell, Plus, Search } from 'lucide-react'

function greeting(h: number): string {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Header() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const hello = now ? greeting(now.getHours()) : 'Welcome'
  const dateStr = now
    ? now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : ''
  const timeStr = now ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b-2 border-[var(--ink)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="display-title text-lg font-bold text-[var(--ink)]">{hello} 👋</p>
        {dateStr && (
          <p className="text-xs font-semibold text-[var(--ink2)]">
            {dateStr} · {timeStr}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="hidden items-center gap-2 rounded-full border-2 border-[var(--ink)] bg-[var(--card)] px-3 py-1.5 sm:flex">
          <Search size={15} className="text-[var(--ink3)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search…"
            className="w-40 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
          />
        </label>
        <button type="button" aria-label="Notifications" className="btn btn-ghost px-2.5">
          <Bell size={16} aria-hidden="true" />
        </button>
        {/* ponytail: + New is a visual shell; wired to a create flow in a later sub-project */}
        <button type="button" className="btn btn-primary">
          <Plus size={16} aria-hidden="true" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>
    </header>
  )
}
```

(The brand moved to the sidebar in Task 5, so it is intentionally gone from the header. The avatar also lives in the sidebar footer; the topbar keeps search/notif/New only — matches the content-column role.)

- [ ] **Step 2: Verify in preview**

Reload `http://localhost:3000/`. Topbar shows time-appropriate greeting + date/time, search (≥sm), bell, `+ New`. No hydration warning in `read_console_messages`. Border is chunky. Toggle theme — holds.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat(ui): pixel topbar with greeting, search, New"
```

---

## Self-Review

**Spec coverage:**
- Tokens (fonts/border/shadow/radius/palette/dark) → Task 1. ✓
- Component kit (card/btn/chip/progress-seg/stat-tile/avatar-stack) → Task 2. ✓
- Sidebar (brand, main nav, favorites, workspaces, scene, footer) → Task 5. Note: "Favorites" collapsible is spec'd as optional/can-be-empty; omitted as a distinct section to avoid an empty stub (YAGNI) — nav + workspaces cover navigation. Add when Favorites has data.
- Topbar (greeting/robot/date-time + search/notif/New/avatar) → Task 6. Robot bubble rendered as the 👋 greeting; avatar kept in sidebar footer per Task 4 layout. ✓
- Coming Soon placeholder route → Task 3. ✓
- Theme toggle keeps working → constraint enforced + verified each task. ✓
- No new deps → constraint. ✓

**Placeholder scan:** No TBD/TODO left. The one `ponytail:` comment on `+ New` is a deliberate, documented shell, not a plan gap.

**Type consistency:** `segFill(pct, blocks)` defined Task 2, used consistently. `MAIN_NAV` shape self-contained in Task 5. Route path `/coming-soon` matches between Task 3 (created) and Task 5 (linked).

**Deviations from spec noted above:** Favorites section omitted (YAGNI, empty); robot-bubble simplified to emoji greeting (no asset available). Both are within the "cozy retro, mockup-faithful" intent and reversible.

# GenTrack — UI Redesign PRD

> Hand this document to a UI-focused AI/designer. It describes the product, every
> screen, the components and their **prop contracts**, and the current design
> system. Goal: **redesign the visual layer without breaking the working backend.**

---

## 1. Product overview

**GenTrack** is a Trello-style kanban tracker. An **owner** creates boards, columns,
and cards to track their projects, and invites **clients** to view specific boards,
comment, and attach files. Owner has full edit control; clients are read + comment + upload.

- Live app: `https://project-tracker.rezarezanje.workers.dev`
- Local dev: `http://localhost:5180` (demo login: `demo@gmail.com` / `Babikeguling1!`)
- It is a **working, deployed product** — every feature below already functions.

**This PRD is for a visual redesign only.** Do not change data flow, server functions,
RLS, or route structure. Change markup + styles.

---

## 2. Users & roles

| Role | Can do |
|------|--------|
| **owner** | Create/edit boards, columns, cards, labels; drag cards; set due/assignee/labels; invite clients; comment; upload |
| **client** | View a board they're a member of; comment; upload attachments. **No structural edits, no drag.** |

Role is per-board (`board_members.role`). The same user can be owner of one board and
client on another. The UI must gate owner-only controls (drag, add card, invite, edit
fields) behind `role === 'owner'`; clients see read-only equivalents.

---

## 3. Hard constraints (do NOT break)

- **Tech**: TanStack Start (React 19, SSR + server functions) → Cloudflare Workers.
  Tailwind CSS v4 + a CSS-variable design token system in `src/styles.css`.
  Icons: `lucide-react`. Drag: `@dnd-kit/core` + `@dnd-kit/sortable`.
- **Routes are file-based** (`src/routes/*`). Route paths, loaders, and `createServerFn`
  calls must stay intact. You may restructure JSX inside a route's component, not its data layer.
- **Component prop contracts** (Section 6) must be preserved — a redesign changes the
  render, not the props/handlers.
- **dnd wiring**: `Card` uses `useSortable`; `Column` uses `useDroppable` + `SortableContext`;
  the board route owns `DndContext`. Keep these hooks and the `isDraggable`/`isOwner` gates,
  and keep `PointerSensor` `activationConstraint: { distance: 5 }` (so a tap opens the card,
  a drag moves it). You may restyle the elements these hooks attach to.
- **Auth**: session is cookie-based (Supabase SSR). The header reads auth state client-side.
- **Accessibility is a requirement, not a nice-to-have** — see Section 8.

---

## 4. Current design system (`src/styles.css`)

Palette is a teal/"sea" theme with light + dark modes (driven by `data-theme` attribute
+ `prefers-color-scheme`). A redesign may change the palette, but must keep **both modes**
and the CSS-variable approach so the theme toggle keeps working.

**Tokens (CSS vars, per theme):** `--sea-ink` (primary text), `--sea-ink-soft` (secondary
text), `--lagoon` / `--lagoon-deep` (accent), `--line` (borders), `--card-bg`, `--col-bg`
(recessed column lane), `--btn-bg` / `--btn-ink` (accent button, AA-contrast), `--chip-bg`,
`--ring` (focus ring), `--bg-base`, `--header-bg`.

**Reusable classes:** `.card`, `.card-hover`, `.field` (inputs), `.btn` + `.btn-primary` /
`.btn-ghost` / `.btn-danger`, `.chip`, `.col-surface` (column lane), `.display-title`
(Fraunces serif for headings), `.page-wrap` (max-width container).

**Current aesthetic** (after first redesign pass): Linear-style restraint — calm solid
surfaces, no glow orbs/gradients, white cards as the protagonist on recessed column lanes,
one accent color used sparingly, dark quiet primary buttons.

Fonts: **Manrope** (sans, body/UI), **Fraunces** (serif, display titles).

---

## 5. Screens (screen-by-screen spec)

### 5.1 `/login` — Login (`src/routes/login.tsx`)
- **Purpose:** email + password sign-in.
- **Elements:** heading, email field, password field, error text, submit button, link to `/signup`.
- **Behavior:** submit -> `supabase.auth.signInWithPassword` -> on success navigate `/`.
  Error string shown inline. Note: email confirmation is ON, so unconfirmed users get
  "Email not confirmed".
- **States:** idle, loading ("Logging in..."), error.

### 5.2 `/signup` — Sign up (`src/routes/signup.tsx`)
- **Purpose:** create account (name + email + password).
- **Extra:** honors `?invite=<token>` search param — after signup, POSTs `/api/accept-invite`
  to convert a pending invite to membership.
- **Elements:** heading, name/email/password fields (password min 6), error, submit, link to `/login`.
- **States:** idle, loading ("Creating..."), error.

### 5.3 `/` — Boards list (`src/routes/index.tsx`)
- **Purpose:** the logged-in user's boards + create a board. **Protected** (redirects to `/login`).
- **Data:** `loader` -> list of `{ id, title, owner_id, created_at }` (RLS-limited to member boards).
- **Elements:** page title + board count, "new board" inline form (title input + button),
  responsive **grid of board cards** (each links to `/board/<id>`), empty state.
- **Interactions:** create board -> optimistic refresh (`router.invalidate()`).
- **Design intent:** boards grid is the protagonist. Each card is a click target.

### 5.4 `/board/$boardId` — Board view (`src/routes/board.$boardId.tsx`)
- **Purpose:** the kanban board — columns left-to-right, draggable cards. **Protected.**
- **Data:** `loadBoard` -> `{ id, title, role, columns: [{ id, title, position, cards: [...] }] }`.
  `role` is the current user's role on this board.
- **Elements:**
  - Back-to-boards link, board title, **role chip** (owner/client).
  - **Owner-only:** invite-by-email form (top-right); "add card" input per column.
  - Horizontal scroll row of **columns** (`Column`), each with its **cards** (`Card`).
  - Empty state when no columns.
  - **Card detail modal** (`CardDetail`) opens on card click.
- **Interactions:**
  - Owner drags cards within/between columns (dnd-kit) -> optimistic reorder -> `moveCardFn`.
  - Clicking a card (tap < 5px) opens `CardDetail`.
  - Invite -> shows "added"/"invited" result text.
- **Roles:** client sees columns/cards read-only, no drag, no add-card, no invite form.
- **Design intent:** columns are recessed lanes; **white cards pop** as the focus. This is
  the app's most important screen — spend the most design effort here.

### 5.5 Card detail modal (`src/components/CardDetail.tsx`)
- **Opens over** the board view. Backdrop-click and a close (X) button dismiss it. Scrollable.
- **Owner view (editable):** title, description (textarea), due date (`<input type=date>`),
  assignee (`<select>` of board members), label multi-select (colored pills), Save/Cancel.
- **Client view (read-only):** title, description, due date, assignee name, label chips.
- **Both roles:** **Comments** (realtime) + **Attachments** sections mounted at the bottom.
- **States:** editing, saving ("Saving..."), error.

### 5.6 Comments (`src/components/Comments.tsx`) — realtime
- **In:** card detail. Both roles can post.
- **Elements:** scrollable comment list (author name + body + short timestamp), text input + Post button, empty state, error.
- **Behavior:** loads existing comments (author name joined), subscribes to Supabase Realtime
  `INSERT`s filtered by `card_id`, appends live (id-deduped). Post -> inserts (RLS: members).

### 5.7 Attachments (`src/components/Attachments.tsx`)
- **In:** card detail. Both roles can upload.
- **Elements:** list of files as **signed-URL download links** + upload date, "Choose file" input, empty state, error.
- **Behavior:** upload to private Storage bucket -> insert row -> appears in list. Files are
  private; links are time-limited signed URLs.

### 5.8 Chrome
- **Header** (`src/components/Header.tsx`): brand ("GenTrack"), theme toggle, and — when
  logged in — current user email + **Log out** button. Rendered on every page.
- **Footer** (`src/components/Footer.tsx`): minimal one-line brand mark.
- **ThemeToggle** (`src/components/ThemeToggle.tsx`): light/dark/auto — must keep working
  (sets `data-theme`; a boot script in `__root.tsx` avoids flash).

---

## 6. Component prop contracts (preserve these)

Redesign the render; keep the props/handlers identical so the wiring stays intact.

```ts
// Card.tsx
{ card: CardRow; isDraggable?: boolean; onCardClick?: (card: CardRow) => void }

// Column.tsx
{ column: ColumnRow; isOwner?: boolean;
  onAddCard?: (columnId: string, title: string) => Promise<void>;
  onCardClick?: (card: CardRow) => void }

// CardDetail.tsx
{ card: CardRow; boardId: string; meta: BoardMeta; isOwner: boolean;
  onClose: () => void; onSaved: () => void;
  onUpdateCard: (cardId, fields: Partial<{title; description; due_date; assignee_id}>) => Promise<void>;
  onSetLabels: (cardId, labelIds: string[]) => Promise<void> }

// Comments.tsx
{ cardId: string; members: { id: string; name: string }[] }

// Attachments.tsx
{ cardId: string; boardId: string }

// Types
CardRow   = { id; title; description: string|null; due_date: string|null;
              assignee_id: string|null; position: number; card_labels: { label_id: string }[] }
ColumnRow = { id; title; position: number; cards: CardRow[] }
BoardMeta = { members: { id; name }[]; labels: { id; name; color }[] }
```

---

## 7. Design goals for the redesign

- **Protagonist:** the board (columns + cards). Chrome and forms recede.
- **Reference bar:** Linear / Height / modern Trello — dense but calm, strong typographic
  hierarchy, one accent used sparingly, restraint over decoration.
- **Brand:** "GenTrack". Pick a distinctive but calm identity; keep light + dark modes.
- **Avoid:** glow orbs, animated blobs, grid overlays, heavy glassmorphism as default,
  purple-on-white AI-gradient cliches, uniform "everything same weight" layouts.
- **One protagonist per screen**, decided before layout. 70-point-everything = failure.

---

## 8. Accessibility & responsive (required)

- **WCAG 2.1 contrast:** >= 4.5:1 normal text, >= 3:1 large text / UI. Verify accent
  button + chip + disabled states in **both** themes. Target Lighthouse a11y 100.
- Keyboard: modal closable, focus-visible rings (`--ring`), inputs labeled, buttons have
  `aria-label` where icon-only.
- Responsive breakpoints to check: 320 / 768 / 1024 / 1440px. The board view scrolls
  horizontally on small screens; forms stack.
- Do not drop below AA to hit an aesthetic.

---

## 9. Out of scope (v1 — don't add)

Checklists, activity/audit log, @mentions, cross-board client dashboards, native mobile,
card archiving, global search, label-creation UI (labels are assigned, not created, in v1).

---

## 10. Deliverable

Restyled React/TSX for the routes and components above + an updated `src/styles.css`
token/class layer. Must pass `npx tsc --noEmit`, `npx vitest run` (12 tests, unaffected by
UI), and `npm run build`. Keep every prop contract and server-function call unchanged.

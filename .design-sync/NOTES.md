# RAKIT design-sync notes

## Repo shape
This repo is the app itself, not a publishable component library — no `dist/`
build target, no `main`/`module`/`exports` in `package.json` (`private: true`).
Package shape runs in **hand-authored entry** mode (not the converter's
auto-synth-from-src/, which would have pulled in the whole app tree — routes,
server functions, Supabase/Cloudflare code — and broken the bundle):
`.design-sync/.cache/entry/index.tsx` hand-picks the exact named exports for
the scoped components. It's gitignored/regenerated, not committed — if the
scoped component list changes, edit `componentSrcMap` in config.json AND this
entry file together.

## Scope (user-confirmed)
Only `src/components/ui/*` (shadcn primitives) + `src/components/dotto/*`
(the "DottoUI" pixel kit) are synced — 15 components. The rest of
`src/components/` (BoardPanels, Header, TeamPanel, Sidebar, etc.) is
app-specific composition, not design-system surface, and was excluded.

`src/components/pixel-icons.tsx` was **excluded entirely**: its ~15 icon
components render `<img src="/icons/*.png">` against the app's `public/`
folder at an absolute site-root path. There's no converter mechanism to ship
arbitrary `<img>`-referenced public assets (only CSS-referenced fonts get
harvested), so these would render as broken images in the DS sandbox. If
re-scoped in later, either inline each PNG as a data-URI in a wrapper preview,
or ask the user again.

One extra care point if pixel-icons.tsx is ever added: `pixel-icons.tsx`
exports a `StickyNote` icon constant that collides with
`dotto/sticky-note.tsx`'s `StickyNote` component — same global name, can't
coexist on `window.DottoUI`. The dotto component won that slot; the icon
would need renaming/excluding.

## cssEntry — points at a real Vite build output, not a package dist
`cfg.cssEntry` = `dist/client/assets/styles-<hash>.css`, the Tailwind v4
compiled output from `npm run build` (vite build). This repo's CSS is only
real once compiled — the source `src/styles.css` is raw `@import "tailwindcss"`
with zero generated utility classes.

**Re-sync risk**: this hash changes every rebuild. Before any re-sync, rerun
`npm run build` and update `cssEntry` in config.json to the new
`dist/client/assets/styles-*.css` filename, or the sync will point at stale
(or missing, if `dist/` was cleaned) CSS.

## Fonts
The compiled dist CSS ships font URLs as **root-absolute** paths
(`/assets/xxx-<hash>.woff2`, `/fonts/PressStart2P-Regular.ttf`) — normal for a
deployed Vite app, but not resolvable by the converter's relative-path font
extraction. Fixed via `cfg.extraFonts` pointing directly at the source files:
- `public/fonts/PressStart2P-Regular.ttf` (self-hosted display face — turned
  out to be shadowed by DottoUI's own `--font-display: Silkscreen` override
  for every scoped component, so it's shipped but currently unused by any
  synced component; harmless to keep).
- `node_modules/@fontsource/silkscreen/{400,700}.css` and
  `node_modules/@fontsource/space-mono/{400,700,400-italic,700-italic}.css`
  — these ship clean relative `./files/*.woff2` paths the converter *can*
  resolve, unlike the dist CSS's hashed absolute ones.

The dist CSS's own dead absolute-path `@font-face` rules get silently dropped
by the converter's `_ds_bundle.css` font-face rewrite pass (unresolvable src
→ block removed) — expected, not a bug to chase on validate.

A remote Google Fonts `@import` (Bricolage Grotesque, Hanken Grotesk) is
present in the source CSS but is unlikely to survive as a valid `@import` once
appended into the middle of `_ds_bundle.css` (CSS requires `@import` to be
the first rule in a stylesheet). Not chased — neither family is actually used
by any of the 15 scoped components (DottoUI's `--font-sans`/`--font-mono`
tokens resolve to Space Mono, not Hanken Grotesk, for these).

## Token cascade — CONFIRMED BUG, breaks 3 components (Input/Textarea/Checkbox)
`src/styles.css` and `src/styles/_dotto-core.css` both define `:root` tokens
with the same custom-property names (`--background`, `--card`, `--border`,
`--input`, `--ring`, `--primary`, etc.) but different palettes —
`_dotto-core.css` is `@import`ed near the top of `styles.css`, so
`styles.css`'s own later `:root` block (a leftover stock shadcn/Tailwind
default theme, all near-grayscale oklch values) wins the cascade for every
overlapping name.

Verified via computed styles in the actual rendered bundle (not guesswork):
`--border` resolves to `oklch(92.2% 0 0)` (near-white) everywhere, not
DottoUI's intended navy `oklch(30.76% .0566 257.95)`. This makes any
component whose visible edge comes from `border-border` or `pixel-bordered`'s
`::before`/`::after` fill **render with an invisible border**:
**Input, Textarea, and Checkbox (unchecked state) are all currently
broken** this way. `Button` and `Card` look fine only by accident — their
visible edge comes from `pixel-shadow`/`pixel-depth`, which use
`--pixel-shadow-color`, a *separate* token hardcoded to navy in
`_dotto-core.css` (not `var(--border)`) and never touched by the override.

None of the three broken components are wired into any page yet (`grep -rl
"components/ui/{input,checkbox,textarea}" src/` = no hits), which is
presumably why this hasn't been noticed. User confirmed (2026-07-18): ship
the sync as-is with these graded `needs-work` rather than block on it — the
DS pane should show what's actually shipped. Real fix is in the app, not
design-sync: reconcile or remove the duplicate `:root` block in
`src/styles.css` so `_dotto-core.css`'s navy tokens win, then re-run the
render check and re-grade Checkbox/Input/Label/Textarea.

## Re-sync risks (forward-looking)
- `cssEntry`'s filename hash — see above, must be refreshed pre-sync.
- The hand-authored entry file duplicates `componentSrcMap`'s component list;
  if a component is added/removed from scope, both need editing.
- No Storybook, no `.d.ts` — every `<Name>Props` in the design system pane is
  inferred by ts-morph directly from the `.tsx` source (not checker-verified
  against a real build), and every preview is either author-written (§4.2) or
  the floor card. If shadcn/dotto components are refactored upstream, re-run
  the render check before trusting previews are still accurate.
- `dist/` is a full build of the whole TanStack Start app (SSR + client) —
  large and slow-ish; only its `client/assets/styles-*.css` is used here.

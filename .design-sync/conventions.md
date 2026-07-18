## Setup

No root provider is required — every component in this system is
self-contained (no context/theme provider to wrap). Just make sure the page
loads `styles.css` (it pulls in tokens, fonts, and the component stylesheet
in one `@import` chain) before rendering anything.

**Known issue to design around**: `Input`, `Textarea`, and the unchecked
state of `Checkbox` currently ship with an invisible border (a token-cascade
bug in the source app, not in this bundle — tracked, not yet fixed upstream).
Don't rely on their outline being visible in a composition; lean on
surrounding `Card`/`pixel-bordered` containers, spacing, or a filled variant
instead until it's fixed.

## Styling idiom

This system layers two things on top of plain Tailwind v4 utilities:

- **Design tokens** — CSS variables consumed via standard Tailwind
  color/spacing utilities: `bg-primary`, `bg-secondary`, `bg-accent`,
  `bg-destructive`, `bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`. Always reach for the token utility, never a raw hex.
- **The "low-pixel" utility family** (custom `@utility` rules, not stock
  Tailwind) — this is what gives components their stepped-corner,
  hard-offset-shadow look:
  - `pixel-corner` / `pixel-corner-lg` / `pixel-corner-1` — stepped clip-path
    corners (small / large / single-notch).
  - `pixel-bordered` / `pixel-bordered-1` — a crisp frame that follows the
    stepped corners; fill color via the `--pf-fill` custom property
    (defaults to `var(--card)`), e.g. `style={{ '--pf-fill': 'var(--primary)' }}`.
  - `pixel-depth` / `pixel-depth-fill` — inset bevel for a chiseled look.
  - `pixel-shadow` / `pixel-shadow-sm` / `pixel-shadow-none` — hard offset
    drop-shadow (not a soft box-shadow) that follows the clipped shape.
  - `font-mono` → Space Mono (body/UI face); `font-display` → Silkscreen
    (headline face). Labels, buttons, and badges are typically uppercase
    mono with tracked-out letter-spacing (`uppercase tracking-[0.06em]`).

Compose new elements the way `Button`/`Badge`/`Card` already do:
`pixel-bordered pixel-depth pixel-shadow` together is the standard
"raised control" look; `pixel-bordered` alone (no depth/shadow) is the
standard "flat field" look for form inputs.

## Where the truth lives

- `styles.css` at the bundle root — the full `@import` closure (tokens,
  fonts, component CSS). Read it before styling anything new.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage
  reference and prop docs.
- Two groups: `general` (shadcn-derived primitives: Badge, Button, Card
  family, Checkbox, Input, Label, Textarea) and `dotto` (the pixel-art
  extras: IconTile, PixelGlyph, StickyNote).

## Example composition

```tsx
<Card style={{ width: 320 }}>
  <CardHeader>
    <CardTitle>Ship pixel revamp</CardTitle>
    <CardDescription>Redesign the board panels to match the new mockup.</CardDescription>
  </CardHeader>
  <CardContent>
    <Badge variant="secondary">In Progress</Badge>
  </CardContent>
  <CardFooter>
    <Button size="sm">Open task</Button>
    <Button size="sm" variant="ghost">Snooze</Button>
  </CardFooter>
</Card>
```

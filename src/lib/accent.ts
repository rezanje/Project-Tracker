/* Warm neutral ramp. The redesign spends its one accent (orange) on charts and
   calls to action, so identity colours for workspaces/boards/avatars are tones,
   not hues — they never compete with a CTA. */
const ACCENTS = ['#8a7f73', '#a8927c', '#6e7a66', '#9c8b7a']

/** Stable colour for an id — same id always yields the same accent, so a
 *  workspace or board keeps one colour across the sidebar, dashboards, and
 *  the My Tasks group dots. */
export function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

/* Workspace marks. These replaced per-company logo images: a workspace is a
   free-text name, so only the three hard-coded ones ever had a logo and every
   other workspace fell back to a flat initial. A gradient gives all of them the
   same treatment, and drops ~3 MB of PNGs.

   This is the one place identity colour is allowed to be a hue rather than a
   tone — the same licence the comp takes with its "Semua workspace" mark. The
   marks are small and never sit next to a call to action, so a saturated pair
   reads as branding rather than as something to press. */
const GRADIENTS = [
  'linear-gradient(135deg,#E8622C 0%,#E9A13B 100%)', // ember
  'linear-gradient(135deg,#3E8C8C 0%,#3A5C8C 100%)', // lagoon
  'linear-gradient(135deg,#7B5EA7 0%,#C0559B 100%)', // orchid
  'linear-gradient(135deg,#4E8A5A 0%,#8FB84A 100%)', // moss
  'linear-gradient(135deg,#C64F6B 0%,#E8834F 100%)', // coral
  'linear-gradient(135deg,#4B5BC4 0%,#37A8C4 100%)', // sea
  'linear-gradient(135deg,#B8862B 0%,#D9B24C 100%)', // brass
  'linear-gradient(135deg,#2F7A6B 0%,#6BB07A 100%)', // jade
  'linear-gradient(135deg,#8C4A7A 0%,#C4667E 100%)', // plum
  'linear-gradient(135deg,#5A6BA8 0%,#8C7BC4 100%)', // dusk
]

/** Stable gradient for an id, picked the same way `accentFor` picks a tone, so
 *  a workspace keeps one mark across the pill, switcher, sidebar and cards. */
export function gradientFor(id: string): string {
  // FNV-1a rather than the ×31 sum `accentFor` uses: workspace ids are uuids
  // that share long stretches of hex, and the weaker mix landed neighbouring
  // workspaces on the same mark.
  let h = 0x811c9dc5
  for (const ch of id) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return GRADIENTS[h % GRADIENTS.length]
}

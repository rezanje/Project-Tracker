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

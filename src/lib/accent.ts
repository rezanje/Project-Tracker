const ACCENTS = ['#1f9d55', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2']

/** Stable colour for an id — same id always yields the same accent, so a
 *  workspace or board keeps one colour across the sidebar, dashboards, and
 *  the My Tasks group dots. */
export function accentFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const WORKSPACE_LOGOS: Array<[needle: string, src: string]> = [
  ['gentanala', '/workspace-logos/gentanala.png'],
  ['nui', '/workspace-logos/nui.png'],
  ['gendev', '/workspace-logos/gendev.png'],
]

/** Known-company logo for a workspace badge, matched by name containing the company keyword. */
export function workspaceLogoFor(name: string): string | null {
  const lower = name.trim().toLowerCase()
  return WORKSPACE_LOGOS.find(([needle]) => lower.includes(needle))?.[1] ?? null
}

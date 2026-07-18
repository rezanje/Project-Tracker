import { StickyNote } from "@/components/dotto/sticky-note"
import { PixelGlyph } from "@/components/dotto/pixel-glyph"

export function Default() {
  return <StickyNote>Don&apos;t forget standup</StickyNote>
}

export function WithGlyph() {
  return (
    <StickyNote glyph={<PixelGlyph shape="sparkle" unit={3} />}>
      Nice work this sprint
    </StickyNote>
  )
}

export function Alignments() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <StickyNote align="left">Left aligned</StickyNote>
      <StickyNote align="center">Centered</StickyNote>
      <StickyNote align="right">Right aligned</StickyNote>
    </div>
  )
}

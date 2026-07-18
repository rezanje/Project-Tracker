import { IconTile } from "@/components/dotto/icon-tile"
import { PixelGlyph } from "@/components/dotto/pixel-glyph"

export function Default() {
  return (
    <IconTile>
      <PixelGlyph shape="sparkle" color="white" />
    </IconTile>
  )
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <IconTile size={32}><PixelGlyph shape="plus" unit={3} color="white" /></IconTile>
      <IconTile size={56}><PixelGlyph shape="plus" color="white" /></IconTile>
      <IconTile size={80}><PixelGlyph shape="plus" unit={6} color="white" /></IconTile>
    </div>
  )
}

export function CustomColor() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <IconTile color="#f5c451"><PixelGlyph shape="heart" color="#16211b" /></IconTile>
      <IconTile color="#c0392b"><PixelGlyph shape="diamond" color="white" /></IconTile>
    </div>
  )
}

import { PixelGlyph } from "@/components/dotto/pixel-glyph"

export function Shapes() {
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <PixelGlyph shape="sparkle" />
      <PixelGlyph shape="heart" />
      <PixelGlyph shape="plus" />
      <PixelGlyph shape="diamond" />
      <PixelGlyph shape="square" />
    </div>
  )
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <PixelGlyph shape="sparkle" unit={2} />
      <PixelGlyph shape="sparkle" unit={4} />
      <PixelGlyph shape="sparkle" unit={8} />
    </div>
  )
}

export function CustomColor() {
  return (
    <div style={{ display: "flex", gap: 20 }}>
      <PixelGlyph shape="heart" color="#c0392b" unit={6} />
      <PixelGlyph shape="diamond" color="#1f9d55" unit={6} />
    </div>
  )
}

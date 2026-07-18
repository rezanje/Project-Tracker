import { Badge } from "@/components/ui/badge"

export function Default() {
  return <Badge>New</Badge>
}

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  )
}

export function InContext() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Badge variant="secondary">In Progress</Badge>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>Sprint 14</span>
    </div>
  )
}

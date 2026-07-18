import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export function Default() {
  return <Label htmlFor="board-name">Board name</Label>
}

export function PairedWithField() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 240 }}>
      <Label htmlFor="board-name-2">Board name</Label>
      <Input id="board-name-2" defaultValue="Q3 Roadmap" />
    </div>
  )
}

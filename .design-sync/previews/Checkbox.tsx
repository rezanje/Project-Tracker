import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export function Unchecked() {
  return <Checkbox id="cb-unchecked" />
}

export function Checked() {
  return <Checkbox id="cb-checked" defaultChecked />
}

export function WithLabel() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Checkbox id="cb-label" defaultChecked />
      <Label htmlFor="cb-label">Mark as complete</Label>
    </div>
  )
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <Checkbox id="cb-disabled" disabled />
      <Checkbox id="cb-disabled-checked" disabled defaultChecked />
    </div>
  )
}

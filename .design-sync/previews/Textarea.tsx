import { Textarea } from "@/components/ui/textarea"

export function Empty() {
  return <Textarea placeholder="Add a description..." style={{ width: 280 }} />
}

export function WithValue() {
  return (
    <Textarea
      defaultValue="Redesign the board panels to match the new pixel-art mockup, including hover states and dark mode."
      style={{ width: 280 }}
    />
  )
}

export function Disabled() {
  return <Textarea disabled defaultValue="Locked field" style={{ width: 280 }} />
}

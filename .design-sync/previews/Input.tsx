import { Input } from "@/components/ui/input"

export function Empty() {
  return <Input placeholder="Search tasks..." style={{ width: 260 }} />
}

export function WithValue() {
  return <Input defaultValue="Ship pixel revamp" style={{ width: 260 }} />
}

export function Types() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 260 }}>
      <Input type="email" placeholder="you@example.com" />
      <Input type="password" placeholder="Password" />
      <Input type="date" />
    </div>
  )
}

export function Disabled() {
  return <Input disabled defaultValue="Read only" style={{ width: 260 }} />
}

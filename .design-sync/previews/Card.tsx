import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function TaskCard() {
  return (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>Ship pixel revamp</CardTitle>
        <CardDescription>Redesign the board panels to match the new mockup.</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="secondary">In Progress</Badge>
      </CardContent>
      <CardFooter>
        <Button size="sm">Open task</Button>
        <Button size="sm" variant="ghost">Snooze</Button>
      </CardFooter>
    </Card>
  )
}

export function Minimal() {
  return (
    <Card style={{ width: 280 }}>
      <CardContent>
        <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13 }}>
          A card with only body content, no header or footer.
        </p>
      </CardContent>
    </Card>
  )
}

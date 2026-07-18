import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export function Default() {
  return (
    <Card style={{ width: 300 }}>
      <CardHeader>
        <CardTitle>Weekly Standup</CardTitle>
        <CardDescription>Every Monday at 9:00 AM</CardDescription>
      </CardHeader>
    </Card>
  )
}

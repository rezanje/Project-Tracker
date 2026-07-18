import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export function Default() {
  return (
    <Card style={{ width: 300 }}>
      <CardHeader>
        <CardTitle>Goals</CardTitle>
        <CardDescription>Track quarterly OKRs and check-ins across the team.</CardDescription>
      </CardHeader>
    </Card>
  )
}

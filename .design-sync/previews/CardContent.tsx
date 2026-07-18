import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function Default() {
  return (
    <Card style={{ width: 280 }}>
      <CardContent style={{ display: "flex", gap: 8 }}>
        <Badge>Design</Badge>
        <Badge variant="secondary">Frontend</Badge>
      </CardContent>
    </Card>
  )
}

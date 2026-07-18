import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function Default() {
  return (
    <Card style={{ width: 300 }}>
      <CardContent>
        <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13 }}>Delete this board?</p>
      </CardContent>
      <CardFooter>
        <Button size="sm" variant="destructive">Delete</Button>
        <Button size="sm" variant="ghost">Cancel</Button>
      </CardFooter>
    </Card>
  )
}

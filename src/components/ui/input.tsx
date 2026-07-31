import * as React from "react"

import { cn } from "@/lib/utils"

/** Rakit input — filled surface-2, soft radius, accent focus ring. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("field", "disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  )
}

export { Input }

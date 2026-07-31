import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Rakit button — pill, no border, hierarchy from fill alone. Mirrors the `.btn`
 * classes in styles.css so the two stay visually identical.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-sans font-bold leading-none transition-colors disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--btn)] text-[var(--btn-ink)] shadow-[0_6px_18px_rgba(28,26,23,.16)]",
        secondary: "bg-[var(--col)] text-[var(--ink)] hover:bg-[var(--sunk)]",
        outline: "bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]",
        ghost: "bg-transparent text-[var(--ink2)] hover:bg-[var(--col)] hover:text-[var(--ink)]",
        destructive: "bg-[var(--danger-soft)] text-[var(--danger-ink)]",
        link: "text-[var(--accent-ink)] underline-offset-4 hover:underline",
      },
      size: {
        default: "px-5 py-[0.7rem] text-sm",
        sm: "px-3.5 py-2 text-[13px]",
        lg: "px-7 py-4 text-[15px]",
        icon: "size-11 px-0 py-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

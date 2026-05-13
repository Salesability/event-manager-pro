import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-card text-muted-foreground",
        destructive: "border-transparent bg-destructive/15 text-destructive",
        // Added per 0043 Phase 7 — green affordance for active / accepted /
        // success-leaning states; mirrors `--color-status-green` from
        // globals.css.
        success: "border-transparent bg-status-green/15 text-status-green",
        // Amber affordance for pending / expired / warning-leaning states.
        warning: "border-transparent bg-amber-100 text-amber-700",
        // Blue affordance for sent / in-flight / informational states.
        info: "border-transparent bg-status-blue/15 text-status-blue",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }

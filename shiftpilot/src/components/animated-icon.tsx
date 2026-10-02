import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IconMotion = "lift" | "tilt" | "pulse" | "turn" | "slide" | "pop";

/** Decorative icon. Add icon-trigger to its link, button or heading to animate it. */
export function AnimatedIcon({ icon: Icon, motion = "lift", className }: { icon: LucideIcon; motion?: IconMotion; className?: string }) {
  return (
    <span className="animated-icon inline-flex shrink-0" data-motion={motion} aria-hidden="true">
      <Icon className={cn("size-4", className)} aria-hidden="true" />
    </span>
  );
}

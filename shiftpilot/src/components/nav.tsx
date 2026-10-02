"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarDays, House, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedIcon } from "@/components/animated-icon";

const LINKS = [
  { href: "/", label: "Overview", icon: House, motion: "pop" },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, motion: "tilt" },
  { href: "/workers", label: "Team", icon: Users, motion: "lift" },
  { href: "/activity", label: "Activity", icon: Activity, motion: "pulse" },
  { href: "/settings", label: "Settings", icon: Settings2, motion: "turn" },
] as const;

export function Nav({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label={mobile ? "Mobile navigation" : "Main navigation"} className={cn(mobile ? "grid grid-cols-5 gap-1" : "flex flex-col gap-1.5")}>
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "icon-trigger flex items-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              mobile ? "min-h-14 flex-col justify-center gap-1 px-1 py-2 text-[11px] sm:text-xs" : "gap-3 px-3.5 py-3 text-sm",
              active ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <AnimatedIcon icon={l.icon} motion={l.motion} className="size-[18px]" />{l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function CurrentPageLabel() {
  const path = usePathname();
  return <span className="font-medium text-foreground">{LINKS.find((link) => link.href === "/" ? path === "/" : path.startsWith(link.href))?.label ?? "Workspace"}</span>;
}

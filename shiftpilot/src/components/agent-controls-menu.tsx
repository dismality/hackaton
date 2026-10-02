"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { AnimatedIcon } from "@/components/animated-icon";

export function AgentControlsMenu({ children }: { children: React.ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const path = usePathname();

  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [path]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target) && details.current) details.current.open = false;
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.current?.open) {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  return (
    <details ref={details} className="group relative shrink-0">
      <summary className="icon-trigger flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border bg-background px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <AnimatedIcon icon={SlidersHorizontal} motion="turn" className="size-3.5" />Agent controls
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

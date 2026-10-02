"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders server components periodically so inbound WhatsApp activity shows up live. */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !document.querySelector('form :focus, form[data-pending="true"]')) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

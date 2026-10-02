import { CheckCircle2, Circle, Loader2, MinusCircle, PauseCircle, ShieldCheck } from "lucide-react";
import type { AuditTool } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import type { PlanStepStatus, WeekStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StepIcon({ status, gate }: { status: PlanStepStatus; gate?: boolean }) {
  const cls = "size-4 shrink-0";
  if (status === "done") return <CheckCircle2 className={cn(cls, "text-emerald-600")} aria-label="Done" />;
  if (status === "in_progress")
    return gate ? <ShieldCheck className={cn(cls, "text-amber-600")} aria-label="Waiting for approval" /> : <Loader2 className={cn(cls, "animate-spin text-sky-600")} aria-label="In progress" />;
  if (status === "blocked") return <PauseCircle className={cn(cls, "text-amber-600")} aria-label="Blocked" />;
  if (status === "skipped") return <MinusCircle className={cn(cls, "text-muted-foreground")} aria-label="Skipped" />;
  return <Circle className={cn(cls, "text-muted-foreground/50")} aria-label="Pending" />;
}

const WEEK_LABELS: Record<WeekStatus, string> = {
  awaiting_send_approval: "Waiting for approval",
  collecting: "Collecting availability",
  solving: "Building roster",
  awaiting_publish: "Waiting for publish approval",
  published: "Published",
  cancelled: "Cancelled",
};

export function WeekStatusBadge({ status }: { status: WeekStatus }) {
  const variant = status === "published" ? "default" : status === "cancelled" ? "outline" : "secondary";
  return <Badge variant={variant}>{WEEK_LABELS[status]}</Badge>;
}

const TOOL_STYLES: Record<AuditTool, string> = {
  whatsapp: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  jev: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  llm: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  solver: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ranking: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  sheets: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300",
  policy: "bg-muted text-foreground",
  manager: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  clock: "bg-muted text-muted-foreground",
};

const TOOL_LABELS: Record<AuditTool, string> = {
  whatsapp: "WhatsApp",
  jev: "Jev",
  llm: "GPT-6 Sol",
  solver: "Solver",
  ranking: "Ranking",
  sheets: "Sheets",
  policy: "Agent",
  manager: "Manager",
  clock: "Clock",
};

export function ToolBadge({ tool }: { tool: AuditTool }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", TOOL_STYLES[tool])}>{TOOL_LABELS[tool]}</span>;
}

export { TOOL_LABELS };

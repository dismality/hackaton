import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Activity, ArrowRight, Bot, BrainCircuit, CalendarCheck2, ChevronDown, Clock3, Code2, History, ListOrdered, MessageSquare, Sheet, Sparkles, UserRoundCog, type LucideIcon } from "lucide-react";
import { getWorkspace } from "@/agent/context";
import { getDb, schema } from "@/db";
import type { AuditTool } from "@/db/schema";
import { AnimatedIcon } from "@/components/animated-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { TOOL_LABELS } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const SOURCE_ICONS: Record<AuditTool, LucideIcon> = {
  whatsapp: MessageSquare,
  jev: Sparkles,
  llm: BrainCircuit,
  solver: CalendarCheck2,
  ranking: ListOrdered,
  sheets: Sheet,
  policy: Bot,
  manager: UserRoundCog,
  clock: Clock3,
};

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await connection();
  const params = await searchParams;
  const tool = typeof params.tool === "string" && params.tool in TOOL_LABELS ? (params.tool as AuditTool) : null;
  const ws = await getWorkspace();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(tool ? eq(schema.auditLog.tool, tool) : undefined)
    .orderBy(desc(schema.auditLog.id))
    .limit(300);
  const filterClass = "icon-trigger inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh seconds={6} />
      <div className="space-y-2">
        <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight"><AnimatedIcon icon={Activity} motion="pulse" className="size-5" />Activity</h1>
        <p className="text-muted-foreground">Follow the decisions, messages and changes behind your roster.</p>
      </div>

      <nav aria-label="Filter activity by source" className="space-y-3">
        <p className="text-sm font-medium">Filter by source</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/activity" aria-current={!tool ? "page" : undefined} className={cn(filterClass, !tool ? "border-primary bg-primary font-medium text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")}><AnimatedIcon icon={Activity} motion="pulse" />All activity</Link>
          {(Object.keys(TOOL_LABELS) as AuditTool[]).map((t) => (
            <Link key={t} href={`/activity?tool=${t}`} aria-current={tool === t ? "page" : undefined} className={cn(filterClass, tool === t ? "border-primary bg-primary font-medium text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <AnimatedIcon icon={SOURCE_ICONS[t]} />
              {TOOL_LABELS[t]}
            </Link>
          ))}
        </div>
      </nav>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle><h2 className="icon-trigger inline-flex items-center gap-2"><AnimatedIcon icon={tool ? SOURCE_ICONS[tool] : History} motion="tilt" />{tool ? `${TOOL_LABELS[tool]} activity` : "Recent activity"}</h2></CardTitle>
            {rows.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{rows.length === 300 ? "Latest 300 events" : `${rows.length} ${rows.length === 1 ? "event" : "events"}`}</span>}
          </div>
          <CardDescription>Newest first. Updates appear automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length > 0 ? (
            <ol className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="grid gap-3 py-5 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                  <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-start sm:gap-2.5">
                    <time dateTime={r.at.toISOString()} className="text-xs leading-5 text-muted-foreground tabular-nums">{formatDateTime(r.at.getTime(), ws.timezone)}</time>
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium">{TOOL_LABELS[r.tool]}</span>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm leading-6 break-words">{r.summary}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>By {r.actor}</span>
                      {r.weekId && <Link href={`/schedule?week=${r.weekId}`} className="icon-trigger inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">View roster <AnimatedIcon icon={ArrowRight} motion="slide" className="size-3" /></Link>}
                    </div>
                    {r.details && Object.keys(r.details).length > 0 && (
                      <details className="group/details pt-1">
                        <summary className="icon-trigger inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                          <AnimatedIcon icon={Code2} motion="pop" className="size-3.5" />
                          <ChevronDown className="size-3.5 transition-transform group-open/details:rotate-180" />
                          View technical details
                        </summary>
                        <div className="mt-3 overflow-hidden rounded-lg border bg-muted/30">
                          <p className="border-b px-3 py-2 text-xs text-muted-foreground">Action: {r.action}</p>
                          <pre className="max-h-64 overflow-auto p-3 text-xs leading-5">{JSON.stringify(r.details, null, 2)}</pre>
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <Activity className="size-8 text-muted-foreground" aria-hidden="true" />
              <div className="space-y-2">
                <h2 className="text-lg font-medium">{tool ? `No ${TOOL_LABELS[tool]} activity yet` : "Your activity will appear here"}</h2>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">{tool ? "Try another source or view all activity to see the latest changes." : "Plan your first week from Overview. Decisions, team replies and roster updates will be recorded here."}</p>
              </div>
              <Link href={tool ? "/activity" : "/"} className={cn(buttonVariants({ variant: "outline" }), "icon-trigger mt-2 h-10 px-4")}>{tool ? "View all activity" : "Go to Overview"} <AnimatedIcon icon={ArrowRight} motion="slide" /></Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


import Link from "next/link";
import { ArrowUpRight, BookOpen, CalendarDays, Clock, FastForward, Play, RotateCcw } from "lucide-react";
import { advanceClockAction, runTickAction } from "@/app/actions";
import { getWorkspace, nowMs } from "@/agent/context";
import { SubmitButton } from "@/components/action-form";
import { AgentControlsMenu } from "@/components/agent-controls-menu";
import { AnimatedIcon } from "@/components/animated-icon";
import { CurrentPageLabel, Nav } from "@/components/nav";
import { formatDateTime } from "@/lib/time";

async function AgentControls() {
  const ws = await getWorkspace();
  const offset = ws.clockOffsetMinutes;
  return (
    <AgentControlsMenu>
      <div className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-background p-5 shadow-lg">
        <div className="mb-4 flex items-start gap-2.5">
          <Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Agent clock</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{formatDateTime(nowMs(ws), ws.timezone)}</p>
            {offset !== 0 && <p className="mt-1 text-xs text-amber-700">Demo clock: +{Math.round(offset / 60)} hours</p>}
          </div>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Fast-forward to test reminders and shift offers.</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {[60, 720, 1440].map((m) => (
            <form key={m} action={advanceClockAction}>
              <input type="hidden" name="minutes" value={m} />
              <SubmitButton size="sm" variant="outline" pendingLabel="…" className="icon-trigger"><AnimatedIcon icon={FastForward} motion="slide" className="size-3.5" />+{m / 60}h</SubmitButton>
            </form>
          ))}
          {offset !== 0 && (
            <form action={advanceClockAction}>
              <input type="hidden" name="minutes" value={0} />
              <SubmitButton size="sm" variant="ghost" pendingLabel="…" className="icon-trigger"><AnimatedIcon icon={RotateCcw} motion="turn" className="size-3.5" />Reset clock</SubmitButton>
            </form>
          )}
        </div>
        <form action={runTickAction} className="border-t pt-4">
          <SubmitButton variant="secondary" pendingLabel="Running…" className="icon-trigger w-full"><AnimatedIcon icon={Play} motion="slide" />Run agent now</SubmitButton>
        </form>
      </div>
    </AgentControlsMenu>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ws = await getWorkspace();
  return (
    <div className="dashboard min-h-screen bg-muted/20">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-background px-5 py-7 lg:flex">
        <Link href="/" className="icon-trigger mb-10 flex items-center gap-2.5 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><AnimatedIcon icon={CalendarDays} motion="tilt" className="size-5" /></span>
          <span className="text-lg font-semibold tracking-tight">ShiftPilot</span>
        </Link>
        <p className="mb-3 px-3.5 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Workspace</p>
        <Nav />
        <div className="mt-auto pt-8">
          <Link href="/setup" className="icon-trigger mb-5 flex items-center justify-between gap-2 rounded-xl border p-3.5 text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <span><span className="flex items-center gap-2 font-medium"><AnimatedIcon icon={BookOpen} motion="tilt" className="size-3.5" />Setup guide</span><span className="mt-1 block text-xs text-muted-foreground">Walk through the basics</span></span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-3 border-t px-1 pt-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium" aria-hidden="true">{ws.businessName.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0"><p className="truncate text-sm font-medium" title={ws.businessName}>{ws.businessName}</p><p className="text-xs text-muted-foreground">Manager workspace</p></div>
          </div>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-56">
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex min-h-18 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
            <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex"><span>Workspace</span><span aria-hidden="true">/</span><CurrentPageLabel /></div>
            <Link href="/" className="icon-trigger flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight lg:hidden"><AnimatedIcon icon={CalendarDays} motion="tilt" className="size-5" />ShiftPilot</Link>
            <AgentControls />
          </div>
          <div className="border-t px-3 py-2 lg:hidden"><Nav mobile /></div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl min-w-0 scroll-mt-44 px-5 py-8 outline-none sm:px-8 sm:py-10 lg:scroll-mt-24 lg:px-10">{children}</main>
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t px-5 py-5 text-xs text-muted-foreground sm:px-8 lg:hidden">
          <span>{ws.businessName}</span><Link href="/setup" className="icon-trigger inline-flex items-center gap-2 rounded-md py-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><AnimatedIcon icon={BookOpen} motion="tilt" className="size-3.5" />Setup guide<ArrowUpRight className="size-3" aria-hidden="true" /></Link>
        </footer>
      </div>
    </div>
  );
}

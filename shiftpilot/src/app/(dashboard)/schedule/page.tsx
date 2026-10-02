import { desc } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, MessageSquare, RotateCcw, ShieldCheck, UserRoundPlus, WandSparkles, X } from "lucide-react";
import { addAssignmentAction, buildNowAction, removeAssignmentAction, requestPublishAction, resolveAgainAction } from "@/app/actions";
import { loadWeekState, type WeekState } from "@/agent/context";
import { latestWeekId } from "@/agent/metrics";
import { availabilityKey, validateRoster } from "@/agent/solver";
import { getDb, schema } from "@/db";
import type { Shift } from "@/db/schema";
import { SubmitButton } from "@/components/action-form";
import { AnimatedIcon } from "@/components/animated-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { WeekStatusBadge } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, DAY_NAMES, DAY_SHORT, formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

function ShiftRoster({ shift, state, editable }: { shift: Shift; state: WeekState; editable: boolean }) {
  const { assignments, workers, availability } = state;
  const onShift = assignments.filter((a) => a.shiftId === shift.id);
  const open = Math.max(0, shift.requiredCount - onShift.length);
  const options = workers
    .filter((w) => !onShift.some((a) => a.workerId === w.id))
    .map((w) => ({ w, said: availability.get(availabilityKey(w.id, shift.id)) }))
    .sort((a, b) => (a.said === "yes" ? 0 : 1) - (b.said === "yes" ? 0 : 1));

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <p className="font-medium">{shift.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{shift.start}–{shift.end}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-muted-foreground tabular-nums">{onShift.length} / {shift.requiredCount} filled</span>
        {open > 0 && <span className="font-medium text-destructive">{open} open</span>}
      </div>
      {onShift.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {onShift.map((a) => {
            const workerName = workers.find((w) => w.id === a.workerId)?.name.replace(" (sim)", "") ?? "Unknown worker";
            return (
              <li key={a.id} className="flex min-h-9 items-center justify-between gap-1 rounded-lg bg-muted/60 py-1 pl-2.5 pr-1" title={a.reason ?? undefined}>
                <span className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
                  {a.source === "replacement" && <RotateCcw className="size-3 shrink-0 text-muted-foreground" aria-label="Replacement" />}
                  <span className="break-words">{workerName}</span>
                </span>
                {editable && (
                  <form action={removeAssignmentAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton size="icon-sm" variant="ghost" pendingLabel="…" aria-label={`Remove ${workerName} from ${shift.label} on ${formatDate(shift.date)}`} title={`Remove ${workerName}`}>
                      <X className="size-3.5" />
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No one assigned yet.</p>}
      {shift.requiredSkills.length > 0 && <p className="text-xs leading-5 text-muted-foreground">Needs {shift.requiredSkills.join(", ")}</p>}
      {editable && open > 0 && (
        <details className="group/add">
          <summary className="icon-trigger flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md py-1 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2"><AnimatedIcon icon={UserRoundPlus} motion="pop" className="size-3.5" />Add worker</span>
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open/add:rotate-180" />
          </summary>
          <form action={addAssignmentAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="shiftId" value={shift.id} />
            <select name="workerId" defaultValue="" required className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Worker for ${shift.label} on ${formatDate(shift.date)}`}>
              <option value="" disabled>Choose a worker</option>
              {options.map(({ w, said }) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {said === "yes" ? "available" : said === "no" ? "unavailable" : said === "unsure" ? "unsure" : "no reply"}
                </option>
              ))}
            </select>
            <SubmitButton variant="outline" className="h-9 w-full text-xs" pendingLabel="Adding…">Add to shift</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  await connection();
  const params = await searchParams;
  const weeks = await getDb().select().from(schema.weeks).orderBy(desc(schema.weeks.id)).limit(8);
  const weekId = params.week ? Number(params.week) : await latestWeekId();
  if (!weekId) {
    return (
      <div className="flex flex-col gap-8">
        <div className="space-y-2">
          <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight"><AnimatedIcon icon={CalendarDays} motion="tilt" className="size-5" />Schedule</h1>
          <p className="text-muted-foreground">See who&apos;s working and keep every shift covered.</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-lg font-medium">Your first roster starts here</h2>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">Plan a week from Overview. Once it&apos;s ready, you can review the roster and make changes here.</p>
            </div>
            <Link href="/" className={cn(buttonVariants(), "icon-trigger mt-2 h-10 px-4")}>Go to Overview <AnimatedIcon icon={ArrowRight} motion="slide" /></Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  const st = await loadWeekState(weekId);
  const { ws, week, shifts, workers, assignments, availability, solverShifts, solverWorkers } = st;
  const violations = validateRoster({ shifts: solverShifts, workers: solverWorkers, rules: ws.rules }, assignments);
  const hours = new Map<number, number>();
  for (const a of assignments) hours.set(a.workerId, (hours.get(a.workerId) ?? 0) + (st.shiftById.get(a.shiftId)?.hours ?? 0));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.weekStart, i));
  const editable = week.status === "awaiting_publish" || week.status === "published";
  const totalSlots = shifts.reduce((n, s) => n + s.requiredCount, 0);
  const openSlots = shifts.reduce((n, s) => n + Math.max(0, s.requiredCount - assignments.filter((a) => a.shiftId === s.id).length), 0);

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh seconds={8} />
      <div className="space-y-2">
        <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight"><AnimatedIcon icon={CalendarDays} motion="tilt" className="size-5" />Schedule</h1>
        <p className="text-muted-foreground">See who&apos;s working and keep every shift covered.</p>
      </div>

      <nav aria-label="Schedule weeks" className="space-y-3">
        <p className="text-sm font-medium">Recent weeks</p>
        <div className="flex flex-wrap gap-2">
          {weeks.map((w) => (
            <Link key={w.id} href={`/schedule?week=${w.id}`} aria-current={w.id === week.id ? "page" : undefined} className={cn("icon-trigger inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50", w.id === week.id ? "border-primary bg-primary font-medium text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <AnimatedIcon icon={CalendarDays} motion="tilt" />
              {formatDate(w.weekStart)}
              {w.status === "cancelled" && <span className="text-xs opacity-70">Cancelled</span>}
            </Link>
          ))}
        </div>
      </nav>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="icon-trigger inline-flex items-center gap-2"><AnimatedIcon icon={CalendarDays} motion="tilt" />Week of {formatDate(week.weekStart)}</CardTitle>
              <CardDescription>{formatDate(week.weekStart)} – {formatDate(addDays(week.weekStart, 6))}</CardDescription>
            </div>
            <WeekStatusBadge status={week.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-sm">
            <span><span className="font-medium tabular-nums">{assignments.length} / {totalSlots}</span> <span className="text-muted-foreground">slots filled</span></span>
            <span className={cn(openSlots > 0 ? "text-destructive" : "text-muted-foreground")}>{openSlots > 0 ? `${openSlots} still open` : "All shifts covered"}</span>
            <span className={cn(violations.length > 0 ? "text-destructive" : "text-muted-foreground")}>{violations.length > 0 ? `${violations.length} rule ${violations.length === 1 ? "warning" : "warnings"}` : "All scheduling rules met"}</span>
          </div>
          {(week.status === "collecting" || week.status === "awaiting_publish") && (
            <div className="flex flex-wrap items-center gap-2">
              {week.status === "collecting" && (
                <form action={buildNowAction}>
                  <input type="hidden" name="weekId" value={week.id} />
                  <SubmitButton variant="outline" className="icon-trigger h-10 px-4"><AnimatedIcon icon={WandSparkles} motion="pop" />Build roster now</SubmitButton>
                </form>
              )}
              {week.status === "awaiting_publish" && (
                <>
                  <form action={requestPublishAction}>
                    <input type="hidden" name="weekId" value={week.id} />
                    <SubmitButton className="icon-trigger h-10 px-4"><AnimatedIcon icon={ShieldCheck} motion="pulse" />Request publish approval</SubmitButton>
                  </form>
                  <form action={resolveAgainAction}>
                    <input type="hidden" name="weekId" value={week.id} />
                    <SubmitButton variant="outline" className="icon-trigger h-10 px-4" pendingLabel="Building…"><AnimatedIcon icon={RotateCcw} motion="turn" />Rebuild roster</SubmitButton>
                  </form>
                </>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {violations.length > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <p className="mb-2 text-sm font-medium text-destructive">Review these scheduling warnings</p>
              <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-destructive">{violations.map((v) => <li key={v}>{v}</li>)}</ul>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {days.map((date, i) => {
              const dayShifts = shifts.filter((s) => s.date === date);
              return (
                <section key={date} aria-label={formatDate(date)} className="min-w-0 overflow-hidden rounded-xl border">
                  <div className="flex items-baseline justify-between gap-2 border-b bg-muted/40 px-4 py-3">
                    <h2 className="font-medium">{DAY_NAMES[i]}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">{date.slice(8)}</span>
                  </div>
                  <div className="divide-y">
                    {dayShifts.map((shift) => <ShiftRoster key={shift.id} shift={shift} state={st} editable={editable} />)}
                    {dayShifts.length === 0 && <p className="p-4 text-xs text-muted-foreground">No shifts planned.</p>}
                  </div>
                </section>
              );
            })}
          </div>
          {editable && <p className="text-xs leading-5 text-muted-foreground">Use the × beside a name to remove an assignment. Open shifts let you add a worker; their availability is shown in the list.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="icon-trigger inline-flex items-center gap-2"><AnimatedIcon icon={Clock3} motion="tilt" />Availability and hours</CardTitle>
          <CardDescription>Review team replies and compare assigned hours with each person&apos;s weekly limit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {workers.map((w) => {
              const max = solverWorkers.find((x) => x.id === w.id)?.maxHours ?? 0;
              const h = hours.get(w.id) ?? 0;
              return (
                <div key={w.id} className="flex items-center justify-between gap-3 border-b pb-3 text-sm">
                  <span className="min-w-0 truncate" title={w.name}>{w.name}</span>
                  <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", h > max && "text-destructive")}><span className="font-medium">{Number(h.toFixed(1))}</span> / {max}h</span>
                </div>
              );
            })}
          </div>
          <details className="group/availability">
            <summary className="icon-trigger flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2"><AnimatedIcon icon={MessageSquare} motion="pop" />View replies by shift</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/availability:rotate-180" />
            </summary>
            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <caption className="sr-only">Team availability for the week of {formatDate(week.weekStart)}. Dark cells show assigned shifts.</caption>
                <thead className="bg-muted/40">
                  <tr>
                    <th scope="col" className="p-3 text-left font-medium">Worker</th>
                    <th scope="col" className="p-3 text-left font-medium">Hours</th>
                    {shifts.map((s) => (
                      <th scope="col" key={s.id} className="px-2 py-3 text-center font-normal text-muted-foreground" title={`${formatDate(s.date)} ${s.label}`}>
                        {DAY_SHORT[days.indexOf(s.date)]}<br />{s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => {
                    const max = solverWorkers.find((x) => x.id === w.id)?.maxHours ?? 0;
                    const h = hours.get(w.id) ?? 0;
                    return (
                      <tr key={w.id} className="border-t">
                        <th scope="row" className="p-3 text-left font-normal whitespace-nowrap">{w.name}</th>
                        <td className={cn("p-3 tabular-nums whitespace-nowrap", h > max && "text-destructive")}>{Number(h.toFixed(1))}/{max}h</td>
                        {shifts.map((s) => {
                          const said = availability.get(availabilityKey(w.id, s.id));
                          const assigned = assignments.some((a) => a.shiftId === s.id && a.workerId === w.id);
                          return (
                            <td key={s.id} className={cn("p-2 text-center", assigned && "bg-primary text-primary-foreground")} aria-label={`${said === "yes" ? "Available" : said === "no" ? "Unavailable" : said === "unsure" ? "Unsure" : "No reply"}${assigned ? ", assigned" : ""}`}>
                              {said === "yes" ? "✓" : said === "no" ? "✗" : said === "unsure" ? "?" : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">✓ available · ✗ unavailable · ? unsure · — no reply. Dark cells are assigned shifts. Simulated workers answer automatically.</p>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}


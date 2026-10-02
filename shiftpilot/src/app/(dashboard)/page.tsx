import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Activity, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, Clock3, House, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSetupStatus, SETUP_STEPS } from "@/agent/setup";
import { buildNowAction, cancelWeekAction, decideApprovalAction, simulateOfferReplyAction } from "@/app/actions";
import { getWorkspace, shiftLabel } from "@/agent/context";
import type { NoCoverOption } from "@/agent/cover";
import { computeMetrics, latestWeekId } from "@/agent/metrics";
import { getDb, schema } from "@/db";
import { SubmitButton } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { AnimatedIcon, type IconMotion } from "@/components/animated-icon";
import { PlanningForm } from "@/components/planning-form";
import { StepIcon, ToolBadge, WeekStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DAY_SHORT, formatDate, formatDateTime } from "@/lib/time";

export default async function Overview() {
  await connection();
  const setup = await getSetupStatus();
  if (!setup.started) redirect("/setup");
  const db = getDb();
  const ws = await getWorkspace();
  const weekId = await latestWeekId();
  const [week] = weekId ? await db.select().from(schema.weeks).where(eq(schema.weeks.id, weekId)) : [];
  const workers = await db.select().from(schema.workers);
  const nameOf = new Map(workers.map((w) => [w.id, w.name]));

  const pendingApprovals = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).orderBy(schema.approvals.id);
  const requests = week ? await db.select().from(schema.availabilityRequests).where(eq(schema.availabilityRequests.weekId, week.id)) : [];
  const incidents = week
    ? await db
        .select({ incident: schema.incidents, shift: schema.shifts })
        .from(schema.incidents)
        .innerJoin(schema.shifts, eq(schema.incidents.shiftId, schema.shifts.id))
        .where(eq(schema.shifts.weekId, week.id))
        .orderBy(desc(schema.incidents.id))
    : [];
  const offers = incidents.length
    ? await db.select().from(schema.offers).where(inArray(schema.offers.incidentId, incidents.map((i) => i.incident.id))).orderBy(schema.offers.id)
    : [];
  const recent = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(5);
  const metrics = await computeMetrics(week?.id);

  const canStartNew = !week || week.status === "published" || week.status === "cancelled";
  const replied = requests.filter((request) => request.status === "responded").length;
  const teamCount = workers.filter((worker) => worker.active).length;

  return (
    <div className="space-y-8">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">{ws.businessName}</p>
          <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight text-balance"><AnimatedIcon icon={House} motion="pop" className="size-6" />Your week, at a glance</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{pendingApprovals.length ? `${pendingApprovals.length} ${pendingApprovals.length === 1 ? "decision needs" : "decisions need"} your approval. Review the next step below.` : week && week.status !== "cancelled" ? "Keep track of your roster, team replies and anything that needs your attention." : "Tell us what you need. ShiftPilot will help you put the week together."}</p>
        </div>
        <Link href={week ? `/schedule?week=${week.id}` : "/workers"} className="icon-trigger inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <AnimatedIcon icon={week ? CalendarDays : Users} motion={week ? "tilt" : "lift"} />{week ? "View schedule" : "View team"}<ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryMetric icon={ShieldCheck} motion="pulse" label="Needs approval" value={pendingApprovals.length} hint={pendingApprovals.length ? "Ready for your review" : "You're all caught up"} />
        <SummaryMetric icon={CalendarDays} motion="tilt" label="Shift coverage" value={metrics.coverage ? `${metrics.coverage.filled}/${metrics.coverage.required}` : "—"} hint={metrics.coverage ? "Places filled this week" : "Plan a week to get started"} />
        <SummaryMetric icon={Users} motion="lift" label={requests.length ? "Team replies" : "Active team"} value={requests.length ? `${replied}/${requests.length}` : teamCount} hint={requests.length ? "Availability received" : "People ready to schedule"} />
        <SummaryMetric icon={Clock3} motion="turn" label="Time saved" value={`${metrics.savedMinutes} min`} hint="Estimated manager time" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {setup.completed < setup.total && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-background p-5">
            <div>
              <div className="text-sm font-medium">Let&apos;s finish your setup</div>
              <div className="text-sm text-muted-foreground">
                {setup.completed} of {setup.total} complete · Next: {SETUP_STEPS.find((s) => !setup.done[s.key])?.title}
              </div>
            </div>
            <Link href="/setup" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring">
              Continue setup
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}

        {pendingApprovals.length > 0 && (
          <Card className="ring-1 ring-amber-300 bg-amber-50/30">
            <CardHeader>
              <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={ShieldCheck} motion="pulse" className="text-amber-700" />Needs your approval</h2></CardTitle>
              <CardDescription>Review the plan, then choose what happens next.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {pendingApprovals.map((a) => (
                <div key={a.id} className="rounded-lg border bg-background p-4">
                  <div className="font-medium">{a.title}</div>
                  <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{a.summary}</p>
                  {a.kind === "no_cover" ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {((a.payload.options as NoCoverOption[] | undefined) ?? []).map((o, i) => (
                        <form key={i} action={decideApprovalAction} className="flex flex-wrap items-center gap-3">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="option" value={i} />
                          <input type="hidden" name="decision" value="approve" />
                          <SubmitButton size="sm" variant={i === 0 ? "default" : "outline"} className="h-auto min-h-10 max-w-full justify-start py-2 text-left whitespace-normal">{o.label}</SubmitButton>
                          <span className="text-xs text-muted-foreground">{o.rationale}</span>
                        </form>
                      ))}
                    </div>
                  ) : (
                    <form action={decideApprovalAction} className="mt-4 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton size="sm" name="decision" value="approve">Approve</SubmitButton>
                      <SubmitButton size="sm" variant="outline" name="decision" value="reject">
                        {a.kind === "publish_schedule" ? "Not yet, I'll edit" : "Reject"}
                      </SubmitButton>
                      {a.kind === "publish_schedule" && (
                        <Link href={`/schedule?week=${a.weekId}`} className="ml-2 self-center text-sm underline underline-offset-4">
                          Review roster
                        </Link>
                      )}
                    </form>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {canStartNew && (
          <Card>
            <CardHeader>
              <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={Sparkles} motion="pop" />Let&apos;s plan your next week</h2></CardTitle>
              <CardDescription>Use your own words. You&apos;ll review the plan before the team is messaged.</CardDescription>
            </CardHeader>
            <CardContent>
              <PlanningForm />
              {workers.filter((w) => w.active).length === 0 && (
                <p className="mt-3 text-sm text-amber-700">
                  No workers yet. <Link href="/workers" className="underline">Add your team</Link> first.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {week && (
          <Card>
            <CardHeader>
              <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={CalendarDays} motion="tilt" />Week of {formatDate(week.weekStart)}</h2></CardTitle>
              <CardDescription className="italic">&ldquo;{week.goal}&rdquo;</CardDescription>
              <CardAction className="flex items-center gap-2">
                <WeekStatusBadge status={week.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {(week.assumptions.length > 0 || Object.keys(week.constraints).length > 0) && (
                <details className="group rounded-xl bg-muted/60 p-4 text-sm">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">How your goal was understood<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                    {week.constraints.closedDays?.length ? <li>Closed: {week.constraints.closedDays.map((d) => DAY_SHORT[d]).join(", ")}</li> : null}
                    {week.constraints.countOverrides?.map((o, i) => (
                      <li key={i}>
                        {ws.shiftTemplates.find((t) => t.key === o.templateKey)?.label ?? o.templateKey}
                        {o.days?.length ? ` on ${o.days.map((d) => DAY_SHORT[d]).join("/")}` : ""}: {o.requiredCount === 0 ? "not running" : `${o.requiredCount} people`}
                      </li>
                    ))}
                    {week.constraints.maxHoursPerWeek && <li>Max {week.constraints.maxHoursPerWeek}h per person</li>}
                    {week.constraints.notes && <li>Note: {week.constraints.notes}</li>}
                    {week.assumptions.map((a, i) => (
                      <li key={i}>Assumed: {a}</li>
                    ))}
                  </ul>
                </details>
              )}

              <ol className="flex flex-col gap-0">
                {week.plan.map((s) => (
                  <li key={s.id} className="flex gap-3 border-b py-3 last:border-0">
                    <span className="mt-0.5"><StepIcon status={s.status} gate={s.gate} /></span>
                    <div>
                      <div className="text-sm font-medium">
                        {s.title}
                        {s.gate && <span className="ml-2 text-xs font-normal text-amber-700">Your approval</span>}
                      </div>
                      <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>

              {week.summary && (
                <div className="rounded-lg border p-3 text-sm whitespace-pre-line">
                  <div className="mb-1 font-medium">Roster summary</div>
                  {week.summary}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {week.status === "collecting" && (
                  <form action={buildNowAction}>
                    <input type="hidden" name="weekId" value={week.id} />
                    <SubmitButton size="sm" variant="outline" pendingLabel="Building…">Build roster now</SubmitButton>
                  </form>
                )}
                <Link href={`/schedule?week=${week.id}`} className="icon-trigger inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  Review schedule<AnimatedIcon icon={ArrowRight} motion="slide" className="size-3.5" />
                </Link>
                {week.status !== "published" && (
                  <form action={cancelWeekAction}>
                    <input type="hidden" name="weekId" value={week.id} />
                    <SubmitButton size="sm" variant="ghost">Cancel week</SubmitButton>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {incidents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={RefreshCw} motion="turn" />Changes during the week</h2></CardTitle>
              <CardDescription>Sick calls and drop-outs the agent is handling. Reasons are never shared with other staff.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {incidents.map(({ incident, shift }) => {
                const myOffers = offers.filter((o) => o.incidentId === incident.id);
                return (
                  <div key={incident.id} className="rounded-lg border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{shiftLabel(shift)}</div>
                      <Badge variant={incident.status === "filled" ? "default" : incident.status === "unfilled" ? "destructive" : "secondary"}>
                        {incident.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {nameOf.get(incident.workerId)} {incident.kind === "sick" ? "reported sick" : "can't make it"} at {formatDateTime(incident.reportedAt.getTime(), ws.timezone)}
                      {incident.sensitive && " · health details private"}
                      {incident.filledByWorkerId && ` · covered by ${nameOf.get(incident.filledByWorkerId)}`}
                    </div>
                    <div className="mt-3 grid gap-1.5">
                      {incident.candidates.slice(0, 5).map((c, i) => {
                        const offer = myOffers.findLast((o) => o.workerId === c.workerId);
                        const simulated = workers.find((w) => w.id === c.workerId)?.simulated;
                        return (
                          <div key={c.workerId} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                            <span className="font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.reasons.join(" · ")}</span>
                            {offer && <Badge variant="outline">{offer.status}</Badge>}
                            {offer?.status === "pending" && simulated && (
                              <form action={simulateOfferReplyAction} className="flex gap-1">
                                <input type="hidden" name="offerId" value={offer.id} />
                                <SubmitButton size="xs" name="decision" value="accept">Simulate yes</SubmitButton>
                                <SubmitButton size="xs" variant="outline" name="decision" value="decline">Simulate no</SubmitButton>
                              </form>
                            )}
                          </div>
                        );
                      })}
                      {incident.candidates.length === 0 && <div className="text-sm text-muted-foreground">No eligible candidates.</div>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="rounded-2xl border bg-background p-5">
          <h2 className="text-sm font-medium">A little less admin.</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">ShiftPilot collects availability, follows up with your team and builds a roster. You decide when to send and publish.</p>
          <div className="mt-4 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />You&apos;re in control at every step</div>
        </div>
        <details className="group rounded-2xl border bg-background p-5">
          <summary className="icon-trigger flex cursor-pointer items-center justify-between gap-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="inline-flex items-center gap-2"><AnimatedIcon icon={Clock3} motion="turn" />Time &amp; effort saved</span><ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Estimates use the baselines in Settings.</p>
          <div className="mt-4 grid grid-cols-2 gap-5">
            <Metric label="Manager time saved" value={`${metrics.savedMinutes} min`} hint={`${metrics.manualMinutes} min manual vs ${metrics.managerMinutes} min approving`} />
            <Metric label="Manual steps removed" value={metrics.stepsRemoved} hint={`${metrics.messagesOut} sent, ${metrics.messagesIn} read`} />
            <Metric label="Reminders sent" value={metrics.reminders} />
            <Metric label="Decisions you made" value={metrics.managerDecisions} />
            <Metric
              label="Coverage"
              value={metrics.coverage ? `${metrics.coverage.filled}/${metrics.coverage.required}` : "–"}
              hint={metrics.ruleViolations === null ? undefined : `${metrics.ruleViolations} rule violations`}
            />
            <Metric
              label="Sick-call fill time"
              value={metrics.medianFillMinutes === null ? "–" : `${metrics.medianFillMinutes} min`}
              hint={`${metrics.incidentsFilled}/${metrics.incidents} covered by staff`}
            />
          </div>
        </details>

        {week && requests.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={MessageCircle} motion="pop" />Availability replies</h2></CardTitle>
              <CardDescription>
                {replied} of {requests.length} replied
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-0">
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Team availability replies" aria-valuenow={replied} aria-valuemin={0} aria-valuemax={requests.length}><div className="h-full rounded-full bg-primary" style={{ width: `${replied / requests.length * 100}%` }} /></div>
              {requests
                .sort((a, b) => a.status.localeCompare(b.status) * -1)
                .map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm">
                    <span>{nameOf.get(r.workerId)}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.status === "responded" ? "✓ replied" : r.status === "no_response" ? "no reply, flagged" : `waiting${r.remindersSent ? `, ${r.remindersSent} reminder(s)` : ""}`}
                    </span>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle><h2 className="icon-trigger flex items-center gap-2"><AnimatedIcon icon={Activity} motion="pulse" />Recent activity</h2></CardTitle>
            <CardAction>
              <Link href="/activity" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">View all<ArrowRight className="size-3" aria-hidden="true" /></Link>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {recent.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <ToolBadge tool={e.tool} />
                  {formatDateTime(e.at.getTime(), ws.timezone)}
                </div>
                <div className="text-sm leading-relaxed">{e.summary}</div>
              </div>
            ))}
            {recent.length === 0 && <div className="text-sm leading-relaxed text-muted-foreground">Your team messages and scheduling updates will appear here.</div>}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}

function SummaryMetric({ icon, motion, label, value, hint }: { icon: typeof Users; motion: IconMotion; label: string; value: string | number; hint: string }) {
  return (
    <div className="icon-trigger rounded-2xl border bg-background p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><AnimatedIcon icon={icon} motion={motion} /></div>
      <div className="mt-3 text-2xl font-medium tracking-tight tabular-nums">{value}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-medium tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

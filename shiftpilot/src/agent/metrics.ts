import { and, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getWorkspace, loadWeekState } from "./context";
import { validateRoster } from "./solver";

export type Metrics = {
  messagesOut: number;
  messagesOutReal: number;
  messagesIn: number;
  reminders: number;
  offers: number;
  rostersBuilt: number;
  managerDecisions: number;
  incidents: number;
  incidentsFilled: number;
  medianFillMinutes: number | null;
  manualMinutes: number;
  managerMinutes: number;
  savedMinutes: number;
  stepsRemoved: number;
  coverage: { filled: number; required: number } | null;
  ruleViolations: number | null;
  failedMessages: number;
};

export async function computeMetrics(weekId?: number | null): Promise<Metrics> {
  const db = getDb();
  const ws = await getWorkspace();
  const b = ws.baselines;

  const msgs = await db.select({ direction: schema.messages.direction, status: schema.messages.status, kind: schema.messages.kind }).from(schema.messages);
  const out = msgs.filter((m) => m.direction === "out" && m.status !== "failed" && m.kind !== "template");
  const messagesOut = out.length;
  const messagesOutReal = out.filter((m) => m.status !== "simulated").length;
  const messagesIn = msgs.filter((m) => m.direction === "in").length;
  const failedMessages = msgs.filter((m) => m.status === "failed").length;

  const actions = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(inArray(schema.auditLog.action, ["reminder.sent", "cover.offered", "roster.solved"]));
  const count = (a: string) => actions.filter((x) => x.action === a).length;
  const reminders = count("reminder.sent");
  const offers = count("cover.offered");
  const rostersBuilt = count("roster.solved");

  const decided = await db.select({ id: schema.approvals.id }).from(schema.approvals).where(and(ne(schema.approvals.status, "pending"), ne(schema.approvals.decision, "superseded")));
  const managerDecisions = decided.length;

  const incidents = await db.select().from(schema.incidents);
  const filled = incidents.filter((i) => i.status === "filled" && i.resolvedAt && i.filledByWorkerId);
  const fillTimes = filled.map((i) => (i.resolvedAt!.getTime() - i.reportedAt.getTime()) / 60000).sort((x, y) => x - y);
  const medianFillMinutes = fillTimes.length ? Math.round(fillTimes[Math.floor(fillTimes.length / 2)]) : null;

  const manualMinutes =
    messagesOut * b.minutesPerMessageSent +
    messagesIn * b.minutesPerReplyRead +
    rostersBuilt * b.minutesToBuildRoster +
    offers * b.minutesPerCoverCall;
  const managerMinutes = managerDecisions * b.minutesPerApproval;

  let coverage: Metrics["coverage"] = null;
  let ruleViolations: number | null = null;
  if (weekId) {
    const st = await loadWeekState(weekId);
    coverage = { filled: st.assignments.length, required: st.shifts.reduce((n, s) => n + s.requiredCount, 0) };
    ruleViolations = validateRoster({ shifts: st.solverShifts, workers: st.solverWorkers, rules: ws.rules }, st.assignments).length;
  }

  return {
    messagesOut,
    messagesOutReal,
    messagesIn,
    reminders,
    offers,
    rostersBuilt,
    managerDecisions,
    incidents: incidents.length,
    incidentsFilled: filled.length,
    medianFillMinutes,
    manualMinutes: Math.round(manualMinutes),
    managerMinutes: Math.round(managerMinutes * 10) / 10,
    savedMinutes: Math.round(manualMinutes - managerMinutes),
    stepsRemoved: messagesOut + messagesIn + rostersBuilt + reminders,
    coverage,
    ruleViolations,
    failedMessages,
  };
}

export async function latestWeekId(): Promise<number | null> {
  const db = getDb();
  const rows = await db.select({ id: schema.weeks.id, status: schema.weeks.status }).from(schema.weeks).orderBy(schema.weeks.id);
  const active = rows.filter((r) => r.status !== "cancelled");
  return active.length ? active[active.length - 1].id : null;
}

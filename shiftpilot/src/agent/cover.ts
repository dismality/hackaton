import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Incident, Worker } from "@/db/schema";
import { llmJson } from "@/integrations/llm";
import { integrations } from "@/lib/env";
import { formatDuration } from "@/lib/time";
import type { RankedCandidate } from "@/lib/types";
import { audit } from "./audit";
import { getWorkspace, loadWeekState, nowDate, nowMs, shiftLabel, type WeekState } from "./context";
import * as copy from "./copy";
import { sendToWorker } from "./outbox";
import { updatePlan } from "./plan";
import { rankReplacements } from "./ranking";
import { conflictReason } from "./solver";

async function getIncident(id: number): Promise<Incident> {
  const [row] = await getDb().select().from(schema.incidents).where(eq(schema.incidents.id, id));
  if (!row) throw new Error(`Incident ${id} not found`);
  return row;
}

function placedExcept(state: WeekState, assignmentId?: number | null) {
  return state.assignments
    .filter((a) => a.id !== assignmentId)
    .map((a) => ({ shift: state.shiftById.get(a.shiftId)!, workerId: a.workerId }));
}

export async function rank(state: WeekState, incident: Pick<Incident, "shiftId" | "workerId" | "assignmentId">, alsoExclude: number[] = []) {
  return rankReplacements({
    shift: state.shiftById.get(incident.shiftId)!,
    workers: state.solverWorkers,
    availability: state.availability,
    placed: placedExcept(state, incident.assignmentId),
    rules: { minRestHours: state.ws.rules.minRestHours, maxShiftsPerDay: state.ws.rules.maxShiftsPerDay },
    excludeWorkerIds: [incident.workerId, ...alsoExclude],
  });
}

export async function reportUnavailable(worker: Worker, assignmentId: number, sick: boolean, sensitive: boolean): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, assignmentId));
  if (!assignment || assignment.workerId !== worker.id || assignment.status !== "active") return;
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, assignment.shiftId));

  await db.update(schema.assignments).set({ status: "released", releasedAt: nowDate(ws) }).where(eq(schema.assignments.id, assignment.id));
  const [incident] = await db
    .insert(schema.incidents)
    .values({
      shiftId: shift.id,
      workerId: worker.id,
      assignmentId: assignment.id,
      kind: sick ? "sick" : "unavailable",
      sensitive,
      status: "offering",
      reportedAt: nowDate(ws),
    })
    .returning();

  await sendToWorker(worker, copy.unavailableAck(shift, sick), { purpose: "drop-out acknowledgement", weekId: shift.weekId, incidentId: incident.id });
  await audit({
    actor: `worker:${worker.id}`,
    tool: "policy",
    action: "incident.opened",
    summary: `${worker.name} can't make ${shiftLabel(shift)} (${sick ? "sick" : "unavailable"}${sensitive ? "; health details kept private" : ""}). Released the shift.`,
    weekId: shift.weekId,
    incidentId: incident.id,
  });
  await updatePlan(shift.weekId, [
    { id: `cover-${incident.id}`, title: `Find cover: ${shiftLabel(shift)}`, detail: "Ranking replacements…", status: "in_progress" },
  ]);

  const state = await loadWeekState(shift.weekId);
  const ranking = await rank(state, incident);
  await db.update(schema.incidents).set({ candidates: ranking.ranked }).where(eq(schema.incidents.id, incident.id));
  await audit({
    actor: "agent",
    tool: "ranking",
    action: "cover.ranked",
    summary: ranking.ranked.length
      ? `Ranked ${ranking.ranked.length} possible replacements. Top: ${ranking.ranked.slice(0, 3).map((c) => `${c.name} (${c.reasons[0]})`).join(", ")}`
      : "No eligible replacements found",
    details: { ranked: ranking.ranked, excluded: ranking.excluded, missingSkills: ranking.missingSkills },
    weekId: shift.weekId,
    incidentId: incident.id,
  });
  await advanceIncident(incident.id);
}

/** Offers the shift to the next viable candidate, or escalates to the manager. */
export async function advanceIncident(incidentId: number): Promise<void> {
  const db = getDb();
  let incident = await getIncident(incidentId);
  if (incident.status === "filled" || incident.status === "cancelled") return;
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, incident.shiftId));
  const state = await loadWeekState(shift.weekId);
  const rules = { minRestHours: state.ws.rules.minRestHours, maxShiftsPerDay: state.ws.rules.maxShiftsPerDay };

  while (incident.cursor < incident.candidates.length) {
    const c = incident.candidates[incident.cursor];
    const worker = state.workers.find((w) => w.id === c.workerId);
    const solverWorker = state.solverWorkers.find((w) => w.id === c.workerId);
    const conflict = solverWorker
      ? conflictReason(state.shiftById.get(shift.id)!, solverWorker, placedExcept(state, incident.assignmentId), rules)
      : "no longer active";
    if (!worker || conflict) {
      await audit({ actor: "agent", tool: "ranking", action: "cover.skipped", summary: `Skipped ${c.name}: ${conflict ?? "inactive"}`, weekId: shift.weekId, incidentId });
      [incident] = await db.update(schema.incidents).set({ cursor: incident.cursor + 1 }).where(eq(schema.incidents.id, incidentId)).returning();
      continue;
    }

    if (c.overtime || !state.ws.autoOfferReplacements) {
      const kind = c.overtime ? "overtime_offer" : "send_offer";
      await db.insert(schema.approvals).values({
        kind,
        status: "pending",
        title: c.overtime ? `Offer ${shift.label} to ${c.name} (overtime)?` : `Offer ${shift.label} to ${c.name}?`,
        summary: `${shiftLabel(shift)}. ${c.name}: ${c.reasons.join("; ")}.${c.overtime ? ` This takes them to ${c.hoursAfter}h.` : ""}`,
        payload: { workerId: c.workerId },
        weekId: shift.weekId,
        incidentId,
        createdAt: nowDate(state.ws),
      });
      await db.update(schema.incidents).set({ status: "awaiting_approval" }).where(eq(schema.incidents.id, incidentId));
      await audit({
        actor: "agent",
        tool: "policy",
        action: "approval.requested",
        summary: c.overtime ? `Next best is ${c.name}, but it would exceed their hour limit, so I'm asking the manager first` : `Asking the manager before offering the shift to ${c.name}`,
        weekId: shift.weekId,
        incidentId,
      });
      await updatePlan(shift.weekId, [{ id: `cover-${incidentId}`, status: "blocked", detail: `Waiting for manager approval (${c.name}).` }]);
      return;
    }

    await sendOffer(incidentId, c.workerId);
    return;
  }

  await escalateNoCover(incidentId);
}

export async function sendOffer(incidentId: number, workerId: number): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const incident = await getIncident(incidentId);
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, incident.shiftId));
  const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.id, workerId));
  const [offer] = await db.insert(schema.offers).values({ incidentId, workerId, status: "pending", sentAt: nowDate(ws) }).returning();
  const state = await loadWeekState(shift.weekId);
  const hours = state.shiftById.get(shift.id)!.hours;

  await db.update(schema.incidents).set({ status: "offering" }).where(eq(schema.incidents.id, incidentId));
  await sendToWorker(worker, copy.shiftOffer(worker.name, shift, hours, offer.id), { purpose: "shift offer", weekId: shift.weekId, incidentId });
  await audit({
    actor: "agent",
    tool: "policy",
    action: "cover.offered",
    summary: `Offered ${shiftLabel(shift)} to ${worker.name} (reason for the opening not shared). Waiting up to ${ws.rules.offerTimeoutMinutes} min.`,
    weekId: shift.weekId,
    incidentId,
  });
  await updatePlan(shift.weekId, [{ id: `cover-${incidentId}`, status: "in_progress", detail: `Offered to ${worker.name}, waiting for a reply.` }]);
}

export async function respondToOffer(offerId: number, accept: boolean, via: string): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
  if (!offer) return;
  const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.id, offer.workerId));
  const incident = await getIncident(offer.incidentId);
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, incident.shiftId));
  const ctx = { weekId: shift.weekId, incidentId: incident.id };

  if (offer.status !== "pending" || incident.status === "filled" || incident.status === "cancelled") {
    await db.update(schema.offers).set({ status: offer.status === "pending" ? "cancelled" : offer.status }).where(eq(schema.offers.id, offerId));
    await sendToWorker(worker, copy.offerAlreadyFilled(), { purpose: "late offer reply", ...ctx });
    return;
  }

  if (!accept) {
    await db.update(schema.offers).set({ status: "declined", respondedAt: nowDate(ws) }).where(eq(schema.offers.id, offerId));
    await sendToWorker(worker, copy.offerDeclinedAck(), { purpose: "offer declined", ...ctx });
    await audit({ actor: `worker:${worker.id}`, tool: "policy", action: "cover.declined", summary: `${worker.name} declined (${via}). Moving to the next candidate.`, ...ctx });
    await db.update(schema.incidents).set({ cursor: incident.cursor + 1 }).where(eq(schema.incidents.id, incident.id));
    await advanceIncident(incident.id);
    return;
  }

  const state = await loadWeekState(shift.weekId);
  const sw = state.solverWorkers.find((w) => w.id === worker.id);
  const conflict = sw
    ? conflictReason(state.shiftById.get(shift.id)!, sw, placedExcept(state, incident.assignmentId), { minRestHours: ws.rules.minRestHours, maxShiftsPerDay: ws.rules.maxShiftsPerDay })
    : "is no longer active";
  if (conflict) {
    await db.update(schema.offers).set({ status: "cancelled", respondedAt: nowDate(ws) }).where(eq(schema.offers.id, offerId));
    await sendToWorker(worker, copy.offerClash(conflict), { purpose: "offer clash", ...ctx });
    await audit({ actor: "agent", tool: "policy", action: "cover.clash", summary: `${worker.name} accepted, but now ${conflict}. Moving on.`, ...ctx });
    await db.update(schema.incidents).set({ cursor: incident.cursor + 1 }).where(eq(schema.incidents.id, incident.id));
    await advanceIncident(incident.id);
    return;
  }

  await db.update(schema.offers).set({ status: "accepted", respondedAt: nowDate(ws) }).where(eq(schema.offers.id, offerId));
  await db.insert(schema.assignments).values({
    shiftId: shift.id,
    workerId: worker.id,
    status: "active",
    source: "replacement",
    reason: `replacement: ${(incident.candidates.find((c) => c.workerId === worker.id)?.reasons ?? []).join("; ")}`,
    createdAt: nowDate(ws),
  });
  await db
    .update(schema.incidents)
    .set({ status: "filled", filledByWorkerId: worker.id, resolvedAt: nowDate(ws) })
    .where(eq(schema.incidents.id, incident.id));
  await db.update(schema.offers).set({ status: "cancelled" }).where(and(eq(schema.offers.incidentId, incident.id), eq(schema.offers.status, "pending")));

  const elapsed = formatDuration(nowMs(ws) - incident.reportedAt.getTime());
  await sendToWorker(worker, copy.offerConfirmed(shift), { purpose: "offer confirmed", ...ctx });
  const [original] = await db.select().from(schema.workers).where(eq(schema.workers.id, incident.workerId));
  if (original) await sendToWorker(original, copy.coverFound(shift, incident.kind === "sick"), { purpose: "cover found", ...ctx });
  await audit({ actor: `worker:${worker.id}`, tool: "policy", action: "cover.filled", summary: `${worker.name} accepted. ${shiftLabel(shift)} covered ${elapsed} after the report.`, ...ctx });
  await updatePlan(shift.weekId, [{ id: `cover-${incident.id}`, status: "done", detail: `Covered by ${worker.name} in ${elapsed}.` }]);
}

const NoCoverSchema = z.object({
  analysis: z.string(),
  options: z.array(
    z.object({
      action: z.enum(["offer_to_worker", "manager_covers", "leave_unfilled", "retry"]),
      workerId: z.number().int().nullable(),
      label: z.string(),
      rationale: z.string(),
    }),
  ),
});

export type NoCoverOption = z.infer<typeof NoCoverSchema>["options"][number];

async function escalateNoCover(incidentId: number): Promise<void> {
  const db = getDb();
  const incident = await getIncident(incidentId);
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, incident.shiftId));
  const state = await loadWeekState(shift.weekId);
  const asked = await db.select().from(schema.offers).where(eq(schema.offers.incidentId, incidentId));
  const askedIds = asked.map((o) => o.workerId);
  const fresh = await rank(state, incident, askedIds);

  let options: NoCoverOption[] = [
    ...fresh.ranked.slice(0, 2).map((c: RankedCandidate) => ({
      action: "offer_to_worker" as const,
      workerId: c.workerId,
      label: `Offer to ${c.name}${c.overtime ? " (overtime)" : ""}`,
      rationale: c.reasons.join("; "),
    })),
    { action: "manager_covers", workerId: null, label: "I'll cover it myself", rationale: "Closes the gap without asking more staff." },
    { action: "leave_unfilled", workerId: null, label: "Leave it short-staffed", rationale: `Run the shift with ${Math.max(0, shift.requiredCount - 1)} people.` },
  ];
  let analysis = `Everyone eligible has declined, timed out or is blocked by rules (${fresh.excluded.length} excluded).`;

  if (integrations.openrouter) {
    try {
      const { data } = await llmJson({
        name: "no_cover_options",
        schema: NoCoverSchema,
        system:
          "You advise a small-business manager when no part-timer has accepted an open shift. " +
          "Propose 2–4 concrete options using only the listed people. Never reveal why the shift opened. Keep labels under 40 characters.",
        user: JSON.stringify({
          shift: shiftLabel(shift),
          needed: shift.requiredCount,
          alreadyAsked: asked.map((o) => ({ name: state.workers.find((w) => w.id === o.workerId)?.name, result: o.status })),
          stillPossible: fresh.ranked.map((c) => ({ workerId: c.workerId, name: c.name, reasons: c.reasons, overtime: c.overtime })),
          excluded: fresh.excluded.map((e) => ({ name: e.name, reason: e.reason })),
        }),
        effort: "low",
      });
      const validIds = new Set(fresh.ranked.map((c) => c.workerId));
      const cleaned = data.options.filter((o) => o.action !== "offer_to_worker" || (o.workerId !== null && validIds.has(o.workerId)));
      if (cleaned.length) options = cleaned;
      analysis = data.analysis;
      await audit({ actor: "agent", tool: "llm", action: "cover.options", summary: `Drafted ${options.length} options for the manager`, weekId: shift.weekId, incidentId });
    } catch (e) {
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `Couldn't draft options, using defaults: ${(e as Error).message}`, weekId: shift.weekId, incidentId });
    }
  }

  await db.update(schema.incidents).set({ status: "unfilled" }).where(eq(schema.incidents.id, incidentId));
  await db.insert(schema.approvals).values({
    kind: "no_cover",
    status: "pending",
    title: `No cover yet for ${shiftLabel(shift)}`,
    summary: analysis,
    payload: { options },
    weekId: shift.weekId,
    incidentId,
    createdAt: nowDate(state.ws),
  });
  await audit({ actor: "agent", tool: "policy", action: "cover.escalated", summary: `Couldn't find cover for ${shiftLabel(shift)}; escalated to the manager with ${options.length} options`, weekId: shift.weekId, incidentId });
  await updatePlan(shift.weekId, [{ id: `cover-${incidentId}`, status: "blocked", detail: "Nobody available; waiting for the manager's decision." }]);
}

export async function expireStaleOffers(): Promise<number> {
  const db = getDb();
  const ws = await getWorkspace();
  const pending = await db.select().from(schema.offers).where(eq(schema.offers.status, "pending"));
  const cutoff = nowMs(ws) - ws.rules.offerTimeoutMinutes * 60_000;
  let n = 0;
  for (const o of pending) {
    if (o.sentAt.getTime() > cutoff) continue;
    const [updated] = await db
      .update(schema.offers)
      .set({ status: "expired" })
      .where(and(eq(schema.offers.id, o.id), eq(schema.offers.status, "pending")))
      .returning();
    if (!updated) continue;
    n++;
    const incident = await getIncident(o.incidentId);
    const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.id, o.workerId));
    await audit({ actor: "agent", tool: "policy", action: "cover.timeout", summary: `${worker?.name ?? "Worker"} didn't reply within ${ws.rules.offerTimeoutMinutes} min. Moving on.`, incidentId: incident.id });
    await db.update(schema.incidents).set({ cursor: incident.cursor + 1 }).where(eq(schema.incidents.id, incident.id));
    await advanceIncident(incident.id);
  }
  return n;
}

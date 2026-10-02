import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Shift, Worker } from "@/db/schema";
import { llmJson } from "@/integrations/llm";
import { publishRosterToSheet } from "@/integrations/sheets";
import { integrations } from "@/lib/env";
import { addDays, DAY_NAMES, formatDate, mondayOf, nextMonday, localDateOf, weekdayIndex } from "@/lib/time";
import type { WeekConstraints } from "@/lib/types";
import { audit } from "./audit";
import { getWorkspace, loadWeekState, nowDate, nowMs, shiftLabel } from "./context";
import * as copy from "./copy";
import { sendToWorker } from "./outbox";
import { initialPlan, updatePlan } from "./plan";
import { solveRoster, validateRoster } from "./solver";
import { countStatuses, extractAvailability } from "./understand";

const PlanSchema = z.object({
  weekStart: z.string().describe("Monday of the week to staff, YYYY-MM-DD"),
  countOverrides: z
    .array(
      z.object({
        templateKey: z.string(),
        days: z.array(z.number().int()).nullable().describe("0=Monday … 6=Sunday, or null for every day the shift runs"),
        requiredCount: z.number().int().describe("0 removes the shift on those days"),
      }),
    )
    .describe("Only headcount changes the goal asks for, e.g. 3 people on weekend closing shifts"),
  maxHoursPerWeek: z.number().int().nullable().describe("Cap for everyone this week, or null to keep each person's limit"),
  closedDays: z.array(z.number().int()).describe("0=Monday … 6=Sunday; days the business is closed this week"),
  assumptions: z.array(z.string()).describe("Things you assumed that the manager should know"),
  notes: z.string().describe("Anything in the goal the solver can't enforce, for the manager"),
});

export async function createWeekFromGoal(goal: string): Promise<{ weekId: number }> {
  const db = getDb();
  const ws = await getWorkspace();
  const now = nowMs(ws);
  const today = localDateOf(now, ws.timezone);
  const workers = await db.select().from(schema.workers).where(eq(schema.workers.active, true));
  if (!workers.length) throw new Error("Add at least one worker before planning a week.");

  let weekStart = nextMonday(now, ws.timezone);
  let constraints: WeekConstraints = {};
  let assumptions: string[] = [];

  if (integrations.openrouter) {
    try {
      const { data, model } = await llmJson({
        name: "week_plan",
        schema: PlanSchema,
        system:
          "You are the planning step of a shift-scheduling agent for a small business with part-time staff. " +
          "Convert the manager's goal into structured constraints. Only change what the goal asks for; keep defaults otherwise. " +
          "If no week is mentioned, choose next week. List every assumption you made.",
        user: JSON.stringify({
          goal,
          today: `${DAY_NAMES[weekdayIndex(today)]} ${today}`,
          defaultWeekStart: weekStart,
          business: ws.businessName,
          shiftTemplates: ws.shiftTemplates.map((t) => ({
            key: t.key,
            label: t.label,
            time: `${t.start}-${t.end}`,
            days: t.days.map((d) => DAY_NAMES[d]),
            requiredCount: t.requiredCount,
            requiredSkills: t.requiredSkills,
          })),
          defaultMaxHoursPerWeek: ws.rules.maxHoursPerWeek,
          team: { size: workers.length, skills: ws.skills },
        }),
        effort: "low",
      });
      const keys = new Set(ws.shiftTemplates.map((t) => t.key));
      const proposedStart = /^\d{4}-\d{2}-\d{2}$/.test(data.weekStart) ? mondayOf(data.weekStart) : weekStart;
      weekStart = proposedStart >= mondayOf(today) ? proposedStart : weekStart;
      const overrides = data.countOverrides
        .filter((c) => keys.has(c.templateKey))
        .map((c) => ({
          templateKey: c.templateKey,
          days: c.days?.filter((d) => d >= 0 && d <= 6),
          requiredCount: Math.max(0, Math.min(20, c.requiredCount)),
        }));
      constraints = {
        countOverrides: overrides.length ? overrides : undefined,
        maxHoursPerWeek: data.maxHoursPerWeek && data.maxHoursPerWeek > 0 ? Math.min(60, data.maxHoursPerWeek) : undefined,
        closedDays: data.closedDays.filter((d) => d >= 0 && d <= 6),
        notes: data.notes || undefined,
      };
      assumptions = data.assumptions;
      await audit({
        actor: "agent",
        tool: "llm",
        action: "plan.goal_parsed",
        summary: `Planned the week of ${formatDate(weekStart)} from the goal`,
        details: { goal, constraints, assumptions, model },
      });
    } catch (e) {
      assumptions = [`Planner model unavailable (${(e as Error).message.slice(0, 120)}), so I used next week and the standard shift pattern.`];
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `Planner failed; falling back to defaults: ${(e as Error).message}` });
    }
  } else {
    assumptions = ["No OpenRouter key configured, so I used next week and the standard shift pattern."];
  }

  const existing = await db
    .select()
    .from(schema.weeks)
    .where(and(eq(schema.weeks.weekStart, weekStart), ne(schema.weeks.status, "cancelled")));
  if (existing.length) throw new Error(`The week of ${formatDate(weekStart)} is already planned. Cancel it first to start over.`);

  const real = workers.filter((w) => !w.simulated && w.phone).length;
  const [week] = await db
    .insert(schema.weeks)
    .values({
      weekStart,
      goal,
      constraints,
      assumptions,
      status: "awaiting_send_approval",
      plan: initialPlan({
        realWorkers: real,
        simWorkers: workers.length - real,
        reminderAfterHours: ws.rules.reminderAfterHours,
        maxReminders: ws.rules.maxReminders,
      }),
      createdAt: nowDate(ws),
    })
    .returning();

  const shiftRows: (typeof schema.shifts.$inferInsert)[] = [];
  for (let d = 0; d < 7; d++) {
    if (constraints.closedDays?.includes(d)) continue;
    const date = addDays(weekStart, d);
    for (const t of ws.shiftTemplates) {
      if (!t.days.includes(d)) continue;
      const override = constraints.countOverrides?.findLast((o) => o.templateKey === t.key && (!o.days?.length || o.days.includes(d)));
      const count = override?.requiredCount ?? t.requiredCount;
      if (count <= 0) continue;
      shiftRows.push({ weekId: week.id, date, templateKey: t.key, label: t.label, start: t.start, end: t.end, requiredCount: count, requiredSkills: t.requiredSkills });
    }
  }
  if (shiftRows.length) await db.insert(schema.shifts).values(shiftRows);

  const deadline = nowMs(ws) + ws.rules.availabilityDeadlineHours * 3_600_000;
  await db.insert(schema.approvals).values({
    kind: "send_availability_requests",
    status: "pending",
    title: `Message ${workers.length} workers for the week of ${formatDate(weekStart)}?`,
    summary:
      `I'll ask ${real} worker(s) on WhatsApp and ${workers.length - real} simulated worker(s) which of the ${shiftRows.length} shifts they can do. ` +
      `Reminders go out after ${ws.rules.reminderAfterHours}h (max ${ws.rules.maxReminders}). ` +
      `I'll build the roster when everyone has replied or by ${new Date(deadline).toLocaleString("en-GB", { timeZone: ws.timezone, weekday: "short", hour: "2-digit", minute: "2-digit" })}.`,
    payload: { workerIds: workers.map((w) => w.id) },
    weekId: week.id,
    createdAt: nowDate(ws),
  });
  await audit({
    actor: "agent",
    tool: "policy",
    action: "approval.requested",
    summary: `Paused for approval before messaging ${workers.length} workers`,
    weekId: week.id,
  });
  return { weekId: week.id };
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export async function startCollection(weekId: number): Promise<void> {
  const db = getDb();
  const state = await loadWeekState(weekId);
  const { ws, week, shifts, workers } = state;
  await db.update(schema.weeks).set({ status: "collecting", collectionStartedAt: nowDate(ws) }).where(eq(schema.weeks.id, weekId));

  const templates = ws.shiftTemplates.filter((t) => shifts.some((s) => s.templateKey === t.key));
  for (const w of workers) {
    const [req] = await db
      .insert(schema.availabilityRequests)
      .values({ weekId, workerId: w.id, status: "sent", sentAt: nowDate(ws) })
      .onConflictDoNothing()
      .returning();
    if (!req) continue;

    if (w.simulated || !w.phone) {
      const rows = shifts.map((s) => ({
        weekId,
        workerId: w.id,
        shiftId: s.id,
        status: (hash(w.id * 7919 + s.id) < 0.55 ? "yes" : "no") as "yes" | "no",
        source: "simulated" as const,
        updatedAt: nowDate(ws),
      }));
      if (rows.length) await db.insert(schema.availability).values(rows).onConflictDoNothing();
      await db.update(schema.availabilityRequests).set({ status: "responded", respondedAt: nowDate(ws) }).where(eq(schema.availabilityRequests.id, req.id));
      continue;
    }
    await sendToWorker(w, copy.availabilityRequest(w.name, ws.businessName, week.weekStart, templates), { purpose: "availability request", weekId });
  }
  await audit({
    actor: "agent",
    tool: "policy",
    action: "collection.started",
    summary: `Asked ${workers.length} workers for availability (simulated workers answer instantly)`,
    weekId,
  });
  await updatePlan(weekId, [
    { id: "approve_send", status: "done" },
    { id: "collect", status: "in_progress" },
    { id: "chase", status: "in_progress" },
  ]);
  await maybeFinishCollection(weekId);
}

export async function recordAvailabilityFromMessage(worker: Worker, weekId: number, text: string, messageId: number): Promise<void> {
  const db = getDb();
  const state = await loadWeekState(weekId);
  const { ws, week, shifts } = state;
  const extraction = await extractAvailability(
    text,
    shifts.map((s) => ({ id: s.id, label: shiftLabel(s) })),
    { workerName: worker.name, weekLabel: `the week of ${formatDate(week.weekStart)}`, weekId },
  );

  for (const [shiftId, v] of extraction.byShift) {
    await db
      .insert(schema.availability)
      .values({ weekId, workerId: worker.id, shiftId, status: v.status, source: "message", confidence: v.p, messageId, updatedAt: nowDate(ws) })
      .onConflictDoUpdate({
        target: [schema.availability.workerId, schema.availability.shiftId],
        set: { status: v.status, source: "message", confidence: v.p, messageId, updatedAt: nowDate(ws) },
      });
  }
  await db
    .update(schema.availabilityRequests)
    .set({ status: "responded", respondedAt: nowDate(ws) })
    .where(and(eq(schema.availabilityRequests.weekId, weekId), eq(schema.availabilityRequests.workerId, worker.id)));
  await db
    .update(schema.messages)
    .set({ understanding: { availability: Object.fromEntries(extraction.byShift), via: extraction.via } })
    .where(eq(schema.messages.id, messageId));

  const pick = (st: "yes" | "unsure") => shifts.filter((s) => extraction.byShift.get(s.id)?.status === st);
  const counts = countStatuses(extraction.byShift);
  await sendToWorker(worker, copy.availabilityEcho(worker.name, pick("yes"), pick("unsure")), { purpose: "availability confirmation", weekId });
  await audit({
    actor: `worker:${worker.id}`,
    tool: "policy",
    action: "availability.recorded",
    summary: `${worker.name} replied: ${counts.yes} shifts yes, ${counts.no} no, ${counts.unsure} to clarify`,
    weekId,
  });
  await maybeFinishCollection(weekId);
}

export async function maybeFinishCollection(weekId: number, force = false): Promise<boolean> {
  const db = getDb();
  const ws = await getWorkspace();
  const [week] = await db.select().from(schema.weeks).where(eq(schema.weeks.id, weekId));
  if (!week || week.status !== "collecting") return false;
  const requests = await db.select().from(schema.availabilityRequests).where(eq(schema.availabilityRequests.weekId, weekId));
  const outstanding = requests.filter((r) => r.status === "sent").length;
  const deadline = (week.collectionStartedAt?.getTime() ?? 0) + ws.rules.availabilityDeadlineHours * 3_600_000;
  const pastDeadline = nowMs(ws) >= deadline;
  if (!force && outstanding > 0 && !pastDeadline) {
    await updatePlan(weekId, [{ id: "collect", detail: `${requests.filter((r) => r.status === "responded").length} of ${requests.length} replied.` }]);
    return false;
  }
  const replied = requests.filter((r) => r.status === "responded").length;
  const why = force ? "manager asked to build now" : outstanding === 0 ? "no one left to wait for" : "deadline reached";
  await audit({ actor: "agent", tool: "policy", action: "collection.closed", summary: `Closed availability collection (${why}; ${requests.length - replied} without a reply)`, weekId });
  await updatePlan(weekId, [
    { id: "collect", status: "done", detail: `${replied} of ${requests.length} replied (${why}).` },
    { id: "chase", status: "done" },
  ]);
  await solveWeek(weekId);
  return true;
}

const ExplainSchema = z.object({
  summary: z.string().describe("2–3 sentences for the manager"),
  risks: z.array(z.string()).describe("Short bullet points: gaps, people near their limit, anything to double-check"),
});

export async function solveWeek(weekId: number): Promise<void> {
  const db = getDb();
  const state = await loadWeekState(weekId);
  const { ws, week, shifts, workers, availability, solverShifts, solverWorkers } = state;
  await db.update(schema.weeks).set({ status: "solving" }).where(eq(schema.weeks.id, weekId));
  await updatePlan(weekId, [{ id: "solve", status: "in_progress" }]);

  const shiftIds = shifts.map((s) => s.id);
  if (shiftIds.length) await db.delete(schema.assignments).where(inArray(schema.assignments.shiftId, shiftIds));

  const result = solveRoster({
    shifts: solverShifts,
    workers: solverWorkers,
    availability,
    rules: { minRestHours: ws.rules.minRestHours, maxShiftsPerDay: ws.rules.maxShiftsPerDay },
  });
  if (result.assignments.length) {
    await db.insert(schema.assignments).values(
      result.assignments.map((a) => ({
        shiftId: a.shiftId,
        workerId: a.workerId,
        status: "active" as const,
        source: "solver" as const,
        reason: a.reasons.join("; "),
        createdAt: nowDate(ws),
      })),
    );
  }

  const nameOf = new Map(workers.map((w) => [w.id, w.name]));
  const shiftOf = new Map(shifts.map((s) => [s.id, s]));
  const gapLines = result.gaps.map(
    (g) =>
      `${shiftLabel(shiftOf.get(g.shiftId)!)}: ${g.missing ? `${g.missing} short` : "full"}${g.missingSkills.length ? `, no ${g.missingSkills.join("/")}` : ""} (${g.reason})`,
  );
  await audit({
    actor: "agent",
    tool: "solver",
    action: "roster.solved",
    summary: `Built roster: ${result.stats.filledSlots}/${result.stats.requiredSlots} slots filled, ${result.gaps.length} gap(s), ${result.violations.length} rule violation(s), best of ${result.stats.attempts} attempts`,
    details: { gaps: gapLines, hours: Object.fromEntries(Object.entries(result.hoursByWorker).map(([id, h]) => [nameOf.get(+id), h])) },
    weekId,
  });

  let summary = `Filled ${result.stats.filledSlots} of ${result.stats.requiredSlots} slots.${gapLines.length ? ` Gaps: ${gapLines.join("; ")}.` : " No gaps."}`;
  let risks: string[] = [];
  if (integrations.openrouter) {
    try {
      const { data } = await llmJson({
        name: "roster_explanation",
        schema: ExplainSchema,
        system: "Explain a computed shift roster to a busy small-business manager. Be concrete and brief. Do not invent facts.",
        user: JSON.stringify({
          goal: week.goal,
          constraints: week.constraints,
          filled: result.stats.filledSlots,
          required: result.stats.requiredSlots,
          gaps: gapLines,
          hoursByWorker: solverWorkers.map((w) => ({ name: w.name, hours: result.hoursByWorker[w.id], max: w.maxHours })),
          noResponse: (await db.select().from(schema.availabilityRequests).where(and(eq(schema.availabilityRequests.weekId, weekId), ne(schema.availabilityRequests.status, "responded")))).map((r) => nameOf.get(r.workerId)),
        }),
        effort: "low",
      });
      summary = data.summary;
      risks = data.risks;
      await audit({ actor: "agent", tool: "llm", action: "roster.explained", summary: "Wrote a plain-language summary of the roster for review", weekId });
    } catch (e) {
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `Roster explanation failed, using the solver summary: ${(e as Error).message}`, weekId });
    }
  }

  await db.update(schema.weeks).set({ status: "awaiting_publish", summary: [summary, ...risks.map((r) => `• ${r}`)].join("\n") }).where(eq(schema.weeks.id, weekId));
  await requestPublishApproval(weekId);
  await updatePlan(weekId, [
    { id: "solve", status: "done", detail: `${result.stats.filledSlots}/${result.stats.requiredSlots} slots filled, ${result.gaps.length} gap(s), ${result.violations.length} violations.` },
    { id: "approve_publish", status: "in_progress" },
  ]);
}

export async function requestPublishApproval(weekId: number): Promise<void> {
  const db = getDb();
  const state = await loadWeekState(weekId);
  const { ws, week, shifts, assignments, solverShifts, solverWorkers } = state;
  await db
    .update(schema.approvals)
    .set({ status: "rejected", decision: "superseded", decidedAt: nowDate(ws) })
    .where(and(eq(schema.approvals.weekId, weekId), eq(schema.approvals.kind, "publish_schedule"), eq(schema.approvals.status, "pending")));
  const required = shifts.reduce((n, s) => n + s.requiredCount, 0);
  const violations = validateRoster({ shifts: solverShifts, workers: solverWorkers, rules: ws.rules }, assignments);
  const people = new Set(assignments.map((a) => a.workerId)).size;
  await db.insert(schema.approvals).values({
    kind: "publish_schedule",
    status: "pending",
    title: `Publish the roster for the week of ${formatDate(week.weekStart)}?`,
    summary: `${assignments.length}/${required} slots filled across ${people} people. ${violations.length ? `${violations.length} rule warning(s): ${violations.join("; ")}.` : "All hard rules pass."} Publishing messages each rostered worker their shifts.`,
    payload: {},
    weekId,
    createdAt: nowDate(ws),
  });
  await audit({ actor: "agent", tool: "policy", action: "approval.requested", summary: "Paused for approval before publishing the roster", weekId });
}

export async function publishWeek(weekId: number): Promise<void> {
  const db = getDb();
  const state = await loadWeekState(weekId);
  const { ws, week, shifts, workers, assignments } = state;
  const shiftOf = new Map(shifts.map((s) => [s.id, s]));
  const requested = new Set(
    (await db.select().from(schema.availabilityRequests).where(eq(schema.availabilityRequests.weekId, weekId))).map((r) => r.workerId),
  );

  for (const w of workers) {
    const mine = assignments
      .filter((a) => a.workerId === w.id)
      .map((a) => shiftOf.get(a.shiftId)!)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    if (!mine.length && !requested.has(w.id)) continue;
    await sendToWorker(w, copy.rosterPublished(w.name, week.weekStart, mine), { purpose: "published roster", weekId });
  }

  try {
    const rows: (string | number)[][] = [["Date", "Shift", "Start", "End", "Needed", "Assigned", "Open slots"]];
    const nameOf = new Map(workers.map((w) => [w.id, w.name]));
    for (const s of shifts) {
      const names = assignments.filter((a) => a.shiftId === s.id).map((a) => nameOf.get(a.workerId) ?? "?");
      rows.push([formatDate(s.date), s.label, s.start, s.end, s.requiredCount, names.join(", "), Math.max(0, s.requiredCount - names.length)]);
    }
    const url = await publishRosterToSheet(rows);
    if (url) await audit({ actor: "agent", tool: "sheets", action: "sheet.updated", summary: `Wrote ${rows.length - 1} shifts to Google Sheets`, details: { url }, weekId });
  } catch (e) {
    await audit({ actor: "agent", tool: "sheets", action: "sheet.failed", summary: `Google Sheets update failed: ${(e as Error).message}`, weekId });
  }

  await db.update(schema.weeks).set({ status: "published", publishedAt: nowDate(ws) }).where(eq(schema.weeks.id, weekId));
  await audit({ actor: "agent", tool: "policy", action: "roster.published", summary: `Published the roster for the week of ${formatDate(week.weekStart)}`, weekId });
  await updatePlan(weekId, [
    { id: "approve_publish", status: "done" },
    { id: "publish", status: "done" },
    { id: "monitor", status: "in_progress" },
  ]);
}

export async function upcomingAssignmentsFor(workerId: number) {
  const db = getDb();
  const ws = await getWorkspace();
  const today = localDateOf(nowMs(ws), ws.timezone);
  const rows = await db
    .select({ assignment: schema.assignments, shift: schema.shifts, week: schema.weeks })
    .from(schema.assignments)
    .innerJoin(schema.shifts, eq(schema.assignments.shiftId, schema.shifts.id))
    .innerJoin(schema.weeks, eq(schema.shifts.weekId, schema.weeks.id))
    .where(and(eq(schema.assignments.workerId, workerId), eq(schema.assignments.status, "active"), eq(schema.weeks.status, "published")));
  return rows
    .filter((r) => r.shift.date >= addDays(today, -1) && r.shift.date <= addDays(today, 14))
    .sort((a, b) => (a.shift.date + a.shift.start).localeCompare(b.shift.date + b.shift.start)) as {
    assignment: typeof schema.assignments.$inferSelect;
    shift: Shift;
    week: typeof schema.weeks.$inferSelect;
  }[];
}

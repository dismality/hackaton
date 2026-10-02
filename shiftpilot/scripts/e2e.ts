/**
 * End-to-end rehearsal of the demo against the database in DATABASE_URL.
 * Real workers are simulated through the same inbound pipeline the WhatsApp webhook uses.
 *   npx tsx scripts/e2e.ts
 * WARNING: resets weeks, messages and the audit log in that database.
 */
import { and, desc, eq } from "drizzle-orm";
import { decideApproval } from "../src/agent/approvals";
import { getWorkspace, loadWeekState, shiftLabel } from "../src/agent/context";
import { respondToOffer } from "../src/agent/cover";
import { handleSimulatedMessage, handleWhatsAppMessage } from "../src/agent/inbound";
import { computeMetrics } from "../src/agent/metrics";
import { resetDemoData, seedSimulatedWorkers } from "../src/agent/seed";
import { runTick } from "../src/agent/tick";
import { createWeekFromGoal } from "../src/agent/weekly";
import { getDb, schema } from "../src/db";
import { localDateOf, addDays } from "../src/lib/time";

const db = getDb();
const log = (...a: unknown[]) => console.log("•", ...a);
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log("  ✓", msg);
}

async function pendingApproval(kind: string) {
  const [a] = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.kind, kind as never), eq(schema.approvals.status, "pending")))
    .orderBy(desc(schema.approvals.id));
  return a;
}

async function lastOut(workerId: number) {
  const [m] = await db.select().from(schema.messages).where(and(eq(schema.messages.workerId, workerId), eq(schema.messages.direction, "out"))).orderBy(desc(schema.messages.id)).limit(1);
  return m;
}

async function setClockTo(dateLocal: string, time: string) {
  const ws = await getWorkspace();
  const { localToUtcMs } = await import("../src/lib/time");
  const target = localToUtcMs(dateLocal, time, ws.timezone);
  const offset = Math.round((target - Date.now()) / 60000);
  await db.update(schema.workspace).set({ clockOffsetMinutes: offset }).where(eq(schema.workspace.id, 1));
}

async function main() {
  await getWorkspace();
  await resetDemoData();
  await db.delete(schema.workers);
  await seedSimulatedWorkers(9);
  const [ana] = await db.insert(schema.workers).values({ name: "Ana Real", phone: "6590000001", skills: ["opener", "barista"], maxHoursPerWeek: 25 }).returning();
  const [ben] = await db.insert(schema.workers).values({ name: "Ben Real", phone: "6590000002", skills: ["barista"], maxHoursPerWeek: 25 }).returning();
  const [cai] = await db.insert(schema.workers).values({ name: "Cai Real", phone: "6590000003", skills: ["opener", "cashier"], maxHoursPerWeek: 25 }).returning();

  log("1. Goal → plan (GPT-6 Sol)");
  const { weekId } = await createWeekFromGoal("Staff next week. We're closed Monday, and weekend closing shifts need 3 people.");
  let st = await loadWeekState(weekId);
  log("constraints", JSON.stringify(st.week.constraints), "assumptions", st.week.assumptions);
  check(!st.shifts.some((s) => s.date === st.week.weekStart), "no shifts on the closed Monday");
  const weekendClose = st.shifts.filter((s) => s.templateKey === "close" && ["Sat", "Sun"].some((d) => shiftLabel(s).startsWith(d)));
  check(weekendClose.length === 2 && weekendClose.every((s) => s.requiredCount === 3), "weekend closing shifts need 3 people");
  check(st.shifts.some((s) => s.templateKey === "close" && s.requiredCount === 2), "weekday closing stays at 2");

  log("2. Approval gate before messaging anyone");
  const msgsBefore = (await db.select().from(schema.messages)).length;
  check(msgsBefore === 0, "no messages sent before approval");
  await decideApproval((await pendingApproval("send_availability_requests")).id, true);
  st = await loadWeekState(weekId);
  check(st.week.status === "collecting", "collecting after approval");

  log("3. Free-text availability through Jev (+ LLM for uncertain)");
  await handleWhatsAppMessage({ waMessageId: "wamid.test1", from: ana.phone!, timestampMs: Date.now(), text: "can do mornings tue to thu, not fri. weekends anything" });
  await handleWhatsAppMessage({ waMessageId: "wamid.test1", from: ana.phone!, timestampMs: Date.now(), text: "duplicate delivery" });
  const anaIn = await db.select().from(schema.messages).where(and(eq(schema.messages.workerId, ana.id), eq(schema.messages.direction, "in")));
  check(anaIn.length === 1, "duplicate webhook delivery ignored");
  st = await loadWeekState(weekId);
  const anaAvail = st.shifts.map((s) => `${shiftLabel(s)} → ${st.availability.get(`${ana.id}:${s.id}`)}`);
  log(anaAvail.join("\n    "));
  const tueOpen = st.shifts.find((s) => s.templateKey === "open" && shiftLabel(s).startsWith("Tue"))!;
  const friOpen = st.shifts.find((s) => s.templateKey === "open" && shiftLabel(s).startsWith("Fri"))!;
  check(st.availability.get(`${ana.id}:${tueOpen.id}`) === "yes", "Ana: Tue opening = yes");
  check(st.availability.get(`${ana.id}:${friOpen.id}`) === "no", "Ana: Fri opening = no");
  log("echo to Ana:", (await lastOut(ana.id))?.body);

  await handleSimulatedMessage(ben.id, "free all week except thursday evening");

  log("4. Cai doesn't reply → reminders → escalation (demo clock)");
  const ws = await getWorkspace();
  for (let i = 0; i < 3; i++) {
    await db.update(schema.workspace).set({ clockOffsetMinutes: ws.clockOffsetMinutes + (i + 1) * ws.rules.reminderAfterHours * 60 + 1 }).where(eq(schema.workspace.id, 1));
    const r = await runTick();
    log(`tick ${i + 1}`, JSON.stringify(r));
  }
  const [caiReq] = await db.select().from(schema.availabilityRequests).where(and(eq(schema.availabilityRequests.weekId, weekId), eq(schema.availabilityRequests.workerId, cai.id)));
  check(caiReq.remindersSent === 2, "Cai got 2 reminders");
  check(caiReq.status === "no_response", "Cai flagged as no response after max reminders");

  log("5. Roster solved → publish approval");
  st = await loadWeekState(weekId);
  check(st.week.status === "awaiting_publish", "awaiting publish approval");
  log("summary:", st.week.summary);
  check(st.assignments.length > 0, `roster has ${st.assignments.length} assignments`);
  await decideApproval((await pendingApproval("publish_schedule")).id, true);
  st = await loadWeekState(weekId);
  check(st.week.status === "published", "published");

  log("6. Sick call the day before Ana's shift");
  const anaShifts = st.assignments.filter((a) => a.workerId === ana.id).map((a) => st.shifts.find((s) => s.id === a.shiftId)!).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  check(anaShifts.length > 0, `Ana has ${anaShifts.length} shifts`);
  const target = anaShifts[0];
  await setClockTo(addDays(target.date, -1), "18:00");
  log("agent date now", localDateOf(Date.now() + (await getWorkspace()).clockOffsetMinutes * 60000, ws.timezone), "target", shiftLabel(target));
  await handleWhatsAppMessage({ waMessageId: "wamid.test2", from: ana.phone!, timestampMs: Date.now(), text: "sorry cant come tmr, got fever" });
  const [incident] = await db.select().from(schema.incidents).orderBy(desc(schema.incidents.id)).limit(1);
  check(incident && incident.shiftId === target.id, "incident opened for the right shift");
  check(incident.sensitive, "health details flagged as private");
  log("ranked:", incident.candidates.slice(0, 4).map((c) => `${c.name} [${c.reasons.join("; ")}]`).join(" | "));

  const offers = await db.select().from(schema.offers).where(eq(schema.offers.incidentId, incident.id));
  const offerMsgs = await db.select().from(schema.messages).where(eq(schema.messages.direction, "out"));
  check(!offerMsgs.some((m) => m.body.includes("fever") || (m.workerId !== ana.id && m.body.includes("Ana"))), "no other worker was told who dropped out or why");

  log("7. First candidate declines, then timeout, then accept");
  if (offers[0]) {
    await respondToOffer(offers[0].id, false, "test");
    const next = (await db.select().from(schema.offers).where(eq(schema.offers.incidentId, incident.id))).filter((o) => o.status === "pending");
    check(next.length === 1, "offered to the next candidate after a decline");
    await db.update(schema.workspace).set({ clockOffsetMinutes: (await getWorkspace()).clockOffsetMinutes + ws.rules.offerTimeoutMinutes + 1 }).where(eq(schema.workspace.id, 1));
    await runTick();
    const after = (await db.select().from(schema.offers).where(eq(schema.offers.incidentId, incident.id)));
    check(after.some((o) => o.status === "expired"), "unanswered offer expired and moved on");
    const pending = after.find((o) => o.status === "pending");
    if (pending) {
      const w = st.workers.find((x) => x.id === pending.workerId)!;
      if (w.phone) await handleWhatsAppMessage({ waMessageId: "wamid.test3", from: w.phone, timestampMs: Date.now(), text: "ok I can take it" });
      else await respondToOffer(pending.id, true, "test");
    }
  }
  const [final] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incident.id));
  log("incident status:", final.status, "filled by", final.filledByWorkerId);
  const approvals = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending"));
  log("pending approvals:", approvals.map((a) => `${a.kind}: ${a.title}`));
  check(final.status === "filled" || approvals.length > 0, "incident filled or escalated to the manager");

  log("8. Metrics");
  console.log(await computeMetrics(weekId));
  const audit = await db.select().from(schema.auditLog).orderBy(schema.auditLog.id);
  log(`audit entries: ${audit.length}; tools: ${[...new Set(audit.map((a) => a.tool))].join(", ")}`);
  console.log("\nALL CHECKS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

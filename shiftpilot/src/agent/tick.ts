import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { getWorkspace, nowDate, nowMs } from "./context";
import * as copy from "./copy";
import { expireStaleOffers } from "./cover";
import { sendToWorker } from "./outbox";
import { updatePlan } from "./plan";
import { maybeFinishCollection } from "./weekly";

const g = globalThis as unknown as { __shiftpilotTick?: Promise<TickResult> | null };

export type TickResult = { reminders: number; escalations: number; expiredOffers: number; closedWeeks: number };

/** Time-driven work: reminders, escalation of non-responders, offer timeouts, collection deadlines. */
export function runTick(): Promise<TickResult> {
  if (g.__shiftpilotTick) return g.__shiftpilotTick;
  g.__shiftpilotTick = doTick().finally(() => {
    g.__shiftpilotTick = null;
  });
  return g.__shiftpilotTick;
}

async function doTick(): Promise<TickResult> {
  const db = getDb();
  const ws = await getWorkspace();
  const now = nowMs(ws);
  const result: TickResult = { reminders: 0, escalations: 0, expiredOffers: 0, closedWeeks: 0 };
  const everyMs = ws.rules.reminderAfterHours * 3_600_000;

  const collecting = await db.select().from(schema.weeks).where(eq(schema.weeks.status, "collecting"));
  for (const week of collecting) {
    const pending = await db
      .select({ request: schema.availabilityRequests, worker: schema.workers })
      .from(schema.availabilityRequests)
      .innerJoin(schema.workers, eq(schema.availabilityRequests.workerId, schema.workers.id))
      .where(and(eq(schema.availabilityRequests.weekId, week.id), eq(schema.availabilityRequests.status, "sent")));

    let changed = false;
    for (const { request, worker } of pending) {
      const last = (request.lastNudgeAt ?? request.sentAt).getTime();
      if (now - last < everyMs) continue;
      if (request.remindersSent < ws.rules.maxReminders) {
        const attempt = request.remindersSent + 1;
        await sendToWorker(worker, copy.availabilityReminder(worker.name, week.weekStart, attempt), { purpose: `reminder ${attempt}`, weekId: week.id });
        await db
          .update(schema.availabilityRequests)
          .set({ remindersSent: attempt, lastNudgeAt: nowDate(ws) })
          .where(eq(schema.availabilityRequests.id, request.id));
        await audit({ actor: "agent", tool: "policy", action: "reminder.sent", summary: `No reply from ${worker.name} after ${ws.rules.reminderAfterHours}h, so I sent reminder ${attempt} of ${ws.rules.maxReminders}`, weekId: week.id });
        result.reminders++;
        changed = true;
      } else {
        await db.update(schema.availabilityRequests).set({ status: "no_response" }).where(eq(schema.availabilityRequests.id, request.id));
        await audit({ actor: "agent", tool: "policy", action: "needs_manager", summary: `${worker.name} didn't reply after ${ws.rules.maxReminders} reminders. Treating them as unavailable and flagging to the manager.`, weekId: week.id });
        result.escalations++;
        changed = true;
      }
    }
    if (changed) {
      const all = await db.select().from(schema.availabilityRequests).where(eq(schema.availabilityRequests.weekId, week.id));
      const sent = all.reduce((n, r) => n + r.remindersSent, 0);
      const flagged = all.filter((r) => r.status === "no_response").length;
      await updatePlan(week.id, [{ id: "chase", detail: `${sent} reminder(s) sent so far, ${flagged} non-responder(s) flagged to you.` }]);
    }
    if (await maybeFinishCollection(week.id)) result.closedWeeks++;
  }

  result.expiredOffers = await expireStaleOffers();
  return result;
}

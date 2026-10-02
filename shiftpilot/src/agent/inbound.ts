import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Worker } from "@/db/schema";
import { normalizePhone, type InboundMessage } from "@/integrations/whatsapp";
import { relativeDayLabel, shiftWindow } from "@/lib/time";
import { audit } from "./audit";
import { getWorkspace, nowDate, nowMs } from "./context";
import * as copy from "./copy";
import { reportUnavailable, respondToOffer } from "./cover";
import { flushAwaiting, sendToWorker } from "./outbox";
import { buildScheduleView, pickWeekForWorker, renderScheduleImage } from "./schedule-image";
import { classifyIntent, resolveAffectedShift, type Intent } from "./understand";
import { recordAvailabilityFromMessage, upcomingAssignmentsFor } from "./weekly";

type Incoming = {
  worker: Worker;
  messageId: number;
  text?: string;
  buttonId?: string;
  /** True when this is the worker's very first message, which already got the "connected" reply. */
  firstContact?: boolean;
};

/** Entry point for a WhatsApp webhook message. Duplicate deliveries are ignored. */
export async function handleWhatsAppMessage(m: InboundMessage): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const phone = normalizePhone(m.from);
  const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.phone, phone));

  const [row] = await db
    .insert(schema.messages)
    .values({
      direction: "in",
      workerId: worker?.id ?? null,
      phone,
      body: m.text ?? (m.buttonTitle ? `[${m.buttonTitle}]` : `[${m.unsupportedType} message]`),
      kind: m.buttonId ? "button_reply" : "text",
      payload: m.buttonId ? { buttonId: m.buttonId } : null,
      waMessageId: m.waMessageId,
      status: "received",
      createdAt: nowDate(ws),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return;

  if (!worker) {
    await audit({ actor: "system", tool: "whatsapp", action: "message.unknown_sender", summary: `Message from unknown number ${phone.slice(0, -4)}xxxx; not processed` });
    await sendToWorker({ id: 0, name: m.profileName ?? "Unknown", phone, simulated: false, lastInboundAt: new Date() } as Worker, copy.unknownSender(ws.businessName), { purpose: "unknown sender" }).catch(() => {});
    return;
  }

  const firstContact = !worker.lastInboundAt;
  const [updated] = await db.update(schema.workers).set({ lastInboundAt: new Date() }).where(eq(schema.workers.id, worker.id)).returning();
  await audit({ actor: `worker:${worker.id}`, tool: "whatsapp", action: "message.received", summary: `${worker.name}: "${row.body.slice(0, 120)}"` });

  if (firstContact) {
    await sendToWorker(updated, copy.connected(updated.name, ws.businessName), { purpose: "connected" });
    await audit({ actor: "agent", tool: "policy", action: "worker.connected", summary: `${updated.name} is connected on WhatsApp` });
  }
  await flushAwaiting(updated);

  if (m.unsupportedType) return void (await sendToWorker(updated, copy.unsupportedMessage(), { purpose: "unsupported message" }));
  await route({ worker: updated, messageId: row.id, text: m.text, buttonId: m.buttonId, firstContact });
}

/** Test console: treats text typed on the dashboard as if the worker sent it. */
export async function handleSimulatedMessage(workerId: number, text: string): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.id, workerId));
  if (!worker) throw new Error("Worker not found");
  const [row] = await db
    .insert(schema.messages)
    .values({ direction: "in", workerId, phone: worker.phone, body: text, kind: "text", status: "simulated", createdAt: nowDate(ws) })
    .returning();
  await audit({ actor: `worker:${worker.id}`, tool: "whatsapp", action: "message.simulated_in", summary: `${worker.name} (test console): "${text.slice(0, 120)}"` });
  await route({ worker, messageId: row.id, text });
}

async function route(inc: Incoming): Promise<void> {
  if (inc.buttonId) return routeButton(inc);
  if (inc.text) return routeText(inc, undefined);
}

async function routeButton(inc: Incoming): Promise<void> {
  const db = getDb();
  const [kind, a, b] = inc.buttonId!.split(":");
  if (kind === "offer") {
    const offerId = Number(b);
    const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
    if (offer?.workerId === inc.worker.id) await respondToOffer(offerId, a === "accept", "button");
    return;
  }
  if (kind === "cant") return reportUnavailable(inc.worker, Number(a), b === "s", b === "s");
  if (kind === "clarify") {
    const [prev] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.workerId, inc.worker.id), eq(schema.messages.direction, "in"), eq(schema.messages.kind, "text"), lt(schema.messages.id, inc.messageId)))
      .orderBy(desc(schema.messages.id))
      .limit(1);
    const forced: Intent = a === "offer" ? "accept_offer" : (a as Intent);
    if (a === "offer") {
      const offer = await pendingOffer(inc.worker.id);
      if (offer) return sendToWorker(inc.worker, { kind: "buttons", body: "Can you take the open shift?", buttons: [{ id: `offer:accept:${offer.id}`, title: "Yes, I'll take it" }, { id: `offer:decline:${offer.id}`, title: "No, can't" }] }, { purpose: "offer clarification" }).then(() => {});
    }
    return routeText({ ...inc, text: prev?.body ?? "", messageId: prev?.id ?? inc.messageId }, forced);
  }
}

async function pendingOffer(workerId: number) {
  const [offer] = await getDb()
    .select()
    .from(schema.offers)
    .where(and(eq(schema.offers.workerId, workerId), eq(schema.offers.status, "pending")))
    .orderBy(desc(schema.offers.id))
    .limit(1);
  return offer ?? null;
}

async function openRequest(workerId: number) {
  const db = getDb();
  const rows = await db
    .select({ request: schema.availabilityRequests, week: schema.weeks })
    .from(schema.availabilityRequests)
    .innerJoin(schema.weeks, eq(schema.availabilityRequests.weekId, schema.weeks.id))
    .where(and(eq(schema.availabilityRequests.workerId, workerId), inArray(schema.weeks.status, ["collecting", "solving", "awaiting_publish"])))
    .orderBy(desc(schema.weeks.id))
    .limit(1);
  return rows[0] ?? null;
}

async function routeText(inc: Incoming, forced: Intent | undefined): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const { worker } = inc;
  const text = inc.text ?? "";
  const now = nowMs(ws);

  const [request, offer, upcomingAll] = await Promise.all([openRequest(worker.id), pendingOffer(worker.id), upcomingAssignmentsFor(worker.id)]);
  const upcoming = upcomingAll.filter((u) => shiftWindow(u.shift.date, u.shift.start, u.shift.end, ws.timezone).endMs > now);
  const labelFor = (s: (typeof upcoming)[number]["shift"]) => `${relativeDayLabel(s.date, now, ws.timezone)}, ${s.label} ${s.start}–${s.end}`;

  let offerLabel: string | null = null;
  if (offer) {
    const [inc2] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, offer.incidentId));
    const [s] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, inc2.shiftId));
    offerLabel = labelFor(s);
  }

  const understanding = forced
    ? { intent: forced, confidence: 1, mentionsHealth: false, via: "none" as const }
    : await classifyIntent({
        message: text,
        awaitingAvailability: request?.week.status === "collecting",
        openOffer: offerLabel,
        upcomingShifts: upcoming.map((u) => labelFor(u.shift)),
        weekId: request?.week.id,
        workerName: worker.name,
      });
  await db.update(schema.messages).set({ understanding }).where(eq(schema.messages.id, inc.messageId));

  const reply = (msg: Parameters<typeof sendToWorker>[1], purpose: string) => sendToWorker(worker, msg, { purpose, weekId: request?.week.id });

  switch (understanding.intent) {
    case "availability": {
      if (!request) return void (await reply(copy.noOpenRequest(), "no open request"));
      if (request.week.status !== "collecting") {
        await audit({ actor: `worker:${worker.id}`, tool: "policy", action: "needs_manager", summary: `${worker.name} sent an availability update after collection closed: "${text.slice(0, 120)}"`, weekId: request.week.id });
        return void (await reply(copy.rosterClosed(), "late availability"));
      }
      return recordAvailabilityFromMessage(worker, request.week.id, text, inc.messageId);
    }

    case "cannot_work": {
      if (!upcoming.length) return void (await reply(copy.noUpcomingShifts(), "no upcoming shifts"));
      const sick = understanding.mentionsHealth;
      let target: number | null = null;
      if (upcoming.length === 1) target = upcoming[0].assignment.id;
      else {
        const match = await resolveAffectedShift(
          text,
          upcoming.map((u) => ({ assignmentId: u.assignment.id, label: labelFor(u.shift) })),
          { workerName: worker.name, weekId: upcoming[0].week.id },
        );
        target = match?.assignmentId ?? null;
      }
      if (target === null) return void (await reply(copy.pickShift(upcoming.map((u) => ({ assignmentId: u.assignment.id, shift: u.shift })), sick), "which shift?"));
      return reportUnavailable(worker, target, sick, sick);
    }

    case "ask_schedule": {
      const weekId = await pickWeekForWorker(worker.id);
      const view = weekId ? await buildScheduleView(weekId, worker.id) : null;
      if (!view) return void (await reply(copy.noPublishedRoster(), "no published roster"));
      const png = await renderScheduleImage(view);
      const mine = upcoming.filter((u) => u.week.id === view.weekId).map((u) => u.shift);
      await audit({ actor: "agent", tool: "policy", action: "schedule.image", summary: `Sent ${worker.name} the roster image for the week of ${view.weekStart}`, weekId: view.weekId });
      return void (await reply(
        { kind: "image", caption: copy.scheduleCaption(worker.name, view.weekStart, mine), png, previewUrl: `/api/schedule-image?week=${view.weekId}&worker=${worker.id}` },
        "roster image",
      ));
    }

    case "accept_offer":
    case "decline_offer":
      if (!offer) return void (await reply(copy.noOpenOffer(), "no open offer"));
      return respondToOffer(offer.id, understanding.intent === "accept_offer", "text reply");

    case "question":
      await audit({ actor: `worker:${worker.id}`, tool: "policy", action: "needs_manager", summary: `${worker.name} asked: "${text.slice(0, 160)}"` });
      return void (await reply(copy.questionAck(upcoming.map((u) => u.shift)), "question"));

    case "other":
      if (inc.firstContact) return; // the "connected" message already answered a greeting
      return void (await reply(copy.genericAck(), "acknowledgement"));

    default:
      if (inc.firstContact) return;
      return void (await reply(copy.clarifyIntent(Boolean(offer)), "clarification"));
  }
}

import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Message, Worker } from "@/db/schema";
import {
  sendTemplate,
  sendWhatsApp,
  WhatsAppError,
  WINDOW_CLOSED_CODES,
} from "@/integrations/whatsapp";
import { env, integrations } from "@/lib/env";
import type { OutgoingMessage } from "@/lib/types";
import { audit } from "./audit";
import { getWorkspace, nowDate } from "./context";
import { toPlainText } from "./copy";

const WINDOW_MS = 23.5 * 3_600_000;

type Ctx = { purpose: string; weekId?: number | null; incidentId?: number | null };

async function insertOut(worker: Worker, msg: OutgoingMessage, values: Partial<typeof schema.messages.$inferInsert>) {
  const ws = await getWorkspace();
  const [row] = await getDb()
    .insert(schema.messages)
    .values({
      direction: "out",
      workerId: worker.id,
      phone: worker.phone,
      body: toPlainText(msg),
      kind: msg.kind,
      payload: msg.kind === "buttons" ? { buttons: msg.buttons } : msg.kind === "image" ? { image: msg.previewUrl } : null,
      status: "sent",
      createdAt: nowDate(ws),
      ...values,
    })
    .returning();
  return row;
}

async function reconstructQueued(m: Message): Promise<OutgoingMessage> {
  if (m.kind === "buttons" && m.payload?.buttons) {
    return { kind: "buttons", body: m.body.split("\n[")[0], buttons: m.payload.buttons as { id: string; title: string }[] };
  }
  if (m.kind === "image" && typeof m.payload?.image === "string") {
    const preview = m.payload.image;
    const params = new URL(preview, "http://local").searchParams;
    const weekId = Number(params.get("week"));
    const workerId = Number(params.get("worker"));
    if (weekId > 0) {
      const { buildScheduleView, renderScheduleImage } = await import("./schedule-image");
      const view = await buildScheduleView(weekId, workerId > 0 ? workerId : null);
      if (view) return { kind: "image", caption: m.body, png: await renderScheduleImage(view), previewUrl: preview };
    }
  }
  return { kind: "text", body: m.body };
}

function windowOpen(worker: Worker): boolean {
  return Boolean(worker.lastInboundAt && Date.now() - worker.lastInboundAt.getTime() < WINDOW_MS);
}

/**
 * Sends a message to a worker. Simulated workers (or a missing WhatsApp config) are logged but not sent.
 * Outside Meta's 24-hour window the approved template opens the conversation first.
 */
export async function sendToWorker(worker: Worker, msg: OutgoingMessage, ctx: Ctx): Promise<Message> {
  const auditBase = { actor: "agent", tool: "whatsapp" as const, weekId: ctx.weekId, incidentId: ctx.incidentId };

  if (worker.simulated || !worker.phone || !integrations.whatsapp) {
    const row = await insertOut(worker, msg, { status: "simulated" });
    await audit({
      ...auditBase,
      action: "message.simulated",
      summary: `Would message ${worker.name} (${ctx.purpose})${worker.simulated ? ": simulated worker" : ": WhatsApp not configured"}`,
      details: { messageId: row.id },
    });
    return row;
  }

  if (windowOpen(worker)) {
    try {
      const { waMessageId } = await sendWhatsApp(worker.phone, msg);
      const row = await insertOut(worker, msg, { waMessageId });
      await audit({ ...auditBase, action: "message.sent", summary: `Messaged ${worker.name} on WhatsApp (${ctx.purpose})`, details: { messageId: row.id, waMessageId } });
      return row;
    } catch (e) {
      if (!(e instanceof WhatsAppError && e.code && WINDOW_CLOSED_CODES.includes(e.code))) {
        if (msg.kind === "image") {
          // The picture could not be delivered (e.g. upload failed): fall back to the same information as text.
          await audit({ ...auditBase, action: "message.image_failed", summary: `Image to ${worker.name} failed (${(e as Error).message}); sending it as text instead` });
          return sendToWorker(worker, { kind: "text", body: msg.caption }, ctx);
        }
        const row = await insertOut(worker, msg, { status: "failed", error: String((e as Error).message) });
        await audit({ ...auditBase, action: "message.failed", summary: `WhatsApp send to ${worker.name} failed: ${(e as Error).message}`, details: { messageId: row.id } });
        return row;
      }
    }
  }

  // Outside the 24-hour window: only an approved template can be delivered.
  const text = toPlainText(msg) + (msg.kind === "buttons" ? "\nReply YES or NO." : "");
  try {
    if (env.whatsapp.templateHasBodyParam) {
      const { waMessageId } = await sendTemplate(worker.phone, text);
      const row = await insertOut(worker, msg, { kind: "template", body: text, waMessageId });
      await audit({ ...auditBase, action: "message.sent_template", summary: `Messaged ${worker.name} with template "${env.whatsapp.templateName}" (${ctx.purpose})`, details: { messageId: row.id, waMessageId } });
      return row;
    }
    const opener = await sendTemplate(worker.phone);
    await insertOut(worker, { kind: "text", body: `[template: ${env.whatsapp.templateName}]` }, { kind: "template", waMessageId: opener.waMessageId });
    const row = await insertOut(worker, msg, { status: "awaiting_window" });
    await audit({
      ...auditBase,
      action: "message.queued_for_window",
      summary: `${worker.name} hasn't messaged in 24h, so I sent the "${env.whatsapp.templateName}" template and queued the real message until they reply`,
      details: { messageId: row.id },
    });
    return row;
  } catch (e) {
    const row = await insertOut(worker, msg, { status: "failed", error: String((e as Error).message) });
    await audit({ ...auditBase, action: "message.failed", summary: `Template send to ${worker.name} failed: ${(e as Error).message}`, details: { messageId: row.id } });
    return row;
  }
}

/** Delivers messages that were waiting for the worker to open the 24-hour window. */
export async function flushAwaiting(worker: Worker): Promise<void> {
  if (!worker.phone || !integrations.whatsapp) return;
  const db = getDb();
  const queued = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.workerId, worker.id), eq(schema.messages.status, "awaiting_window")))
    .orderBy(asc(schema.messages.id));
  for (const m of queued) {
    const msg: OutgoingMessage = await reconstructQueued(m);
    try {
      const { waMessageId } = await sendWhatsApp(worker.phone, msg);
      await db.update(schema.messages).set({ status: "sent", waMessageId }).where(eq(schema.messages.id, m.id));
      await audit({ actor: "agent", tool: "whatsapp", action: "message.delivered_queued", summary: `Window open: delivered queued message to ${worker.name}`, details: { messageId: m.id } });
    } catch (e) {
      await db.update(schema.messages).set({ status: "failed", error: String((e as Error).message) }).where(eq(schema.messages.id, m.id));
    }
  }
}

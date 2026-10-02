import { eq } from "drizzle-orm";
import { after, type NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { audit } from "@/agent/audit";
import { handleWhatsAppMessage } from "@/agent/inbound";
import { parseWebhook, verifySignature } from "@/integrations/whatsapp";
import { env } from "@/lib/env";

/** Meta's webhook verification handshake. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && env.whatsapp.verifyToken && p.get("hub.verify_token") === env.whatsapp.verifyToken) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

let queue: Promise<void> = Promise.resolve();

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const { messages, statuses } = parseWebhook(payload);

  // Acknowledge immediately so Meta doesn't retry; process in order afterwards.
  after(() => {
    queue = queue.then(async () => {
      const db = getDb();
      for (const s of statuses) {
        const [row] = await db
          .update(schema.messages)
          .set({ status: s.status, ...(s.error ? { error: s.error } : {}) })
          .where(eq(schema.messages.waMessageId, s.waMessageId))
          .returning();
        if (row && s.status === "failed") {
          await audit({ actor: "system", tool: "whatsapp", action: "message.failed", summary: `WhatsApp reported delivery failure: ${s.error ?? "unknown"}`, details: { messageId: row.id } });
        }
      }
      for (const m of messages) {
        try {
          await handleWhatsAppMessage(m);
        } catch (e) {
          console.error("[webhook] failed to handle message", e);
          await audit({ actor: "system", tool: "whatsapp", action: "inbound.error", summary: `Failed to process a message: ${(e as Error).message}` }).catch(() => {});
        }
      }
    });
    return queue;
  });

  return new Response("OK", { status: 200 });
}

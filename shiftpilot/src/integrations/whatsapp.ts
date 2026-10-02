import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { OutgoingMessage } from "@/lib/types";

export class WhatsAppError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

/** Meta error codes meaning the 24-hour customer service window is closed. */
export const WINDOW_CLOSED_CODES = [131047, 131026];

type SendResult = { waMessageId: string };

async function post(body: Record<string, unknown>): Promise<SendResult> {
  const { token, phoneNumberId, graphVersion } = env.whatsapp;
  if (!token || !phoneNumberId) throw new WhatsAppError("WhatsApp is not configured");
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new WhatsAppError(err.error_data?.details ?? err.message ?? `WhatsApp HTTP ${res.status}`, err.code);
  }
  const id = json?.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp did not return a message id");
  return { waMessageId: id };
}

/** Uploads an image to WhatsApp and returns its media id, so no public URL (or tunnel) is needed to send it. */
async function uploadImage(png: Uint8Array): Promise<string> {
  const { token, phoneNumberId, graphVersion } = env.whatsapp;
  if (!token || !phoneNumberId) throw new WhatsAppError("WhatsApp is not configured");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/png");
  form.append("file", new Blob([png as BlobPart], { type: "image/png" }), "schedule.png");
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) throw new WhatsAppError(json?.error?.message ?? `WhatsApp media upload failed (HTTP ${res.status})`, json?.error?.code);
  return json.id as string;
}

export async function sendWhatsApp(to: string, msg: OutgoingMessage): Promise<SendResult> {
  if (msg.kind === "text") {
    return post({ to, type: "text", text: { body: msg.body, preview_url: false } });
  }
  if (msg.kind === "image") {
    const id = await uploadImage(msg.png);
    return post({ to, type: "image", image: { id, caption: msg.caption.slice(0, 1024) } });
  }
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: msg.body.slice(0, 1024) },
      action: {
        buttons: msg.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })),
      },
    },
  });
}

/** Opens a conversation outside the 24-hour window with the configured approved template. */
export function sendTemplate(to: string, text?: string): Promise<SendResult> {
  const { templateName, templateLang, templateHasBodyParam } = env.whatsapp;
  const components =
    templateHasBodyParam && text
      ? [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " ").slice(0, 1000) }] }]
      : undefined;
  return post({
    to,
    type: "template",
    template: { name: templateName, language: { code: templateLang }, ...(components ? { components } : {}) },
  });
}

export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env.whatsapp.appSecret;
  if (!secret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = signatureHeader.slice(7);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

export type InboundMessage = {
  waMessageId: string;
  from: string;
  profileName?: string;
  timestampMs: number;
  text?: string;
  buttonId?: string;
  buttonTitle?: string;
  unsupportedType?: string;
};

export type StatusUpdate = {
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error?: string;
};

type WebhookValue = {
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    interactive?: { type: string; button_reply?: { id: string; title: string } };
    button?: { text: string; payload: string };
  }[];
  statuses?: { id: string; status: string; errors?: { code: number; title?: string; message?: string }[] }[];
};

export function parseWebhook(payload: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const out = { messages: [] as InboundMessage[], statuses: [] as StatusUpdate[] };
  const entries = (payload as { entry?: { changes?: { value?: WebhookValue }[] }[] })?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const base = { waMessageId: m.id, from: m.from, profileName: names.get(m.from), timestampMs: Number(m.timestamp) * 1000 };
        if (m.type === "text" && m.text) out.messages.push({ ...base, text: m.text.body });
        else if (m.type === "interactive" && m.interactive?.button_reply)
          out.messages.push({ ...base, buttonId: m.interactive.button_reply.id, buttonTitle: m.interactive.button_reply.title });
        else if (m.type === "button" && m.button) out.messages.push({ ...base, text: m.button.text });
        else out.messages.push({ ...base, unsupportedType: m.type });
      }
      for (const s of value.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const e = s.errors?.[0];
        out.statuses.push({
          waMessageId: s.id,
          status: s.status as StatusUpdate["status"],
          error: e ? `${e.code}: ${e.message ?? e.title ?? "unknown error"}` : undefined,
        });
      }
    }
  }
  return out;
}

export const normalizePhone = (p: string) => p.replace(/[^\d]/g, "");

let numberCache: { at: number; value: BusinessNumber } | null = null;
export type BusinessNumber = { ok: true; display: string; digits: string; name?: string } | { ok: false; error: string };

/** Looks up the bot's own number. Doubles as a check that the token and phone number ID are valid. */
export async function getBusinessNumber(): Promise<BusinessNumber> {
  const { token, phoneNumberId, graphVersion } = env.whatsapp;
  if (!token || !phoneNumberId) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not set" };
  if (numberCache && Date.now() - numberCache.at < 10 * 60_000 && numberCache.value.ok) return numberCache.value;
  try {
    const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json().catch(() => ({}));
    const value: BusinessNumber = res.ok
      ? { ok: true, display: json.display_phone_number, digits: normalizePhone(json.display_phone_number ?? ""), name: json.verified_name }
      : { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    numberCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

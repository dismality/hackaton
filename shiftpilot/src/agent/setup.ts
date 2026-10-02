import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Workspace } from "@/db/schema";
import { integrations } from "@/lib/env";

export const SETUP_STEPS = [
  { key: "business", title: "Your business", hint: "Name, timezone and business type" },
  { key: "shifts", title: "Shifts", hint: "When people work and how many you need" },
  { key: "rules", title: "Rules", hint: "Hour limits, reminders and what needs your OK" },
  { key: "team", title: "Your team", hint: "Add part-timers and their WhatsApp numbers" },
  { key: "whatsapp", title: "Connect WhatsApp", hint: "Check each person can reach the bot" },
  { key: "week", title: "First roster", hint: "Tell the agent what you need" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

/** One question per page. Headcount gets a page per shift type, so the list depends on the chosen business type. */
export type SetupPage = { key: string; group: SetupStepKey };

export function setupPages(ws: Pick<Workspace, "shiftTemplates">): SetupPage[] {
  return [
    { key: "name", group: "business" },
    { key: "timezone", group: "business" },
    { key: "type", group: "business" },
    ...ws.shiftTemplates.map((t) => ({ key: `shift:${t.key}`, group: "shifts" as const })),
    { key: "hours", group: "rules" },
    { key: "reminders", group: "rules" },
    { key: "autoOffer", group: "rules" },
    { key: "team", group: "team" },
    { key: "simulated", group: "team" },
    { key: "whatsapp", group: "whatsapp" },
    { key: "goal", group: "week" },
  ];
}

export async function getSetupStatus(): Promise<{ done: Record<SetupStepKey, boolean>; completed: number; total: number; started: boolean }> {
  const db = getDb();
  const saved = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(inArray(schema.auditLog.action, ["setup.business", "setup.shifts", "setup.rules"]));
  const has = (a: string) => saved.some((s) => s.action === a);

  const workers = await db.select().from(schema.workers).where(eq(schema.workers.active, true));
  const real = workers.filter((w) => !w.simulated && w.phone);
  const [{ n: weeks }] = await db.select({ n: count() }).from(schema.weeks);

  const done: Record<SetupStepKey, boolean> = {
    business: has("setup.business"),
    shifts: has("setup.shifts"),
    rules: has("setup.rules"),
    team: workers.length > 0,
    whatsapp: integrations.whatsapp && real.length > 0 && real.every((w) => w.lastInboundAt),
    week: weeks > 0,
  };
  const completed = Object.values(done).filter(Boolean).length;
  return { done, completed, total: SETUP_STEPS.length, started: saved.length > 0 || workers.length > 0 || weeks > 0 };
}

export async function webhookSeen(): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.messages)
    .where(and(eq(schema.messages.direction, "in"), isNotNull(schema.messages.waMessageId)));
  return row.n > 0;
}

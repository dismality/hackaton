"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { setupPages } from "@/agent/setup";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { decideApproval } from "@/agent/approvals";
import { audit } from "@/agent/audit";
import { getWorkspace, nowDate } from "@/agent/context";
import { connected as connectedCopy } from "@/agent/copy";
import { respondToOffer } from "@/agent/cover";
import { sendToWorker } from "@/agent/outbox";
import { handleSimulatedMessage } from "@/agent/inbound";
import { updatePlan } from "@/agent/plan";
import { resetDemoData, seedSimulatedWorkers } from "@/agent/seed";
import { runTick } from "@/agent/tick";
import { createWeekFromGoal, maybeFinishCollection, requestPublishApproval, solveWeek } from "@/agent/weekly";
import { getDb, schema } from "@/db";
import { normalizePhone } from "@/integrations/whatsapp";
import { getPreset } from "@/lib/presets";
import type { ShiftTemplate } from "@/lib/types";

export type FormState = { ok?: boolean; error?: string; message?: string } | null;

const refresh = () => revalidatePath("/", "layout");
const num = (v: FormDataEntryValue | null) => Number(v);

async function guard(fn: () => Promise<string | void>): Promise<FormState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message: message || undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function createWeekAction(_: FormState, form: FormData): Promise<FormState> {
  const goal = String(form.get("goal") ?? "").trim();
  if (goal.length < 5) return { error: "Describe what you need, e.g. \"Staff next week, 3 people on weekend closing shifts\"." };
  return guard(async () => {
    await createWeekFromGoal(goal);
    return "Plan ready. Review it and approve the first step.";
  });
}

export async function decideApprovalAction(form: FormData): Promise<void> {
  const option = form.get("option");
  await decideApproval(num(form.get("id")), form.get("decision") === "approve", option === null ? undefined : Number(option));
  refresh();
}

export async function buildNowAction(form: FormData): Promise<void> {
  await maybeFinishCollection(num(form.get("weekId")), true);
  refresh();
}

export async function resolveAgainAction(form: FormData): Promise<void> {
  const weekId = num(form.get("weekId"));
  await audit({ actor: "manager", tool: "manager", action: "roster.resolve_requested", summary: "Manager asked the agent to rebuild the roster", weekId });
  await solveWeek(weekId);
  refresh();
}

export async function requestPublishAction(form: FormData): Promise<void> {
  const weekId = num(form.get("weekId"));
  await requestPublishApproval(weekId);
  await updatePlan(weekId, [{ id: "approve_publish", status: "in_progress", detail: "Manager edited the roster; waiting for approval." }]);
  refresh();
}

export async function cancelWeekAction(form: FormData): Promise<void> {
  const weekId = num(form.get("weekId"));
  const db = getDb();
  const ws = await getWorkspace();
  await db.update(schema.weeks).set({ status: "cancelled" }).where(eq(schema.weeks.id, weekId));
  await db.update(schema.approvals).set({ status: "rejected", decision: "week cancelled", decidedAt: nowDate(ws) }).where(eq(schema.approvals.weekId, weekId));
  await audit({ actor: "manager", tool: "manager", action: "week.cancelled", summary: "Manager cancelled the week", weekId });
  refresh();
}

const WorkerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim(),
  skills: z.string(),
  maxHours: z.string(),
  simulated: z.boolean(),
});

export async function addWorkerAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = WorkerSchema.safeParse({
    name: form.get("name"),
    phone: form.get("phone") ?? "",
    skills: form.getAll("skills").join(","),
    maxHours: form.get("maxHours") ?? "",
    simulated: form.get("simulated") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, phone, skills, maxHours, simulated } = parsed.data;
  const digits = normalizePhone(phone);
  if (!simulated && digits.length < 8) return { error: "Real workers need a WhatsApp number with country code, e.g. +65 9123 4567." };
  return guard(async () => {
    await insertWorker({ name, phone: digits, skills: csv(skills), maxHours: maxHours ? Number(maxHours) : null, simulated });
    return `Added ${name}.`;
  });
}

/** Adds a worker and links any messages they sent before being added, so they count as connected. */
async function insertWorker(w: { name: string; phone: string; skills: string[]; maxHours: number | null; simulated: boolean }) {
  const db = getDb();
  const ws = await getWorkspace();
  const [worker] = await db
    .insert(schema.workers)
    .values({ name: w.name, phone: w.phone || null, skills: w.skills, maxHoursPerWeek: w.maxHours, simulated: w.simulated })
    .returning();
  if (w.phone) {
    const earlier = await db
      .update(schema.messages)
      .set({ workerId: worker.id })
      .where(and(eq(schema.messages.phone, w.phone), isNull(schema.messages.workerId), eq(schema.messages.direction, "in")))
      .returning({ createdAt: schema.messages.createdAt });
    const last = earlier.map((m) => m.createdAt.getTime() - ws.clockOffsetMinutes * 60_000).sort((a, b) => b - a)[0];
    if (last) {
      const [linked] = await db.update(schema.workers).set({ lastInboundAt: new Date(last) }).where(eq(schema.workers.id, worker.id)).returning();
      // They messaged the bot before being added: they are connected the moment they are on the team.
      await sendToWorker(linked, connectedCopy(linked.name, ws.businessName), { purpose: "connected" }).catch(() => {});
      await audit({ actor: "agent", tool: "policy", action: "worker.connected", summary: `${linked.name} is connected on WhatsApp` });
    }
  }
  await audit({ actor: "manager", tool: "manager", action: "worker.added", summary: `Added ${w.simulated ? "simulated " : ""}worker ${w.name}` });
  return worker;
}

export async function toggleWorkerAction(form: FormData): Promise<void> {
  const id = num(form.get("id"));
  const db = getDb();
  const [w] = await db.select().from(schema.workers).where(eq(schema.workers.id, id));
  if (w) await db.update(schema.workers).set({ active: !w.active }).where(eq(schema.workers.id, id));
  refresh();
}

export async function deleteWorkerAction(form: FormData): Promise<void> {
  await getDb().delete(schema.workers).where(eq(schema.workers.id, num(form.get("id"))));
  refresh();
}

export async function seedWorkersAction(): Promise<void> {
  await seedSimulatedWorkers();
  refresh();
}

export async function simulateMessageAction(_: FormState, form: FormData): Promise<FormState> {
  const text = String(form.get("text") ?? "").trim();
  const workerId = num(form.get("workerId"));
  if (!text || !workerId) return { error: "Pick a worker and type a message." };
  return guard(async () => {
    await handleSimulatedMessage(workerId, text);
    return "Message processed. See the activity log.";
  });
}

export async function simulateOfferReplyAction(form: FormData): Promise<void> {
  await respondToOffer(num(form.get("offerId")), form.get("decision") === "accept", "simulated reply");
  refresh();
}

export async function removeAssignmentAction(form: FormData): Promise<void> {
  const id = num(form.get("id"));
  const db = getDb();
  const ws = await getWorkspace();
  const [a] = await db.update(schema.assignments).set({ status: "released", releasedAt: nowDate(ws) }).where(eq(schema.assignments.id, id)).returning();
  if (a) await audit({ actor: "manager", tool: "manager", action: "assignment.removed", summary: `Manager removed an assignment (#${a.id})` });
  refresh();
}

export async function addAssignmentAction(form: FormData): Promise<void> {
  const shiftId = num(form.get("shiftId"));
  const workerId = num(form.get("workerId"));
  if (!shiftId || !workerId) return;
  const db = getDb();
  const ws = await getWorkspace();
  await db.insert(schema.assignments).values({ shiftId, workerId, status: "active", source: "manual", reason: "added by manager", createdAt: nowDate(ws) });
  await audit({ actor: "manager", tool: "manager", action: "assignment.added", summary: `Manager added a worker to shift #${shiftId}` });
  refresh();
}

export async function advanceClockAction(form: FormData): Promise<void> {
  const minutes = num(form.get("minutes"));
  const db = getDb();
  const ws = await getWorkspace();
  const offset = minutes === 0 ? 0 : ws.clockOffsetMinutes + minutes;
  await db.update(schema.workspace).set({ clockOffsetMinutes: offset }).where(eq(schema.workspace.id, 1));
  await audit({ actor: "manager", tool: "clock", action: "clock.changed", summary: minutes === 0 ? "Demo clock reset to real time" : `Demo clock moved forward ${minutes >= 60 ? `${minutes / 60}h` : `${minutes} min`}` });
  await runTick();
  refresh();
}

export async function runTickAction(): Promise<void> {
  await runTick();
  refresh();
}

const numberField = (form: FormData, k: string, fallback: number) => {
  const v = Number(form.get(k));
  return Number.isFinite(v) && form.get(k) !== "" && form.get(k) !== null ? v : fallback;
};

const csv = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function parseTemplates(form: FormData): ShiftTemplate[] {
  const templates: ShiftTemplate[] = [];
  for (let i = 0; i < 20; i++) {
    const label = String(form.get(`t${i}_label`) ?? "").trim();
    if (!label) continue;
    const start = String(form.get(`t${i}_start`) ?? "");
    const end = String(form.get(`t${i}_end`) ?? "");
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new Error(`Shift "${label}" needs start and end times.`);
    const days = form.getAll(`t${i}_days`).map(Number);
    if (!days.length) throw new Error(`Shift "${label}" needs at least one day.`);
    templates.push({
      key: String(form.get(`t${i}_key`) || label.toLowerCase().replace(/[^a-z0-9]+/g, "_")),
      label,
      start,
      end,
      days,
      requiredCount: Math.max(1, numberField(form, `t${i}_count`, 1)),
      requiredSkills: csv(form.get(`t${i}_skills`)),
    });
  }
  if (!templates.length) throw new Error("Keep at least one shift type.");
  return templates;
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parses "Name, +65 9123 4567, opener barista" lines. Skills are optional. */
function parseTeam(text: string, knownSkills: string[]) {
  const people: { name: string; phone: string; skills: string[] }[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [name, phone = "", skills = ""] = line.split(/\s*[,\t]\s*/);
    const digits = normalizePhone(phone);
    if (!name) throw new Error(`Line ${i + 1} needs a name.`);
    if (digits.length < 8) throw new Error(`Line ${i + 1} (${name}) needs a WhatsApp number with country code, e.g. +65 9123 4567.`);
    const lower = new Map(knownSkills.map((s) => [s.toLowerCase(), s]));
    people.push({ name, phone: digits, skills: skills.split(/[\s;/]+/).map((s) => lower.get(s.toLowerCase()) ?? s).filter(Boolean) });
  }
  return people;
}

/** Saves one onboarding answer, then moves to the next question. */
export async function setupAnswerAction(_: FormState, form: FormData): Promise<FormState> {
  const step = String(form.get("step") ?? "");
  const value = String(form.get("value") ?? "").trim();
  const db = getDb();
  const ws = await getWorkspace();
  const setWs = (patch: Partial<typeof schema.workspace.$inferInsert>) => db.update(schema.workspace).set(patch).where(eq(schema.workspace.id, 1));
  const mark = (action: string, summary: string) => audit({ actor: "manager", tool: "manager", action, summary });
  const pages = setupPages(ws);
  const isLastShift = step.startsWith("shift:") && pages.filter((p) => p.group === "shifts").at(-1)?.key === step;

  if (step === "name") {
    if (!value) return { error: "Staff will see this name in messages." };
    await setWs({ businessName: value });
  } else if (step === "timezone") {
    if (!validTimezone(value)) return { error: `"${value}" isn't a timezone I recognise.` };
    await setWs({ timezone: value });
  } else if (step === "type") {
    const preset = getPreset(value);
    if (preset.key !== ws.presetKey) {
      await setWs({ presetKey: preset.key, skills: preset.skills, shiftTemplates: preset.shiftTemplates, rules: { ...ws.rules, ...preset.rules } });
    }
    await mark("setup.business", `Set up ${ws.businessName} as ${preset.name}`);
  } else if (step.startsWith("shift:")) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 50) return { error: "Enter a whole number from 1 to 50." };
    const key = step.slice(6);
    await setWs({ shiftTemplates: ws.shiftTemplates.map((t) => (t.key === key ? { ...t, requiredCount: count } : t)) });
    if (isLastShift) await mark("setup.shifts", `Confirmed ${ws.shiftTemplates.length} shift types`);
  } else if (step === "hours") {
    const hours = Number(value);
    if (!(hours > 0 && hours <= 80)) return { error: "Enter a number of hours from 1 to 80." };
    await setWs({ rules: { ...ws.rules, maxHoursPerWeek: hours } });
  } else if (step === "reminders") {
    const hours = Number(value);
    if (!(hours >= 0.5 && hours <= 72)) return { error: "Enter between 0.5 and 72 hours." };
    await setWs({ rules: { ...ws.rules, reminderAfterHours: hours } });
  } else if (step === "autoOffer") {
    if (value !== "yes" && value !== "no") return { error: "Pick one." };
    await setWs({ autoOfferReplacements: value === "yes" });
    await mark("setup.rules", "Confirmed scheduling rules");
  } else if (step === "team") {
    let people;
    try {
      people = parseTeam(value, ws.skills);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const existing = await db.select({ phone: schema.workers.phone }).from(schema.workers);
    const known = new Set(existing.map((w) => w.phone));
    for (const p of people.filter((p) => !known.has(p.phone))) {
      await insertWorker({ ...p, maxHours: null, simulated: false });
    }
    if (!people.length && !existing.length) return { error: "Add at least one person, or pick simulated staff on the next page." };
  } else if (step === "simulated") {
    if (value === "yes") await seedSimulatedWorkers();
    const [{ n }] = await db.select({ n: count() }).from(schema.workers);
    if (!n) return { error: "You need at least one person. Go back to add your team, or choose yes." };
  } else if (step === "goal") {
    if (value.length < 5) return { error: "Describe the week, e.g. \"Staff next week with the normal pattern\"." };
    try {
      await createWeekFromGoal(value);
    } catch (e) {
      return { error: (e as Error).message };
    }
    refresh();
    redirect("/");
  }

  refresh();
  const nextPages = setupPages(await getWorkspace());
  const i = nextPages.findIndex((p) => p.key === step);
  redirect(`/setup?step=${encodeURIComponent(nextPages[i + 1]?.key ?? "goal")}`);
}

export async function saveSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  return guard(async () => {
    const ws = await getWorkspace();
    const n = (k: string, fallback: number) => numberField(form, k, fallback);
    const templates = parseTemplates(form);
    const skills = csv(form.get("skills"));
    await getDb()
      .update(schema.workspace)
      .set({
        businessName: String(form.get("businessName") || ws.businessName),
        timezone: String(form.get("timezone") || ws.timezone),
        skills,
        shiftTemplates: templates,
        autoOfferReplacements: form.get("autoOffer") === "on",
        rules: {
          maxHoursPerWeek: n("maxHoursPerWeek", ws.rules.maxHoursPerWeek),
          minRestHours: n("minRestHours", ws.rules.minRestHours),
          maxShiftsPerDay: n("maxShiftsPerDay", ws.rules.maxShiftsPerDay),
          reminderAfterHours: n("reminderAfterHours", ws.rules.reminderAfterHours),
          maxReminders: n("maxReminders", ws.rules.maxReminders),
          availabilityDeadlineHours: n("availabilityDeadlineHours", ws.rules.availabilityDeadlineHours),
          offerTimeoutMinutes: n("offerTimeoutMinutes", ws.rules.offerTimeoutMinutes),
        },
        baselines: {
          minutesPerMessageSent: n("minutesPerMessageSent", ws.baselines.minutesPerMessageSent),
          minutesPerReplyRead: n("minutesPerReplyRead", ws.baselines.minutesPerReplyRead),
          minutesToBuildRoster: n("minutesToBuildRoster", ws.baselines.minutesToBuildRoster),
          minutesPerCoverCall: n("minutesPerCoverCall", ws.baselines.minutesPerCoverCall),
          minutesPerApproval: n("minutesPerApproval", ws.baselines.minutesPerApproval),
        },
      })
      .where(eq(schema.workspace.id, 1));
    await audit({ actor: "manager", tool: "manager", action: "settings.saved", summary: "Manager updated business settings" });
    return "Settings saved. New weeks will use them.";
  });
}

export async function applyPresetAction(form: FormData): Promise<void> {
  const preset = getPreset(String(form.get("preset")));
  const ws = await getWorkspace();
  await getDb()
    .update(schema.workspace)
    .set({ presetKey: preset.key, skills: preset.skills, shiftTemplates: preset.shiftTemplates, rules: { ...ws.rules, ...preset.rules } })
    .where(eq(schema.workspace.id, 1));
  await audit({ actor: "manager", tool: "manager", action: "settings.preset", summary: `Applied the "${preset.name}" preset` });
  refresh();
}

export async function resetDemoAction(): Promise<void> {
  await resetDemoData();
  refresh();
}

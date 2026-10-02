import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift, Week, Worker, Workspace } from "@/db/schema";
import { DEFAULT_BASELINES, DEFAULT_RULES, getPreset } from "@/lib/presets";
import { formatDate, shiftWindow } from "@/lib/time";
import type { Rules } from "@/lib/types";
import { availabilityKey, type AvailabilityStatus, type SolverShift, type SolverWorker } from "./solver";

export async function getWorkspace(): Promise<Workspace> {
  const db = getDb();
  const [row] = await db.select().from(schema.workspace).where(eq(schema.workspace.id, 1));
  if (row) return row;
  const preset = getPreset("cafe");
  const [created] = await db
    .insert(schema.workspace)
    .values({
      id: 1,
      businessName: "Kopi & Co. Café",
      presetKey: preset.key,
      timezone: "Asia/Singapore",
      skills: preset.skills,
      shiftTemplates: preset.shiftTemplates,
      rules: { ...DEFAULT_RULES, ...preset.rules },
      baselines: DEFAULT_BASELINES,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getWorkspace());
}

/** Agent time: wall clock plus the demo clock offset, so reminders and timeouts can be fast-forwarded. */
export function nowMs(ws: Pick<Workspace, "clockOffsetMinutes">): number {
  return Date.now() + ws.clockOffsetMinutes * 60_000;
}

export const nowDate = (ws: Pick<Workspace, "clockOffsetMinutes">) => new Date(nowMs(ws));

export function effectiveMaxHours(worker: Worker, rules: Rules, week?: Week | null): number {
  const personal = worker.maxHoursPerWeek ?? rules.maxHoursPerWeek;
  const cap = week?.constraints.maxHoursPerWeek;
  return cap ? Math.min(personal, cap) : personal;
}

export function shiftLabel(shift: Pick<Shift, "date" | "label" | "start" | "end">): string {
  return `${formatDate(shift.date)}, ${shift.label} ${shift.start}–${shift.end}`;
}

export function toSolverShift(shift: Shift, tz: string): SolverShift {
  return {
    id: shift.id,
    date: shift.date,
    label: shiftLabel(shift),
    ...shiftWindow(shift.date, shift.start, shift.end, tz),
    requiredCount: shift.requiredCount,
    requiredSkills: shift.requiredSkills,
  };
}

export function toSolverWorker(worker: Worker, rules: Rules, week?: Week | null): SolverWorker {
  return { id: worker.id, name: worker.name, skills: worker.skills, maxHours: effectiveMaxHours(worker, rules, week) };
}

export async function loadWeekState(weekId: number) {
  const db = getDb();
  const ws = await getWorkspace();
  const [week] = await db.select().from(schema.weeks).where(eq(schema.weeks.id, weekId));
  if (!week) throw new Error(`Week ${weekId} not found`);
  const shifts = await db.select().from(schema.shifts).where(eq(schema.shifts.weekId, weekId)).orderBy(schema.shifts.date, schema.shifts.start);
  const workers = await db.select().from(schema.workers).where(eq(schema.workers.active, true)).orderBy(schema.workers.id);
  const avail = await db.select().from(schema.availability).where(eq(schema.availability.weekId, weekId));
  const shiftIds = shifts.map((s) => s.id);
  const assignments = shiftIds.length
    ? await db
        .select()
        .from(schema.assignments)
        .where(and(inArray(schema.assignments.shiftId, shiftIds), eq(schema.assignments.status, "active")))
    : [];

  const availability = new Map<string, AvailabilityStatus>();
  for (const a of avail) availability.set(availabilityKey(a.workerId, a.shiftId), a.status);

  const solverShifts = shifts.map((s) => toSolverShift(s, ws.timezone));
  const solverWorkers = workers.map((w) => toSolverWorker(w, ws.rules, week));
  const shiftById = new Map(solverShifts.map((s) => [s.id, s]));

  return { ws, week, shifts, workers, availability, assignments, solverShifts, solverWorkers, shiftById };
}

export type WeekState = Awaited<ReturnType<typeof loadWeekState>>;

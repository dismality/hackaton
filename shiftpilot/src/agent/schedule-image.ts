import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, localDateOf } from "@/lib/time";
import { getWorkspace, nowMs } from "./context";
import { upcomingAssignmentsFor } from "./weekly";

export type Chip = { workerId: number; name: string } | { workerId: null; name: "Open" };

export type ScheduleView = {
  businessName: string;
  weekId: number;
  weekStart: string;
  viewerId: number | null;
  days: {
    date: string;
    shifts: { id: number; label: string; start: string; end: string; chips: Chip[]; hasViewer: boolean }[];
  }[];
};

export { renderScheduleImage } from "./schedule-render";

/** The published week that is most useful to show this worker: the one with their next shift, else the current or next one. */
export async function pickWeekForWorker(workerId: number): Promise<number | null> {
  const upcoming = await upcomingAssignmentsFor(workerId);
  if (upcoming.length) return upcoming[0].week.id;
  const ws = await getWorkspace();
  const today = localDateOf(nowMs(ws), ws.timezone);
  const published = await getDb().select().from(schema.weeks).where(eq(schema.weeks.status, "published")).orderBy(schema.weeks.weekStart);
  return published.find((w) => addDays(w.weekStart, 6) >= today)?.id ?? null;
}

export async function buildScheduleView(weekId: number, viewerId: number | null): Promise<ScheduleView | null> {
  const db = getDb();
  const ws = await getWorkspace();
  const [week] = await db.select().from(schema.weeks).where(eq(schema.weeks.id, weekId));
  if (!week) return null;
  const shifts = await db.select().from(schema.shifts).where(eq(schema.shifts.weekId, weekId)).orderBy(schema.shifts.date, schema.shifts.start);
  const shiftIds = shifts.map((s) => s.id);
  const assigned = shiftIds.length
    ? await db.select().from(schema.assignments).where(and(inArray(schema.assignments.shiftId, shiftIds), eq(schema.assignments.status, "active")))
    : [];
  const workerIds = [...new Set(assigned.map((a) => a.workerId))];
  const workers = workerIds.length ? await db.select().from(schema.workers).where(inArray(schema.workers.id, workerIds)) : [];

  // First names, unless two rostered people share one.
  const firsts = workers.map((w) => w.name.split(" ")[0]);
  const display = new Map(workers.map((w) => [w.id, firsts.filter((f) => f === w.name.split(" ")[0]).length > 1 ? w.name : w.name.split(" ")[0]]));

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week.weekStart, i);
    return {
      date,
      shifts: shifts
        .filter((s) => s.date === date)
        .map((s) => {
          const here = assigned.filter((a) => a.shiftId === s.id);
          const chips: Chip[] = here.map((a) => ({ workerId: a.workerId, name: display.get(a.workerId) ?? "Staff" }));
          chips.sort((a, b) => Number(b.workerId === viewerId) - Number(a.workerId === viewerId) || a.name.localeCompare(b.name));
          for (let n = here.length; n < s.requiredCount; n++) chips.push({ workerId: null, name: "Open" });
          return { id: s.id, label: s.label, start: s.start, end: s.end, chips, hasViewer: viewerId !== null && here.some((a) => a.workerId === viewerId) };
        }),
    };
  });
  return { businessName: ws.businessName, weekId, weekStart: week.weekStart, viewerId, days };
}

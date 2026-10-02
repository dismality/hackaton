import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PlanStep, PlanStepStatus } from "@/lib/types";
import { getWorkspace, nowDate } from "./context";

export function initialPlan(opts: { realWorkers: number; simWorkers: number; reminderAfterHours: number; maxReminders: number }): PlanStep[] {
  const total = opts.realWorkers + opts.simWorkers;
  return [
    { id: "goal", title: "Understand the goal", detail: "Turn the request into dates, shift counts and rules.", status: "done" },
    {
      id: "approve_send",
      title: "Get approval to message the team",
      detail: `Ask ${total} workers for availability (${opts.realWorkers} on WhatsApp, ${opts.simWorkers} simulated).`,
      status: "in_progress",
      gate: true,
    },
    { id: "collect", title: "Collect availability", detail: "Read free-text replies and confirm what each person said.", status: "pending" },
    {
      id: "chase",
      title: "Chase non-responders",
      detail: `Remind after ${opts.reminderAfterHours}h, up to ${opts.maxReminders} times, then flag to the manager.`,
      status: "pending",
    },
    { id: "solve", title: "Build the roster", detail: "Constraint solver: coverage, skills, hour limits, rest time, fairness.", status: "pending" },
    { id: "approve_publish", title: "Get approval to publish", detail: "Manager reviews the roster, gaps and explanation.", status: "pending", gate: true },
    { id: "publish", title: "Publish", detail: "Send everyone their shifts and update the shared sheet.", status: "pending" },
    { id: "monitor", title: "Handle changes during the week", detail: "Sick calls and drop-outs: find and confirm cover.", status: "pending" },
  ];
}

export async function updatePlan(
  weekId: number,
  updates: { id: string; status?: PlanStepStatus; detail?: string; title?: string; gate?: boolean }[],
): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const [week] = await db.select({ plan: schema.weeks.plan }).from(schema.weeks).where(eq(schema.weeks.id, weekId));
  if (!week) return;
  const plan = [...week.plan];
  const stamp = nowDate(ws).toISOString();
  for (const u of updates) {
    const i = plan.findIndex((s) => s.id === u.id);
    if (i >= 0) {
      plan[i] = { ...plan[i], ...u, updatedAt: stamp } as PlanStep;
    } else {
      plan.push({ title: u.title ?? u.id, detail: u.detail ?? "", status: u.status ?? "pending", gate: u.gate, id: u.id, updatedAt: stamp });
    }
  }
  await db.update(schema.weeks).set({ plan }).where(eq(schema.weeks.id, weekId));
}

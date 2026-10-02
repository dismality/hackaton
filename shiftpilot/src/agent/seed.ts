import { eq, notLike } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { getWorkspace } from "./context";

const DEMO_NAMES = ["Aisha Rahman", "Ben Tan", "Chloe Lim", "Darius Ng", "Elena Koh", "Farid Ismail", "Grace Wong", "Hao Chen", "Isha Menon"];

/** Adds clearly-labelled simulated workers so the roster is realistic with only a few real phones. */
export async function seedSimulatedWorkers(count = 9): Promise<number> {
  const db = getDb();
  const ws = await getWorkspace();
  const existing = await db.select({ name: schema.workers.name }).from(schema.workers).where(eq(schema.workers.simulated, true));
  const taken = new Set(existing.map((e) => e.name));
  const rows = DEMO_NAMES.filter((n) => !taken.has(`${n} (sim)`))
    .slice(0, count)
    .map((name, i) => ({
      name: `${name} (sim)`,
      simulated: true,
      skills: ws.skills.filter((_, j) => (i + j) % 3 !== 2 && (i * 7 + j) % 4 !== 0),
      maxHoursPerWeek: [20, 25, 30][i % 3],
    }));
  if (rows.length) await db.insert(schema.workers).values(rows);
  await audit({ actor: "manager", tool: "manager", action: "workers.seeded", summary: `Added ${rows.length} simulated workers` });
  return rows.length;
}

/** Clears weeks, messages and the audit log. Keeps workers, settings and setup progress. */
export async function resetDemoData(): Promise<void> {
  const db = getDb();
  await db.delete(schema.approvals);
  await db.delete(schema.offers);
  await db.delete(schema.incidents);
  await db.delete(schema.weeks);
  await db.delete(schema.messages);
  await db.delete(schema.auditLog).where(notLike(schema.auditLog.action, "setup.%"));
  await db.update(schema.workspace).set({ clockOffsetMinutes: 0 }).where(eq(schema.workspace.id, 1));
}

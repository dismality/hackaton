import { getDb, schema } from "@/db";
import type { AuditTool } from "@/db/schema";
import { getWorkspace, nowDate } from "./context";

export type AuditEntry = {
  actor: string;
  tool: AuditTool;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
  weekId?: number | null;
  incidentId?: number | null;
};

export async function audit(entry: AuditEntry): Promise<void> {
  const ws = await getWorkspace();
  await getDb()
    .insert(schema.auditLog)
    .values({ ...entry, at: nowDate(ws), weekId: entry.weekId ?? null, incidentId: entry.incidentId ?? null });
}

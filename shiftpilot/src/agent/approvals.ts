import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { getWorkspace, nowDate } from "./context";
import { advanceIncident, sendOffer, type NoCoverOption } from "./cover";
import { updatePlan } from "./plan";
import { publishWeek, startCollection } from "./weekly";

/** Applies the manager's decision. `optionIndex` selects one of the options on a no-cover escalation. */
export async function decideApproval(id: number, approve: boolean, optionIndex?: number): Promise<void> {
  const db = getDb();
  const ws = await getWorkspace();
  const [claimed] = await db
    .update(schema.approvals)
    .set({ status: approve ? "approved" : "rejected", decidedAt: nowDate(ws) })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning();
  if (!claimed) return;

  const option =
    claimed.kind === "no_cover" && optionIndex !== undefined
      ? ((claimed.payload.options as NoCoverOption[] | undefined)?.[optionIndex] ?? null)
      : null;
  const decision = option ? option.label : approve ? "approved" : "rejected";
  await db.update(schema.approvals).set({ decision }).where(eq(schema.approvals.id, id));
  await audit({
    actor: "manager",
    tool: "manager",
    action: `approval.${approve ? "approved" : "rejected"}`,
    summary: `Manager ${option ? `chose "${option.label}"` : approve ? "approved" : "rejected"}: ${claimed.title}`,
    weekId: claimed.weekId,
    incidentId: claimed.incidentId,
  });

  switch (claimed.kind) {
    case "send_availability_requests":
      if (approve) await startCollection(claimed.weekId!);
      else {
        await db.update(schema.weeks).set({ status: "cancelled" }).where(eq(schema.weeks.id, claimed.weekId!));
        await updatePlan(claimed.weekId!, [{ id: "approve_send", status: "skipped", detail: "Manager rejected; week cancelled." }]);
      }
      return;

    case "publish_schedule":
      if (approve) await publishWeek(claimed.weekId!);
      else await updatePlan(claimed.weekId!, [{ id: "approve_publish", status: "blocked", detail: "Manager asked for changes. Edit the roster, then request approval again." }]);
      return;

    case "overtime_offer":
    case "send_offer": {
      const incidentId = claimed.incidentId!;
      if (approve) {
        await sendOffer(incidentId, claimed.payload.workerId as number);
      } else {
        const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId));
        await db.update(schema.incidents).set({ cursor: incident.cursor + 1, status: "offering" }).where(eq(schema.incidents.id, incidentId));
        await advanceIncident(incidentId);
      }
      return;
    }

    case "no_cover": {
      const incidentId = claimed.incidentId!;
      const [incident] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId));
      const done = (detail: string, status: "filled" | "cancelled") =>
        Promise.all([
          db.update(schema.incidents).set({ status, resolvedAt: nowDate(ws) }).where(eq(schema.incidents.id, incidentId)),
          updatePlan(claimed.weekId!, [{ id: `cover-${incidentId}`, status: "done", detail }]),
        ]);
      if (!approve || !option || option.action === "leave_unfilled") return void (await done("Manager chose to run short-staffed.", "cancelled"));
      if (option.action === "manager_covers") return void (await done("Manager is covering the shift.", "filled"));
      if (option.action === "offer_to_worker" && option.workerId) return sendOffer(incidentId, option.workerId);
      await db.update(schema.incidents).set({ status: "offering", cursor: 0 }).where(eq(schema.incidents.id, incident.id));
      await advanceIncident(incidentId);
      return;
    }
  }
}

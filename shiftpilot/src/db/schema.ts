import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Baselines,
  PlanStep,
  RankedCandidate,
  Rules,
  ShiftTemplate,
  WeekConstraints,
  WeekStatus,
} from "@/lib/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const workspace = pgTable("workspace", {
  id: integer("id").primaryKey(),
  businessName: text("business_name").notNull(),
  presetKey: text("preset_key").notNull(),
  timezone: text("timezone").notNull(),
  skills: jsonb("skills").$type<string[]>().notNull(),
  shiftTemplates: jsonb("shift_templates").$type<ShiftTemplate[]>().notNull(),
  rules: jsonb("rules").$type<Rules>().notNull(),
  baselines: jsonb("baselines").$type<Baselines>().notNull(),
  autoOfferReplacements: boolean("auto_offer_replacements").notNull().default(true),
  clockOffsetMinutes: integer("clock_offset_minutes").notNull().default(0),
});

export const workers = pgTable("workers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  maxHoursPerWeek: integer("max_hours_per_week"),
  simulated: boolean("simulated").notNull().default(false),
  active: boolean("active").notNull().default(true),
  /** Real (wall-clock) time of the last inbound WhatsApp message; drives Meta's 24-hour window. */
  lastInboundAt: ts("last_inbound_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const weeks = pgTable("weeks", {
  id: serial("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  goal: text("goal").notNull(),
  constraints: jsonb("constraints").$type<WeekConstraints>().notNull().default({}),
  assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
  plan: jsonb("plan").$type<PlanStep[]>().notNull().default([]),
  status: text("status").$type<WeekStatus>().notNull(),
  summary: text("summary"),
  collectionStartedAt: ts("collection_started_at"),
  publishedAt: ts("published_at"),
  createdAt: ts("created_at").notNull(),
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  templateKey: text("template_key").notNull(),
  label: text("label").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  requiredCount: integer("required_count").notNull(),
  requiredSkills: jsonb("required_skills").$type<string[]>().notNull().default([]),
});

export const availability = pgTable(
  "availability",
  {
    id: serial("id").primaryKey(),
    weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
    workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
    shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    status: text("status").$type<"yes" | "no" | "unsure">().notNull(),
    source: text("source").$type<"message" | "manual" | "simulated" | "button">().notNull(),
    confidence: real("confidence"),
    messageId: integer("message_id"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("availability_worker_shift").on(t.workerId, t.shiftId)],
);

export const availabilityRequests = pgTable(
  "availability_requests",
  {
    id: serial("id").primaryKey(),
    weekId: integer("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
    workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
    status: text("status").$type<"sent" | "responded" | "no_response">().notNull(),
    sentAt: ts("sent_at").notNull(),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastNudgeAt: ts("last_nudge_at"),
    respondedAt: ts("responded_at"),
  },
  (t) => [uniqueIndex("request_week_worker").on(t.weekId, t.workerId)],
);

export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  status: text("status").$type<"active" | "released">().notNull(),
  source: text("source").$type<"solver" | "replacement" | "manual">().notNull(),
  reason: text("reason"),
  createdAt: ts("created_at").notNull(),
  releasedAt: ts("released_at"),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  shiftId: integer("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  assignmentId: integer("assignment_id"),
  kind: text("kind").$type<"sick" | "unavailable">().notNull(),
  /** True when the report contained health details. Those details are never shown to other workers. */
  sensitive: boolean("sensitive").notNull().default(false),
  status: text("status")
    .$type<"offering" | "awaiting_approval" | "filled" | "unfilled" | "cancelled">()
    .notNull(),
  candidates: jsonb("candidates").$type<RankedCandidate[]>().notNull().default([]),
  cursor: integer("cursor").notNull().default(0),
  filledByWorkerId: integer("filled_by_worker_id"),
  reportedAt: ts("reported_at").notNull(),
  resolvedAt: ts("resolved_at"),
});

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "accepted" | "declined" | "expired" | "cancelled">().notNull(),
  sentAt: ts("sent_at").notNull(),
  respondedAt: ts("responded_at"),
});

export type ApprovalKind = "send_availability_requests" | "publish_schedule" | "overtime_offer" | "send_offer" | "no_cover";

export const approvals = pgTable("approvals", {
  id: serial("id").primaryKey(),
  kind: text("kind").$type<ApprovalKind>().notNull(),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  weekId: integer("week_id"),
  incidentId: integer("incident_id"),
  createdAt: ts("created_at").notNull(),
  decidedAt: ts("decided_at"),
  decision: text("decision"),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    workerId: integer("worker_id"),
    phone: text("phone"),
    body: text("body").notNull(),
    kind: text("kind").$type<"text" | "buttons" | "image" | "template" | "button_reply">().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    waMessageId: text("wa_message_id"),
    status: text("status")
      .$type<"received" | "simulated" | "awaiting_window" | "sent" | "delivered" | "read" | "failed">()
      .notNull(),
    error: text("error"),
    understanding: jsonb("understanding").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("messages_wa_id").on(t.waMessageId)],
);

export type AuditTool = "whatsapp" | "jev" | "llm" | "solver" | "ranking" | "sheets" | "policy" | "manager" | "clock";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: ts("at").notNull(),
  actor: text("actor").notNull(),
  tool: text("tool").$type<AuditTool>().notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  weekId: integer("week_id"),
  incidentId: integer("incident_id"),
});

export type Workspace = typeof workspace.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type Week = typeof weeks.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Message = typeof messages.$inferSelect;

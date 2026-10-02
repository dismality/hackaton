export type ShiftTemplate = {
  key: string;
  label: string;
  start: string; // "HH:MM" local time
  end: string; // "HH:MM"; earlier than start means it ends the next day
  days: number[]; // 0 = Monday … 6 = Sunday
  requiredCount: number;
  requiredSkills: string[];
};

export type Rules = {
  maxHoursPerWeek: number;
  minRestHours: number;
  maxShiftsPerDay: number;
  reminderAfterHours: number;
  maxReminders: number;
  availabilityDeadlineHours: number;
  offerTimeoutMinutes: number;
};

export type Baselines = {
  minutesPerMessageSent: number;
  minutesPerReplyRead: number;
  minutesToBuildRoster: number;
  minutesPerCoverCall: number;
  minutesPerApproval: number;
};

export type CountOverride = {
  templateKey: string;
  /** 0 = Monday … 6 = Sunday; omitted means every day the shift runs */
  days?: number[];
  requiredCount: number;
};

export type WeekConstraints = {
  countOverrides?: CountOverride[];
  maxHoursPerWeek?: number;
  closedDays?: number[];
  notes?: string;
};

export type PlanStepStatus = "pending" | "in_progress" | "done" | "blocked" | "skipped";

export type PlanStep = {
  id: string;
  title: string;
  detail: string;
  status: PlanStepStatus;
  gate?: boolean;
  updatedAt?: string;
};

export type WeekStatus =
  | "awaiting_send_approval"
  | "collecting"
  | "solving"
  | "awaiting_publish"
  | "published"
  | "cancelled";

export type RankedCandidate = {
  workerId: number;
  name: string;
  score: number;
  declared: "yes" | "unknown";
  hoursBefore: number;
  hoursAfter: number;
  overtime: boolean;
  reasons: string[];
};

export type OutgoingMessage =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  /** A PNG with a caption. `previewUrl` lets the dashboard show the same image in the message log. */
  | { kind: "image"; caption: string; png: Uint8Array; previewUrl: string };

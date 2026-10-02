import type { Baselines, Rules, ShiftTemplate } from "./types";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

export type BusinessPreset = {
  key: string;
  name: string;
  description: string;
  skills: string[];
  shiftTemplates: ShiftTemplate[];
  rules: Partial<Rules>;
};

export const DEFAULT_RULES: Rules = {
  maxHoursPerWeek: 30,
  minRestHours: 10,
  maxShiftsPerDay: 1,
  reminderAfterHours: 12,
  maxReminders: 2,
  availabilityDeadlineHours: 48,
  offerTimeoutMinutes: 60,
};

export const DEFAULT_BASELINES: Baselines = {
  minutesPerMessageSent: 1.5,
  minutesPerReplyRead: 1,
  minutesToBuildRoster: 45,
  minutesPerCoverCall: 4,
  minutesPerApproval: 0.5,
};

export const PRESETS: BusinessPreset[] = [
  {
    key: "cafe",
    name: "Café / F&B",
    description: "Opening, lunch-rush and closing shifts. Every opening shift needs a trained opener.",
    skills: ["opener", "barista", "cashier"],
    shiftTemplates: [
      { key: "open", label: "Opening", start: "07:00", end: "12:00", days: ALL_DAYS, requiredCount: 2, requiredSkills: ["opener"] },
      { key: "mid", label: "Lunch rush", start: "11:00", end: "16:00", days: ALL_DAYS, requiredCount: 2, requiredSkills: [] },
      { key: "close", label: "Closing", start: "16:00", end: "21:00", days: ALL_DAYS, requiredCount: 2, requiredSkills: ["barista"] },
    ],
    rules: {},
  },
  {
    key: "retail",
    name: "Retail store",
    description: "Morning and evening floor shifts with a cashier on every shift; busier weekends.",
    skills: ["cashier", "stockroom", "keyholder"],
    shiftTemplates: [
      { key: "am", label: "Morning", start: "10:00", end: "15:00", days: WEEKDAYS, requiredCount: 2, requiredSkills: ["keyholder"] },
      { key: "pm", label: "Evening", start: "15:00", end: "22:00", days: WEEKDAYS, requiredCount: 2, requiredSkills: ["cashier"] },
      { key: "wk_am", label: "Weekend morning", start: "10:00", end: "16:00", days: WEEKEND, requiredCount: 3, requiredSkills: ["keyholder"] },
      { key: "wk_pm", label: "Weekend evening", start: "16:00", end: "22:00", days: WEEKEND, requiredCount: 3, requiredSkills: ["cashier"] },
    ],
    rules: { maxHoursPerWeek: 28 },
  },
  {
    key: "tuition",
    name: "Tuition / enrichment centre",
    description: "After-school and weekend teaching slots; each slot needs a subject-qualified tutor.",
    skills: ["math", "science", "english"],
    shiftTemplates: [
      { key: "after_school", label: "After school", start: "15:00", end: "19:00", days: WEEKDAYS, requiredCount: 2, requiredSkills: ["math"] },
      { key: "evening", label: "Evening", start: "19:00", end: "21:30", days: WEEKDAYS, requiredCount: 1, requiredSkills: [] },
      { key: "weekend", label: "Weekend", start: "09:00", end: "13:00", days: WEEKEND, requiredCount: 3, requiredSkills: ["science"] },
    ],
    rules: { maxHoursPerWeek: 20, minRestHours: 0 },
  },
  {
    key: "warehouse",
    name: "Warehouse / events crew",
    description: "Day and night crews, including an overnight shift; forklift-licensed staff on every crew.",
    skills: ["forklift", "supervisor"],
    shiftTemplates: [
      { key: "day", label: "Day crew", start: "08:00", end: "16:00", days: WEEKDAYS, requiredCount: 3, requiredSkills: ["forklift"] },
      { key: "night", label: "Night crew", start: "22:00", end: "06:00", days: [0, 2, 4], requiredCount: 2, requiredSkills: ["supervisor"] },
    ],
    rules: { maxHoursPerWeek: 36, minRestHours: 12 },
  },
];

export function getPreset(key: string): BusinessPreset {
  return PRESETS.find((p) => p.key === key) ?? PRESETS[0];
}

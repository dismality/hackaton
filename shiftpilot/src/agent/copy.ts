import type { Shift } from "@/db/schema";
import { DAY_SHORT, formatDate, weekdayIndex } from "@/lib/time";
import type { OutgoingMessage, ShiftTemplate } from "@/lib/types";
import { shiftLabel } from "./context";

const first = (name: string) => name.split(" ")[0];

function templateLine(t: ShiftTemplate): string {
  const days =
    t.days.length === 7 ? "daily" : t.days.map((d) => DAY_SHORT[d]).join("/");
  return `• ${t.label} ${t.start}–${t.end} (${days})`;
}

export const connected = (name: string, business: string): OutgoingMessage => ({
  kind: "text",
  body: `You are now connected! ✅\n\nHi ${first(name)}, I'm ${business}'s scheduling assistant. I'll message you here when it's time to share your availability, and you can tell me any time if you can't make a shift.`,
});

export function availabilityRequest(name: string, business: string, weekStart: string, templates: ShiftTemplate[]): OutgoingMessage {
  return {
    kind: "text",
    body:
      `Hi ${first(name)}! ${business} is planning the roster for the week of ${formatDate(weekStart)}.\n\n` +
      `Which shifts can you work?\n${templates.map(templateLine).join("\n")}\n\n` +
      `Just reply in your own words, e.g. "Mon–Wed mornings, not Friday, anything on the weekend" or "can't work that week".`,
  };
}

export function availabilityReminder(name: string, weekStart: string, attempt: number): OutgoingMessage {
  const lead = attempt > 1 ? "Last reminder" : "Quick reminder";
  return {
    kind: "text",
    body: `${lead}, ${first(name)}: I still need your availability for the week of ${formatDate(weekStart)}. Reply with the days or shifts you can do, or "none" if you can't work that week.`,
  };
}

function groupByLabel(shifts: Shift[]): string {
  const groups = new Map<string, string[]>();
  for (const s of shifts) {
    const key = `${s.label} ${s.start}–${s.end}`;
    groups.set(key, [...(groups.get(key) ?? []), DAY_SHORT[weekdayIndex(s.date)]]);
  }
  return [...groups].map(([k, days]) => `• ${k}: ${days.join(", ")}`).join("\n");
}

export function availabilityEcho(name: string, yes: Shift[], unsure: Shift[]): OutgoingMessage {
  let body = `Thanks ${first(name)}! `;
  body += yes.length ? `I've got you down as available for:\n${groupByLabel(yes)}` : "I've noted that you can't work any shifts that week.";
  if (unsure.length) body += `\n\nI wasn't sure about:\n${groupByLabel(unsure)}\nCan you tell me if you can do those?`;
  body += `\n\nReply any time before the roster is published to change this.`;
  return { kind: "text", body };
}

export function rosterPublished(name: string, weekStart: string, shifts: Shift[]): OutgoingMessage {
  if (!shifts.length)
    return {
      kind: "text",
      body: `Hi ${first(name)}, the roster for the week of ${formatDate(weekStart)} is out. You're not scheduled that week. Thanks for sending your availability!`,
    };
  return {
    kind: "text",
    body:
      `Hi ${first(name)}, your shifts for the week of ${formatDate(weekStart)}:\n` +
      shifts.map((s) => `• ${shiftLabel(s)}`).join("\n") +
      `\n\nIf something comes up (e.g. you're sick), just message me here and I'll find cover.`,
  };
}

export function unavailableAck(shift: Shift, sick: boolean): OutgoingMessage {
  return {
    kind: "text",
    body:
      (sick ? "Thanks for letting me know, and take care. " : "Thanks for letting me know. ") +
      `I've taken you off ${shiftLabel(shift)} and I'm finding cover now. You don't need to do anything else.`,
  };
}

/** Shift offers never mention who dropped the shift or why. */
export function shiftOffer(name: string, shift: Shift, hours: number, offerId: number): OutgoingMessage {
  return {
    kind: "buttons",
    body: `Hi ${first(name)}, a shift has opened up: ${shiftLabel(shift)} (${hours}h). Can you take it?`,
    buttons: [
      { id: `offer:accept:${offerId}`, title: "Yes, I'll take it" },
      { id: `offer:decline:${offerId}`, title: "No, can't" },
    ],
  };
}

export const offerConfirmed = (shift: Shift): OutgoingMessage => ({
  kind: "text",
  body: `You're confirmed for ${shiftLabel(shift)}. Thank you!`,
});

export const offerAlreadyFilled = (): OutgoingMessage => ({
  kind: "text",
  body: "Thanks! That shift has already been covered, so no action needed.",
});

export const offerDeclinedAck = (): OutgoingMessage => ({
  kind: "text",
  body: "No worries, thanks for replying!",
});

export const offerClash = (reason: string): OutgoingMessage => ({
  kind: "text",
  body: `Thanks! Unfortunately I can't give you that shift because it ${reason}. I'll ask someone else.`,
});

export const coverFound = (shift: Shift, sick: boolean): OutgoingMessage => ({
  kind: "text",
  body: `Update: ${shiftLabel(shift)} is now covered.${sick ? " Get well soon!" : ""}`,
});

export function pickShift(shifts: { assignmentId: number; shift: Shift }[], sick: boolean): OutgoingMessage {
  return {
    kind: "buttons",
    body: "Sorry to hear that. Which shift can't you make?",
    buttons: shifts.slice(0, 3).map(({ assignmentId, shift }) => ({
      id: `cant:${assignmentId}:${sick ? "s" : "u"}`,
      title: `${formatDate(shift.date)} ${shift.label}`.slice(0, 20),
    })),
  };
}

export function clarifyIntent(hasOffer: boolean): OutgoingMessage {
  const buttons = [
    { id: "clarify:availability", title: "My availability" },
    { id: "clarify:cannot_work", title: "Can't make a shift" },
  ];
  if (hasOffer) buttons.push({ id: "clarify:offer", title: "The open shift" });
  return { kind: "buttons", body: "Sorry, I didn't quite get that. What is your message about?", buttons };
}

export const noUpcomingShifts = (): OutgoingMessage => ({
  kind: "text",
  body: "I can't find any upcoming shifts for you. If it's urgent, please contact your manager directly.",
});

export const noOpenRequest = (): OutgoingMessage => ({
  kind: "text",
  body: "Thanks! I'm not collecting availability right now. I'll message you when the next roster opens.",
});

export const rosterClosed = (): OutgoingMessage => ({
  kind: "text",
  body: "Thanks! That roster is already being finalised, so I've passed your update to the manager.",
});

export const noOpenOffer = (): OutgoingMessage => ({
  kind: "text",
  body: "Thanks! There's no open shift waiting for your answer right now.",
});

export function questionAck(upcoming: Shift[]): OutgoingMessage {
  const list = upcoming.length ? `\n\nYour upcoming shifts:\n${upcoming.map((s) => `• ${shiftLabel(s)}`).join("\n")}` : "";
  return { kind: "text", body: `Good question. I've passed it to the manager, who will get back to you.${list}` };
}

export const genericAck = (): OutgoingMessage => ({
  kind: "text",
  body: "Thanks! Message me any time to update your availability or if you can't make a shift.",
});

export const unsupportedMessage = (): OutgoingMessage => ({
  kind: "text",
  body: "Sorry, I can only read text messages for now. Please type your reply.",
});

export const unknownSender = (business: string): OutgoingMessage => ({
  kind: "text",
  body: `Hi! This number handles staff scheduling for ${business}, and I don't have you on the team list. Please ask your manager to add you.`,
});

export function scheduleCaption(name: string, weekStart: string, upcoming: Shift[]): string {
  const mine = upcoming.length
    ? `Your upcoming shifts:\n${upcoming.map((s) => `• ${shiftLabel(s)}`).join("\n")}`
    : "You're not scheduled on this roster.";
  return `Hi ${first(name)}, here's the roster for the week of ${formatDate(weekStart)}. Your shifts are in green, and you can see who you're working with.\n\n${mine}`.slice(0, 1000);
}

export const noPublishedRoster = (): OutgoingMessage => ({
  kind: "text",
  body: "There's no published roster yet. I'll message you as soon as the next one is out.",
});

export function toPlainText(msg: OutgoingMessage): string {
  if (msg.kind === "text") return msg.body;
  if (msg.kind === "image") return msg.caption;
  return `${msg.body}\n${msg.buttons.map((b) => `[${b.title}]`).join(" ")}`;
}

export { formatDate };

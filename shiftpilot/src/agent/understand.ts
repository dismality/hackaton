import { z } from "zod";
import { askJev, choice, noul, type JevChoice, type JevNoul, type JevQuestion } from "@/integrations/jev";
import { llmJson } from "@/integrations/llm";
import { env, integrations } from "@/lib/env";
import { audit } from "./audit";

/** Confidence and probability cut-offs. Kept together so they can be tuned in one place. */
export const THRESHOLDS = {
  intentConfidence: 0.6,
  shiftChoiceConfidence: 0.6,
  availableYes: 0.7,
  availableNo: 0.3,
  health: 0.5,
};

export const INTENTS = ["availability", "cannot_work", "ask_schedule", "accept_offer", "decline_offer", "question", "other"] as const;
export type Intent = (typeof INTENTS)[number];

export type IntentResult = {
  intent: Intent | "unclear";
  confidence: number;
  mentionsHealth: boolean;
  via: "jev" | "llm" | "jev+llm" | "none";
  probabilities?: Record<string, number>;
};

const INTENT_CRITERIA: Record<Intent, string> = {
  availability: "Telling us which days or shifts they can or cannot work in an upcoming week, or saying they can't work that week at all.",
  cannot_work: "Saying they cannot come in for a shift they are already scheduled for, because they are sick, have an emergency or have a clash.",
  ask_schedule: "Asking to see or be reminded of their shifts or the roster: when they work, what the schedule is, who else is on shift, or asking for the schedule.",
  accept_offer: "Agreeing to take the open shift listed in `context.open_shift_offered_to_them`.",
  decline_offer: "Turning down the open shift listed in `context.open_shift_offered_to_them`.",
  question: "Asking a question about the job, pay or anything else the manager must answer (not simply asking to see the schedule).",
  other: "A greeting, a thank-you, or anything that is none of the above.",
};

type IntentCtx = {
  message: string;
  awaitingAvailability: boolean;
  openOffer: string | null;
  upcomingShifts: string[];
  weekId?: number | null;
  workerName: string;
};

const jevEnabled = () => integrations.openrouter && env.understandingMode !== "llm";
const llmEnabled = () => integrations.openrouter && env.understandingMode !== "jev";

async function jevCall(
  purpose: string,
  state: unknown,
  questions: Record<string, JevQuestion>,
  weekId?: number | null,
) {
  try {
    const res = await askJev(state, questions);
    return res;
  } catch (e) {
    await audit({ actor: "agent", tool: "jev", action: "jev.error", summary: `Jev failed while ${purpose}: ${(e as Error).message}`, weekId });
    return null;
  }
}

export async function classifyIntent(ctx: IntentCtx): Promise<IntentResult> {
  let result: IntentResult = { intent: "unclear", confidence: 0, mentionsHealth: false, via: "none" };

  if (jevEnabled()) {
    const res = await jevCall(
      "classifying a message",
      {
        message: ctx.message,
        context: {
          we_asked_them_for_availability: ctx.awaitingAvailability ? "yes" : "no",
          open_shift_offered_to_them: ctx.openOffer ?? "none",
          their_upcoming_shifts: ctx.upcomingShifts.length ? ctx.upcomingShifts : ["none"],
        },
      },
      {
        intent: choice(
          "What is the part-time worker doing in `message`? Use `context` to interpret short replies such as 'yes', 'ok' or 'can't'.",
          INTENT_CRITERIA,
        ),
        mentions_health: noul("Does `message` mention illness, injury, a medical appointment or another health reason?"),
      },
      ctx.weekId,
    );
    if (res) {
      const intent = res.answers.intent as JevChoice;
      const health = res.answers.mentions_health as JevNoul;
      result = {
        intent: intent.choice as Intent,
        confidence: intent.confidence,
        mentionsHealth: health.noul >= THRESHOLDS.health,
        via: "jev",
        probabilities: intent.probabilities,
      };
      await audit({
        actor: "agent",
        tool: "jev",
        action: "jev.intent",
        summary: `Read ${ctx.workerName}'s message as "${intent.choice}" (confidence ${intent.confidence.toFixed(2)})`,
        details: { probabilities: intent.probabilities, health: health.noul, model: res.model, cost: res.usage?.cost },
        weekId: ctx.weekId,
      });
    }
  }

  const offerIntent = result.intent === "accept_offer" || result.intent === "decline_offer";
  const needsSecondOpinion =
    result.via === "none" || result.confidence < THRESHOLDS.intentConfidence || (offerIntent && !ctx.openOffer);

  if (needsSecondOpinion && llmEnabled()) {
    try {
      const { data } = await llmJson({
        name: "intent",
        schema: z.object({
          intent: z.enum([...INTENTS, "unclear"]),
          confidence: z.number().min(0).max(1),
          mentions_health: z.boolean(),
        }),
        system:
          "You classify WhatsApp messages from part-time staff to a scheduling assistant. " +
          `Intents: ${Object.entries(INTENT_CRITERIA).map(([k, v]) => `${k}: ${v}`).join(" ")} ` +
          "Use 'unclear' if you genuinely cannot tell. accept_offer/decline_offer only apply if an open shift was offered.",
        user: JSON.stringify({
          message: ctx.message,
          we_asked_them_for_availability: ctx.awaitingAvailability,
          open_shift_offered_to_them: ctx.openOffer ?? "none",
          their_upcoming_shifts: ctx.upcomingShifts,
        }),
        effort: "none",
      });
      const prior = result;
      result = {
        intent: data.intent,
        confidence: data.confidence,
        mentionsHealth: data.mentions_health || prior.mentionsHealth,
        via: prior.via === "jev" ? "jev+llm" : "llm",
        probabilities: prior.probabilities,
      };
      await audit({
        actor: "agent",
        tool: "llm",
        action: "llm.intent",
        summary: `Second opinion: "${data.intent}" (confidence ${data.confidence.toFixed(2)})${prior.via === "jev" ? `; Jev said "${prior.intent}" at ${prior.confidence.toFixed(2)}` : ""}`,
        weekId: ctx.weekId,
      });
    } catch (e) {
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `LLM intent check failed: ${(e as Error).message}`, weekId: ctx.weekId });
    }
  }

  if (result.confidence < THRESHOLDS.intentConfidence * 0.8) result.intent = "unclear";
  if ((result.intent === "accept_offer" || result.intent === "decline_offer") && !ctx.openOffer) result.intent = "unclear";
  return result;
}

export type AvailabilityExtraction = {
  byShift: Map<number, { status: "yes" | "no" | "unsure"; p: number | null }>;
  via: IntentResult["via"];
};

export async function extractAvailability(
  message: string,
  shifts: { id: number; label: string }[],
  meta: { workerName: string; weekLabel: string; weekId: number },
): Promise<AvailabilityExtraction> {
  const byShift: AvailabilityExtraction["byShift"] = new Map(shifts.map((s) => [s.id, { status: "unsure" as const, p: null }]));
  let via: IntentResult["via"] = "none";

  if (jevEnabled()) {
    const questions: Record<string, JevQuestion> = {};
    for (const s of shifts) {
      questions[`s${s.id}`] = noul(`Based on \`message\`, can the worker work this shift: ${s.label}?`, {
        true: "The message says or clearly implies they can work this day and time.",
        false: "The message says they can't, excludes this day or time, or doesn't include it in what they offered.",
      });
    }
    const res = await jevCall("reading availability", { message, week: meta.weekLabel }, questions, meta.weekId);
    if (res) {
      via = "jev";
      for (const s of shifts) {
        const p = (res.answers[`s${s.id}`] as JevNoul | undefined)?.noul;
        if (p === undefined) continue;
        const status = p >= THRESHOLDS.availableYes ? "yes" : p <= THRESHOLDS.availableNo ? "no" : "unsure";
        byShift.set(s.id, { status, p });
      }
      const counts = countStatuses(byShift);
      await audit({
        actor: "agent",
        tool: "jev",
        action: "jev.availability",
        summary: `Read ${meta.workerName}'s availability: ${counts.yes} yes, ${counts.no} no, ${counts.unsure} unsure`,
        details: { probabilities: Object.fromEntries([...byShift].map(([id, v]) => [id, v.p])), cost: res.usage?.cost, model: res.model },
        weekId: meta.weekId,
      });
    }
  }

  const unsureIds = [...byShift].filter(([, v]) => v.status === "unsure").map(([id]) => id);
  if (unsureIds.length && llmEnabled()) {
    try {
      const { data } = await llmJson({
        name: "availability",
        schema: z.object({
          shifts: z.array(z.object({ id: z.number().int(), status: z.enum(["yes", "no", "unsure"]) })),
        }),
        system:
          "You read a part-time worker's availability message and decide, for each shift, whether they can work it. " +
          "'yes' only if the message says or clearly implies they can. 'no' if they excluded it or didn't offer it. " +
          "'unsure' only if the message is genuinely ambiguous about that shift (e.g. 'maybe Friday').",
        user: JSON.stringify({
          message,
          week: meta.weekLabel,
          shifts: shifts.filter((s) => unsureIds.includes(s.id)),
        }),
        effort: "low",
      });
      for (const r of data.shifts) {
        if (unsureIds.includes(r.id)) byShift.set(r.id, { status: r.status, p: byShift.get(r.id)?.p ?? null });
      }
      via = via === "jev" ? "jev+llm" : "llm";
      const counts = countStatuses(byShift);
      await audit({
        actor: "agent",
        tool: "llm",
        action: "llm.availability",
        summary: `Resolved ${unsureIds.length} uncertain shift(s) for ${meta.workerName}; now ${counts.yes} yes, ${counts.no} no, ${counts.unsure} unsure`,
        weekId: meta.weekId,
      });
    } catch (e) {
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `LLM availability check failed: ${(e as Error).message}`, weekId: meta.weekId });
    }
  }
  return { byShift, via };
}

export function countStatuses(map: AvailabilityExtraction["byShift"]) {
  const c = { yes: 0, no: 0, unsure: 0 };
  for (const v of map.values()) c[v.status]++;
  return c;
}

/** Works out which scheduled shift a "can't make it" message refers to. Returns null if unclear. */
export async function resolveAffectedShift(
  message: string,
  candidates: { assignmentId: number; label: string }[],
  meta: { workerName: string; weekId?: number | null },
): Promise<{ assignmentId: number; confidence: number } | null> {
  if (!candidates.length) return null;
  const criteria: Record<string, string> = Object.fromEntries(candidates.map((c) => [`a${c.assignmentId}`, c.label]));
  criteria.none = "None of these, or it isn't clear which shift they mean.";

  if (jevEnabled()) {
    const res = await jevCall(
      "matching a shift",
      { message, their_upcoming_shifts: candidates.map((c) => c.label) },
      { shift: choice("Which of their scheduled shifts does `message` say they cannot make?", criteria) },
      meta.weekId,
    );
    if (res) {
      const a = res.answers.shift as JevChoice;
      await audit({
        actor: "agent",
        tool: "jev",
        action: "jev.shift_match",
        summary: `Matched ${meta.workerName}'s message to ${a.choice === "none" ? "no specific shift" : criteria[a.choice]} (confidence ${a.confidence.toFixed(2)})`,
        details: { probabilities: a.probabilities, cost: res.usage?.cost },
        weekId: meta.weekId,
      });
      if (a.choice !== "none" && a.confidence >= THRESHOLDS.shiftChoiceConfidence)
        return { assignmentId: Number(a.choice.slice(1)), confidence: a.confidence };
    }
  }

  if (llmEnabled()) {
    try {
      const { data } = await llmJson({
        name: "shift_match",
        schema: z.object({ choice: z.string(), confidence: z.number().min(0).max(1) }),
        system: "Pick which scheduled shift the worker says they can't make. Reply with one of the option keys, or 'none' if unclear.",
        user: JSON.stringify({ message, options: criteria }),
        effort: "none",
      });
      if (data.choice !== "none" && criteria[data.choice] && data.confidence >= THRESHOLDS.shiftChoiceConfidence) {
        await audit({ actor: "agent", tool: "llm", action: "llm.shift_match", summary: `Second opinion matched ${criteria[data.choice]} (confidence ${data.confidence.toFixed(2)})`, weekId: meta.weekId });
        return { assignmentId: Number(data.choice.slice(1)), confidence: data.confidence };
      }
    } catch (e) {
      await audit({ actor: "agent", tool: "llm", action: "llm.error", summary: `LLM shift match failed: ${(e as Error).message}`, weekId: meta.weekId });
    }
  }
  return null;
}

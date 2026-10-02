import { env } from "@/lib/env";

/** Typed questions for TypeSafe's Jev decision model, called through OpenRouter's Decisions API. */
export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevNoul = { type: "noul"; noul: number };
export type JevChoice = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type JevScore = { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };
export type JevAnswer = JevNoul | JevChoice | JevScore;

export type JevResponse = {
  id?: string;
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; cost?: number };
};

export const noul = (instructions: string, criteria?: { true?: string; false?: string }): JevQuestion => ({
  type: "noul",
  instructions,
  ...(criteria ? { criteria } : {}),
});

export const choice = (instructions: string, criteria: Record<string, string>): JevQuestion => ({
  type: "choice",
  instructions,
  criteria,
});

export class JevError extends Error {}

export async function askJev(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
  if (!env.openrouterKey) throw new JevError("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterKey}`,
      "Content-Type": "application/json",
      "X-Title": "ShiftPilot",
    },
    body: JSON.stringify({ model: env.jevModel, state, questions }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JevError(`Jev ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as JevResponse;
  if (!json.answers) throw new JevError("Jev returned no answers");
  return json;
}

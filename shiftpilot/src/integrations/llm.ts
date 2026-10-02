import { z } from "zod";
import { env } from "@/lib/env";

export class LlmError extends Error {}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Calls the chat model on OpenRouter and returns JSON validated against `schema`. */
export async function llmJson<T extends z.ZodType>(opts: {
  name: string;
  schema: T;
  system: string;
  user: string;
  effort?: "none" | "low" | "medium" | "high";
}): Promise<{ data: z.infer<T>; model: string; cost?: number }> {
  if (!env.openrouterKey) throw new LlmError("OPENROUTER_API_KEY is not set");
  const messages: ChatMessage[] = [
    { role: "system", content: `${opts.system}\nRespond with a single JSON object that matches the provided schema.` },
    { role: "user", content: opts.user },
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterKey}`,
      "Content-Type": "application/json",
      "X-Title": "ShiftPilot",
    },
    body: JSON.stringify({
      model: env.llmModel,
      messages,
      reasoning: { effort: opts.effort ?? "low" },
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.name, strict: false, schema: z.toJSONSchema(opts.schema) },
      },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) throw new LlmError("LLM returned an empty response");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new LlmError(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) throw new LlmError(`LLM output failed validation: ${result.error.message.slice(0, 300)}`);
  return { data: result.data, model: json.model ?? env.llmModel, cost: json.usage?.cost };
}

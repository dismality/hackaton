export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const g = globalThis as unknown as { __shiftpilotTimer?: ReturnType<typeof setInterval> };
  if (g.__shiftpilotTimer) return;
  const { runTick } = await import("./agent/tick");
  const seconds = Number(process.env.AGENT_TICK_SECONDS ?? 30);
  g.__shiftpilotTimer = setInterval(() => {
    runTick().catch((e) => console.error("[agent tick]", e));
  }, seconds * 1000);
}

import { runTick } from "@/agent/tick";

export async function POST() {
  const result = await runTick();
  return Response.json(result);
}

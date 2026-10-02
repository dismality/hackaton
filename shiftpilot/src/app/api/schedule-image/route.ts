import { NextResponse, type NextRequest } from "next/server";
import { buildScheduleView, renderScheduleImage } from "@/agent/schedule-image";

/** Preview of the roster image the bot sends. Behind the dashboard password like every non-webhook route. */
export async function GET(request: NextRequest) {
  const weekId = Number(request.nextUrl.searchParams.get("week"));
  const workerParam = request.nextUrl.searchParams.get("worker");
  if (!Number.isInteger(weekId) || weekId <= 0) return new NextResponse("Missing week", { status: 400 });
  const view = await buildScheduleView(weekId, workerParam ? Number(workerParam) || null : null);
  if (!view) return new NextResponse("Week not found", { status: 404 });
  const png = await renderScheduleImage(view);
  return new NextResponse(png as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

import { ImageResponse } from "next/og";
import { addDays, DAY_SHORT, formatDate, weekdayIndex } from "@/lib/time";
import type { Chip, ScheduleView } from "./schedule-image";

const WIDTH = 1000;
const CHIPS_WIDTH = 590;
const chipWidth = (name: string) => Math.round(name.length * 16 + 40 + 10);

function chipLines(chips: Chip[]): number {
  let lines = 1;
  let used = 0;
  for (const c of chips) {
    const w = chipWidth(c.name + (c.workerId ? " (you)" : ""));
    if (used + w > CHIPS_WIDTH && used > 0) {
      lines++;
      used = 0;
    }
    used += w;
  }
  return lines;
}

const shiftHeight = (chips: Chip[]) => Math.max(66, chipLines(chips) * 50);
const dayHeight = (d: ScheduleView["days"][number]) =>
  (d.shifts.length ? d.shifts.reduce((sum, s) => sum + shiftHeight(s.chips), 0) + (d.shifts.length - 1) * 12 : 56) + 32;

/** Renders the roster for a week as a PNG. Shifts belonging to `view.viewerId` are highlighted. */
export async function renderScheduleImage(view: ScheduleView): Promise<Uint8Array> {
  const GREEN = "#047857";
  const height = 44 + 118 + view.days.reduce((sum, d) => sum + dayHeight(d) + 12, 0) + 64;
  const weekEnd = addDays(view.weekStart, 6);

  const image = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: WIDTH,
          height,
          background: "#f8fafc",
          padding: "44px 40px 0 40px",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: 118 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#0f172a" }}>{view.businessName}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#475569", marginTop: 8 }}>
            {`Roster · ${formatDate(view.weekStart)} – ${formatDate(weekEnd)}`}
          </div>
          {view.viewerId !== null && (
            <div style={{ display: "flex", fontSize: 22, color: GREEN, marginTop: 6 }}>Your shifts are highlighted in green</div>
          )}
        </div>

        {view.days.map((d) => {
          const mine = d.shifts.some((s) => s.hasViewer);
          return (
            <div
              key={d.date}
              style={{
                display: "flex",
                width: "100%",
                height: dayHeight(d),
                marginBottom: 12,
                padding: "16px 20px",
                background: mine ? "#ecfdf5" : "#ffffff",
                border: mine ? `2px solid ${GREEN}` : "2px solid #e2e8f0",
                borderRadius: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: 130,
                  gap: 4,
                  justifyContent: d.shifts.length ? "flex-start" : "center",
                }}
              >
                <div style={{ display: "flex", fontSize: 30, color: mine ? GREEN : "#0f172a" }}>{DAY_SHORT[weekdayIndex(d.date)]}</div>
                <div style={{ display: "flex", fontSize: 20, color: "#64748b" }}>{formatDate(d.date).replace(/^\w+ /, "")}</div>
              </div>

              {d.shifts.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", fontSize: 24, color: "#94a3b8" }}>Closed</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  {d.shifts.map((s, i) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex",
                        height: shiftHeight(s.chips),
                        marginBottom: i === d.shifts.length - 1 ? 0 : 12,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", width: 240 }}>
                        <div style={{ display: "flex", fontSize: 26, color: s.hasViewer ? GREEN : "#0f172a" }}>{s.label}</div>
                        <div style={{ display: "flex", fontSize: 21, color: "#64748b" }}>{`${s.start}–${s.end}`}</div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", width: CHIPS_WIDTH, alignContent: "flex-start" }}>
                        {s.chips.map((c, ci) => {
                          const you = c.workerId !== null && c.workerId === view.viewerId;
                          const open = c.workerId === null;
                          return (
                            <div
                              key={ci}
                              style={{
                                display: "flex",
                                height: 42,
                                alignItems: "center",
                                padding: "0 20px",
                                marginRight: 10,
                                marginBottom: 8,
                                borderRadius: 21,
                                fontSize: 23,
                                background: you ? GREEN : open ? "#fff1f2" : "#f1f5f9",
                                color: you ? "#ffffff" : open ? "#be123c" : "#0f172a",
                                border: open ? "2px solid #fb7185" : "2px solid transparent",
                              }}
                            >
                              {you ? `${c.name} (you)` : c.name}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: "flex", height: 52, alignItems: "center", fontSize: 20, color: "#64748b" }}>
          Can&apos;t make a shift? Message me here and I&apos;ll find cover.
        </div>
      </div>
    ),
    { width: WIDTH, height },
  );
  return new Uint8Array(await image.arrayBuffer());
}

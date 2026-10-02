import { writeFileSync } from "node:fs";
import { renderScheduleImage } from "../src/agent/schedule-render";
import type { ScheduleView } from "../src/agent/schedule-image";

const view: ScheduleView = {
  businessName: "Kopi & Co. Café",
  weekId: 1,
  weekStart: "2026-10-05",
  viewerId: 1,
  days: [
    { date: "2026-10-05", shifts: [] },
    {
      date: "2026-10-06",
      shifts: [
        { id: 1, label: "Opening", start: "07:00", end: "12:00", hasViewer: true, chips: [{ workerId: 1, name: "Ana" }, { workerId: 2, name: "Ben" }] },
        { id: 2, label: "Closing", start: "16:00", end: "22:00", hasViewer: false, chips: [{ workerId: 3, name: "Cai" }, { workerId: null, name: "Open" }] },
      ],
    },
    {
      date: "2026-10-07",
      shifts: [{ id: 3, label: "Opening", start: "07:00", end: "12:00", hasViewer: true, chips: [{ workerId: 1, name: "Ana" }, { workerId: 4, name: "Dee" }] }],
    },
    {
      date: "2026-10-08",
      shifts: [{ id: 4, label: "Mid", start: "11:00", end: "16:00", hasViewer: false, chips: [{ workerId: 2, name: "Ben" }, { workerId: 3, name: "Cai" }] }],
    },
    {
      date: "2026-10-09",
      shifts: [{ id: 5, label: "Opening", start: "07:00", end: "12:00", hasViewer: true, chips: [{ workerId: 1, name: "Ana" }, { workerId: 5, name: "Eli" }] }],
    },
    {
      date: "2026-10-10",
      shifts: [
        { id: 6, label: "Opening", start: "07:00", end: "12:00", hasViewer: false, chips: [{ workerId: 2, name: "Ben" }, { workerId: 4, name: "Dee" }] },
        { id: 7, label: "Closing", start: "16:00", end: "22:00", hasViewer: true, chips: [{ workerId: 1, name: "Ana" }, { workerId: 3, name: "Cai" }, { workerId: 5, name: "Eli" }] },
      ],
    },
    {
      date: "2026-10-11",
      shifts: [{ id: 8, label: "Closing", start: "16:00", end: "22:00", hasViewer: true, chips: [{ workerId: 1, name: "Ana" }, { workerId: 2, name: "Ben" }, { workerId: 4, name: "Dee" }] }],
    },
  ],
};

async function main() {
  const png = await renderScheduleImage(view);
  writeFileSync("tmp-schedule.png", png);
  console.log("wrote tmp-schedule.png", png.byteLength, "bytes");
}

void main();

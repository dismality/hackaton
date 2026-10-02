import assert from "node:assert/strict";
import { test } from "node:test";
import { rankReplacements } from "../src/agent/ranking.ts";
import { availabilityKey, solveRoster, type SolverShift, type SolverWorker } from "../src/agent/solver.ts";
import { localToUtcMs, relativeDayLabel, shiftWindow, weekdayIndex } from "../src/lib/time.ts";

const TZ = "Asia/Singapore";

function makeShift(id: number, date: string, start: string, end: string, requiredCount: number, skills: string[] = []): SolverShift {
  const w = shiftWindow(date, start, end, TZ);
  return { id, date, label: `${date} ${start}`, ...w, requiredCount, requiredSkills: skills };
}

test("time helpers", () => {
  assert.equal(weekdayIndex("2026-10-05"), 0);
  assert.equal(weekdayIndex("2026-10-11"), 6);
  assert.equal(new Date(localToUtcMs("2026-10-05", "08:00", TZ)).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(shiftWindow("2026-10-05", "22:00", "06:00", TZ).hours, 8);
  assert.match(relativeDayLabel("2026-10-06", localToUtcMs("2026-10-05", "09:00", TZ), TZ), /^tomorrow/);
});

test("solver fills shifts, respects skills, hours and rest", () => {
  const shifts = [
    makeShift(1, "2026-10-05", "07:00", "12:00", 2, ["opener"]),
    makeShift(2, "2026-10-05", "16:00", "21:00", 2),
    makeShift(3, "2026-10-06", "07:00", "12:00", 2, ["opener"]),
  ];
  const workers: SolverWorker[] = [
    { id: 1, name: "Ana", skills: ["opener"], maxHours: 10 },
    { id: 2, name: "Ben", skills: [], maxHours: 10 },
    { id: 3, name: "Cy", skills: [], maxHours: 10 },
    { id: 4, name: "Di", skills: [], maxHours: 5 },
  ];
  const availability = new Map<string, "yes" | "no" | "unsure">();
  for (const w of workers) for (const s of shifts) availability.set(availabilityKey(w.id, s.id), "yes");

  const r = solveRoster({ shifts, workers, availability, rules: { minRestHours: 10, maxShiftsPerDay: 1 } });
  assert.deepEqual(r.violations, []);
  assert.equal(r.stats.filledSlots, 6);
  for (const s of [1, 3]) {
    const onShift = r.assignments.filter((a) => a.shiftId === s).map((a) => a.workerId);
    assert.ok(onShift.includes(1), `opener must be on shift ${s}`);
  }
  assert.ok(r.hoursByWorker[4] <= 5);
});

test("solver reports gaps with reasons", () => {
  const shifts = [makeShift(1, "2026-10-05", "07:00", "12:00", 3, ["opener"])];
  const workers: SolverWorker[] = [{ id: 1, name: "Ana", skills: [], maxHours: 20 }];
  const availability = new Map([[availabilityKey(1, 1), "yes" as const]]);
  const r = solveRoster({ shifts, workers, availability, rules: { minRestHours: 10, maxShiftsPerDay: 1 } });
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].missing, 2);
  assert.deepEqual(r.gaps[0].missingSkills, ["opener"]);
});

test("replacement ranking prefers declared availability and flags overtime", () => {
  const target = makeShift(1, "2026-10-07", "16:00", "21:00", 1);
  const other = makeShift(2, "2026-10-06", "07:00", "12:00", 1);
  const workers: SolverWorker[] = [
    { id: 1, name: "Sick", skills: [], maxHours: 20 },
    { id: 2, name: "Unknown", skills: [], maxHours: 20 },
    { id: 3, name: "Yes", skills: [], maxHours: 20 },
    { id: 4, name: "No", skills: [], maxHours: 20 },
    { id: 5, name: "Tired", skills: [], maxHours: 5 },
  ];
  const availability = new Map<string, "yes" | "no" | "unsure">([
    [availabilityKey(3, 1), "yes"],
    [availabilityKey(4, 1), "no"],
    [availabilityKey(5, 1), "yes"],
  ]);
  const r = rankReplacements({
    shift: target,
    workers,
    availability,
    placed: [{ shift: other, workerId: 5 }],
    rules: { minRestHours: 10, maxShiftsPerDay: 1 },
    excludeWorkerIds: [1],
  });
  assert.equal(r.ranked[0].name, "Yes");
  assert.ok(r.excluded.some((e) => e.name === "No"));
  const tired = r.ranked.find((c) => c.name === "Tired");
  assert.ok(tired?.overtime);
  assert.ok(r.ranked.findIndex((c) => c.name === "Tired") > r.ranked.findIndex((c) => c.name === "Unknown"));
});

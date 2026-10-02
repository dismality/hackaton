export type SolverShift = {
  id: number;
  date: string;
  label: string;
  startMs: number;
  endMs: number;
  hours: number;
  requiredCount: number;
  requiredSkills: string[];
};

export type SolverWorker = { id: number; name: string; skills: string[]; maxHours: number };

export type AvailabilityStatus = "yes" | "no" | "unsure";

export type SolverRules = { minRestHours: number; maxShiftsPerDay: number };

export type SolverInput = {
  shifts: SolverShift[];
  workers: SolverWorker[];
  /** keyed `${workerId}:${shiftId}` */
  availability: Map<string, AvailabilityStatus>;
  rules: SolverRules;
};

export type SolverAssignment = { shiftId: number; workerId: number; reasons: string[] };
export type SolverGap = { shiftId: number; missing: number; missingSkills: string[]; reason: string };

export type SolverResult = {
  assignments: SolverAssignment[];
  gaps: SolverGap[];
  hoursByWorker: Record<number, number>;
  violations: string[];
  stats: { requiredSlots: number; filledSlots: number; attempts: number };
};

export const availabilityKey = (workerId: number, shiftId: number) => `${workerId}:${shiftId}`;

type Placed = { shift: SolverShift; workerId: number };

export function conflictReason(
  shift: SolverShift,
  worker: SolverWorker,
  placed: Placed[],
  rules: SolverRules,
): string | null {
  const mine = placed.filter((p) => p.workerId === worker.id);
  if (mine.some((p) => p.shift.id === shift.id)) return "already on this shift";
  const restMs = rules.minRestHours * 3_600_000;
  for (const p of mine) {
    const overlap = shift.startMs < p.shift.endMs && p.shift.startMs < shift.endMs;
    if (overlap) return `overlaps ${p.shift.label}`;
    const gap = shift.startMs >= p.shift.endMs ? shift.startMs - p.shift.endMs : p.shift.startMs - shift.endMs;
    if (gap < restMs) return `less than ${rules.minRestHours}h rest after/before ${p.shift.label}`;
  }
  const sameDay = mine.filter((p) => p.shift.date === shift.date).length;
  if (sameDay >= rules.maxShiftsPerDay) return `already has ${sameDay} shift(s) that day`;
  return null;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function greedy(input: SolverInput, order: SolverShift[]) {
  const { workers, availability, rules } = input;
  const placed: Placed[] = [];
  const hours: Record<number, number> = Object.fromEntries(workers.map((w) => [w.id, 0]));
  const assignments: SolverAssignment[] = [];
  const gaps: SolverGap[] = [];

  for (const shift of order) {
    const onShift: SolverWorker[] = [];
    const candidates = workers.filter((w) => availability.get(availabilityKey(w.id, shift.id)) === "yes");

    const feasible = (w: SolverWorker) =>
      !onShift.includes(w) &&
      hours[w.id] + shift.hours <= w.maxHours + 1e-9 &&
      conflictReason(shift, w, placed, rules) === null;

    const rank = (list: SolverWorker[]) =>
      [...list].sort(
        (a, b) =>
          hours[a.id] / a.maxHours - hours[b.id] / b.maxHours ||
          a.skills.length - b.skills.length ||
          a.id - b.id,
      );

    const place = (w: SolverWorker, reasons: string[]) => {
      reasons.push(`had ${hours[w.id]}h of ${w.maxHours}h before this shift`);
      onShift.push(w);
      placed.push({ shift, workerId: w.id });
      hours[w.id] += shift.hours;
      assignments.push({ shiftId: shift.id, workerId: w.id, reasons });
    };

    const missingSkills: string[] = [];
    for (const skill of shift.requiredSkills) {
      if (onShift.some((w) => w.skills.includes(skill))) continue;
      const withSkill = rank(candidates.filter((w) => w.skills.includes(skill) && feasible(w)));
      if (withSkill.length === 0) {
        missingSkills.push(skill);
        continue;
      }
      const only = withSkill.length === 1 ? `only available ${skill}` : `covers required skill "${skill}"`;
      place(withSkill[0], ["available", only]);
    }

    while (onShift.length < shift.requiredCount) {
      const pool = rank(candidates.filter(feasible));
      if (pool.length === 0) break;
      place(pool[0], ["available", "fewest hours among available workers"]);
    }

    const missing = Math.max(0, shift.requiredCount - onShift.length);
    if (missing > 0 || missingSkills.length > 0) {
      const declined = workers.filter((w) => availability.get(availabilityKey(w.id, shift.id)) === "no").length;
      const unsure = workers.filter((w) => availability.get(availabilityKey(w.id, shift.id)) === "unsure").length;
      const blocked = candidates.filter((w) => !onShift.includes(w)).length;
      const parts = [`${candidates.length} said yes`, `${declined} said no`];
      if (unsure) parts.push(`${unsure} unsure`);
      if (blocked) parts.push(`${blocked} blocked by hours/rest rules`);
      gaps.push({ shiftId: shift.id, missing, missingSkills, reason: parts.join(", ") });
    }
  }
  return { assignments, gaps, hours };
}

export function validateRoster(
  input: Pick<SolverInput, "shifts" | "workers" | "rules">,
  assignments: { shiftId: number; workerId: number }[],
): string[] {
  const byId = new Map(input.shifts.map((s) => [s.id, s]));
  const violations: string[] = [];
  const placed: Placed[] = [];
  const hours: Record<number, number> = {};
  const sorted = [...assignments].sort((a, b) => byId.get(a.shiftId)!.startMs - byId.get(b.shiftId)!.startMs);
  for (const a of sorted) {
    const shift = byId.get(a.shiftId);
    const worker = input.workers.find((w) => w.id === a.workerId);
    if (!shift || !worker) continue;
    const c = conflictReason(shift, worker, placed, input.rules);
    if (c) violations.push(`${worker.name} on ${shift.label}: ${c}`);
    placed.push({ shift, workerId: worker.id });
    hours[worker.id] = (hours[worker.id] ?? 0) + shift.hours;
  }
  for (const w of input.workers) {
    if ((hours[w.id] ?? 0) > w.maxHours + 1e-9) violations.push(`${w.name} is over ${w.maxHours}h (${hours[w.id]}h)`);
  }
  return violations;
}

/** Scarcity-first greedy, repeated over shuffled orderings; keeps the most complete, then fairest, roster. */
export function solveRoster(input: SolverInput, attempts = 40): SolverResult {
  const supply = (s: SolverShift) =>
    input.workers.filter((w) => input.availability.get(availabilityKey(w.id, s.id)) === "yes").length - s.requiredCount;

  const orders: SolverShift[][] = [
    [...input.shifts].sort((a, b) => supply(a) - supply(b) || a.startMs - b.startMs),
    [...input.shifts].sort((a, b) => a.startMs - b.startMs),
  ];
  const rand = mulberry32(42);
  for (let i = orders.length; i < attempts; i++) {
    orders.push(
      [...input.shifts]
        .map((s) => ({ s, k: supply(s) + rand() * 3 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.s),
    );
  }

  let best: ReturnType<typeof greedy> | null = null;
  let bestKey: [number, number, number] = [-1, 0, 0];
  for (const order of orders) {
    const r = greedy(input, order);
    const filled = r.assignments.length;
    const skillGaps = r.gaps.reduce((n, g) => n + g.missingSkills.length, 0);
    const utils = input.workers.map((w) => r.hours[w.id] / w.maxHours);
    const spread = utils.length ? Math.max(...utils) - Math.min(...utils) : 0;
    const key: [number, number, number] = [filled, -skillGaps, -spread];
    if (
      !best ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))
    ) {
      best = r;
      bestKey = key;
    }
  }

  const result = best!;
  const shiftOrder = new Map(input.shifts.map((s) => [s.id, s.startMs]));
  result.assignments.sort((a, b) => shiftOrder.get(a.shiftId)! - shiftOrder.get(b.shiftId)!);
  result.gaps.sort((a, b) => shiftOrder.get(a.shiftId)! - shiftOrder.get(b.shiftId)!);

  return {
    assignments: result.assignments,
    gaps: result.gaps,
    hoursByWorker: result.hours,
    violations: validateRoster(input, result.assignments),
    stats: {
      requiredSlots: input.shifts.reduce((n, s) => n + s.requiredCount, 0),
      filledSlots: result.assignments.length,
      attempts: orders.length,
    },
  };
}

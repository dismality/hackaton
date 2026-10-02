import type { RankedCandidate } from "../lib/types";
import {
  availabilityKey,
  conflictReason,
  type AvailabilityStatus,
  type SolverRules,
  type SolverShift,
  type SolverWorker,
} from "./solver.ts";

export type RankingInput = {
  shift: SolverShift;
  workers: SolverWorker[];
  availability: Map<string, AvailabilityStatus>;
  /** Every active assignment in the week, excluding the one being replaced. */
  placed: { shift: SolverShift; workerId: number }[];
  rules: SolverRules;
  excludeWorkerIds: number[];
};

export type RankingResult = {
  ranked: RankedCandidate[];
  excluded: { workerId: number; name: string; reason: string }[];
  missingSkills: string[];
};

export function rankReplacements(input: RankingInput): RankingResult {
  const { shift, workers, availability, placed, rules } = input;
  const onShift = placed.filter((p) => p.shift.id === shift.id).map((p) => p.workerId);
  const missingSkills = shift.requiredSkills.filter(
    (skill) => !workers.some((w) => onShift.includes(w.id) && w.skills.includes(skill)),
  );

  const ranked: RankedCandidate[] = [];
  const excluded: RankingResult["excluded"] = [];

  for (const w of workers) {
    if (input.excludeWorkerIds.includes(w.id) || onShift.includes(w.id)) continue;
    const said = availability.get(availabilityKey(w.id, shift.id));
    if (said === "no") {
      excluded.push({ workerId: w.id, name: w.name, reason: "said they can't work this shift" });
      continue;
    }
    const conflict = conflictReason(shift, w, placed, rules);
    if (conflict) {
      excluded.push({ workerId: w.id, name: w.name, reason: conflict });
      continue;
    }
    const hoursBefore = placed.filter((p) => p.workerId === w.id).reduce((n, p) => n + p.shift.hours, 0);
    const hoursAfter = hoursBefore + shift.hours;
    const overtime = hoursAfter > w.maxHours + 1e-9;
    const coversSkill = missingSkills.filter((s) => w.skills.includes(s));

    const reasons: string[] = [];
    reasons.push(said === "yes" ? "said they're available" : "didn't say either way");
    if (coversSkill.length) reasons.push(`has needed skill: ${coversSkill.join(", ")}`);
    reasons.push(`${hoursBefore}h scheduled of ${w.maxHours}h`);
    if (overtime) reasons.push(`would go over their ${w.maxHours}h limit (needs approval)`);

    const score =
      (said === "yes" ? 100 : 40) +
      (coversSkill.length ? 25 : 0) -
      (hoursBefore / Math.max(1, w.maxHours)) * 30 -
      (overtime ? 60 : 0);

    ranked.push({
      workerId: w.id,
      name: w.name,
      score: Math.round(score * 10) / 10,
      declared: said === "yes" ? "yes" : "unknown",
      hoursBefore,
      hoursAfter,
      overtime,
      reasons,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.hoursBefore - b.hoursBefore || a.workerId - b.workerId);
  return { ranked, excluded, missingSkills };
}

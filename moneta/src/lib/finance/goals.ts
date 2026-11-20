/**
 * Objectifs d'épargne : progression, épargne mensuelle recommandée, date estimée d'atteinte.
 * Les versements sur objectif sont des affectations d'épargne, jamais des dépenses de consommation.
 */
import { addDays, addMonths, diffDays, diffMonthsFractional, parseISO, type ISODate } from "@/lib/dates";
import type { Contribution, GoalInfo } from "./types";

export type GoalState = "reached" | "on_track" | "behind" | "no_deadline" | "overdue";

export interface GoalProgress {
  saved: number;
  remaining: number;
  progress: number; // 0..1 (borné)
  monthsLeft: number | null;
  recommendedMonthly: number | null;
  averageMonthly: number | null; // moyenne des versements nets sur 3 mois
  estimatedDate: ISODate | null;
  expectedByNow: number | null;
  state: GoalState;
}

export function goalProgress(goal: GoalInfo, contributions: Contribution[], today: ISODate): GoalProgress {
  const own = contributions.filter((c) => c.goalId === goal.id && c.date <= today);
  const saved = own.reduce((s, c) => s + c.amount, 0);
  const remaining = Math.max(0, goal.targetAmount - saved);
  const progress = Math.min(1, Math.max(0, saved / goal.targetAmount));

  const windowStart = addMonths(today, -3);
  const effectiveStart = goal.startDate > windowStart ? goal.startDate : windowStart;
  const recent = own.filter((c) => c.date > windowStart).reduce((s, c) => s + c.amount, 0);
  const monthsObserved = Math.max(1, diffMonthsFractional(effectiveStart, today));
  const averageMonthly = own.length ? Math.round(recent / monthsObserved) : null;

  let monthsLeft: number | null = null;
  let recommendedMonthly: number | null = null;
  let expectedByNow: number | null = null;
  let state: GoalState;

  if (remaining === 0) state = "reached";
  else if (!goal.deadline) state = "no_deadline";
  else if (goal.deadline < today) state = "overdue";
  else state = "on_track";

  if (goal.deadline && remaining > 0) {
    monthsLeft = Math.max(0, diffMonthsFractional(today, goal.deadline));
    // Nombre de versements mensuels encore possibles avant l'échéance (au moins 1).
    const t = parseISO(today);
    const d = parseISO(goal.deadline);
    const installments = Math.max(1, (d.y - t.y) * 12 + (d.m - t.m));
    recommendedMonthly = Math.ceil(remaining / installments);
    const total = diffDays(goal.startDate, goal.deadline);
    const elapsed = Math.min(total, Math.max(0, diffDays(goal.startDate, today)));
    expectedByNow = total > 0 ? Math.round((goal.targetAmount * elapsed) / total) : goal.targetAmount;
    if (state === "on_track" && saved < expectedByNow * 0.9) state = "behind";
  }

  let estimatedDate: ISODate | null = null;
  if (remaining === 0) estimatedDate = null;
  else if (averageMonthly && averageMonthly > 0) {
    const months = remaining / averageMonthly;
    if (months <= 600) estimatedDate = addDays(today, Math.ceil(months * 30.436875));
  }

  return { saved, remaining, progress, monthsLeft, recommendedMonthly, averageMonthly, estimatedDate, expectedByNow, state };
}

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  reached: "Atteint",
  on_track: "Dans les temps",
  behind: "En retard",
  no_deadline: "Sans échéance",
  overdue: "Échéance dépassée",
};

/** Montant mensuel nécessaire pour atteindre `target` en `months` mois en partant de `current`. */
export function monthlyNeeded(target: number, months: number, current = 0): number | null {
  if (months <= 0) return null;
  return Math.ceil(Math.max(0, target - current) / months);
}

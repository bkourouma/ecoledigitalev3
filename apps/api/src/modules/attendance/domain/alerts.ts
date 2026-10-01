/**
 * Alertes d'assiduité CONFIGURABLES.
 *
 * Aucun seuil dans le module (R9, convention n° 11) : les règles (`code`, `metric`, `threshold`) sont des PARAMÈTRES
 * d'établissement fournis par le modèle de pack ou un RuleSet (port `AlertPolicyPort`). Le domaine ne fait que :
 *   1. valider la forme des règles ;
 *   2. mesurer un indicateur sur le récapitulatif effectif ;
 *   3. décider d'une TRANSITION (franchi / repassé sous le seuil / simple mise à jour) à partir de l'état précédent,
 *      pour n'émettre `attendance.alert.triggered` qu'au franchissement (pas à chaque recalcul).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, validation } from "./errors";
import { absenceRateBps } from "./summary";
import type { SummaryCounts } from "./types";

export const ALERT_METRICS = [
  "ABSENT_COUNT",
  "UNEXCUSED_ABSENT_COUNT",
  "LATE_COUNT",
  "ABSENT_MINUTES",
  "UNEXCUSED_ABSENT_MINUTES",
  "ABSENCE_RATE_BPS",
] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export interface AlertRule {
  readonly code: string;
  readonly metric: AlertMetric;
  readonly threshold: number;
  readonly active: boolean;
}

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Valide un tableau de règles (paramètres d'établissement). Codes uniques, seuil entier >= 1. */
export function parseAlertRules(raw: unknown): Result<AlertRule[], AppError> {
  if (raw === null || raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return err(validation(AttendanceCode.ALERT_RULE_INVALID, "Les règles d'alerte forment un tableau.", "alertRules"));
  const seen = new Set<string>();
  const out: AlertRule[] = [];
  for (const [i, item] of raw.entries()) {
    const r = item as Partial<AlertRule> | null;
    const path = ["alertRules", i];
    if (!r || typeof r !== "object") return err(validation(AttendanceCode.ALERT_RULE_INVALID, "Règle d'alerte invalide.", path));
    if (typeof r.code !== "string" || !CODE_RE.test(r.code)) {
      return err(validation(AttendanceCode.ALERT_RULE_INVALID, "Code de règle invalide (majuscules, chiffres et _).", [...path, "code"]));
    }
    if (seen.has(r.code)) return err(validation(AttendanceCode.ALERT_RULE_INVALID, `Règle ${r.code} déclarée deux fois.`, [...path, "code"]));
    seen.add(r.code);
    if (typeof r.metric !== "string" || !(ALERT_METRICS as readonly string[]).includes(r.metric)) {
      return err(validation(AttendanceCode.ALERT_RULE_INVALID, `Indicateur inconnu : ${String(r.metric)}.`, [...path, "metric"]));
    }
    if (typeof r.threshold !== "number" || !Number.isInteger(r.threshold) || r.threshold < 1) {
      return err(validation(AttendanceCode.ALERT_RULE_INVALID, "Le seuil est un entier supérieur ou égal à 1.", [...path, "threshold"]));
    }
    out.push({ code: r.code, metric: r.metric as AlertMetric, threshold: r.threshold, active: r.active !== false });
  }
  return ok(out);
}

/** Mesure d'un indicateur sur un récapitulatif EFFECTIF (surcharge comprise pour les minutes). */
export function metricValue(metric: AlertMetric, s: SummaryCounts): number {
  switch (metric) {
    case "ABSENT_COUNT":
      return s.absentCount;
    case "UNEXCUSED_ABSENT_COUNT":
      return Math.max(0, s.absentCount - s.excusedCount);
    case "LATE_COUNT":
      return s.lateCount;
    case "ABSENT_MINUTES":
      return s.absentMinutes;
    case "UNEXCUSED_ABSENT_MINUTES":
      return Math.max(0, s.absentMinutes - s.excusedMinutes);
    case "ABSENCE_RATE_BPS":
      return absenceRateBps(s.sessionsTotal, s.absentCount);
  }
}

/** État mémorisé d'une règle pour un couple (inscription, période). */
export interface AlertState {
  readonly ruleCode: string;
  readonly metric: AlertMetric;
  readonly threshold: number;
  readonly lastValue: number;
  /** `true` tant que le seuil est franchi (non « cleared »). */
  readonly active: boolean;
}

export type AlertTransition =
  | { kind: "TRIGGER"; ruleCode: string; metric: AlertMetric; threshold: number; value: number }
  | { kind: "CLEAR"; ruleCode: string; metric: AlertMetric; threshold: number; value: number }
  | { kind: "UPDATE"; ruleCode: string; metric: AlertMetric; threshold: number; value: number };

/**
 * Compare le récapitulatif aux règles ACTIVES et à l'état précédent :
 *  - valeur >= seuil et pas d'état actif  -> TRIGGER (événement) ;
 *  - valeur >= seuil et état actif         -> UPDATE si la valeur a changé (silencieux) ;
 *  - valeur <  seuil et état actif         -> CLEAR (événement) ;
 *  - règle supprimée / désactivée avec un état actif -> CLEAR.
 */
export function evaluateAlerts(rules: readonly AlertRule[], summary: SummaryCounts, previous: readonly AlertState[]): AlertTransition[] {
  const prev = new Map(previous.map((p) => [p.ruleCode, p]));
  const out: AlertTransition[] = [];
  const activeCodes = new Set<string>();
  for (const rule of rules) {
    if (!rule.active) continue;
    activeCodes.add(rule.code);
    const value = metricValue(rule.metric, summary);
    const before = prev.get(rule.code);
    const wasActive = before?.active === true;
    const base = { ruleCode: rule.code, metric: rule.metric, threshold: rule.threshold, value };
    if (value >= rule.threshold) {
      if (!wasActive) out.push({ kind: "TRIGGER", ...base });
      else if (before && before.lastValue !== value) out.push({ kind: "UPDATE", ...base });
    } else if (wasActive) {
      out.push({ kind: "CLEAR", ...base });
    }
  }
  for (const before of previous) {
    if (before.active && !activeCodes.has(before.ruleCode)) {
      out.push({ kind: "CLEAR", ruleCode: before.ruleCode, metric: before.metric, threshold: before.threshold, value: before.lastValue });
    }
  }
  return out;
}

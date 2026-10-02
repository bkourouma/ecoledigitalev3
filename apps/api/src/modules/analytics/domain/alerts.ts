/**
 * Règles PURES des alertes : gravité d'une valeur, cohérence des seuils, créneau de fréquence (anti-doublon), formatage
 * NEUTRE des valeurs pour les notifications. Aucun accès base, aucune horloge implicite (l'instant est un paramètre).
 */
import type { AlertComparator, AlertMetricDef, AlertUnit } from "./alert-metrics";

export type AlertSeverity = "WARNING" | "CRITICAL";
export type AlertFrequency = "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";

/** Gravité d'une valeur mesurée, ou `null` si aucun seuil n'est franchi. Franchissement STRICT. */
export function severityOf(comparator: AlertComparator, value: number, thresholds: { warning: number | null; critical: number | null }): { severity: AlertSeverity; threshold: number } | null {
  const crosses = (t: number): boolean => (comparator === "BELOW" ? value < t : value > t);
  if (thresholds.critical !== null && crosses(thresholds.critical)) return { severity: "CRITICAL", threshold: thresholds.critical };
  if (thresholds.warning !== null && crosses(thresholds.warning)) return { severity: "WARNING", threshold: thresholds.warning };
  return null;
}

export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = { WARNING: 1, CRITICAL: 2 };

/**
 * Cohérence des seuils d'une règle : au moins un seuil, valeurs de l'unité (taux en points de base 0..10000, montants et
 * comptages positifs ou nuls), et seuil critique « plus grave » que le seuil d'attention (sous lui pour `BELOW`, au-dessus
 * pour `ABOVE`). Renvoie une liste d'anomalies (vide = valide).
 */
export function thresholdIssues(metric: Pick<AlertMetricDef, "unit" | "comparator">, warning: number | null, critical: number | null): string[] {
  const issues: string[] = [];
  if (warning === null && critical === null) issues.push("Au moins un seuil (attention ou critique) est attendu.");
  for (const [name, v] of [["attention", warning], ["critique", critical]] as const) {
    if (v === null) continue;
    if (!Number.isSafeInteger(v) || v < 0) issues.push(`Le seuil ${name} doit être un entier positif ou nul.`);
    else if (metric.unit === "BPS" && v > 10_000) issues.push(`Le seuil ${name} d'un taux ne peut pas dépasser 100 %.`);
  }
  if (warning !== null && critical !== null) {
    if (metric.comparator === "BELOW" && critical > warning) issues.push("Le seuil critique doit être inférieur ou égal au seuil d'attention.");
    if (metric.comparator === "ABOVE" && critical < warning) issues.push("Le seuil critique doit être supérieur ou égal au seuil d'attention.");
  }
  return issues;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Semaine ISO 8601 (`AAAA-Snn`) d'une date UTC. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-S${pad(week)}`;
}

/**
 * Créneau de fréquence : deux évaluations dans le MÊME créneau ne notifient pas deux fois la même gravité (Abidjan = UTC+0,
 * donc UTC). `HOURLY` : heure ; `DAILY` : jour ; `WEEKLY` : semaine ISO ; `MONTHLY` : mois.
 */
export function frequencyBucket(frequency: AlertFrequency, now: Date): string {
  const day = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  switch (frequency) {
    case "HOURLY":
      return `${day}T${pad(now.getUTCHours())}`;
    case "DAILY":
      return day;
    case "WEEKLY":
      return isoWeek(now);
    case "MONTHLY":
      return day.slice(0, 7);
  }
}

/** Clé de dédoublonnage d'une notification : (règle, gravité, créneau de fréquence). UNIQUE en base. */
export const notificationKey = (ruleId: string, severity: AlertSeverity, bucket: string): string => `${ruleId}:${severity}:${bucket}`;

export type NotificationReason = "RAISED" | "ESCALATED" | "REMINDER";

/** Raison d'une notification : première de l'alerte, montée en gravité, ou rappel périodique. */
export function reasonOf(previousHighest: AlertSeverity | null, severity: AlertSeverity): NotificationReason {
  if (previousHighest === null) return "RAISED";
  return SEVERITY_RANK[severity] > SEVERITY_RANK[previousHighest] ? "ESCALATED" : "REMINDER";
}

const nf = (n: number): string => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, " ");

/** Valeur lisible (français) d'une mesure : `78,5 %`, `1 250 000 XOF`, `12`. */
export function formatAlertValue(unit: AlertUnit, value: number, currency: string | null): string {
  switch (unit) {
    case "BPS":
      return `${nf(value / 100)} %`;
    case "AMOUNT":
      return `${nf(value)}${currency ? ` ${currency}` : ""}`;
    case "COUNT":
      return nf(value);
  }
}

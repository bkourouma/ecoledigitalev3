/**
 * Catalogue des indicateurs surveillables par une alerte (spec v2/025, partie B). Données pures : pour chaque indicateur son
 * libellé NEUTRE (repris tel quel dans la notification, jamais saisi librement), son unité, le sens du dépassement, la
 * permission de DONNÉES qu'exige sa lecture, et les genres de rafraîchissement dont il dépend.
 *
 * AUCUN seuil par défaut et AUCUNE règle officielle : le catalogue dit « quoi surveiller », l'établissement dit « à partir de
 * quelle valeur ». Aucun indicateur ne porte de donnée d'élève (taux, montants et comptages agrégés).
 *
 * Sens : `BELOW` = on alerte quand la valeur passe SOUS le seuil (taux de présence) ; `ABOVE` = quand elle le DÉPASSE (impayés).
 * Le dépassement est STRICT (une valeur égale au seuil n'alerte pas).
 */
import { ANALYTICS_ALERT_METRICS, ANALYTICS_PERMISSIONS as P, type AnalyticsAlertMetric } from "@ecoledigitale/contracts/src/v2/analytics";
import type { RefreshKind } from "./types";

export type AlertUnit = "BPS" | "AMOUNT" | "COUNT";
export type AlertComparator = "BELOW" | "ABOVE";

export interface AlertMetricDef {
  readonly metric: AnalyticsAlertMetric;
  readonly label: string;
  readonly unit: AlertUnit;
  readonly comparator: AlertComparator;
  /** Permission de données requise pour voir, configurer et accuser réception d'une alerte de cet indicateur. */
  readonly permission: string;
  /** Fenêtre glissante en jours (sinon : état du jour). */
  readonly windowed: boolean;
  readonly defaultWindowDays: number | null;
  /** Indicateur de facturation : suivi par campus (un établissement à plusieurs campus doit en désigner un). */
  readonly campusScoped: boolean;
  /** Genres de rafraîchissement dont l'indicateur dépend : tous doivent être frais et sans manque pour évaluer. */
  readonly kinds: readonly RefreshKind[];
}

const def = (d: AlertMetricDef): AlertMetricDef => Object.freeze(d);

export const ALERT_METRICS: readonly AlertMetricDef[] = Object.freeze([
  def({ metric: "ATTENDANCE_RATE", label: "Taux de présence des élèves", unit: "BPS", comparator: "BELOW", permission: P.attendance, windowed: true, defaultWindowDays: 30, campusScoped: false, kinds: ["ATTENDANCE", "CALENDAR"] }),
  def({ metric: "COLLECTION_RATE", label: "Taux de recouvrement de la scolarité", unit: "BPS", comparator: "BELOW", permission: P.finance, windowed: false, defaultWindowDays: null, campusScoped: true, kinds: ["FINANCE", "CALENDAR"] }),
  def({ metric: "OVERDUE_AMOUNT", label: "Montant des impayés échus", unit: "AMOUNT", comparator: "ABOVE", permission: P.finance, windowed: false, defaultWindowDays: null, campusScoped: true, kinds: ["FINANCE", "CALENDAR"] }),
  def({ metric: "VALIDATION_RATE", label: "Taux de validation de la dernière période clôturée", unit: "BPS", comparator: "BELOW", permission: P.pedagogy, windowed: false, defaultWindowDays: null, campusScoped: false, kinds: ["RESULTS", "CALENDAR"] }),
  def({ metric: "ENROLLMENT_IN_SCHOOLING", label: "Effectif en scolarité", unit: "COUNT", comparator: "BELOW", permission: P.read, windowed: false, defaultWindowDays: null, campusScoped: false, kinds: ["ENROLLMENT", "CALENDAR"] }),
  def({ metric: "CASH_VARIANCE", label: "Écart de caisse cumulé (valeur absolue)", unit: "AMOUNT", comparator: "ABOVE", permission: P.treasury, windowed: true, defaultWindowDays: 30, campusScoped: false, kinds: ["CASH"] }),
  def({ metric: "SCHOOLLIFE_OPEN_INCIDENTS", label: "Incidents de vie scolaire ouverts", unit: "COUNT", comparator: "ABOVE", permission: P.schoollife, windowed: false, defaultWindowDays: null, campusScoped: false, kinds: ["SCHOOLLIFE"] }),
  def({ metric: "SCHOOLLIFE_MEASURES_TO_VALIDATE", label: "Mesures de vie scolaire en attente de validation", unit: "COUNT", comparator: "ABOVE", permission: P.schoollife, windowed: false, defaultWindowDays: null, campusScoped: false, kinds: ["SCHOOLLIFE"] }),
]);

const BY_METRIC: ReadonlyMap<string, AlertMetricDef> = new Map(ALERT_METRICS.map((m) => [m.metric, m]));

export const alertMetricDef = (metric: string): AlertMetricDef | undefined => BY_METRIC.get(metric);

/** Garde de cohérence : le catalogue couvre exactement les indicateurs des contrats (un test le vérifie aussi). */
export const CATALOG_COVERS_CONTRACT: boolean = ANALYTICS_ALERT_METRICS.every((m) => BY_METRIC.has(m)) && ALERT_METRICS.length === ANALYTICS_ALERT_METRICS.length;

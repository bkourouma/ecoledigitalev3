/**
 * Catalogue des états : paramètres que chaque rapport attend (lus dans `application/reports.ts`) et rapports réservés à la
 * direction (`primary.class.read_all`). Ce sont des indications de FORME pour le formulaire : l'API revalide tout.
 */

import { PRIMARY_REPORT_KEYS, type PrimaryReportKey } from "@ecoledigitale/contracts/v2/primary_school";

export type ReportParam = "classroomId" | "periodId" | "yearId" | "month" | "deliberationId";

export const REPORT_PARAMS: Readonly<Record<PrimaryReportKey, { required: readonly ReportParam[]; optional: readonly ReportParam[] }>> = {
  "class-list": { required: ["classroomId"], optional: [] },
  "enrollment-stats": { required: [], optional: ["yearId"] },
  "attendance-register": { required: ["classroomId", "month"], optional: [] },
  repeaters: { required: [], optional: ["yearId"] },
  "competency-coverage": { required: ["classroomId", "periodId"], optional: [] },
  "council-pack": { required: ["deliberationId"], optional: [] },
  progress: { required: [], optional: ["yearId"] },
};

/** Rapports réservés à la direction : masqués pour qui n'a pas l'accès à toutes les classes. */
export const DIRECTION_ONLY_REPORTS: readonly PrimaryReportKey[] = ["enrollment-stats", "repeaters", "progress"];

export function visibleReports(canReadAllClasses: boolean): PrimaryReportKey[] {
  return PRIMARY_REPORT_KEYS.filter((k) => canReadAllClasses || !DIRECTION_ONLY_REPORTS.includes(k));
}

/** Le rapport peut être demandé : tous les paramètres obligatoires sont renseignés (contrôle de forme). */
export function missingParams(key: PrimaryReportKey, params: Partial<Record<ReportParam, string>>): ReportParam[] {
  return REPORT_PARAMS[key].required.filter((p) => !params[p]);
}

/** Nom de fichier de l'export (jamais une URL affichée). */
export const csvFileName = (key: PrimaryReportKey): string => `${key}.csv`;

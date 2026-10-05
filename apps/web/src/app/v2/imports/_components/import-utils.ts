/**
 * Utilitaires d'affichage des imports : étape de l'assistant déduite de l'ÉTAT serveur, tons des pastilles, formats.
 * Aucune règle métier : l'état vient de l'API ; l'écran ne fait que le présenter.
 */
import type { ImportJobDto } from "@ecoledigitale/contracts/v2/imports";
import type { Tone } from "@/platform/ui";

export const INPUT_CLASS =
  "block h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-10";

export type AssistantStep = "upload" | "mapping" | "validation" | "preview" | "import" | "report";
export const ASSISTANT_STEPS: readonly AssistantStep[] = ["upload", "mapping", "validation", "preview", "import", "report"];

/** Étape affichée pour un état d'import (« Erreurs » est un volet de « Validation »). */
export function stepOf(job: Pick<ImportJobDto, "status"> | null | undefined): AssistantStep {
  if (!job) return "upload";
  switch (job.status) {
    case "UPLOADED":
    case "MAPPED":
      return "mapping";
    case "VALIDATING":
      return "validation";
    case "VALIDATED":
      return "preview";
    case "QUEUED":
    case "RUNNING":
      return "import";
    default:
      return "report";
  }
}

export function toneOf(status: ImportJobDto["status"]): Tone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "COMPLETED_WITH_ERRORS":
      return "warning";
    case "FAILED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    case "VALIDATED":
      return "info";
    default:
      return "info";
  }
}

/** Pourcentage entier borné de `done / total` (total nul -> 0). */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} Ko`;
  return `${Math.round(n / 104857.6) / 10} Mo`;
}

/**
 * Importeurs proposés à l'écran. « Notes » (direction, toute évaluation) et « Notes de mes classes » (enseignant, ses seules
 * évaluations) couvrent le même fichier : on ne montre qu'un des deux selon les droits — le complet s'il est utilisable, sinon
 * celui de l'enseignant s'il l'est, sinon le complet (désactivé, avec les droits manquants).
 */
export function visibleImporters<T extends { key: string; canUse: boolean }>(items: readonly T[]): T[] {
  const can = new Map(items.map((i) => [i.key, i.canUse]));
  return items.filter((i) => {
    if (i.key === "grades_own") return can.get("grades_own") === true && can.get("grades") !== true;
    if (i.key === "grades") return can.get("grades") === true || can.get("grades_own") !== true;
    return true;
  });
}

export const ACCEPT = ".xlsx,.xls,.ods,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,text/csv";

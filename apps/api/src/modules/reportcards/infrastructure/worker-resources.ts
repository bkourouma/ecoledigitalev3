/**
 * Ressources du worker pour le rendu (stockage d'objets, moteur PDF, fusion) INJECTABLES par l'assemblage de la plateforme
 * (`apps/api/src/platform/adapters`) : le worker y branche le stockage de la plateforme (S3 / MinIO, ou repli disque du
 * développement) au lieu de relire seul la configuration S3. Sans injection, `subscribers.ts` garde son comportement
 * historique (variables `REPORTCARDS_S3_*`, Chromium local).
 */
import type { PdfMerger, PdfRenderer, StoragePort } from "../application/ports";

export interface WorkerResourceOverrides {
  storage?: StoragePort | null;
  renderer?: PdfRenderer;
  merger?: PdfMerger;
}

let overrides: WorkerResourceOverrides = {};
let version = 0;

export function setReportcardsWorkerResources(next: WorkerResourceOverrides): void {
  overrides = { ...overrides, ...next };
  version += 1;
}

export function reportcardsWorkerOverrides(): { overrides: WorkerResourceOverrides; version: number } {
  return { overrides, version };
}

export function resetReportcardsWorkerResources(): void {
  overrides = {};
  version += 1;
}

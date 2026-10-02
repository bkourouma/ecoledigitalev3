/**
 * Traduit l'état de synchronisation des notes d'UNE évaluation en un statut unique à annoncer (logique pure, testée sans DOM).
 *
 * Statuts visibles : en attente / synchronisé / conflit / échec, plus les cas qui changent ce que la personne doit faire
 * (hors ligne, envoi en cours, session expirée, évaluation figée, file locale pleine). Priorité décroissante : ce qui demande
 * une ACTION passe avant ce qui est simplement en cours.
 */

import type { GradeSyncStatus } from "./grade-sync-manager";

export type GradeSyncKind =
  | "limit"
  | "storage"
  | "locked"
  | "conflict"
  | "auth"
  | "failed"
  | "offline"
  | "syncing"
  | "pending"
  | "synced"
  | "idle";

export interface GradeSyncDescription {
  kind: GradeSyncKind;
  /** Notes concernées (en attente, en conflit…). */
  count: number;
  /** Instant du dernier envoi réussi de cette évaluation (statut `synced`). */
  syncedAt: string | null;
  /** Instant du prochain essai automatique (statut `failed`). */
  nextRetryAt: number | null;
  /** Une action manuelle est utile (envoyer / réessayer). */
  action: "sync" | "retry" | null;
  /** Gravité de l'annonce : `alert` interrompt la lecture, `status` attend un temps de pause. */
  tone: "ok" | "info" | "warn" | "bad";
}

export function describeSync(status: GradeSyncStatus, assessmentId: string): GradeSyncDescription {
  const draft = status.drafts.find((d) => d.assessmentId === assessmentId);
  const pending = draft?.pending ?? 0;
  const base = { count: 0, syncedAt: null as string | null, nextRetryAt: null as number | null, action: null as GradeSyncDescription["action"] };

  if (status.limitReached) return { ...base, kind: "limit", tone: "bad" };
  if (status.storageFailed) return { ...base, kind: "storage", tone: "bad" };
  if (draft?.status === "LOCKED") return { ...base, kind: "locked", count: pending, tone: "bad" };
  if (draft && draft.conflicts.length > 0) return { ...base, kind: "conflict", count: draft.conflicts.length, tone: "bad" };
  if (draft?.status === "FAILED") return { ...base, kind: "failed", count: pending, action: "retry", tone: "bad" };
  const waiting = pending > 0 || Boolean(draft?.inflight);
  if (status.failure === "auth" && waiting) return { ...base, kind: "auth", count: pending, tone: "bad" };
  if (!status.online) return { ...base, kind: "offline", count: pending, tone: "warn" };
  if (draft?.syncing || (status.syncing && waiting)) return { ...base, kind: "syncing", count: pending, tone: "info" };
  if (status.failure && waiting) return { ...base, kind: "failed", count: pending, nextRetryAt: status.nextRetryAt, action: "retry", tone: "bad" };
  if (waiting) return { ...base, kind: "pending", count: pending, action: "sync", tone: "info" };
  const syncedAt = status.syncedAt[assessmentId] ?? null;
  if (syncedAt) return { ...base, kind: "synced", syncedAt, tone: "ok" };
  return { ...base, kind: "idle", tone: "ok" };
}

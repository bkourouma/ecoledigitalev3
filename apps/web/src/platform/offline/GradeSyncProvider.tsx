"use client";

/**
 * Fournit aux écrans de notes (`/v2/assessments/*`, `/v2/teacher/assessments/*`) le gestionnaire de brouillons hors ligne :
 * ouvre la base locale, écoute le réseau (`online` / `offline`), la visibilité de l'onglet, le renouvellement de la session et
 * un battement lent tant que des saisies attendent. Aucun appel réseau tant qu'il n'y a rien à envoyer.
 *
 * Le gestionnaire est OPTIONNEL pour les écrans (`useGradeSync()` peut renvoyer `null`) : sans fournisseur, la grille garde
 * son comportement en ligne seulement.
 */

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { platformApi } from "@/platform/api/default-client";
import { assessSaveGradesResultDtoSchema } from "@ecoledigitale/contracts/v2/assess";
import { ASSESS_BASE, gradeSheetSchema } from "@/platform/v2/assess";
import { openOfflineDb } from "./idb";
import { currentOfflineOwner, hasValidSession } from "./owner";
import { GradeSyncManager, type GradeSyncStatus } from "./grade-sync-manager";
import type { ServerGrade } from "./grade-drafts";

const GradeSyncContext = createContext<GradeSyncManager | null>(null);

interface ApiGrade {
  enrollmentId: string;
  score: string | null;
  entryStatus: ServerGrade["entryStatus"];
  comment: string | null;
  rowVersion: number;
}
const toServerGrade = (g: ApiGrade): ServerGrade => ({ enrollmentId: g.enrollmentId, score: g.score, entryStatus: g.entryStatus, comment: g.comment, rowVersion: g.rowVersion });

export function createBrowserGradeSyncManager(): GradeSyncManager {
  const locks = typeof navigator !== "undefined" ? (navigator as { locks?: { request: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }).locks : undefined;
  return new GradeSyncManager({
    openDb: () => openOfflineDb(),
    // Identité des brouillons : celle du jeton, MÊME expiré (la saisie hors ligne dure plus longtemps qu'un jeton d'accès).
    owner: () => currentOfflineOwner({ allowExpired: true }),
    canSync: hasValidSession,
    put: async (assessmentId, entries, idempotencyKey) => {
      const r = await platformApi.put(`${ASSESS_BASE}/assessments/${assessmentId}/grades`, { entries }, { schema: assessSaveGradesResultDtoSchema, idempotencyKey });
      return { created: r.created, updated: r.updated, unchanged: r.unchanged, replayed: r.replayed, grades: r.grades.map(toServerGrade) };
    },
    fetchSheet: async (assessmentId) => {
      const sheet = await platformApi.get(`${ASSESS_BASE}/assessments/${assessmentId}/grades`, { schema: gradeSheetSchema });
      return { status: sheet.assessment.status, grades: sheet.grades.map(toServerGrade) };
    },
    ...(locks ? { exclusive: <T,>(fn: () => Promise<T>) => locks.request("ed-grade-sync", fn) } : {}),
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  });
}

const HEARTBEAT_MS = 60_000;

export function GradeSyncProvider({ children, manager: injected }: { children: ReactNode; manager?: GradeSyncManager }) {
  const [manager] = useState(() => injected ?? createBrowserGradeSyncManager());

  useEffect(() => {
    void manager.init();
    const onOnline = () => manager.setOnline(true);
    const onOffline = () => manager.setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && manager.getSnapshot().totals.pending > 0) void manager.syncNow();
    };
    manager.setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    // Filet de sécurité : l'événement `online` est capricieux sur certains réseaux mobiles ; ce battement reprend aussi
    // l'envoi après un renouvellement de session (échec « auth » levé quand le jeton redevient valide).
    const heartbeat = window.setInterval(() => {
      const s = manager.getSnapshot();
      if (!s.online || s.syncing || s.nextRetryAt !== null || s.totals.pending === 0) return;
      if (s.failure === "auth") {
        if (hasValidSession()) manager.notifySessionRenewed();
        return;
      }
      void manager.syncNow();
    }, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(heartbeat);
      if (!injected) manager.dispose();
    };
  }, [manager, injected]);

  return <GradeSyncContext.Provider value={manager}>{children}</GradeSyncContext.Provider>;
}

/** Le gestionnaire de brouillons, ou `null` hors fournisseur (la grille reste alors en ligne seulement). */
export function useGradeSync(): GradeSyncManager | null {
  return useContext(GradeSyncContext);
}

const SERVER_STATUS: GradeSyncStatus = {
  ready: false,
  persistent: false,
  available: false,
  online: true,
  syncing: false,
  drafts: [],
  totals: { pending: 0, conflicts: 0, failed: 0, locked: 0 },
  failure: null,
  nextRetryAt: null,
  lastSyncAt: null,
  syncedAt: {},
  limitReached: false,
  storageFailed: false,
};

const NEVER = () => () => undefined;

/** État observable des brouillons ; vide hors fournisseur. */
export function useGradeSyncStatus(): GradeSyncStatus {
  const manager = useContext(GradeSyncContext);
  return useSyncExternalStore(manager ? manager.subscribe : NEVER, manager ? manager.getSnapshot : () => SERVER_STATUS, () => SERVER_STATUS);
}

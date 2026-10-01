"use client";

/**
 * Fournit le gestionnaire de file d'appel hors ligne aux écrans `/v2/attendance/*` : ouvre la base locale, écoute le
 * réseau (`online` / `offline`), la visibilité de l'onglet et un battement lent tant que des pointages attendent.
 * Aucun appel réseau tant que la file est vide.
 */

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { attendanceSyncResultDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import { platformApi } from "@/platform/api/default-client";
import { getToken, getUserFromToken, isTokenExpired } from "@/lib/jwt-storage";
import { openOfflineDb } from "./idb";
import { OutboxManager, type OutboxStatus } from "./outbox-manager";

const OutboxContext = createContext<OutboxManager | null>(null);

/** `tenant:utilisateur` du jeton courant (la file est cloisonnée par propriétaire), ou null. */
export function currentOutboxOwner(): string | null {
  if (typeof window === "undefined") return null;
  const token = getToken();
  if (!token || isTokenExpired(token)) return null;
  const user = getUserFromToken(token);
  return user ? `${user.tenantSlug || user.tenantId}:${user.userId}` : null;
}

export function createBrowserOutboxManager(): OutboxManager {
  return new OutboxManager({
    openDb: () => openOfflineDb(),
    owner: currentOutboxOwner,
    post: (batch) => platformApi.post("/api/v1/attendance/sync", batch, { schema: attendanceSyncResultDtoSchema, idempotencyKey: batch.batchId }),
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  });
}

const HEARTBEAT_MS = 60_000;

export function OutboxProvider({ children, manager: injected }: { children: ReactNode; manager?: OutboxManager }) {
  const [manager] = useState(() => injected ?? createBrowserOutboxManager());

  useEffect(() => {
    void manager.init();
    const onOnline = () => manager.setOnline(true);
    const onOffline = () => manager.setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && manager.getSnapshot().pending.calls > 0) void manager.syncNow();
    };
    manager.setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    // Filet de sécurité : l'événement `online` est capricieux sur certains réseaux mobiles.
    const heartbeat = window.setInterval(() => {
      const s = manager.getSnapshot();
      if (s.online && !s.syncing && s.pending.calls > 0 && s.failure !== "auth" && s.nextRetryAt === null) void manager.syncNow();
    }, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(heartbeat);
      if (!injected) manager.dispose();
    };
  }, [manager, injected]);

  return <OutboxContext.Provider value={manager}>{children}</OutboxContext.Provider>;
}

/** Le gestionnaire (actions) ; lève si le fournisseur est absent, pour ne jamais perdre silencieusement des pointages. */
export function useOutboxManager(): OutboxManager {
  const manager = useContext(OutboxContext);
  if (!manager) throw new Error("OutboxProvider manquant : enveloppez l'écran d'appel dans <OutboxProvider>.");
  return manager;
}

const SERVER_STATUS: OutboxStatus = {
  ready: false,
  persistent: false,
  available: false,
  online: true,
  syncing: false,
  calls: [],
  pending: { calls: 0, records: 0 },
  lastSyncAt: null,
  failure: null,
  nextRetryAt: null,
};

/** L'état observable de la file (réseau, envoi en cours, éléments en attente). */
export function useOutboxStatus(): OutboxStatus {
  const manager = useOutboxManager();
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, () => SERVER_STATUS);
}

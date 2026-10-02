"use client";

import { useRef } from "react";

/**
 * Clés d'idempotence des opérations financières (paiement, remboursement, facture).
 *
 * Règles :
 *  - UNE clé par intention : la même demande (même empreinte) renvoyée après un échec réseau, un délai dépassé ou un
 *    double clic reprend la MÊME clé, donc l'API la rejoue au lieu d'encaisser deux fois ;
 *  - une demande DIFFÉRENTE (montant corrigé…) reçoit une nouvelle clé (l'API refuse une clé réutilisée avec un autre
 *    contenu : `finance.idempotency_key_reused`) ;
 *  - après un succès la clé est abandonnée : l'opération suivante est une nouvelle opération ;
 *  - un verrou SYNCHRONE (référence, pas état React) ignore tout appel pendant qu'un envoi est en cours : deux clics dans
 *    le même cycle de rendu n'émettent qu'une requête.
 *
 * Format de la clé : lettres, chiffres, `. _ : -`, 8 à 120 caractères (contrat `financeIdempotencyKeySchema`).
 */

export function newIdempotencyKey(prefix = "web"): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return `${prefix}-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface IdempotentRunner<P> {
  /**
   * Exécute `exec(clé)` sauf si un envoi est déjà en cours (renvoie alors `undefined`). Propage l'erreur de `exec` en
   * CONSERVANT la clé pour la nouvelle tentative.
   */
  run<R>(payload: P, exec: (key: string) => Promise<R>): Promise<R | undefined>;
  /** Abandonne la clé courante (formulaire réinitialisé). */
  reset(): void;
  /** Clé en cours, pour affichage ou tests. */
  current(): string | null;
}

export function createIdempotentRunner<P>(fingerprintOf: (payload: P) => string, prefix = "web"): IdempotentRunner<P> {
  let state: { fingerprint: string; key: string } | null = null;
  let inFlight = false;
  return {
    async run(payload, exec) {
      if (inFlight) return undefined;
      const fingerprint = fingerprintOf(payload);
      if (!state || state.fingerprint !== fingerprint) state = { fingerprint, key: newIdempotencyKey(prefix) };
      inFlight = true;
      try {
        const result = await exec(state.key);
        state = null;
        return result;
      } finally {
        inFlight = false;
      }
    },
    reset() {
      state = null;
    },
    current: () => state?.key ?? null,
  };
}

/** Version React : le coureur survit aux rendus (référence stable). */
export function useIdempotentRunner<P>(fingerprintOf: (payload: P) => string, prefix = "web"): IdempotentRunner<P> {
  const ref = useRef<IdempotentRunner<P> | null>(null);
  const fingerprintRef = useRef(fingerprintOf);
  fingerprintRef.current = fingerprintOf;
  if (!ref.current) ref.current = createIdempotentRunner<P>((p) => fingerprintRef.current(p), prefix);
  return ref.current;
}

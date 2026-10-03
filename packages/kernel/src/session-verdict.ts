/**
 * Port d'invalidation du verdict de session (cache de session, fail-closed).
 *
 * Le verdict « cette session est-elle encore valide ? » dépend de lignes écrites par
 * PLUSIEURS modules (iam : sessions, identités, accès ; tenancy : statut du tenant). Un
 * cache de verdict n'est sûr que si TOUT écrivain de ces lignes le signale, dans la MÊME
 * transaction logique que l'écriture. Ce port est le contrat commun : un module qui
 * modifie une donnée du verdict appelle `invalidateSessionVerdict(tx, cible)` AVANT de
 * valider sa transaction ; il ne connaît ni Redis ni le cache.
 *
 * Protocole (voir `apps/api/src/modules/iam/infrastructure/session-verdict-cache.ts`) :
 *   1. `begin` (dans la transaction, avant le COMMIT) : change le jeton de version de la
 *      cible ET pose un marqueur « écriture en cours » ; un lecteur qui voit ce marqueur
 *      ne sert ni ne remplit AUCUN cache pour cette cible. Si `begin` échoue, la
 *      transaction est annulée (échec fermé : on ne valide jamais un changement de verdict
 *      que le cache n'a pas pu apprendre).
 *   2. `end` (après COMMIT ou ROLLBACK, via `tx.onSettled`) : retire le marqueur. Si `end`
 *      échoue, le marqueur expire seul (le cache reste simplement contourné pendant ce délai).
 *
 * Sans invalidateur enregistré (cache désactivé, tests), l'appel est un no-op.
 */
import { UnavailableError } from "./errors";

/** Ce que la modification peut rendre périmé. */
export type SessionVerdictTarget =
  /** Une session précise (révocation, déconnexion). */
  | { kind: "session"; tenantId: string; sessionId: string }
  /** TOUTES les sessions d'une identité, tous établissements (époque, mot de passe, MFA, statut, accès, rôles). */
  | { kind: "identity"; identityId: string }
  /** TOUTES les sessions d'un établissement (suspension, archivage). */
  | { kind: "tenant"; tenantId: string };

export interface SessionVerdictInvalidator {
  /** Appelé dans la transaction, avant COMMIT. Lève si l'invalidation n'a pu être enregistrée. */
  begin(targets: readonly SessionVerdictTarget[]): Promise<void>;
  /** Appelé après COMMIT/ROLLBACK. Ne lève pas (au pire, le marqueur expire). */
  end(targets: readonly SessionVerdictTarget[]): Promise<void>;
}

/** Hôte d'une transaction : `Tx` de `@ecoledigitale/database` (non importé ici : le noyau reste pur). */
export interface SettleHost {
  onSettled?(fn: () => void | Promise<void>): void;
}

let current: SessionVerdictInvalidator | null = null;
const seen = new WeakMap<object, Set<string>>();

/** Enregistre (ou retire, avec `null`) l'invalidateur du processus. Posé au démarrage de la plateforme. */
export function registerSessionVerdictInvalidator(invalidator: SessionVerdictInvalidator | null): void {
  current = invalidator;
}

export function hasSessionVerdictInvalidator(): boolean {
  return current !== null;
}

export const SESSION_VERDICT_UNAVAILABLE = "iam.session_cache_unavailable";

function unavailable(message: string, cause?: unknown): UnavailableError {
  return new UnavailableError(message, {
    code: SESSION_VERDICT_UNAVAILABLE,
    details: { retryAfterSeconds: 2 },
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function targetKey(t: SessionVerdictTarget): string {
  switch (t.kind) {
    case "session":
      return `s:${t.tenantId}:${t.sessionId}`;
    case "identity":
      return `i:${t.identityId}`;
    case "tenant":
      return `t:${t.tenantId}`;
  }
}

/**
 * À appeler par tout code qui écrit une donnée du verdict de session, dans la transaction `tx`
 * (avant ou juste après l'écriture, dans tous les cas AVANT le COMMIT). Idempotent par transaction
 * et par cible.
 *
 * Lève `UnavailableError` (503, `iam.session_cache_unavailable`) si l'invalidation ne peut être
 * enregistrée : la transaction appelante est alors annulée.
 */
export async function invalidateSessionVerdict(tx: SettleHost, target: SessionVerdictTarget | readonly SessionVerdictTarget[]): Promise<void> {
  const invalidator = current;
  if (!invalidator) return;

  const targets = Array.isArray(target) ? (target as readonly SessionVerdictTarget[]) : [target as SessionVerdictTarget];
  if (typeof tx.onSettled !== "function") {
    throw unavailable("Invalidation du cache de session impossible : transaction sans point de fin.");
  }
  let done = seen.get(tx);
  if (!done) {
    done = new Set();
    seen.set(tx, done);
  }
  const fresh = targets.filter((t) => !done.has(targetKey(t)));
  if (fresh.length === 0) return;

  try {
    await invalidator.begin(fresh);
  } catch (error) {
    throw unavailable("Le cache de session est injoignable : opération annulée par prudence, réessayez.", error);
  }
  for (const t of fresh) done.add(targetKey(t));
  tx.onSettled(() => invalidator.end(fresh));
}

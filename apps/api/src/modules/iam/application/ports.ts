/**
 * Ports du module iam (inversion de dépendances) : tout ce qui touche au monde
 * extérieur (Redis, e-mail, autorisation, super-admin) est derrière une interface
 * pour que les use cases restent testables sans réseau.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { LockoutRule, WindowRule } from "../config";

// -----------------------------------------------------------------------------
// Limitation de débit et verrouillage progressif
// -----------------------------------------------------------------------------

export interface WindowDecision {
  allowed: boolean;
  /** Nombre d'appels comptés dans la fenêtre courante (celui-ci inclus). */
  count: number;
  /** Temps avant la fin de la fenêtre, en ms. */
  retryAfterMs: number;
}

export interface LockStatus {
  blocked: boolean;
  /** Durée restante du verrou, en ms (0 si non bloqué). */
  retryAfterMs: number;
}

/**
 * Deux mécanismes complémentaires :
 *  - `hit` : fenêtre fixe (limitation de débit : ex. 20 demandes de reset / h / IP) ;
 *  - `lockStatus` / `recordFailure` / `clear` : verrouillage PROGRESSIF après des
 *    échecs répétés (le verrou double à chaque palier, jusqu'à un plafond, et le
 *    palier est mémorisé longtemps pour décourager les attaques lentes).
 *
 * Les implémentations doivent être ATOMIQUES (Lua pour Redis) : deux requêtes
 * concurrentes ne peuvent pas « partager » un seul échec.
 */
export interface RateLimiter {
  hit(key: string, rule: WindowRule): Promise<WindowDecision>;
  lockStatus(key: string): Promise<LockStatus>;
  recordFailure(key: string, rule: LockoutRule): Promise<LockStatus>;
  clear(key: string): Promise<void>;
}

// -----------------------------------------------------------------------------
// Notifications de compte (e-mail)
// -----------------------------------------------------------------------------

export interface AccountNotifier {
  /** `token` est le secret en clair à placer dans le lien ; il n'est stocké nulle part ailleurs que haché. */
  sendPasswordReset(input: { email: string; token: string; expiresAt: Date; tenantName?: string }): Promise<void>;
  sendInvitation(input: { email: string; token: string; expiresAt: Date; tenantName: string; invitedByEmail?: string }): Promise<void>;
}

export const noopNotifier: AccountNotifier = {
  async sendPasswordReset() {
    /* aucun transport configuré */
  },
  async sendInvitation() {
    /* aucun transport configuré */
  },
};

// -----------------------------------------------------------------------------
// Tâches d'arrière-plan (envoi d'e-mail hors du chemin de réponse)
// -----------------------------------------------------------------------------

/**
 * Exécute une tâche sans bloquer la réponse HTTP (un envoi SMTP lent ne doit pas
 * trahir l'existence d'un compte par le temps de réponse). Les erreurs sont
 * journalisées, jamais propagées. `drain()` sert aux tests et à l'arrêt propre.
 */
export interface BackgroundTasks {
  run(label: string, task: () => Promise<void>): void;
  drain(): Promise<void>;
}

// -----------------------------------------------------------------------------
// Principal authentifié (l'autorisation, elle, est fournie par le module rbac)
// -----------------------------------------------------------------------------

export interface AuthenticatedPrincipal {
  ctx: RequestContext;
  identityId: string;
  membershipId: string;
  sessionId: string;
  tenantSlug: string;
  /** Rôle actif de la session (seul pris en compte pour les permissions) et rôles disponibles. */
  activeRole: string;
  availableRoles: readonly string[];
  /** Facteurs satisfaits par la session. */
  mfa: boolean;
  /** Défini pour une session d'impersonation : l'acteur réel (super-admin). */
  impersonatedBy?: string;
}

// -----------------------------------------------------------------------------
// Authentification des super-admins (module platform / console)
// -----------------------------------------------------------------------------

export interface SuperAdminActor {
  id: string;
  email: string;
}

/** Authentifie l'appelant de la route d'impersonation. Renvoie `null` si non authentifié. */
export type SuperAdminAuthenticator = (request: { headers: Record<string, string | string[] | undefined> }) => Promise<SuperAdminActor | null>;

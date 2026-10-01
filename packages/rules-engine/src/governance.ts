import type { RuleScope, RuleStatus } from './model';

/**
 * Gouvernance (décision D5) :
 *
 *   draft -> simulated -> proposed -> approved -> published -> retired
 *               ^             |
 *        admin d'établissement     super-admin valide
 *
 * - L'admin d'établissement rédige, simule et propose ; il n'approuve ni ne
 *   publie jamais, et n'agit que sur les variantes de son établissement.
 * - Le super-admin peut tout faire (y compris les RuleSets nationaux) ;
 *   l'étape « simulated » est obligatoire avant « proposed ».
 */

export type Actor = 'tenant_admin' | 'super_admin';

export interface TransitionRequest {
  from: RuleStatus;
  to: RuleStatus;
  scope: RuleScope;
  actor: Actor;
}

export type TransitionDecision = { ok: true } | { ok: false; reason: string };

/** Transitions autorisées, avec les acteurs habilités. */
const TRANSITIONS: Readonly<Record<RuleStatus, Readonly<Partial<Record<RuleStatus, readonly Actor[]>>>>> = {
  draft: { simulated: ['tenant_admin', 'super_admin'] },
  simulated: {
    proposed: ['tenant_admin', 'super_admin'],
    // modifier la règle invalide la simulation
    draft: ['tenant_admin', 'super_admin'],
  },
  proposed: {
    approved: ['super_admin'],
    // rejet par le super-admin, ou retrait par l'auteur
    draft: ['tenant_admin', 'super_admin'],
  },
  approved: { published: ['super_admin'], retired: ['super_admin'] },
  published: { retired: ['super_admin'] },
  retired: {},
};

/** Statuts atteignables depuis `from` (tous acteurs confondus). */
export function nextStatuses(from: RuleStatus): RuleStatus[] {
  return Object.keys(TRANSITIONS[from]) as RuleStatus[];
}

export function canTransition(req: TransitionRequest): TransitionDecision {
  const allowed = TRANSITIONS[req.from][req.to];
  if (!allowed) {
    return { ok: false, reason: `Transition interdite : ${req.from} -> ${req.to}.` };
  }
  if (!allowed.includes(req.actor)) {
    return { ok: false, reason: `Seul le super-admin peut passer de ${req.from} à ${req.to}.` };
  }
  if (req.actor === 'tenant_admin' && req.scope.kind !== 'tenant') {
    return { ok: false, reason: 'Un admin d\'établissement ne peut pas modifier un RuleSet national.' };
  }
  return { ok: true };
}

/** Variante de `canTransition` qui lève une erreur explicite. */
export function assertTransition(req: TransitionRequest): void {
  const d = canTransition(req);
  if (!d.ok) throw new Error(d.reason);
}

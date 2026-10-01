/**
 * Registre de ports de `finance` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : annuaire d'apprenants (people) et d'inscriptions (academic). Résolution
 * PARESSEUSE ; un port absent garde son repli (apprenants : passe-plat ; inscriptions : toute référence refusée).
 * Un registre par application Fastify (`app.financePorts`, posé par `setup`).
 */
import type { EnrollmentDirectory, LearnerDirectory } from "./ports/directories";

export interface FinancePortSet {
  learners: LearnerDirectory;
  enrollments: EnrollmentDirectory;
}

export interface FinancePortRegistry {
  register(ports: Partial<FinancePortSet>): void;
  readonly current: Partial<FinancePortSet>;
}

export function createFinancePortRegistry(initial: Partial<FinancePortSet> = {}): FinancePortRegistry {
  const definedOnly = (v: Partial<FinancePortSet>): Partial<FinancePortSet> => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<FinancePortSet>;
  let current: Partial<FinancePortSet> = definedOnly(initial);
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

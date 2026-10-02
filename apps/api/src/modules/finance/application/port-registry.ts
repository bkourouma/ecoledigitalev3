/**
 * Registre de ports de `finance` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : annuaire d'apprenants (people) et d'inscriptions (academic). Résolution
 * PARESSEUSE ; un port absent garde son repli (apprenants : passe-plat ; inscriptions : toute référence refusée).
 * Un registre par application Fastify (`app.financePorts`, posé par `setup`).
 */
import type { EnrollmentDirectory, LearnerDirectory } from "./ports/directories";
import type { ReceiptDocumentPort } from "./ports/documents";
import type { GuardianshipPort } from "./ports/guardianship";

export interface FinancePortSet {
  learners: LearnerDirectory;
  enrollments: EnrollmentDirectory;
  /** Lien de tutelle / identité de l'élève (people) : routes famille. Non branché : aucun accès. */
  guardianship: GuardianshipPort;
  /** Rendu PDF des reçus (reportcards). Non branché : téléchargement indisponible (`finance.port_unavailable`). */
  documents: ReceiptDocumentPort;
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

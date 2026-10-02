/**
 * Ports vers le cœur académique (apprenants, inscriptions).
 *
 * Le module finance n'importe RIEN du futur module `academic` : il consomme ces deux
 * ports. Les implémentations par défaut ci-dessous permettent de construire et tester
 * le module avant l'arrivée du cœur académique ; la Phase 2 fournira un adaptateur qui
 * appelle l'API publique du module `academic`.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { EnrollmentRef, LearnerRef } from "../../domain/refs";

export interface LearnerDirectory {
  /** `null` si l'apprenant n'existe pas (dans le tenant du contexte). */
  getLearner(ctx: RequestContext, learnerId: string): Promise<LearnerRef | null>;
  /**
   * Facultatif — « NOM Prénom » de PLUSIEURS apprenants en UNE lecture (listes, exports : jamais une requête par apprenant).
   * Les identifiants inconnus ou invisibles sont absents du résultat. Décoration seulement : un échec ne casse jamais une liste.
   */
  getLearnerNames?(ctx: RequestContext, learnerIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface EnrollmentDirectory {
  getEnrollment(ctx: RequestContext, enrollmentId: string): Promise<EnrollmentRef | null>;
}

/** Accepte tout UUID d'apprenant (aucune vérification possible sans cœur académique). */
export const passThroughLearners: LearnerDirectory = Object.freeze({
  async getLearner(_ctx: RequestContext, learnerId: string): Promise<LearnerRef> {
    return { learnerId };
  },
});

/** Annuaire en mémoire (tests, développement). */
export class InMemoryEnrollmentDirectory implements EnrollmentDirectory {
  private readonly byId = new Map<string, EnrollmentRef>();
  constructor(refs: ReadonlyArray<EnrollmentRef> = []) {
    for (const r of refs) this.byId.set(r.enrollmentId, r);
  }
  add(ref: EnrollmentRef): void {
    this.byId.set(ref.enrollmentId, ref);
  }
  async getEnrollment(_ctx: RequestContext, enrollmentId: string): Promise<EnrollmentRef | null> {
    return this.byId.get(enrollmentId) ?? null;
  }
}

/** Aucune inscription connue : toute référence d'inscription est refusée. */
export const noEnrollments: EnrollmentDirectory = Object.freeze({
  async getEnrollment(): Promise<EnrollmentRef | null> {
    return null;
  },
});

export class InMemoryLearnerDirectory implements LearnerDirectory {
  private readonly byId = new Map<string, LearnerRef>();
  constructor(refs: ReadonlyArray<LearnerRef> = []) {
    for (const r of refs) this.byId.set(r.learnerId, r);
  }
  add(ref: LearnerRef): void {
    this.byId.set(ref.learnerId, ref);
  }
  async getLearner(_ctx: RequestContext, learnerId: string): Promise<LearnerRef | null> {
    return this.byId.get(learnerId) ?? null;
  }
  /** Lecture par lot : « NOM Prénom » des apprenants connus qui en ont un. */
  async getLearnerNames(_ctx: RequestContext, learnerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    for (const id of learnerIds) {
      const name = this.byId.get(id)?.displayName;
      if (name) out.set(id, name);
    }
    return out;
  }
}

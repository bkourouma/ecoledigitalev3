/**
 * Port « lien de tutelle / identité de l'élève » : qui peut voir la situation financière de QUEL apprenant.
 *
 * Le module finance ne connaît pas `people` : l'adaptateur de plateforme (`platform/adapters/people-finance.ts`) traduit
 * l'API publique de `people`. Les liens sont relus à CHAQUE requête (un lien clos ou archivé ne donne plus aucun accès).
 *
 * Échec FERMÉ : tant que le port n'est pas branché (`denyAllGuardianship`), personne n'est lié à personne.
 */
import type { RequestContext } from "@ecoledigitale/kernel";

export interface GuardianshipPort {
  /** Fiche élève liée à l'identité (`persons.identity_id`), ou `null` (jamais déduite de l'e-mail). */
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  /** L'identité est-elle le tuteur VIVANT de cet élève (portail ouvert, lien de nature `GUARDIAN`) ? */
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
  /** Élèves dont l'identité est le tuteur vivant. */
  childrenOf(ctx: RequestContext, userId: string): Promise<string[]>;
}

export const denyAllGuardianship: GuardianshipPort = Object.freeze({
  async studentIdForUser(): Promise<string | null> {
    return null;
  },
  async isGuardianOf(): Promise<boolean> {
    return false;
  },
  async childrenOf(): Promise<string[]> {
    return [];
  },
});

/** Annuaire en mémoire (tests, développement). */
export class InMemoryGuardianship implements GuardianshipPort {
  private readonly own = new Map<string, string>();
  private readonly links = new Map<string, Set<string>>();
  /** `userId` est l'élève `studentId`. */
  setStudent(userId: string, studentId: string): this {
    this.own.set(userId, studentId);
    return this;
  }
  /** `userId` est tuteur de `studentId`. */
  link(userId: string, studentId: string): this {
    const set = this.links.get(userId) ?? new Set<string>();
    set.add(studentId);
    this.links.set(userId, set);
    return this;
  }
  unlink(userId: string, studentId: string): this {
    this.links.get(userId)?.delete(studentId);
    return this;
  }
  async studentIdForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.own.get(userId) ?? null;
  }
  async isGuardianOf(_ctx: RequestContext, userId: string, studentId: string): Promise<boolean> {
    return this.links.get(userId)?.has(studentId) ?? false;
  }
  async childrenOf(_ctx: RequestContext, userId: string): Promise<string[]> {
    return [...(this.links.get(userId) ?? [])];
  }
}

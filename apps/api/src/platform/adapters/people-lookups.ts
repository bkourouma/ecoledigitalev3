/**
 * Recherches communes aux adaptateurs qui lisent `people` (et le repli de nom d'iam) : élève d'un compte, tutelle,
 * membre du personnel d'un compte, enfants d'un tuteur, nom d'affichage d'un utilisateur.
 *
 * L'identité d'un compte est son identifiant d'identité IAM (`ctx.userId`) : `people` lie `persons.identity_id` à cette
 * identité par une liaison EXPLICITE (jamais par e-mail). Un utilisateur sans fiche liée n'a aucun droit « élève »,
 * « tuteur » ni « personnel » (échec fermé).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { getMemberEmails } from "../../modules/iam";
import {
  getDisplayNamesOfIdentities,
  isGuardianOfStudent,
  listChildrenOfIdentity,
  resolveStaffForIdentity,
  resolveStudentForIdentity,
  type PeopleDeps,
} from "../../modules/people";

export interface PeopleLookups {
  studentIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  isGuardianOf(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
  childrenOf(ctx: RequestContext, userId: string): Promise<string[]>;
  staffIdForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  /** Nom de la personne liée au compte ; sinon la partie locale de l'e-mail du compte (jamais le domaine) ; sinon `null`. */
  displayNameOfUser(ctx: RequestContext, userId: string): Promise<string | null>;
}

/** Partie locale d'une adresse e-mail (avant « @ ») : repli de nom qui ne divulgue ni domaine ni adresse complète. */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export function createPeopleLookups(input: { people: PeopleDeps; tenantDb: Pick<TenantDb, "run"> }): PeopleLookups {
  const { people, tenantDb } = input;
  return {
    studentIdForUser: (ctx, userId) => resolveStudentForIdentity(people, ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => isGuardianOfStudent(people, ctx, userId, studentId),
    async childrenOf(ctx, userId) {
      const r = await listChildrenOfIdentity(people, ctx, userId);
      return r.ok ? r.value.map((s) => s.id) : [];
    },
    staffIdForUser: (ctx, userId) => resolveStaffForIdentity(people, ctx, userId),
    async displayNameOfUser(ctx, userId) {
      const names = await getDisplayNamesOfIdentities(people, ctx, [userId]);
      const name = names.get(userId);
      if (name) return name;
      const emails = await getMemberEmails(tenantDb, ctx, [userId]);
      const email = emails.get(userId);
      return email ? emailLocalPart(email) : null;
    },
  };
}

/**
 * people + iam -> documents : `OwnerDirectory` (liens de l'appelant, existence et noms des propriétaires, comptes du tenant,
 * recherche de personnes, comptes des tuteurs d'un élève).
 *
 *  - Les LIENS de l'appelant (fiche élève de son compte, enfants dont il est tuteur, fiche du personnel) sont relus à CHAQUE
 *    appel : le titulaire d'un compte est résolu par `persons.identity_id` (liaison explicite), jamais par e-mail ; un compte sans
 *    fiche liée n'a aucun droit « élève », « tuteur » ni « personnel » (échec fermé).
 *  - Toutes les lectures passent par l'API publique de people / iam, sous la RLS du tenant : un identifiant d'un autre tenant est
 *    simplement ABSENT des résultats.
 *  - Appels SÉQUENTIELS (connexion partagée par `TenantDb.run` imbriqué).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { OwnerDirectory, PersonRef } from "../../modules/documents";
import { getMemberEmails } from "../../modules/iam";
import { getDisplayNamesOfIdentities, getDisplayNamesOfStaff, getDisplayNamesOfStudents, listAudienceOfStudents, listStaff, listStudents, searchAudienceIdentities, type PeopleDeps } from "../../modules/people";
import { emailLocalPart, type PeopleLookups } from "./people-lookups";

export interface DocumentsOwnerDirectoryInput {
  readonly people: PeopleDeps;
  readonly lookups: PeopleLookups;
  readonly tenantDb: Pick<TenantDb, "run">;
}

const KIND_LABELS: Readonly<Record<string, string>> = { STUDENT: "élève", GUARDIAN: "tuteur", STAFF: "personnel" };

export function createDocumentsOwnerDirectory(input: DocumentsOwnerDirectoryInput): OwnerDirectory {
  const { people, lookups, tenantDb } = input;

  /** Noms de comptes : fiche de personne liée, sinon partie locale de l'e-mail du compte (jamais le domaine). Les inconnus sont absents. */
  async function userNames(ctx: RequestContext, userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const out = new Map<string, string>();
    if (unique.length === 0) return out;
    const names = await getDisplayNamesOfIdentities(people, ctx, unique);
    const emails = await getMemberEmails(tenantDb, ctx, unique); // membres ACTIFS du tenant : l'existence du compte
    for (const id of unique) {
      const email = emails.get(id);
      if (!email) continue; // pas membre de ce tenant : inconnu
      out.set(id, names.get(id) ?? emailLocalPart(email));
    }
    return out;
  }

  return {
    async resolveActorLinks(ctx) {
      const userId = ctx.userId;
      if (!userId) return { studentId: null, childStudentIds: [], staffId: null };
      const studentId = await lookups.studentIdForUser(ctx, userId);
      const childStudentIds = await lookups.childrenOf(ctx, userId);
      const staffId = await lookups.staffIdForUser(ctx, userId);
      return { studentId, childStudentIds, staffId };
    },

    async existingOwners(ctx, type, ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return new Set<string>();
      const names = type === "STUDENT" ? await getDisplayNamesOfStudents(people, ctx, unique) : await getDisplayNamesOfStaff(people, ctx, unique);
      return new Set(names.keys());
    },

    async ownerNames(ctx, type, ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return new Map<string, string>();
      return type === "STUDENT" ? getDisplayNamesOfStudents(people, ctx, unique) : getDisplayNamesOfStaff(people, ctx, unique);
    },

    async searchOwners(ctx, type: "STUDENT" | "STAFF", query, limit): Promise<readonly PersonRef[]> {
      if (type === "STUDENT") {
        const r = await listStudents(people, ctx, { q: query, limit, offset: 0 });
        return r.ok ? r.value.items.map((s) => ({ id: s.id, displayName: s.displayName, detail: s.studentNumber })) : [];
      }
      const r = await listStaff(people, ctx, { q: query, limit, offset: 0 });
      return r.ok ? r.value.items.map((s) => ({ id: s.id, displayName: s.displayName, detail: s.jobTitle ?? s.staffNumber })) : [];
    },

    userNames: (ctx, userIds) => userNames(ctx, userIds),

    async searchUsers(ctx, query, limit) {
      const r = await searchAudienceIdentities(people, ctx, query, limit);
      if (!r.ok) return [];
      return r.value.map((m) => ({ id: m.identityId, displayName: m.displayName, detail: m.kinds.map((k) => KIND_LABELS[k] ?? k).join(", ") || null }));
    },

    async guardianUsers(ctx, studentId) {
      const r = await listAudienceOfStudents(people, ctx, [studentId]);
      const student = r.ok ? r.value[0] : undefined;
      return student ? student.guardians.map((g) => ({ id: g.identityId, displayName: g.displayName, detail: "tuteur" })) : [];
    },
  };
}

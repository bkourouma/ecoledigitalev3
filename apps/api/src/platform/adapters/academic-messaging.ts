/**
 * academic + people + rbac -> messaging : `AudienceDirectory` (cibles d'annonce : établissement, établissement scolaire,
 * campus, niveau, classe, rôle ; résolution en comptes d'utilisateurs).
 *
 * Résolution : une cible est étendue en CLASSES ACTIVES d'academic (établissement scolaire -> `institutionId`, campus -> `campusId`
 * de la classe, niveau -> `gradeLevelId`), puis chaque classe en personnes joignables par l'annuaire des personnes (élèves
 * inscrits aujourd'hui, tuteurs avec accès au portail et compte actif, enseignants affectés aujourd'hui). Le personnel d'un
 * établissement scolaire ou du tenant entier s'ajoute par les fiches de personnel actives. Une cible `ROLE` se résout par les
 * titulaires du rôle (RBAC), sans tenir compte des audiences. Résultat DÉDOUBLONNÉ, plafonné à `limit` (`truncated`).
 *
 * Existence : établissement scolaire (tenancy via l'annuaire d'academic), classe (academic), rôle (RBAC). Campus et niveau ne
 * sont pas vérifiables sans lecture directe de leurs tables : une cible qui ne couvre aucune classe donne une audience VIDE,
 * refusée par le module (`messaging.audience_empty`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getClassroom, listClassrooms } from "../../modules/academic";
import type { AudienceDirectory, MessagingAudience, PeopleDirectory } from "../../modules/messaging";
import { getStaffByIds, listStaff } from "../../modules/people";
import { listRoleHolders, type MessagingDirectoryInput } from "./people-messaging";

const CLASS_PAGE = 200;
const STAFF_PAGE = 200;
const STAFF_STATUSES = ["ACTIVE", "ON_LEAVE"];

export function createMessagingAudienceDirectory(input: MessagingDirectoryInput & { directory: PeopleDirectory }): AudienceDirectory {
  const { academic, people, directory } = input;

  async function activeClassrooms(ctx: RequestContext, filter: { institutionId?: string; gradeLevelId?: string }): Promise<Array<{ id: string; campusId: string | null }>> {
    const out: Array<{ id: string; campusId: string | null }> = [];
    for (let page = 1; page <= 200; page += 1) {
      const r = await listClassrooms(academic, ctx, { ...filter, status: "ACTIVE", page, pageSize: CLASS_PAGE });
      if (!r.ok) break;
      out.push(...r.value.items.map((c) => ({ id: c.id, campusId: c.campusId })));
      if (r.value.items.length < CLASS_PAGE) break;
    }
    return out;
  }

  /** Comptes du personnel actif (tenant entier ou établissement scolaire). */
  async function staffAccounts(ctx: RequestContext, institutionId: string | undefined): Promise<string[]> {
    const ids: string[] = [];
    for (const status of STAFF_STATUSES) {
      for (let offset = 0; offset < 20_000; offset += STAFF_PAGE) {
        const r = await listStaff(people, ctx, { status, limit: STAFF_PAGE, offset, ...(institutionId ? { institutionId } : {}) });
        if (!r.ok) break;
        ids.push(...r.value.items.map((s) => s.id));
        if (r.value.items.length < STAFF_PAGE) break;
      }
    }
    const accounts: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const staff = await getStaffByIds(people, ctx, ids.slice(i, i + 100));
      if (staff.ok) for (const s of staff.value) if (s.identityId) accounts.push(s.identityId);
    }
    return accounts;
  }

  return {
    async firstUnknownTarget(ctx, targets) {
      for (const t of targets) {
        if (t.kind === "CLASSROOM") {
          const r = await getClassroom(academic, ctx, t.ref ?? "");
          if (!r.ok) return t;
        } else if (t.kind === "INSTITUTION") {
          if (!(await academic.ports.institutions.getInstitution(ctx, t.ref ?? ""))) return t;
        }
        // ROLE, CAMPUS, LEVEL : non vérifiables sans lecture directe des tables d'un autre module ; une cible sans titulaire
        // ni classe donne une audience vide, refusée par le module (`messaging.audience_empty`).
      }
      return null;
    },

    async resolveAudience(ctx, { targets, audiences, limit }) {
      const wants = (a: MessagingAudience): boolean => audiences.includes(a);
      const out = new Set<string>();
      let truncated = false;
      const add = (id: string): void => {
        if (out.has(id)) return;
        if (out.size >= limit) {
          truncated = true;
          return;
        }
        out.add(id);
      };

      const classrooms = new Set<string>();
      let tenantStaff = false;
      const institutionStaff = new Set<string>();
      for (const t of targets) {
        switch (t.kind) {
          case "ROLE": {
            for (const id of (await listRoleHolders(input, ctx, [t.ref ?? ""])).keys()) add(id);
            break;
          }
          case "TENANT": {
            for (const c of await activeClassrooms(ctx, {})) classrooms.add(c.id);
            tenantStaff = true;
            break;
          }
          case "INSTITUTION": {
            for (const c of await activeClassrooms(ctx, { institutionId: t.ref ?? "" })) classrooms.add(c.id);
            institutionStaff.add(t.ref ?? "");
            break;
          }
          case "CAMPUS": {
            for (const c of await activeClassrooms(ctx, {})) if (c.campusId === t.ref) classrooms.add(c.id);
            break;
          }
          case "LEVEL": {
            for (const c of await activeClassrooms(ctx, { gradeLevelId: t.ref ?? "" })) classrooms.add(c.id);
            break;
          }
          case "CLASSROOM": {
            classrooms.add(t.ref ?? "");
            break;
          }
        }
      }

      const include = [...(wants("STUDENTS") ? (["STUDENTS"] as const) : []), ...(wants("GUARDIANS") ? (["GUARDIANS"] as const) : []), ...(wants("STAFF") ? (["TEACHERS"] as const) : [])];
      if (include.length > 0) {
        for (const id of classrooms) {
          const res = await directory.listClassroomContacts(ctx, id, include);
          for (const c of res.contacts) add(c.userId);
        }
      }
      if (wants("STAFF")) {
        if (tenantStaff) for (const id of await staffAccounts(ctx, undefined)) add(id);
        else for (const inst of institutionStaff) for (const id of await staffAccounts(ctx, inst)) add(id);
      }
      return { userIds: [...out].sort(), truncated };
    },
  };
}

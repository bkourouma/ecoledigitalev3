/**
 * Lectures d'audience publiées pour la messagerie (spec v2/016) : comptes joignables d'élèves, de leurs tuteurs, et
 * recherche par nom. Extension ADDITIVE : lectures seules, aucune coordonnée (ni e-mail, ni téléphone), la liaison
 * personne <-> compte reste `persons.identity_id` (jamais l'e-mail).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { displayName } from "../domain/normalize";
import { listGuardianAudience, listStudentAudience, searchPortalIdentities } from "../infrastructure/audience-repo";
import type { PeopleDeps } from "./deps";

export interface AudienceIdentity {
  readonly identityId: string;
  readonly displayName: string;
}

export interface StudentAudience {
  readonly studentId: string;
  readonly studentName: string;
  /** Compte de l'élève, `null` s'il n'en a pas (ou s'il est suspendu). */
  readonly student: AudienceIdentity | null;
  /** Tuteurs joignables (lien vivant, accès portail, compte actif). */
  readonly guardians: ReadonlyArray<AudienceIdentity & { readonly guardianId: string }>;
}

export const AUDIENCE_MAX_STUDENTS = 2000;

export async function listAudienceOfStudents(deps: Pick<PeopleDeps, "db">, ctx: RequestContext, studentIds: readonly string[]): Promise<Result<StudentAudience[], AppError>> {
  const ids = [...new Set(studentIds)].slice(0, AUDIENCE_MAX_STUDENTS);
  const { students, guardians } = await deps.db.run(
    ctx,
    async (tx) => ({
      students: await listStudentAudience(tx, ctx.tenantId, ids),
      guardians: await listGuardianAudience(tx, ctx.tenantId, ids),
    }),
    { readOnly: true },
  );
  const byStudent = new Map<string, Array<AudienceIdentity & { guardianId: string }>>();
  for (const g of guardians) {
    const list = byStudent.get(g.studentId) ?? [];
    list.push({ identityId: g.identityId, guardianId: g.guardianId, displayName: displayName(g.lastName, g.firstName) });
    byStudent.set(g.studentId, list);
  }
  return ok(
    students.map((s) => ({
      studentId: s.studentId,
      studentName: displayName(s.lastName, s.firstName),
      student: s.identityId ? { identityId: s.identityId, displayName: displayName(s.lastName, s.firstName) } : null,
      guardians: byStudent.get(s.studentId) ?? [],
    })),
  );
}

export interface IdentityMatch extends AudienceIdentity {
  readonly kinds: ReadonlyArray<"STUDENT" | "GUARDIAN" | "STAFF">;
}

/** Recherche par nom parmi les personnes dotées d'un compte actif (au plus 50). */
export async function searchAudienceIdentities(deps: Pick<PeopleDeps, "db">, ctx: RequestContext, query: string, limit = 20): Promise<Result<IdentityMatch[], AppError>> {
  const q = query.trim();
  if (q.length < 2) return ok([]);
  const rows = await deps.db.run(ctx, (tx) => searchPortalIdentities(tx, ctx.tenantId, q, limit), { readOnly: true });
  return ok(
    rows.map((r) => ({
      identityId: r.identityId,
      displayName: displayName(r.lastName, r.firstName),
      kinds: [...(r.isStudent ? (["STUDENT"] as const) : []), ...(r.isGuardian ? (["GUARDIAN"] as const) : []), ...(r.isStaff ? (["STAFF"] as const) : [])],
    })),
  );
}

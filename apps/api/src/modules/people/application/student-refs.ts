/**
 * Résolution par lots de références d'élèves d'un FICHIER (imports 031) : matricule d'origine (`external_ref`) ou
 * matricule de la plateforme (`student_number`) -> identifiant d'élève. Lecture seule, sans contrôle de périmètre (l'appelant
 * a déjà autorisé sa propre opération : un import exige `student.create` ou `grade.enter`, etc.), réponse minimale.
 *
 * Plafond de 500 références par appel (une requête SQL) ; les références inconnues sont simplement absentes du résultat.
 */
import { ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { inTx, type PeopleDeps } from "./deps";

export const STUDENT_REFS_MAX = 500;

export interface StudentRefMatch {
  /** Référence demandée, telle quelle (la correspondance est insensible à la casse et aux espaces de bord). */
  readonly ref: string;
  readonly studentId: string;
  readonly studentNumber: string;
  readonly externalRef: string | null;
  /** Par quelle colonne la référence a été reconnue. */
  readonly matchedBy: "EXTERNAL_REF" | "STUDENT_NUMBER";
}

export async function resolveStudentRefs(deps: PeopleDeps, ctx: RequestContext, refs: readonly string[]): Promise<Result<StudentRefMatch[], AppError>> {
  // Dédoublonnage insensible à la casse (la correspondance l'est) : la première graphie demandée est conservée.
  const seenKeys = new Set<string>();
  const wanted = refs
    .map((r) => r.trim())
    .filter((r) => {
      if (r === "" || seenKeys.has(r.toUpperCase())) return false;
      seenKeys.add(r.toUpperCase());
      return true;
    });
  if (wanted.length === 0) return ok([]);
  if (wanted.length > STUDENT_REFS_MAX) return err(new ValidationError(`Au plus ${STUDENT_REFS_MAX} références par appel.`, [{ path: ["refs"], message: "Trop de références.", code: "people.invalid_input" }]));
  const upper = wanted.map((r) => r.toUpperCase());
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await tx.many<{ studentId: string; studentNumber: string; externalRef: string | null }>(
        `SELECT id AS "studentId", student_number AS "studentNumber", external_ref AS "externalRef"
           FROM people.students
          WHERE tenant_id = $1 AND (upper(external_ref) = ANY($2::text[]) OR upper(student_number) = ANY($2::text[]))`,
        [ctx.tenantId, upper],
      );
      const byExternal = new Map<string, (typeof rows)[number]>();
      const byNumber = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (r.externalRef) byExternal.set(r.externalRef.toUpperCase(), r);
        byNumber.set(r.studentNumber.toUpperCase(), r);
      }
      const out: StudentRefMatch[] = [];
      wanted.forEach((ref, i) => {
        const key = upper[i] as string;
        // Le matricule d'origine prime : il est celui du fichier ; le matricule de la plateforme est le repli.
        const ext = byExternal.get(key);
        const num = byNumber.get(key);
        const hit = ext ?? num;
        if (hit) out.push({ ref, studentId: hit.studentId, studentNumber: hit.studentNumber, externalRef: hit.externalRef, matchedBy: ext ? "EXTERNAL_REF" : "STUDENT_NUMBER" });
      });
      return ok(out);
    },
    { readOnly: true },
  );
}

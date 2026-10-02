/**
 * schoollife -> councils : `SchoolLifePort` — COMPTAGES et CODES de vie scolaire d'une inscription pour l'instantané du conseil (mesures en
 * vigueur par famille et par gravité, jours d'exclusion, points de conduite quand un barème est actif).
 *
 * Minimisation : jamais un texte libre, une déclaration d'élève ni un élément confidentiel (les fonctions publiques de `schoollife` lisent sous
 * l'audience `STAFF_RESTRICTED` : le confidentiel est exclu par la règle SQL unique). Les points de conduite sont une AIDE ; la note de conduite
 * du bulletin reste une saisie humaine. Aucune lecture ne signale « indisponible » autrement que par `null`.
 */
import { getConductPoints, getDisciplineFacts, getStudentLifeSummary, type SchoolLifeDeps } from "../../modules/schoollife";
import type { CouncilsSchoolLifePort } from "../../modules/councils";

export function createCouncilsSchoolLifePort(schoollife: SchoolLifeDeps): CouncilsSchoolLifePort {
  return {
    async disciplineFacts(ctx, { enrollmentId, studentId, academicYearId }) {
      const summary = await getStudentLifeSummary(schoollife, ctx, { studentId, academicYearId });
      const breakdown = await getDisciplineFacts(schoollife, ctx, { enrollmentId });
      const conduct = await getConductPoints(schoollife, ctx, { enrollmentId }).catch(() => null);
      const measuresByKind: Record<string, number> = {};
      const measuresBySeverity: Record<string, number> = {};
      for (const row of breakdown) {
        measuresByKind[row.kind] = (measuresByKind[row.kind] ?? 0) + row.count;
        const severity = row.severityCode ?? "NONE";
        measuresBySeverity[severity] = (measuresBySeverity[severity] ?? 0) + row.count;
      }
      return { available: true, measuresByKind, measuresBySeverity, exclusionDays: summary.exclusionDays, conductPoints: conduct ? conduct.points : null };
    },
  };
}

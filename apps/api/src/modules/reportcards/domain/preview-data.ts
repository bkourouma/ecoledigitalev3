/**
 * Données FICTIVES pour l'aperçu d'un gabarit (spec 013 AC5.3) : jamais d'élève réel, jamais de nom de personne ni
 * d'établissement réels. Les noms sont manifestement génériques (« Élève Exemple »).
 */
import type { FinalResultBundle, Pack, ReportcardSnapshotLine } from "./types";

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";
const HASH = "0".repeat(64);

function line(partial: Partial<ReportcardSnapshotLine> & Pick<ReportcardSnapshotLine, "level" | "code" | "label">): ReportcardSnapshotLine {
  return {
    parentCode: null, category: null, coefficient: null, credits: null, exact: null, display: null, weighted: null, rank: null, rankOf: null,
    state: null, session: null, mention: null, appreciation: null, periodLabel: null, ...partial,
  };
}

export function previewBundle(pack: Pack, kind: "REPORT_CARD" | "TRANSCRIPT"): FinalResultBundle {
  const higher = pack === "HIGHER" || pack === "VIRTUAL";
  const lines: ReportcardSnapshotLine[] = [];
  if (kind === "TRANSCRIPT") {
    for (const [i, periodLabel] of ["Semestre 1", "Semestre 2"].entries()) {
      lines.push(
        line({ level: "ECUE", code: `U${i + 1}01`, label: "Matière exemple A", credits: "4.00", exact: "13.50", display: "13,50", state: "VALIDATED", periodLabel }),
        line({ level: "ECUE", code: `U${i + 1}02`, label: "Matière exemple B", credits: "2.00", exact: "9.25", display: "9,25", state: "NOT_VALIDATED", periodLabel }),
      );
    }
  } else if (higher) {
    lines.push(
      line({ level: "UE", code: "UE1", label: "Unité d'enseignement exemple 1", credits: "6.00", exact: "12.40", display: "12,40", state: "VALIDATED", session: 1 }),
      line({ level: "ECUE", code: "UE1-A", label: "Élément constitutif A", parentCode: "UE1", credits: "4.00", coefficient: "2.00", exact: "13.00", display: "13,00", weighted: "26,00", state: "VALIDATED", session: 1 }),
      line({ level: "ECUE", code: "UE1-B", label: "Élément constitutif B", parentCode: "UE1", credits: "2.00", coefficient: "1.00", exact: "11.20", display: "11,20", weighted: "11,20", state: "VALIDATED", session: 1 }),
      line({ level: "UE", code: "UE2", label: "Unité d'enseignement exemple 2", credits: "4.00", exact: "8.50", display: "8,50", state: "NOT_VALIDATED", session: 1 }),
      line({ level: "ECUE", code: "UE2-A", label: "Élément constitutif C", parentCode: "UE2", credits: "4.00", coefficient: "2.00", exact: "8.50", display: "8,50", weighted: "17,00", state: "NOT_VALIDATED", session: 1 }),
    );
  } else {
    for (const [i, label] of ["Matière exemple 1", "Matière exemple 2", "Matière exemple 3", "Matière exemple 4"].entries()) {
      lines.push(line({ level: "SUBJECT", code: `M${i + 1}`, label, coefficient: i === 0 ? "3.00" : "2.00", exact: "14.00", display: "14,00", weighted: i === 0 ? "42,00" : "28,00", rank: i + 3, rankOf: 30, appreciation: "Bon travail." }));
    }
  }
  return {
    student: { id: ZERO_UUID, lastName: "EXEMPLE", firstNames: "Élève", matricule: "MAT-0000", birthDate: "2010-01-01", birthPlace: "Ville exemple", gender: null, nationality: null, repeating: false },
    enrollment: {
      id: kind === "TRANSCRIPT" ? null : ZERO_UUID,
      classroomId: kind === "TRANSCRIPT" ? null : ZERO_UUID,
      classroomLabel: kind === "TRANSCRIPT" ? null : "Classe exemple",
      levelLabel: kind === "TRANSCRIPT" ? null : "Niveau exemple",
      programLabel: higher && kind !== "TRANSCRIPT" ? "Filière exemple" : null,
      academicYearId: ZERO_UUID,
      academicYearLabel: "2025-2026",
      periodId: kind === "TRANSCRIPT" ? null : ZERO_UUID,
      periodLabel: kind === "TRANSCRIPT" ? null : "Période exemple",
      classSize: kind === "TRANSCRIPT" ? null : 30,
    },
    lines,
    summary: {
      averageExact: "12.35", averageDisplay: "12,35", rank: 5, classSize: 30, classAverageDisplay: "11,10", mention: "ASSEZ_BIEN", decisionCode: "ADMITTED", decisionOutcome: "PASS",
      creditsAcquired: higher ? "24.00" : null, creditsRequired: higher ? "30.00" : null, totalCoefficient: higher ? null : "9.00", weightedTotal: higher ? null : "98,00", distinctions: [],
    },
    annual: null,
    deliberation: kind === "TRANSCRIPT" ? null : { heldOn: "2026-01-15", nature: higher ? "JURY" : "COUNCIL" },
    generalAppreciation: "Appréciation d'exemple du conseil.",
    attendance: { justifiedMinutes: 150, unjustifiedMinutes: 60, lateCount: 2 },
    rules: {
      ruleSetCode: "EXEMPLE", ruleVersionNo: 1, ruleVersionId: ZERO_UUID, definitionHash: HASH, contractId: "exemple@1", engineVersion: "0.0.0",
      resultsStateId: ZERO_UUID, resultsVersion: 1, closureHash: HASH,
    },
    labels: {
      VALIDATED: "Validé", NOT_VALIDATED: "Non validé", ASSEZ_BIEN: "Assez bien", ADMITTED: "Admis", PASS: "Admis",
    },
    explain: [],
  };
}

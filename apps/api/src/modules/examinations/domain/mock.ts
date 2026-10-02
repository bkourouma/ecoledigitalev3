/**
 * Examen blanc : préparation des ENTRÉES des règles du contrat `exam-national@1` (aucune formule ici).
 *
 * Le module transporte les notes vers `moyenne_candidat` et `resultat_candidat` ; la moyenne, l'issue, la mention et le rang sont
 * calculés PAR LA RÈGLE de la version épinglée. Une épreuve sans note ENTERED est transmise `absent = true`, `note = null`
 * (jamais 0 : « absent » n'est pas « zéro », la règle décide — paramètre `absence_vaut_zero`).
 *
 * Hypothèse documentée : le modèle de données ne porte pas d'indicateur d'épreuve ÉLIMINATOIRE ; le compteur transmis à la
 * règle (`epreuves_eliminatoires_echouees`) vaut donc 0 tant que le texte officiel (Q-E06) n'a pas ajouté cette donnée.
 */
import { createHash } from "node:crypto";
import { normalizeDecimal } from "./decimal";
import type { ScoreStatus, SessionPaperRow } from "./types";

export interface MockScoreInput {
  paperId: string;
  status: ScoreStatus;
  score: string | null;
}

export interface RulePaperInput {
  note: string | null;
  coef: string;
  bareme: string;
  facultative: boolean;
  absent: boolean;
}

export interface MockCandidateInputs {
  epreuves: RulePaperInput[];
  /** Épreuves OBLIGATOIRES de la série sans note saisie (information transmise à `resultat_candidat`). */
  absentCount: number;
}

/** Épreuves qui concernent la série du candidat : communes (série absente) ou propres à sa série. */
export function applicablePapers(papers: readonly SessionPaperRow[], candidateTrack: string | null): SessionPaperRow[] {
  return papers.filter((p) => p.trackCode === null || p.trackCode === candidateTrack).sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code));
}

export function buildMockInputs(papers: readonly SessionPaperRow[], scores: readonly MockScoreInput[], candidateTrack: string | null): MockCandidateInputs {
  const byPaper = new Map(scores.map((s) => [s.paperId, s]));
  const epreuves: RulePaperInput[] = [];
  let absentCount = 0;
  for (const p of applicablePapers(papers, candidateTrack)) {
    const s = byPaper.get(p.id);
    const noted = s?.status === "ENTERED" && s.score !== null;
    if (!noted && !p.isOptional) absentCount += 1;
    epreuves.push({
      note: noted ? normalizeDecimal(s?.score as string) : null,
      coef: normalizeDecimal(p.coefficient),
      bareme: normalizeDecimal(p.scaleMax),
      facultative: p.isOptional,
      absent: !noted,
    });
  }
  return { epreuves, absentCount };
}

/** Code du type d'évaluation `assess` d'un examen blanc (non visible des élèves) : convention d'intégration, pas une règle d'examen. */
export const MOCK_ASSESSMENT_TYPE_CODE = "EXAMEN_BLANC";

/**
 * Correspondance des états de saisie d'`assess` vers ceux d'une note d'épreuve. Une note publiée devient `ENTERED` ; une absence
 * (justifiée ou non) reste une ABSENCE, jamais un zéro ; « dispensé » et « non noté » ne produisent aucune ligne (l'épreuve est
 * transmise à la règle comme absente, qui décide — `absence_vaut_zero`).
 */
export function mapAssessEntry(entryStatus: string, score: string | null): { status: ScoreStatus; score: string | null } | null {
  switch (entryStatus) {
    case "ENTERED":
      return score === null ? null : { status: "ENTERED", score: normalizeDecimal(score) };
    case "ABSENT_UNEXCUSED":
      return { status: "ABSENT", score: null };
    case "ABSENT_EXCUSED":
      return { status: "EXCUSED", score: null };
    default:
      return null;
  }
}

/** Empreinte d'entrées d'un résultat calculé : agrège les empreintes de chaque appel de règle (ordre fixe) — reproductible. */
export function combineInputHashes(hashes: readonly string[]): string {
  return createHash("sha256").update(hashes.join("|")).digest("hex");
}

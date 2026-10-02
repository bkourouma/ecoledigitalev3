/**
 * Faits publiés pour les modules `results` (011), `higher` (019), `attendance` (010), `scheduling` (017) et
 * `payroll` (032) — formes de lecture et fonctions PURES de dérivation. Les adaptateurs de la plateforme
 * (`apps/api/src/platform/adapters`) les traduisent vers les ports de ces modules ; aucun de ces modules n'importe
 * `academic` autrement que par son `index.ts`.
 *
 * Aucune valeur n'est devinée : le contrat de calcul, le drapeau d'examen terminal, le mode de saisie, le rattrapage
 * et la section de bilan sont des DONNÉES du curriculum, jamais déduites d'un libellé ou d'un nom de classe.
 */
import type { AcademicPeriod, CurriculumNode, PeriodType } from "./records";

/** Types de nœuds SYSTÈME que les contrats de calcul comprennent (grammaire `is_system` des modèles de pack). */
export const RESULT_NODE_KINDS = ["UE", "ECUE", "SUBJECT"] as const;
export type ResultNodeKind = (typeof RESULT_NODE_KINDS)[number];

export interface ResultsPeriodFacts {
  id: string;
  typeCode: string;
  /** Rang (1..n) parmi les périodes d'enseignement de même parent, par date de début puis ordinal. */
  rankInYear: number;
  countInYear: number;
  /** Dernière période d'enseignement d'une année qui en compte au moins deux (« second semestre »). */
  isLast: boolean;
  startsOn: string;
  endsOn: string;
}

export interface ResultsStructureNode {
  id: string;
  lineageId: string;
  /** Plus proche ancêtre retenu (UE pour une ECUE), sinon `null`. */
  parentId: string | null;
  kind: ResultNodeKind;
  code: string;
  label: string;
  /** Position dans un parcours en profondeur de l'arbre (ordre total stable). */
  position: number;
  credits: string | null;
  coefficient: string | null;
  gradingMode: "COMPOSED" | "DIRECT";
  resitAllowed: boolean;
  countsInAverage: boolean;
  sectionKey: string | null;
  categoryCode: string | null;
  isTransversal: boolean;
}

export interface ResultsStructure {
  classroomId: string;
  academicYearId: string;
  institutionId: string;
  programId: string;
  educationLevelCode: string;
  gradeLevelCode: string;
  /** Contrat du programme, sinon celui du cycle d'enseignement ; `null` = aucun (les résultats échouent fermé). */
  calculationContract: string | null;
  terminalExamRequired: boolean;
  period: ResultsPeriodFacts;
  /** Première période d'enseignement de l'année (si la période demandée n'est pas la première). */
  firstPeriodId: string | null;
  yearPeriods: ResultsPeriodFacts[];
  nodes: ResultsStructureNode[];
}

const isTeaching = (types: ReadonlyMap<string, PeriodType>, p: AcademicPeriod): boolean => (types.get(p.periodTypeCode)?.kind ?? "TEACHING_PERIOD") === "TEACHING_PERIOD";

/**
 * Faits de rang d'une période : parmi ses sœurs d'enseignement (même parent), triées par date de début puis ordinal.
 * Une période d'examen (session) n'entre pas dans le rang. Renvoie `null` si la période est inconnue.
 */
export function periodFactsOf(periods: readonly AcademicPeriod[], periodId: string, types: ReadonlyMap<string, PeriodType>): { period: ResultsPeriodFacts; yearPeriods: ResultsPeriodFacts[] } | null {
  const target = periods.find((p) => p.id === periodId);
  if (!target) return null;
  const siblings = periods.filter((p) => p.parentPeriodId === target.parentPeriodId && isTeaching(types, p)).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const countInYear = siblings.length;
  const toFacts = (p: AcademicPeriod, index: number): ResultsPeriodFacts => ({
    id: p.id,
    typeCode: p.periodTypeCode,
    rankInYear: index + 1,
    countInYear,
    isLast: countInYear >= 2 && index === countInYear - 1,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
  });
  const yearPeriods = siblings.map(toFacts);
  const own = yearPeriods.find((p) => p.id === periodId);
  // Une période d'examen (hors rang) est décrite sans rang : rang = nombre de sœurs, pas « dernière ».
  const period = own ?? { id: target.id, typeCode: target.periodTypeCode, rankInYear: countInYear, countInYear, isLast: false, startsOn: target.startsOn, endsOn: target.endsOn };
  return { period, yearPeriods };
}

/**
 * Nœuds de structure de calcul à partir des nœuds SUIVIS (déjà filtrés par période) : seuls `UE`, `ECUE` et `SUBJECT` sont
 * retenus ; `parentId` pointe le plus proche ancêtre retenu. `position` suit un parcours en profondeur (frères par ordinal
 * puis code), indépendamment de l'ordre d'entrée.
 */
export function structureNodesOf(followed: readonly CurriculumNode[]): ResultsStructureNode[] {
  const byId = new Map(followed.map((n) => [n.id, n]));
  const kept = new Set(followed.filter((n) => (RESULT_NODE_KINDS as readonly string[]).includes(n.nodeTypeCode)).map((n) => n.id));
  const children = new Map<string | null, CurriculumNode[]>();
  for (const n of followed) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  for (const list of children.values()) list.sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  const keptAncestor = (n: CurriculumNode): string | null => {
    let cursor = n.parentId ? byId.get(n.parentId) : undefined;
    let guard = 0;
    while (cursor && guard < 32) {
      if (kept.has(cursor.id)) return cursor.id;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }
    return null;
  };
  const out: ResultsStructureNode[] = [];
  let position = 0;
  const walk = (parentKey: string | null): void => {
    for (const n of children.get(parentKey) ?? []) {
      if (kept.has(n.id)) {
        out.push({
          id: n.id,
          lineageId: n.lineageId,
          parentId: keptAncestor(n),
          kind: n.nodeTypeCode as ResultNodeKind,
          code: n.code,
          label: n.label,
          position: position++,
          credits: n.credits,
          coefficient: n.coefficient,
          gradingMode: n.gradingMode,
          resitAllowed: n.resitAllowed,
          countsInAverage: n.countsInAverage,
          sectionKey: n.sectionKey,
          categoryCode: n.categoryCode,
          isTransversal: n.isTransversal,
        });
      }
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

/** Contrat effectif : celui du programme, sinon celui du cycle d'enseignement ; jamais de valeur par défaut. */
export function effectiveContract(program: { calculationContract: string | null }, educationLevel: { calculationContract: string | null } | null): string | null {
  return program.calculationContract ?? educationLevel?.calculationContract ?? null;
}

// ---------------------------------------------------------------------------
// Higher : cycles, UE (identité = LIGNÉE, stable d'une année à l'autre), inscriptions du cycle
// ---------------------------------------------------------------------------

export interface CycleFacts {
  programId: string;
  code: string;
  label: string;
  isCycle: boolean;
  institutionId: string;
}

export interface UeFacts {
  /** Identité stable de l'UE : la LIGNÉE (les nœuds sont recréés à chaque année par le clonage). */
  lineageId: string;
  /** Nœud de la version la plus récente (affichage, rattrapage). */
  nodeId: string;
  code: string;
  label: string;
  credits: string;
  categoryCode: string | null;
  programId: string;
  academicYearId: string;
}

export interface CycleEnrollmentFacts {
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  academicYearId: string;
  status: string;
}

export interface LastEnrollmentFacts {
  enrollmentId: string;
  academicYearId: string;
  academicYearCode: string;
  academicYearLabel: string;
  classroomId: string;
}

export interface ClassroomFacts {
  classroomId: string;
  /** Nom de la classe (libellé imprimé sur les documents). */
  name: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  academicYearStartsOn: string;
  academicYearEndsOn: string;
  programId: string;
  programCode: string;
  programLabel: string;
  academicYearCode: string;
  academicYearLabel: string;
  educationLevelCode: string;
  /** Pack du cycle d'enseignement (`PRIMARY`, `SECONDARY`, `HIGHER`, `VIRTUAL`) ; `null` si non renseigné. */
  pack: "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL" | null;
  gradeLevelCode: string;
  gradeLevelLabel: string;
  kind: "CLASS" | "COHORT";
  status: string;
  headcount: number;
  curriculumVersionId: string | null;
}

export interface ClassroomEnrollmentFacts {
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  academicYearId: string;
  status: string;
  /** Inscription qui ouvre la scolarité ET dont la classe actuelle est celle-ci. */
  active: boolean;
}

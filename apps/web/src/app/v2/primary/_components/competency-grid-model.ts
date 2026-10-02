/**
 * Modèle de la grille élèves × compétences : logique PURE (testée sans DOM).
 *
 * Ce module traduit les choix de l'instituteur en lignes de lot pour `PUT /competency-assessments/bulk`. Il ne calcule JAMAIS de
 * moyenne, de pourcentage « acquis », de rang, de seuil ni de décision : les niveaux de maîtrise sont des CODES choisis dans
 * l'échelle du référentiel ; seuls des COMPTAGES (saisies / attendues) sont produits pour l'affichage.
 *
 * Principes :
 *  - une compétence NON SAISIE reste « non évaluée » : jamais 0, jamais un niveau par défaut (aucune valeur n'est inventée) ;
 *  - une saisie locale (brouillon) n'existe que si elle DIFFÈRE de la valeur enregistrée ;
 *  - une ligne VALIDÉE est figée : seule une révision motivée la corrige (elle n'entre jamais dans un lot) ;
 *  - une ligne existante part avec sa `rowVersion` (verrou optimiste), une nouvelle ligne sans ;
 *  - un lot compte 500 lignes au plus (contrat) : au-delà, tranches successives, chacune TOUT OU RIEN avec SA clé d'idempotence.
 */

import type { PrimaryAssessmentDto, PrimaryBulkLine, PrimaryCompetencySheetDto } from "@ecoledigitale/contracts/v2/primary_school";
import { PRIMARY_BULK_MAX_LINES } from "@ecoledigitale/contracts/v2/primary_school";

export const cellKey = (enrollmentId: string, competencyId: string): string => `${enrollmentId}|${competencyId}`;
export const splitCellKey = (key: string): { enrollmentId: string; competencyId: string } => {
  const [enrollmentId = "", competencyId = ""] = key.split("|");
  return { enrollmentId, competencyId };
};

export interface GridCompetency {
  id: string;
  code: string;
  label: string;
  description: string | null;
  domainId: string;
  domainCode: string;
  domainLabel: string;
}

export interface GridLevel {
  id: string;
  code: string;
  label: string;
  ordinal: number;
}

export interface GridStudent {
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  isRepeating: boolean;
}

export interface GridDomain {
  id: string;
  code: string;
  label: string;
  competencies: GridCompetency[];
}

export interface GridModel {
  students: GridStudent[];
  domains: GridDomain[];
  competencies: GridCompetency[];
  levels: GridLevel[];
  /** Nombre de cellules attendues (élèves × compétences) : un COMPTAGE, pas un calcul de résultat. */
  expected: number;
}

/** Construit le modèle depuis la grille de l'API ; `null` tant qu'aucun référentiel n'est retenu. */
export function buildModel(sheet: PrimaryCompetencySheetDto): GridModel | null {
  const framework = sheet.framework;
  if (!framework) return null;
  const domains: GridDomain[] = [...framework.domains]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((d) => ({
      id: d.id,
      code: d.code,
      label: d.label,
      competencies: [...d.competencies]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => ({ id: c.id, code: c.code, label: c.label, description: c.description, domainId: d.id, domainCode: d.code, domainLabel: d.label })),
    }));
  const competencies = domains.flatMap((d) => d.competencies);
  const levels = [...framework.scale.levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ id: l.id, code: l.code, label: l.label, ordinal: l.ordinal }));
  return { students: sheet.students.map((s) => ({ ...s })), domains, competencies, levels, expected: sheet.students.length * competencies.length };
}

// ---------------------------------------------------------------------------
// Cellules
// ---------------------------------------------------------------------------

export type BaseMap = ReadonlyMap<string, PrimaryAssessmentDto>;
/** Saisies locales non enregistrées : `clé de cellule -> id du niveau choisi`. */
export type Drafts = Readonly<Record<string, string>>;

export function baseMapOf(assessments: ReadonlyArray<PrimaryAssessmentDto>): Map<string, PrimaryAssessmentDto> {
  return new Map(assessments.map((a) => [cellKey(a.enrollmentId, a.competencyId), a] as const));
}

export type CellStatus = "unassessed" | "saved" | "validated" | "pending";

export interface CellView {
  /** Niveau affiché ; `null` = NON ÉVALUÉ (jamais un zéro ni un niveau par défaut). */
  levelId: string | null;
  status: CellStatus;
  assessment: PrimaryAssessmentDto | null;
}

export function cellOf(key: string, base: BaseMap, drafts: Drafts): CellView {
  const assessment = base.get(key) ?? null;
  if (assessment?.status === "VALIDATED") return { levelId: assessment.ratingLevelId, status: "validated", assessment };
  const draft = drafts[key];
  if (draft !== undefined) return { levelId: draft, status: "pending", assessment };
  if (assessment) return { levelId: assessment.ratingLevelId, status: "saved", assessment };
  return { levelId: null, status: "unassessed", assessment: null };
}

/**
 * Choisit (ou retire, `levelId = null`) un niveau pour une cellule. Une ligne validée ne change pas ; revenir à la valeur
 * enregistrée supprime la saisie locale (elle ne serait pas envoyée).
 */
export function setLevel(drafts: Drafts, base: BaseMap, key: string, levelId: string | null): Drafts {
  const existing = base.get(key);
  if (existing?.status === "VALIDATED") return drafts;
  const next = { ...drafts };
  if (levelId === null || existing?.ratingLevelId === levelId) delete next[key];
  else next[key] = levelId;
  return next;
}

/**
 * « Tous au niveau X sauf… » : applique `levelId` à TOUTES les cellules NON SAISIES (ni enregistrées ni en cours de saisie) de la
 * portée (un élève, ou toute la classe) ; l'instituteur corrige ensuite les exceptions. Les cellules déjà renseignées ou validées ne
 * sont jamais touchées.
 */
export function fillUnassessed(model: GridModel, base: BaseMap, drafts: Drafts, levelId: string, scope: { enrollmentId?: string } = {}): Drafts {
  const next: Record<string, string> = { ...drafts };
  for (const student of model.students) {
    if (scope.enrollmentId && student.enrollmentId !== scope.enrollmentId) continue;
    for (const competency of model.competencies) {
      const key = cellKey(student.enrollmentId, competency.id);
      if (base.has(key) || next[key] !== undefined) continue;
      next[key] = levelId;
    }
  }
  return next;
}

export function dirtyKeys(base: BaseMap, drafts: Drafts): string[] {
  return Object.keys(drafts).filter((k) => {
    const existing = base.get(k);
    return existing?.status !== "VALIDATED" && existing?.ratingLevelId !== drafts[k];
  });
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export interface Batch {
  lines: PrimaryBulkLine[];
  /** Clé de cellule de chaque ligne (même ordre) : rattache les erreurs par ligne de l'API à la bonne cellule. */
  keys: string[];
}

/**
 * Lots à envoyer : lignes modifiées, dans l'ordre élèves puis compétences, par tranches de 500 au plus. Une ligne existante part
 * avec sa `rowVersion`. Chaque tranche est « tout ou rien » côté API.
 */
export function buildBatches(model: GridModel, base: BaseMap, drafts: Drafts, max: number = PRIMARY_BULK_MAX_LINES): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { lines: [], keys: [] };
  for (const student of model.students) {
    for (const competency of model.competencies) {
      const key = cellKey(student.enrollmentId, competency.id);
      const levelId = drafts[key];
      if (levelId === undefined) continue;
      const existing = base.get(key);
      if (existing?.status === "VALIDATED" || existing?.ratingLevelId === levelId) continue;
      if (current.lines.length >= max) {
        batches.push(current);
        current = { lines: [], keys: [] };
      }
      current.lines.push({ enrollmentId: student.enrollmentId, competencyId: competency.id, ratingLevelId: levelId, ...(existing ? { rowVersion: existing.rowVersion } : {}) });
      current.keys.push(key);
    }
  }
  if (current.lines.length > 0) batches.push(current);
  return batches;
}

/**
 * Fusionne la réponse d'un lot : les lignes renvoyées deviennent la valeur enregistrée (nouvelle `rowVersion`) ; une saisie
 * locale n'est abandonnée que si elle égale désormais la valeur enregistrée. Si l'utilisateur a continué à taper pendant l'envoi,
 * sa saisie plus récente est CONSERVÉE.
 */
export function mergeSaved(base: BaseMap, drafts: Drafts, saved: ReadonlyArray<PrimaryAssessmentDto>): { base: Map<string, PrimaryAssessmentDto>; drafts: Drafts } {
  const nextBase = new Map(base);
  const nextDrafts: Record<string, string> = { ...drafts };
  for (const a of saved) {
    const key = cellKey(a.enrollmentId, a.competencyId);
    nextBase.set(key, a);
    if (nextDrafts[key] === a.ratingLevelId) delete nextDrafts[key];
  }
  return { base: nextBase, drafts: nextDrafts };
}

/**
 * Rechargement SANS écraser les saisies : la nouvelle valeur enregistrée devient la base ; les saisies locales sont conservées,
 * sauf celles qui égalent déjà la nouvelle valeur ou qui visent une ligne devenue VALIDÉE (listées dans `droppedValidated` pour
 * que l'écran les annonce : aucune perte silencieuse).
 */
export function rebase(newBase: BaseMap, drafts: Drafts): { drafts: Drafts; droppedValidated: string[] } {
  const next: Record<string, string> = {};
  const droppedValidated: string[] = [];
  for (const [key, levelId] of Object.entries(drafts)) {
    const fresh = newBase.get(key);
    if (fresh?.status === "VALIDATED") {
      droppedValidated.push(key);
      continue;
    }
    if (fresh?.ratingLevelId === levelId) continue;
    next[key] = levelId;
  }
  return { drafts: next, droppedValidated };
}

export interface LineIssue {
  path: Array<string | number>;
  message: string;
  code?: string | undefined;
}

/** Erreurs par ligne d'un refus de l'API (`details.issues` ou `issues`) : chemins `["lines", i, …]`. */
export function lineIssuesOf(error: unknown): LineIssue[] {
  const details = (error as { details?: unknown } | null)?.details;
  const raw = details && typeof details === "object" ? (details as { issues?: unknown }).issues : undefined;
  if (!Array.isArray(raw)) return [];
  const out: LineIssue[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const { path, message, code } = item as { path?: unknown; message?: unknown; code?: unknown };
    if (typeof message !== "string") continue;
    out.push({ path: Array.isArray(path) ? path.filter((p): p is string | number => typeof p === "string" || typeof p === "number") : [], message, code: typeof code === "string" ? code : undefined });
  }
  return out;
}

/** Rattache chaque erreur `lines.<i>` à la cellule de la ligne `i` du lot envoyé. */
export function issuesToCells(issues: ReadonlyArray<LineIssue>, batch: Batch): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.path[0] !== "lines") continue;
    const index = Number(issue.path[1]);
    const key = Number.isInteger(index) ? batch.keys[index] : undefined;
    if (key && out[key] === undefined) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Avancement (comptages, jamais de statistique de niveaux)
// ---------------------------------------------------------------------------

export interface GridProgress {
  expected: number;
  /** Cellules renseignées (enregistrées, validées ou en attente). */
  recorded: number;
  /** Enregistrées par l'API (brouillon ou validées). */
  saved: number;
  validated: number;
  /** Saisies locales non encore envoyées. */
  pending: number;
  /** Cellules restées « non évaluées ». */
  unassessed: number;
}

export function progressOf(model: GridModel, base: BaseMap, drafts: Drafts, scope: { enrollmentId?: string } = {}): GridProgress {
  const p: GridProgress = { expected: 0, recorded: 0, saved: 0, validated: 0, pending: 0, unassessed: 0 };
  for (const student of model.students) {
    if (scope.enrollmentId && student.enrollmentId !== scope.enrollmentId) continue;
    for (const competency of model.competencies) {
      p.expected += 1;
      const cell = cellOf(cellKey(student.enrollmentId, competency.id), base, drafts);
      if (cell.status === "unassessed") p.unassessed += 1;
      else {
        p.recorded += 1;
        if (cell.status === "validated") {
          p.validated += 1;
          p.saved += 1;
        } else if (cell.status === "saved") p.saved += 1;
        else p.pending += 1;
      }
    }
  }
  return p;
}

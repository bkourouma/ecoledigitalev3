/**
 * Curriculum polymorphe versionné : grammaire des types de nœuds (DONNÉE), validation avant publication, clonage
 * annuel (la lignée est conservée), sélection des nœuds suivis par une inscription.
 *
 * Le comportement ne dépend JAMAIS d'un code de type ni d'un libellé : il lit les drapeaux du type de nœud
 * (`requiresGradeLevel`, `requiresPeriodSlot`, `requiresSubject`…), ce qui permet d'ajouter un type (ex. `MODULE`)
 * par une simple ligne de données.
 */
import type { AcademicCodeValue } from "./errors";
import { AcademicCode } from "./errors";
import { decimalsEqual, sumDecimals } from "./decimal";
import type { CurriculumNode, NodeType } from "./records";

/** Maximum de niveaux d'imbrication d'un arbre (le déclencheur SQL borne le parcours à 16). */
export const MAX_TREE_DEPTH = 16;

export type NodeTypeRules = Pick<
  NodeType,
  | "code"
  | "allowedParentCodes"
  | "requiresGradeLevel"
  | "requiresPeriodSlot"
  | "requiresSubject"
  | "allowsCoefficient"
  | "allowsCredits"
  | "creditsMustEqualChildren"
  | "isEnrollable"
>;

export interface GrammarSubject {
  parentId: string | null;
  subjectId: string | null;
  gradeLevelId: string | null;
  periodTypeCode: string | null;
  periodOrdinal: number | null;
  coefficient: string | null;
  credits: string | null;
}

export interface GrammarViolation {
  code: AcademicCodeValue;
  message: string;
}

/**
 * Contrôle un nœud contre la grammaire de son type (miroir de `curriculum_nodes_guard`, dans le même ordre :
 * le premier élément est ce que la base refuserait). `parentTypeCode` : type du parent, `null` à la racine.
 * `programGradeLevelIds` : niveaux couverts par le programme (contrôle d'appartenance si fourni).
 */
export function checkNodeGrammar(
  node: GrammarSubject,
  type: NodeTypeRules,
  parentTypeCode: string | null,
  programGradeLevelIds?: ReadonlySet<string>,
): GrammarViolation[] {
  const out: GrammarViolation[] = [];
  if (node.parentId === null || parentTypeCode === null) {
    if (!type.allowedParentCodes.includes("ROOT")) {
      out.push({ code: AcademicCode.NODE_NEEDS_PARENT, message: `Un nœud ${type.code} ne peut pas être à la racine.` });
    }
  } else if (!type.allowedParentCodes.includes(parentTypeCode)) {
    out.push({ code: AcademicCode.NODE_BAD_PARENT, message: `Un nœud ${type.code} ne peut pas être sous un nœud ${parentTypeCode}.` });
  }
  if (type.requiresSubject && node.subjectId === null) out.push({ code: AcademicCode.NODE_SUBJECT_REQUIRED, message: `Un nœud ${type.code} exige une matière.` });
  if (!type.requiresSubject && node.subjectId !== null) out.push({ code: AcademicCode.NODE_SUBJECT_FORBIDDEN, message: `Un nœud ${type.code} ne porte pas de matière.` });
  if (type.requiresGradeLevel && node.gradeLevelId === null) out.push({ code: AcademicCode.NODE_GRADE_LEVEL_REQUIRED, message: `Un nœud ${type.code} exige un niveau.` });
  if (!type.requiresGradeLevel && node.gradeLevelId !== null) out.push({ code: AcademicCode.NODE_GRADE_LEVEL_FORBIDDEN, message: `Un nœud ${type.code} ne porte pas de niveau.` });
  if (type.requiresPeriodSlot && (node.periodTypeCode === null || node.periodOrdinal === null)) {
    out.push({ code: AcademicCode.NODE_PERIOD_SLOT_REQUIRED, message: `Un nœud ${type.code} exige un type et un numéro de période.` });
  }
  if (!type.requiresPeriodSlot && (node.periodTypeCode !== null || node.periodOrdinal !== null)) {
    out.push({ code: AcademicCode.NODE_PERIOD_SLOT_FORBIDDEN, message: `Un nœud ${type.code} ne porte pas de période.` });
  }
  if (node.coefficient !== null && !type.allowsCoefficient) out.push({ code: AcademicCode.NODE_COEFFICIENT_FORBIDDEN, message: `Pas de coefficient sur un nœud ${type.code}.` });
  if (node.credits !== null && !type.allowsCredits) out.push({ code: AcademicCode.NODE_CREDITS_FORBIDDEN, message: `Pas de crédits sur un nœud ${type.code}.` });
  if (type.requiresGradeLevel && node.gradeLevelId !== null && programGradeLevelIds && !programGradeLevelIds.has(node.gradeLevelId)) {
    out.push({ code: AcademicCode.NODE_LEVEL_NOT_IN_PROGRAM, message: "Le niveau n'est pas couvert par le programme." });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arbre
// ---------------------------------------------------------------------------

export interface TreeNode<N extends { id: string; parentId: string | null; ordinal: number; code: string }> {
  node: N;
  children: Array<TreeNode<N>>;
}

/** Construit la forêt (racines triées par `ordinal` puis `code`). Les nœuds orphelins sont omis. */
export function buildTree<N extends { id: string; parentId: string | null; ordinal: number; code: string }>(nodes: readonly N[]): Array<TreeNode<N>> {
  const byId = new Map(nodes.map((n) => [n.id, { node: n, children: [] as Array<TreeNode<N>> }]));
  const roots: Array<TreeNode<N>> = [];
  for (const entry of byId.values()) {
    const parent = entry.node.parentId ? byId.get(entry.node.parentId) : undefined;
    if (parent) parent.children.push(entry);
    else if (entry.node.parentId === null) roots.push(entry);
  }
  const sort = (list: Array<TreeNode<N>>): void => {
    list.sort((a, b) => a.node.ordinal - b.node.ordinal || a.node.code.localeCompare(b.node.code));
    for (const e of list) sort(e.children);
  };
  sort(roots);
  return roots;
}

/** Parcours en profondeur, parents avant enfants (ordre sûr pour les insertions sous FK). */
export function flattenTree<N extends { id: string; parentId: string | null; ordinal: number; code: string }>(roots: ReadonlyArray<TreeNode<N>>): N[] {
  const out: N[] = [];
  const walk = (list: ReadonlyArray<TreeNode<N>>): void => {
    for (const e of list) {
      out.push(e.node);
      walk(e.children);
    }
  };
  walk(roots);
  return out;
}

/** Ancêtres d'un nœud, du plus proche au plus éloigné. Lève si une boucle est détectée. */
export function ancestorsOf(nodeId: string, byId: ReadonlyMap<string, { id: string; parentId: string | null }>): string[] {
  const out: string[] = [];
  let cursor = byId.get(nodeId)?.parentId ?? null;
  while (cursor) {
    if (out.includes(cursor) || out.length > MAX_TREE_DEPTH) throw new RangeError("Cycle ou profondeur excessive dans l'arbre.");
    out.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return out;
}

export function descendantsOf(nodeId: string, nodes: readonly { id: string; parentId: string | null }[]): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const out: string[] = [];
  const stack = [...(children.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rapport de validation (AC2.3) : une seule passe, toutes les anomalies
// ---------------------------------------------------------------------------

export interface ValidationIssueRecord {
  severity: "ERROR" | "WARN";
  code: string;
  nodeId: string | null;
  message: string;
}

export interface ValidationReportRecord {
  versionId: string;
  valid: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssueRecord[];
  stats: { nodes: number; byType: Record<string, number> };
}

export const ValidationCode = {
  EMPTY: "academic.curriculum_empty",
  ORPHAN: "academic.node_orphan",
  CYCLE: "academic.node_cycle",
  DUPLICATE_CODE: "academic.node_code_taken",
  CREDITS_MISMATCH: "academic.credits_mismatch",
  UNKNOWN_LINEAGE: "academic.prerequisite_unknown_lineage",
  PROGRAM_LEVEL_WITHOUT_NODE: "academic.program_level_without_node",
  CONTAINER_WITHOUT_CHILDREN: "academic.node_without_children",
  PERIOD_NOT_IN_CALENDAR: "academic.period_slot_not_in_calendar",
  TYPE_UNKNOWN: "academic.node_type_unknown",
} as const;

export interface ValidateCurriculumInput {
  versionId: string;
  nodes: readonly CurriculumNode[];
  nodeTypes: readonly NodeTypeRules[];
  programGradeLevelIds: readonly string[];
  /** Lignées existantes dans l'établissement (toutes versions) : cible légitime d'un prérequis. */
  knownLineageIds: ReadonlySet<string>;
  /** Créneaux de période du calendrier de l'année (type + numéro) : pour signaler un nœud de période sans calendrier. */
  calendarSlots?: ReadonlyArray<{ typeCode: string; ordinal: number }>;
}

export function validateCurriculum(input: ValidateCurriculumInput): ValidationReportRecord {
  const issues: ValidationIssueRecord[] = [];
  const add = (severity: "ERROR" | "WARN", code: string, nodeId: string | null, message: string): void => {
    issues.push({ severity, code, nodeId, message });
  };
  const types = new Map(input.nodeTypes.map((t) => [t.code, t]));
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const byType: Record<string, number> = {};
  for (const n of input.nodes) byType[n.nodeTypeCode] = (byType[n.nodeTypeCode] ?? 0) + 1;

  if (input.nodes.length === 0) add("ERROR", ValidationCode.EMPTY, null, "Le curriculum ne contient aucun nœud.");

  const programLevels = new Set(input.programGradeLevelIds);
  const childrenOf = new Map<string, CurriculumNode[]>();
  for (const n of input.nodes) if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);

  // Nœuds atteignables depuis une racine (détecte orphelins et cycles).
  const reachable = new Set<string>();
  const stack = input.nodes.filter((n) => n.parentId === null).map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c.id);
  }

  const siblingCodes = new Map<string, string>();
  const levelsCovered = new Set<string>();
  for (const n of input.nodes) {
    const type = types.get(n.nodeTypeCode);
    if (!type) {
      add("ERROR", ValidationCode.TYPE_UNKNOWN, n.id, `Type de nœud inconnu « ${n.nodeTypeCode} ».`);
      continue;
    }
    if (n.parentId !== null && !byId.has(n.parentId)) {
      add("ERROR", ValidationCode.ORPHAN, n.id, `Le nœud « ${n.code} » référence un parent absent de la version.`);
    } else if (!reachable.has(n.id)) {
      add("ERROR", ValidationCode.CYCLE, n.id, `Le nœud « ${n.code} » n'est pas rattaché à une racine (cycle).`);
    }
    const parentType = n.parentId ? (byId.get(n.parentId)?.nodeTypeCode ?? null) : null;
    for (const v of checkNodeGrammar(n, type, parentType, programLevels)) add("ERROR", v.code, n.id, `${n.code} : ${v.message}`);
    if (n.gradeLevelId) levelsCovered.add(n.gradeLevelId);

    const key = `${n.parentId ?? "ROOT"}|${n.code}`;
    if (siblingCodes.has(key)) add("ERROR", ValidationCode.DUPLICATE_CODE, n.id, `Le code « ${n.code} » est dupliqué parmi les nœuds frères.`);
    siblingCodes.set(key, n.id);

    const children = childrenOf.get(n.id) ?? [];
    if (type.creditsMustEqualChildren) {
      if (children.length === 0) {
        add("WARN", ValidationCode.CONTAINER_WITHOUT_CHILDREN, n.id, `Le nœud « ${n.code} » n'a aucun élément constitutif.`);
      } else if (!decimalsEqual(n.credits, sumDecimals(children.map((c) => c.credits)))) {
        add(
          "ERROR",
          ValidationCode.CREDITS_MISMATCH,
          n.id,
          `Les crédits de « ${n.code} » (${n.credits ?? "0"}) diffèrent de la somme de ses éléments (${sumDecimals(children.map((c) => c.credits))}).`,
        );
      }
    } else if (type.requiresGradeLevel && children.length === 0) {
      add("WARN", ValidationCode.CONTAINER_WITHOUT_CHILDREN, n.id, `Le niveau « ${n.code} » ne contient aucun élément.`);
    }

    for (const lineage of n.prerequisiteLineageIds) {
      if (!input.knownLineageIds.has(lineage)) {
        add("ERROR", ValidationCode.UNKNOWN_LINEAGE, n.id, `Le prérequis de « ${n.code} » vise une lignée inconnue (${lineage}).`);
      }
    }

    if (type.requiresPeriodSlot && input.calendarSlots && n.periodTypeCode !== null && n.periodOrdinal !== null) {
      const hasSlot = input.calendarSlots.some((s) => s.typeCode === n.periodTypeCode && s.ordinal === n.periodOrdinal);
      if (!hasSlot) add("WARN", ValidationCode.PERIOD_NOT_IN_CALENDAR, n.id, `Aucune période du calendrier ne correspond à « ${n.code} » (${n.periodTypeCode} n° ${n.periodOrdinal}).`);
    }
  }

  for (const levelId of programLevels) {
    if (!levelsCovered.has(levelId)) {
      add("WARN", ValidationCode.PROGRAM_LEVEL_WITHOUT_NODE, null, `Un niveau couvert par le programme n'a aucun nœud dans ce curriculum (${levelId}).`);
    }
  }

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  return {
    versionId: input.versionId,
    valid: errors === 0,
    errors,
    warnings: issues.length - errors,
    issues,
    stats: { nodes: input.nodes.length, byType },
  };
}

// ---------------------------------------------------------------------------
// Clonage annuel : mêmes `lineage_id`, nouveaux `id`
// ---------------------------------------------------------------------------

export interface ClonedNode extends CurriculumNode {
  sourceId: string;
}

export interface ClonePlan {
  nodes: ClonedNode[];
  idMap: ReadonlyMap<string, string>;
  prerequisites: Array<{ nodeId: string; requiredLineageId: string }>;
}

/**
 * Copie un arbre pour une nouvelle version : identifiants neufs, lignée conservée (R11), parents avant enfants.
 * Les prérequis (visant une lignée) sont recréés tels quels sur les nouveaux nœuds.
 */
export function planClone(sourceNodes: readonly CurriculumNode[], targetVersionId: string, idFactory: () => string): ClonePlan {
  const roots = buildTree(sourceNodes);
  const ordered = flattenTree(roots.map((r) => ({ node: r.node, children: r.children })));
  const idMap = new Map<string, string>();
  for (const n of ordered) idMap.set(n.id, idFactory());
  const nodes: ClonedNode[] = ordered.map((n) => ({
    ...n,
    sourceId: n.id,
    id: idMap.get(n.id) as string,
    versionId: targetVersionId,
    parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : null,
  }));
  const prerequisites = ordered.flatMap((n) => n.prerequisiteLineageIds.map((requiredLineageId) => ({ nodeId: idMap.get(n.id) as string, requiredLineageId })));
  return { nodes, idMap, prerequisites };
}

// ---------------------------------------------------------------------------
// Nœuds suivis par une inscription (AC5.6, `listNodesForEnrollment`)
// ---------------------------------------------------------------------------

export interface FollowedSelection {
  nodeId: string;
  courseId: string;
  source: "OPTION" | "A_LA_CARTE" | "CARRY_OVER" | "RESIT";
}

export interface FollowedNode {
  node: CurriculumNode;
  kind: "REGULAR" | "OPTION" | "A_LA_CARTE" | "CARRY_OVER" | "RESIT";
  enrollmentCourseId: string | null;
}

/** Créneau de période du calendrier, de la plus profonde (la période demandée) à la plus haute (son parent…). */
export interface PeriodChainItem {
  typeCode: string;
  ordinal: number;
}

/**
 * Nœuds qu'une inscription suit :
 *  - mode CLASS : les nœuds obligatoires du sous-arbre du niveau de la classe (tous les ancêtres sont obligatoires) ;
 *  - dans les deux modes : chaque sélection confirmée, avec son sous-arbre obligatoire ;
 *  - toujours : les ancêtres de ces nœuds (la structure : UE, période, niveau), pour regrouper les lignes ;
 *  - `periodChain` : ne garde que ce qui relève de la période (un nœud de période d'un autre créneau est écarté ; un
 *    nœud sans ancêtre de période vaut pour toutes les périodes).
 * Les nœuds INACTIFS sont écartés. Les nœuds transversaux sont INCLUS (la conduite est notée au bulletin).
 */
export function followedNodes(input: {
  nodes: readonly CurriculumNode[];
  nodeTypes: readonly NodeTypeRules[];
  mode: "CLASS" | "A_LA_CARTE";
  classGradeLevelId: string;
  selections: readonly FollowedSelection[];
  periodChain?: readonly PeriodChainItem[];
}): FollowedNode[] {
  const types = new Map(input.nodeTypes.map((t) => [t.code, t]));
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const active = (n: CurriculumNode): boolean => n.status === "ACTIVE";
  const children = new Map<string, CurriculumNode[]>();
  for (const n of input.nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);

  const followed = new Map<string, FollowedNode>();
  const put = (n: CurriculumNode, kind: FollowedNode["kind"], courseId: string | null): void => {
    const existing = followed.get(n.id);
    // Une sélection explicite l'emporte sur une inclusion implicite.
    if (!existing || (existing.enrollmentCourseId === null && courseId !== null)) followed.set(n.id, { node: n, kind, enrollmentCourseId: courseId });
  };
  const includeSubtree = (root: CurriculumNode, kind: FollowedNode["kind"], courseId: string | null): void => {
    if (!active(root)) return;
    put(root, kind, courseId);
    for (const c of children.get(root.id) ?? []) {
      if (c.isMandatory) includeSubtree(c, kind, courseId === null ? null : courseId);
    }
  };

  if (input.mode === "CLASS") {
    const levelNode = input.nodes.find((n) => n.gradeLevelId === input.classGradeLevelId && types.get(n.nodeTypeCode)?.requiresGradeLevel);
    if (levelNode) includeSubtree(levelNode, "REGULAR", null);
  }
  for (const s of input.selections) {
    const n = byId.get(s.nodeId);
    if (n) includeSubtree(n, s.source === "OPTION" ? "OPTION" : s.source, s.courseId);
  }
  // Ancêtres (structure) de tout nœud suivi.
  for (const f of [...followed.values()]) {
    let cursor = f.node.parentId ? byId.get(f.node.parentId) : undefined;
    let guard = 0;
    while (cursor && guard < MAX_TREE_DEPTH) {
      if (!followed.has(cursor.id) && active(cursor)) put(cursor, f.kind, null);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }
  }

  let result = [...followed.values()];
  if (input.periodChain) {
    const chain = input.periodChain;
    const matchesPeriod = (n: CurriculumNode): boolean => chain.some((c) => c.typeCode === n.periodTypeCode && c.ordinal === n.periodOrdinal);
    result = result.filter((f) => {
      // Aucun ancêtre-période : vaut pour toutes les périodes. Sinon l'un des ancêtres-période (ou le nœud) doit correspondre.
      const chainNodes = [f.node, ...ancestorsOf(f.node.id, byId as ReadonlyMap<string, { id: string; parentId: string | null }>).map((id) => byId.get(id) as CurriculumNode)];
      const slotNodes = chainNodes.filter((n) => types.get(n.nodeTypeCode)?.requiresPeriodSlot);
      if (slotNodes.length === 0) return true;
      return slotNodes.some(matchesPeriod);
    });
  }
  return result.sort((a, b) => a.node.ordinal - b.node.ordinal || a.node.code.localeCompare(b.node.code));
}

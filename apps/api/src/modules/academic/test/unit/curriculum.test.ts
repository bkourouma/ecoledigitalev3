import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  buildTree,
  checkNodeGrammar,
  descendantsOf,
  flattenTree,
  followedNodes,
  planClone,
  validateCurriculum,
  type NodeTypeRules,
} from "../../domain/curriculum";
import { decimalsEqual, fitsNumeric, fromScaled, normalizeDecimal, sumDecimals, toDecimalString, toScaled } from "../../domain/decimal";
import type { CurriculumNode } from "../../domain/records";

// Grammaire : des DONNÉES, identiques à celles des modèles de pack.
const type = (code: string, over: Partial<NodeTypeRules> = {}): NodeTypeRules => ({
  code,
  allowedParentCodes: ["ROOT"],
  requiresGradeLevel: false,
  requiresPeriodSlot: false,
  requiresSubject: false,
  allowsCoefficient: false,
  allowsCredits: false,
  creditsMustEqualChildren: false,
  isEnrollable: false,
  ...over,
});
const LEVEL = type("LEVEL", { requiresGradeLevel: true });
const PERIOD = type("PERIOD", { allowedParentCodes: ["LEVEL"], requiresPeriodSlot: true });
const GROUP = type("GROUP", { allowedParentCodes: ["LEVEL", "PERIOD"] });
const UE = type("UE", { allowedParentCodes: ["PERIOD"], allowsCredits: true, creditsMustEqualChildren: true, isEnrollable: true });
const ECUE = type("ECUE", { allowedParentCodes: ["UE"], requiresSubject: true, allowsCoefficient: true, allowsCredits: true });
const SUBJECT = type("SUBJECT", { allowedParentCodes: ["LEVEL", "PERIOD", "GROUP"], requiresSubject: true, allowsCoefficient: true, allowsCredits: true, isEnrollable: true });
const TYPES = [LEVEL, PERIOD, GROUP, UE, ECUE, SUBJECT];

const blank = { parentId: null, subjectId: null, gradeLevelId: null, periodTypeCode: null, periodOrdinal: null, coefficient: null, credits: null };

describe("grammaire du curriculum — tableau complet (AC2.2)", () => {
  it("parent admis : un ECUE sous un LEVEL est refusé, sous un UE accepté", () => {
    expect(checkNodeGrammar({ ...blank, parentId: "p", subjectId: "s" }, ECUE, "LEVEL")[0]?.code).toBe("academic.node_bad_parent");
    expect(checkNodeGrammar({ ...blank, parentId: "p", subjectId: "s" }, ECUE, "UE")).toEqual([]);
  });
  it("racine : seul un type qui admet ROOT peut être racine", () => {
    expect(checkNodeGrammar({ ...blank, gradeLevelId: "g" }, LEVEL, null)).toEqual([]);
    expect(checkNodeGrammar({ ...blank, subjectId: "s" }, SUBJECT, null)[0]?.code).toBe("academic.node_needs_parent");
  });
  it("matière exigée ou interdite selon le type", () => {
    expect(checkNodeGrammar({ ...blank, parentId: "p" }, SUBJECT, "LEVEL")[0]?.code).toBe("academic.node_subject_required");
    expect(checkNodeGrammar({ ...blank, parentId: "p", subjectId: "s" }, GROUP, "LEVEL")[0]?.code).toBe("academic.node_subject_forbidden");
  });
  it("niveau exigé ou interdit", () => {
    expect(checkNodeGrammar({ ...blank }, LEVEL, null)[0]?.code).toBe("academic.node_grade_level_required");
    expect(checkNodeGrammar({ ...blank, parentId: "p", gradeLevelId: "g" }, GROUP, "LEVEL")[0]?.code).toBe("academic.node_grade_level_forbidden");
  });
  it("créneau de période exigé (type ET numéro) ou interdit", () => {
    expect(checkNodeGrammar({ ...blank, parentId: "p" }, PERIOD, "LEVEL")[0]?.code).toBe("academic.node_period_slot_required");
    expect(checkNodeGrammar({ ...blank, parentId: "p", periodTypeCode: "SEMESTER" }, PERIOD, "LEVEL")[0]?.code).toBe("academic.node_period_slot_required");
    expect(checkNodeGrammar({ ...blank, parentId: "p", periodTypeCode: "SEMESTER", periodOrdinal: 1 }, PERIOD, "LEVEL")).toEqual([]);
    expect(checkNodeGrammar({ ...blank, parentId: "p", periodTypeCode: "SEMESTER", periodOrdinal: 1 }, GROUP, "LEVEL")[0]?.code).toBe("academic.node_period_slot_forbidden");
  });
  it("coefficient et crédits seulement là où le type les autorise (des crédits sur un GROUP sont refusés)", () => {
    expect(checkNodeGrammar({ ...blank, parentId: "p", credits: "2" }, GROUP, "LEVEL")[0]?.code).toBe("academic.node_credits_forbidden");
    expect(checkNodeGrammar({ ...blank, parentId: "p", coefficient: "2" }, GROUP, "LEVEL")[0]?.code).toBe("academic.node_coefficient_forbidden");
    expect(checkNodeGrammar({ ...blank, parentId: "p", coefficient: "2" }, UE, "PERIOD")[0]?.code).toBe("academic.node_coefficient_forbidden");
    expect(checkNodeGrammar({ ...blank, parentId: "p", subjectId: "s", coefficient: "2", credits: "3" }, ECUE, "UE")).toEqual([]);
  });
  it("niveau couvert par le programme", () => {
    const covered = new Set(["g1"]);
    expect(checkNodeGrammar({ ...blank, gradeLevelId: "g1" }, LEVEL, null, covered)).toEqual([]);
    expect(checkNodeGrammar({ ...blank, gradeLevelId: "g2" }, LEVEL, null, covered)[0]?.code).toBe("academic.node_level_not_in_program");
  });
  it("renvoie TOUTES les violations, dans l'ordre de la base", () => {
    const v = checkNodeGrammar({ ...blank, parentId: "p", credits: "1", gradeLevelId: "g" }, SUBJECT, "UE");
    expect(v.map((x) => x.code)).toEqual(["academic.node_bad_parent", "academic.node_subject_required", "academic.node_grade_level_forbidden"]);
  });
});

// Arbres de test : le même moteur exprime le primaire et le supérieur.
let seq = 0;
const node = (over: Partial<CurriculumNode> & Pick<CurriculumNode, "code" | "nodeTypeCode">): CurriculumNode => {
  seq += 1;
  return {
    id: over.id ?? `n${seq}`,
    versionId: "V1",
    parentId: null,
    lineageId: over.lineageId ?? `l${seq}`,
    subjectId: null,
    gradeLevelId: null,
    periodTypeCode: null,
    periodOrdinal: null,
    label: over.code,
    ordinal: seq,
    coefficient: null,
    credits: null,
    isMandatory: true,
    isTransversal: false,
    categoryCode: null,
    hoursTotal: null,
    hoursLecture: null,
    hoursTutorial: null,
    hoursPractical: null,
    attributes: {},
    status: "ACTIVE",
    prerequisiteLineageIds: [],
    ...over,
  };
};

function primaryTree(): CurriculumNode[] {
  return [
    node({ id: "L", code: "CP1", nodeTypeCode: "LEVEL", gradeLevelId: "g-cp1" }),
    node({ id: "FR", code: "FRA", nodeTypeCode: "GROUP", parentId: "L" }),
    node({ id: "DIC", code: "DIC", nodeTypeCode: "SUBJECT", parentId: "FR", subjectId: "s1", coefficient: "2" }),
    node({ id: "CAL", code: "CAL", nodeTypeCode: "SUBJECT", parentId: "L", subjectId: "s2", coefficient: "3" }),
    node({ id: "COND", code: "COND", nodeTypeCode: "SUBJECT", parentId: "L", subjectId: "s3", coefficient: "1", isTransversal: true }),
    node({ id: "OPT", code: "ANG", nodeTypeCode: "SUBJECT", parentId: "L", subjectId: "s4", coefficient: "1", isMandatory: false }),
  ];
}

function higherTree(): CurriculumNode[] {
  return [
    node({ id: "L", code: "L1", nodeTypeCode: "LEVEL", gradeLevelId: "g-l1" }),
    node({ id: "S1", code: "S1", nodeTypeCode: "PERIOD", parentId: "L", periodTypeCode: "SEMESTER", periodOrdinal: 1 }),
    node({ id: "S2", code: "S2", nodeTypeCode: "PERIOD", parentId: "L", periodTypeCode: "SEMESTER", periodOrdinal: 2 }),
    node({ id: "UE1", code: "UE1", nodeTypeCode: "UE", parentId: "S1", credits: "6" }),
    node({ id: "E11", code: "E11", nodeTypeCode: "ECUE", parentId: "UE1", subjectId: "s1", credits: "3", coefficient: "2" }),
    node({ id: "E12", code: "E12", nodeTypeCode: "ECUE", parentId: "UE1", subjectId: "s2", credits: "3", coefficient: "1.5" }),
    node({ id: "UE2", code: "UE2", nodeTypeCode: "UE", parentId: "S2", credits: "4" }),
    node({ id: "E21", code: "E21", nodeTypeCode: "ECUE", parentId: "UE2", subjectId: "s3", credits: "4", coefficient: "1" }),
  ];
}

const validate = (nodes: CurriculumNode[], over: Partial<Parameters<typeof validateCurriculum>[0]> = {}) =>
  validateCurriculum({ versionId: "V1", nodes, nodeTypes: TYPES, programGradeLevelIds: [], knownLineageIds: new Set(), ...over });

describe("validation d'un curriculum (AC2.3)", () => {
  it("un curriculum primaire (LEVEL > SUBJECT) et un curriculum supérieur (LEVEL > PERIOD > UE > ECUE) se valident par le même code", () => {
    expect(validate(primaryTree(), { programGradeLevelIds: ["g-cp1"] })).toMatchObject({ valid: true, errors: 0 });
    expect(validate(higherTree(), { programGradeLevelIds: ["g-l1"] })).toMatchObject({ valid: true, errors: 0 });
  });
  it("rapport complet en une passe : crédits d'UE incohérents, prérequis inconnu, niveau absent du programme", () => {
    const nodes = higherTree();
    nodes[3] = { ...nodes[3]!, credits: "5" };
    nodes[7] = { ...nodes[7]!, prerequisiteLineageIds: ["inconnue"] };
    const r = validate(nodes, { programGradeLevelIds: ["autre-niveau"], knownLineageIds: new Set(["l-ok"]) });
    expect(r.valid).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("academic.credits_mismatch");
    expect(codes).toContain("academic.prerequisite_unknown_lineage");
    expect(codes).toContain("academic.node_level_not_in_program");
    expect(codes).toContain("academic.program_level_without_node");
    expect(r.errors).toBeGreaterThanOrEqual(3);
    expect(r.warnings).toBeGreaterThanOrEqual(1);
  });
  it("la somme des crédits est comparée en décimal exact (0,1 + 0,2 = 0,3)", () => {
    const nodes = higherTree();
    nodes[3] = { ...nodes[3]!, credits: "0.3" };
    nodes[4] = { ...nodes[4]!, credits: "0.1" };
    nodes[5] = { ...nodes[5]!, credits: "0.2" };
    expect(validate(nodes, { programGradeLevelIds: ["g-l1"] }).issues.filter((i) => i.code === "academic.credits_mismatch")).toEqual([]);
  });
  it("nœud orphelin, cycle, code dupliqué parmi les frères, arbre vide, type inconnu", () => {
    expect(validate([]).issues[0]?.code).toBe("academic.curriculum_empty");
    const orphan = [...primaryTree(), node({ id: "X", code: "X", nodeTypeCode: "SUBJECT", parentId: "inexistant", subjectId: "s" })];
    expect(validate(orphan).issues.map((i) => i.code)).toContain("academic.node_orphan");
    const cyc = [
      node({ id: "A", code: "A", nodeTypeCode: "GROUP", parentId: "B" }),
      node({ id: "B", code: "B", nodeTypeCode: "GROUP", parentId: "A" }),
    ];
    expect(validate(cyc).issues.map((i) => i.code)).toContain("academic.node_cycle");
    const dup = [...primaryTree(), node({ id: "D2", code: "CAL", nodeTypeCode: "SUBJECT", parentId: "L", subjectId: "s9" })];
    expect(validate(dup).issues.map((i) => i.code)).toContain("academic.node_code_taken");
    expect(validate([node({ code: "Z", nodeTypeCode: "INCONNU" })]).issues[0]?.code).toBe("academic.node_type_unknown");
  });
  it("avertissements : UE sans élément, période sans calendrier", () => {
    const nodes = higherTree().filter((n) => n.id !== "E21");
    const r = validate(nodes, { programGradeLevelIds: ["g-l1"], calendarSlots: [{ typeCode: "SEMESTER", ordinal: 1 }] });
    expect(r.issues.map((i) => i.code)).toContain("academic.node_without_children");
    expect(r.issues.map((i) => i.code)).toContain("academic.period_slot_not_in_calendar");
    expect(r.valid).toBe(true); // UE sans élément et période sans calendrier : des AVERTISSEMENTS, pas des erreurs
  });
  it("statistiques par type", () => {
    expect(validate(higherTree(), { programGradeLevelIds: ["g-l1"] }).stats).toEqual({ nodes: 8, byType: { LEVEL: 1, PERIOD: 2, UE: 2, ECUE: 3 } });
  });
});

describe("arbre, ancêtres, descendants", () => {
  it("forêt triée, parcours parents d'abord, ancêtres et descendants", () => {
    const nodes = higherTree();
    const roots = buildTree(nodes);
    expect(roots).toHaveLength(1);
    const flat = flattenTree(roots).map((n) => n.id);
    expect(flat[0]).toBe("L");
    expect(flat.indexOf("UE1")).toBeLessThan(flat.indexOf("E11"));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(ancestorsOf("E11", byId)).toEqual(["UE1", "S1", "L"]);
    expect(descendantsOf("S1", nodes).sort()).toEqual(["E11", "E12", "UE1"]);
    expect(() => ancestorsOf("A", new Map([["A", { id: "A", parentId: "B" }], ["B", { id: "B", parentId: "A" }]]))).toThrow();
  });
});

describe("clonage annuel (AC2.4, R11)", () => {
  it("conserve les lignées, crée de nouveaux identifiants, place les parents avant les enfants et recrée les prérequis", () => {
    const nodes = higherTree();
    nodes[7] = { ...nodes[7]!, prerequisiteLineageIds: [nodes[3]!.lineageId] };
    let n = 0;
    const plan = planClone(nodes, "V2", () => `new-${(n += 1)}`);
    expect(plan.nodes).toHaveLength(nodes.length);
    for (const c of plan.nodes) {
      const src = nodes.find((s) => s.id === c.sourceId)!;
      expect(c.lineageId).toBe(src.lineageId);
      expect(c.id).not.toBe(src.id);
      expect(c.versionId).toBe("V2");
      if (src.parentId) expect(c.parentId).toBe(plan.idMap.get(src.parentId));
      else expect(c.parentId).toBeNull();
    }
    const positions = new Map(plan.nodes.map((c, i) => [c.id, i]));
    for (const c of plan.nodes) if (c.parentId) expect(positions.get(c.parentId)!).toBeLessThan(positions.get(c.id)!);
    expect(plan.prerequisites).toEqual([{ nodeId: plan.idMap.get("E21"), requiredLineageId: nodes[3]!.lineageId }]);
    expect(new Set(plan.nodes.map((c) => c.id)).size).toBe(nodes.length);
  });
});

describe("nœuds suivis par une inscription (AC5.6)", () => {
  const types = TYPES;
  it("mode classe : tronc obligatoire de la classe, transversaux INCLUS, options exclues", () => {
    const f = followedNodes({ nodes: primaryTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-cp1", selections: [] });
    const ids = f.map((x) => x.node.id).sort();
    expect(ids).toEqual(["CAL", "COND", "DIC", "FR", "L"]);
    expect(f.every((x) => x.kind === "REGULAR")).toBe(true);
  });
  it("une option confirmée s'ajoute au tronc, avec son identifiant de sélection", () => {
    const f = followedNodes({ nodes: primaryTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-cp1", selections: [{ nodeId: "OPT", courseId: "c1", source: "OPTION" }] });
    const opt = f.find((x) => x.node.id === "OPT")!;
    expect(opt).toMatchObject({ kind: "OPTION", enrollmentCourseId: "c1" });
  });
  it("à la carte : seulement les sélections, avec leur sous-arbre obligatoire et leurs ancêtres (structure)", () => {
    const f = followedNodes({ nodes: higherTree(), nodeTypes: types, mode: "A_LA_CARTE", classGradeLevelId: "g-l1", selections: [{ nodeId: "UE1", courseId: "c1", source: "A_LA_CARTE" }] });
    expect(f.map((x) => x.node.id).sort()).toEqual(["E11", "E12", "L", "S1", "UE1"]);
    expect(f.find((x) => x.node.id === "E11")).toMatchObject({ kind: "A_LA_CARTE", enrollmentCourseId: "c1" });
    expect(f.find((x) => x.node.id === "S1")).toMatchObject({ enrollmentCourseId: null });
  });
  it("filtre par période : un nœud sous un autre créneau est écarté ; un nœud hors période vaut pour toutes", () => {
    const s1 = followedNodes({ nodes: higherTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-l1", selections: [], periodChain: [{ typeCode: "SEMESTER", ordinal: 1 }] });
    expect(s1.map((x) => x.node.id).sort()).toEqual(["E11", "E12", "L", "S1", "UE1"]);
    const s2 = followedNodes({ nodes: higherTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-l1", selections: [], periodChain: [{ typeCode: "SEMESTER", ordinal: 2 }] });
    expect(s2.map((x) => x.node.id).sort()).toEqual(["E21", "L", "S2", "UE2"]);
    const prim = followedNodes({ nodes: primaryTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-cp1", selections: [], periodChain: [{ typeCode: "TRIMESTER", ordinal: 2 }] });
    expect(prim).toHaveLength(5);
  });
  it("un nœud inactif n'est pas suivi", () => {
    const nodes = primaryTree().map((n) => (n.id === "CAL" ? { ...n, status: "INACTIVE" as const } : n));
    const f = followedNodes({ nodes, nodeTypes: types, mode: "CLASS", classGradeLevelId: "g-cp1", selections: [] });
    expect(f.map((x) => x.node.id)).not.toContain("CAL");
  });
  it("niveau inconnu : aucun nœud", () => {
    expect(followedNodes({ nodes: primaryTree(), nodeTypes: types, mode: "CLASS", classGradeLevelId: "autre", selections: [] })).toEqual([]);
  });
});

describe("décimaux exacts", () => {
  it("canonique, borné, exact", () => {
    expect(toDecimalString("2.500")).toBe("2.5");
    expect(toDecimalString(2)).toBe("2");
    expect(toDecimalString(0.125)).toBe("0.125");
    expect(toDecimalString("02")).toBe("2");
    expect(toDecimalString("0.000")).toBe("0");
    expect(toDecimalString(null)).toBeNull();
    expect(toDecimalString("abc")).toBeNull();
    expect(toDecimalString(-1)).toBeNull();
    expect(toDecimalString(Number.NaN)).toBeNull();
    expect(toDecimalString(1e21)).toBeNull();
    expect(normalizeDecimal("10.0")).toBe("10");
    expect(sumDecimals(["0.1", "0.2", null, undefined])).toBe("0.3");
    expect(sumDecimals([])).toBe("0");
    expect(decimalsEqual("3.0", "3")).toBe(true);
    expect(decimalsEqual(null, "0")).toBe(true);
    expect(decimalsEqual("3", "3.001")).toBe(false);
    expect(fromScaled(toScaled("12.34"))).toBe("12.34");
    expect(fromScaled(-1500n)).toBe("-1.5");
    expect(fromScaled(0n)).toBe("0");
    expect(fitsNumeric("9999.999", 7, 3)).toBe(true);
    expect(fitsNumeric("10000", 7, 3)).toBe(false);
    expect(fitsNumeric("1.2345", 7, 3)).toBe(false);
    expect(fitsNumeric("9999.99", 6, 2)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { primaryCompetencySheetDtoSchema, type PrimaryCompetencySheetDto } from "@ecoledigitale/contracts/v2/primary_school";
import { assessment, competency, enrollment, level, sheet } from "../_test/fixtures";
import {
  baseMapOf,
  buildBatches,
  buildModel,
  cellKey,
  cellOf,
  dirtyKeys,
  fillUnassessed,
  issuesToCells,
  lineIssuesOf,
  mergeSaved,
  progressOf,
  rebase,
  setLevel,
} from "./competency-grid-model";

const parse = (over: Partial<Record<string, unknown>> = {}): PrimaryCompetencySheetDto => primaryCompetencySheetDtoSchema.parse(sheet(over));
const model = () => buildModel(parse())!;
const K = (s: number, c: number) => cellKey(enrollment(s), competency(c));
const dto = (s: number, c: number, l: number, over: Partial<Record<string, unknown>> = {}) => primaryCompetencySheetDtoSchema.shape.assessments.element.parse(assessment(s, c, l, over));

describe("buildModel", () => {
  it("ordonne domaines, compétences et niveaux ; compte les cellules attendues", () => {
    const m = model();
    expect(m.competencies.map((c) => c.code)).toEqual(["D1.1", "D1.2", "D2.1", "D2.2"]);
    expect(m.levels.map((l) => l.code)).toEqual(["N1", "N2", "N3", "N4"]);
    expect(m.students).toHaveLength(3);
    expect(m.expected).toBe(12);
  });

  it("sans référentiel retenu : pas de modèle", () => {
    expect(buildModel(parse({ framework: null }))).toBeNull();
  });
});

describe("cellOf : une compétence non saisie reste « non évaluée »", () => {
  it("aucune valeur par défaut : ni zéro ni niveau", () => {
    const cell = cellOf(K(1, 1), new Map(), {});
    expect(cell).toEqual({ levelId: null, status: "unassessed", assessment: null });
  });

  it("brouillon local > valeur enregistrée ; ligne validée figée", () => {
    const base = baseMapOf([dto(1, 1, 2), dto(1, 2, 3, { status: "VALIDATED", validatedAt: "2026-10-01T08:00:00.000Z" })]);
    expect(cellOf(K(1, 1), base, {}).status).toBe("saved");
    expect(cellOf(K(1, 1), base, { [K(1, 1)]: level(4) })).toMatchObject({ levelId: level(4), status: "pending" });
    // un brouillon sur une ligne validée est ignoré
    expect(cellOf(K(1, 2), base, { [K(1, 2)]: level(1) })).toMatchObject({ levelId: level(3), status: "validated" });
  });
});

describe("setLevel", () => {
  it("pose un brouillon ; revenir à la valeur enregistrée le supprime ; null le retire ; une ligne validée ne change pas", () => {
    const base = baseMapOf([dto(1, 1, 2), dto(1, 2, 3, { status: "VALIDATED" })]);
    let d = setLevel({}, base, K(2, 1), level(3));
    expect(d).toEqual({ [K(2, 1)]: level(3) });
    d = setLevel(d, base, K(2, 1), null);
    expect(d).toEqual({});
    d = setLevel({}, base, K(1, 1), level(4));
    expect(d[K(1, 1)]).toBe(level(4));
    expect(setLevel(d, base, K(1, 1), level(2))).toEqual({});
    expect(setLevel({}, base, K(1, 2), level(1))).toEqual({});
  });
});

describe("« tous au niveau X sauf… »", () => {
  it("ne remplit que les cellules non saisies de la classe, puis les exceptions se corrigent", () => {
    const m = model();
    const base = baseMapOf([dto(1, 1, 2), dto(2, 3, 4, { status: "VALIDATED" })]);
    const filled = fillUnassessed(m, base, { [K(3, 4)]: level(1) }, level(3));
    expect(Object.keys(filled)).toHaveLength(10); // 9 nouvelles cellules (12 - 2 enregistrées - 1 en cours) + la saisie déjà en cours
    expect(filled[K(1, 1)]).toBeUndefined();
    expect(filled[K(2, 3)]).toBeUndefined();
    expect(filled[K(3, 4)]).toBe(level(1)); // la saisie en cours n'est pas écrasée
    expect(filled[K(2, 2)]).toBe(level(3));
    // exception : on corrige une cellule
    expect(setLevel(filled, base, K(2, 2), level(1))[K(2, 2)]).toBe(level(1));
  });

  it("portée d'un seul élève", () => {
    const m = model();
    const filled = fillUnassessed(m, new Map(), {}, level(2), { enrollmentId: enrollment(2) });
    expect(Object.keys(filled)).toHaveLength(4);
    expect(Object.keys(filled).every((k) => k.startsWith(enrollment(2)))).toBe(true);
  });
});

describe("buildBatches : lots ≤ 500 lignes, rowVersion des lignes existantes", () => {
  it("n'envoie que les lignes modifiées, avec rowVersion pour une ligne existante", () => {
    const m = model();
    const base = baseMapOf([dto(1, 1, 2, { rowVersion: 7 }), dto(1, 2, 3, { status: "VALIDATED" })]);
    const drafts = { [K(1, 1)]: level(4), [K(1, 2)]: level(1), [K(2, 1)]: level(3), [K(3, 1)]: level(2) };
    const [batch, ...rest] = buildBatches(m, base, drafts);
    expect(rest).toHaveLength(0);
    expect(batch!.lines).toEqual([
      { enrollmentId: enrollment(1), competencyId: competency(1), ratingLevelId: level(4), rowVersion: 7 },
      { enrollmentId: enrollment(2), competencyId: competency(1), ratingLevelId: level(3) },
      { enrollmentId: enrollment(3), competencyId: competency(1), ratingLevelId: level(2) },
    ]);
    expect(batch!.keys).toEqual([K(1, 1), K(2, 1), K(3, 1)]);
  });

  it("découpe en tranches quand le plafond est dépassé", () => {
    const m = model();
    const drafts = fillUnassessed(m, new Map(), {}, level(2));
    const batches = buildBatches(m, new Map(), drafts, 5);
    expect(batches.map((b) => b.lines.length)).toEqual([5, 5, 2]);
    expect(batches.flatMap((b) => b.keys)).toHaveLength(12);
  });

  it("aucun brouillon : aucun lot", () => {
    expect(buildBatches(model(), new Map(), {})).toEqual([]);
  });
});

describe("mergeSaved / rebase", () => {
  it("la réponse devient la valeur enregistrée ; une saisie plus récente est conservée", () => {
    const base = baseMapOf([]);
    const drafts = { [K(1, 1)]: level(3), [K(1, 2)]: level(2) };
    // le lot partait avec N3 pour (1,1) ; l'utilisateur a depuis choisi N4 pour (1,2) alors que le lot portait N1
    const merged = mergeSaved(base, drafts, [dto(1, 1, 3, { rowVersion: 1 }), dto(1, 2, 1, { rowVersion: 1 })]);
    expect(merged.drafts).toEqual({ [K(1, 2)]: level(2) });
    expect(merged.base.get(K(1, 1))!.ratingLevelId).toBe(level(3));
    expect(dirtyKeys(merged.base, merged.drafts)).toEqual([K(1, 2)]);
  });

  it("rechargement sans écraser : garde les saisies, signale celles qui visent une ligne devenue validée", () => {
    const fresh = baseMapOf([dto(1, 1, 3, { status: "VALIDATED" }), dto(2, 1, 2, { rowVersion: 5 }), dto(3, 1, 4)]);
    const r = rebase(fresh, { [K(1, 1)]: level(1), [K(2, 1)]: level(4), [K(3, 1)]: level(4), [K(3, 2)]: level(2) });
    expect(r.droppedValidated).toEqual([K(1, 1)]);
    expect(r.drafts).toEqual({ [K(2, 1)]: level(4), [K(3, 2)]: level(2) }); // (3,1) égale déjà la valeur serveur
  });
});

describe("erreurs par ligne de l'API", () => {
  it("rattache lines.<i> à la bonne cellule", () => {
    const batch = { lines: [], keys: [K(1, 1), K(2, 3), K(3, 4)] };
    const error = { details: { issues: [{ path: ["lines", 1, "ratingLevelId"], message: "Niveau hors échelle.", code: "primary_school.scale_mismatch" }, { path: ["lines", 2], message: "Autre erreur." }, { path: ["classroomId"], message: "ignorée" }] } };
    const issues = lineIssuesOf(error);
    expect(issues).toHaveLength(3);
    expect(issuesToCells(issues, batch)).toEqual({ [K(2, 3)]: "Niveau hors échelle.", [K(3, 4)]: "Autre erreur." });
  });

  it("aucune erreur exploitable : rien", () => {
    expect(lineIssuesOf(new Error("x"))).toEqual([]);
    expect(lineIssuesOf({ details: { issues: "x" } })).toEqual([]);
  });
});

describe("progressOf : des comptages, jamais de statistique de niveaux", () => {
  it("compte renseignées, enregistrées, validées, en attente et non évaluées", () => {
    const m = model();
    const base = baseMapOf([dto(1, 1, 2), dto(1, 2, 3, { status: "VALIDATED" })]);
    const p = progressOf(m, base, { [K(2, 1)]: level(3), [K(1, 1)]: level(4) });
    expect(p).toEqual({ expected: 12, recorded: 3, saved: 1, validated: 1, pending: 2, unassessed: 9 });
    expect(progressOf(m, base, {}, { enrollmentId: enrollment(1) })).toEqual({ expected: 4, recorded: 2, saved: 2, validated: 1, pending: 0, unassessed: 2 });
  });
});

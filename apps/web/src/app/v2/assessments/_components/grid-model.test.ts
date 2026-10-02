import { describe, expect, it } from "vitest";
import { applyPaste, buildBatch, effectiveOf, isDirty, mergeSaved, nextIndex, normalizeDecimal, parseCell, progressOf, rowFromGrade, rowFromPending, type CellContext, type GridRow } from "./grid-model";

const ctx: CellContext = { scaleMax: "20", maxDecimals: 2 };
const grade = (n: number, over: Record<string, unknown> = {}) => ({ id: `g${n}`, enrollmentId: `e${n}`, studentId: `s${n}`, score: null as string | null, entryStatus: "NOT_GRADED" as const, comment: null as string | null, rowVersion: 1, ...over });

describe("parseCell", () => {
  it("accepte une note avec virgule ou point et la normalise en chaîne décimale", () => {
    expect(parseCell("12,5", ctx)).toEqual({ kind: "score", value: "12.5" });
    expect(parseCell(" 7.25 ", ctx)).toEqual({ kind: "score", value: "7.25" });
    expect(parseCell("0", ctx)).toEqual({ kind: "score", value: "0" });
  });

  it("distingue absences, dispense et non évalué d'un zéro", () => {
    expect(parseCell("abs", ctx)).toEqual({ kind: "status", status: "ABSENT_UNEXCUSED" });
    expect(parseCell("ABJ", ctx)).toEqual({ kind: "status", status: "ABSENT_EXCUSED" });
    expect(parseCell("Dispensé", ctx)).toEqual({ kind: "status", status: "EXEMPT" }); // accents et casse ignorés
    expect(parseCell("dispense", ctx)).toEqual({ kind: "status", status: "EXEMPT" });
    expect(parseCell("nn", ctx)).toEqual({ kind: "status", status: "NOT_GRADED" });
    expect(parseCell("", ctx)).toEqual({ kind: "empty" });
  });

  it("refuse le format, les décimales excédentaires et le dépassement du barème (sans flottant)", () => {
    expect(parseCell("abc", ctx)).toEqual({ kind: "invalid", reason: "format" });
    expect(parseCell("-3", ctx)).toEqual({ kind: "invalid", reason: "format" });
    expect(parseCell("12,555", ctx)).toEqual({ kind: "invalid", reason: "decimals" });
    expect(parseCell("20,01", ctx)).toEqual({ kind: "invalid", reason: "range" });
    expect(parseCell("20", ctx)).toEqual({ kind: "score", value: "20" });
    expect(parseCell("20,00", ctx)).toEqual({ kind: "score", value: "20.00" });
  });

  it("applique le nombre de décimales du réglage du tenant", () => {
    expect(parseCell("12,5", { scaleMax: "20", maxDecimals: 0 })).toEqual({ kind: "invalid", reason: "decimals" });
  });
});

describe("lot à enregistrer", () => {
  it("n'envoie que les lignes modifiées, avec leur rowVersion, et distingue absence et zéro", () => {
    const rows: GridRow[] = [rowFromGrade(grade(1, { score: "12", entryStatus: "ENTERED", rowVersion: 4 })), rowFromGrade(grade(2)), rowFromPending({ enrollmentId: "e3", studentId: "s3" }), rowFromPending({ enrollmentId: "e4", studentId: "s4" })];
    rows[0] = { ...rows[0]!, text: "13" }; // note modifiée
    rows[1] = { ...rows[1]!, text: "ABS" }; // existante non évaluée -> absente
    rows[2] = { ...rows[2]!, text: "0" }; // nouvelle : un VRAI zéro
    // rows[3] : rien saisi -> rien envoyé
    const { entries, invalid } = buildBatch(rows, ctx);
    expect(invalid).toEqual([]);
    expect(entries).toEqual([
      { enrollmentId: "e1", entryStatus: "ENTERED", score: "13", rowVersion: 4 },
      { enrollmentId: "e2", entryStatus: "ABSENT_UNEXCUSED", rowVersion: 1 },
      { enrollmentId: "e3", entryStatus: "ENTERED", score: "0" },
    ]);
  });

  it("une cellule vidée d'une note enregistrée revient à « non évalué » ; une ligne identique n'est pas envoyée", () => {
    const noted = rowFromGrade(grade(1, { score: "12.500", entryStatus: "ENTERED" }));
    expect(isDirty(noted, ctx)).toBe(false);
    const cleared = { ...noted, text: "" };
    expect(effectiveOf(cleared, ctx)).toEqual({ kind: "ok", status: "NOT_GRADED", score: null });
    expect(buildBatch([cleared], ctx).entries).toEqual([{ enrollmentId: "e1", entryStatus: "NOT_GRADED", rowVersion: 1 }]);
    expect(buildBatch([noted], ctx).entries).toEqual([]);
    // 12,5 saisi == 12.500 enregistré : pas une modification
    expect(isDirty({ ...noted, text: "12,5" }, ctx)).toBe(false);
  });

  it("signale les lignes invalides sans les envoyer", () => {
    const row = { ...rowFromPending({ enrollmentId: "e1", studentId: "s1" }), text: "25" };
    expect(buildBatch([row], ctx)).toEqual({ entries: [], invalid: ["e1"] });
  });

  it("fusionne le résultat : nouvelle version, et conserve ce qui a été tapé pendant l'envoi", () => {
    const a = { ...rowFromPending({ enrollmentId: "e1", studentId: "s1" }), text: "14" };
    const b = { ...rowFromPending({ enrollmentId: "e2", studentId: "s2" }), text: "10" };
    const saved = [grade(1, { score: "14", entryStatus: "ENTERED", rowVersion: 1 }), grade(2, { score: "10", entryStatus: "ENTERED", rowVersion: 1 })];
    // e2 a été retapée (« 11 ») après l'envoi de « 10 »
    const merged = mergeSaved([a, { ...b, text: "11" }], saved, new Map([["e1", "14"], ["e2", "10"]]));
    expect(merged[0]).toMatchObject({ rowVersion: 1, text: "14", gradeId: "g1" });
    expect(isDirty(merged[0]!, ctx)).toBe(false);
    expect(merged[1]).toMatchObject({ rowVersion: 1, text: "11" });
    expect(isDirty(merged[1]!, ctx)).toBe(true);
  });
});

describe("collage depuis un tableur", () => {
  const rows = [1, 2, 3, 4].map((n) => rowFromPending({ enrollmentId: `e${n}`, studentId: `s${n}` }));
  const numberOf = (r: GridRow) => `ELV-00${r.enrollmentId.slice(1)}`;

  it("remplit une colonne à partir de la cellule active", () => {
    const out = applyPaste(rows, 1, "12,5\r\nABS\r\n9\r\n", numberOf);
    expect(out.mode).toBe("positional");
    expect(out.rows.map((r) => r.text)).toEqual(["", "12,5", "ABS", "9"]);
    expect(out).toMatchObject({ applied: 3, skipped: 0 });
  });

  it("ignore les lignes en trop au-delà de la dernière ligne", () => {
    const out = applyPaste(rows, 2, "1\n2\n3\n4", numberOf);
    expect(out.rows.map((r) => r.text)).toEqual(["", "", "1", "2"]);
    expect(out).toMatchObject({ applied: 2, skipped: 2 });
  });

  it("mode par matricule : la dernière colonne est la note, l'ordre n'importe pas", () => {
    const out = applyPaste(rows, 0, "ELV-003\tCoulibaly Awa\t15\nELV-001\tAka Marie\tABJ\nELV-999\tInconnu\t10", numberOf);
    expect(out.mode).toBe("keyed");
    expect(out.rows.map((r) => r.text)).toEqual(["ABJ", "", "15", ""]);
    expect(out).toMatchObject({ applied: 2, skipped: 1 });
  });
});

describe("avancement et navigation", () => {
  it("compte les saisies par état (comptages, aucune statistique de notes)", () => {
    const rows = [
      { ...rowFromPending({ enrollmentId: "e1", studentId: "s1" }), text: "12" },
      { ...rowFromPending({ enrollmentId: "e2", studentId: "s2" }), text: "ABS" },
      { ...rowFromPending({ enrollmentId: "e3", studentId: "s3" }), text: "DISP" },
      { ...rowFromPending({ enrollmentId: "e4", studentId: "s4" }), text: "" },
      { ...rowFromPending({ enrollmentId: "e5", studentId: "s5" }), text: "99" },
    ];
    expect(progressOf(rows, ctx)).toMatchObject({ total: 5, entered: 1, unexcused: 1, exempt: 1, empty: 1, invalid: 1 });
  });

  it("borne la navigation clavier", () => {
    expect(nextIndex(0, -1, 3)).toBe(0);
    expect(nextIndex(2, 1, 3)).toBe(2);
    expect(nextIndex(1, 1, 3)).toBe(2);
  });

  it("normalise les décimales sans flottant", () => {
    expect(normalizeDecimal("12.500")).toBe("12.5");
    expect(normalizeDecimal("12.000")).toBe("12");
    expect(normalizeDecimal("100")).toBe("100");
    expect(normalizeDecimal(null)).toBeNull();
  });
});

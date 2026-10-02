/**
 * Tests unitaires du DOMAINE (sans base) : numéro, décimaux, cycle de vie, listes blanches d'export et d'import, rendu des fichiers
 * (injection de formule neutralisée, encodages), analyse d'un fichier de l'autorité, entrées des règles d'examen blanc, erreurs de la base.
 */
import { describe, expect, it } from "vitest";
import { compareDecimal, normalizeDecimal } from "../../domain/decimal";
import { ExamCode, dbRuleCode, fromDbError } from "../../domain/errors";
import { buildTable, applyTransform, csvField, encodeText, neutralizeFormula, toCsv, toFixedWidth, toJson } from "../../domain/export-render";
import { validateExportColumns, validateExportFormatShape, validateImportColumns, validateImportValueMap } from "../../domain/export-spec";
import { analyze, FileError, parseDecimal, parseDelimited, payloadOf } from "../../domain/import-parse";
import { SESSION_TRANSITIONS, canTransitionSession, sessionProgress, transitionBlockers } from "../../domain/lifecycle";
import { applicablePapers, buildMockInputs, combineInputHashes, mapAssessEntry } from "../../domain/mock";
import { formatCandidateNumber, validateNumberPattern } from "../../domain/number-pattern";
import type { ImportFormatRow, SessionPaperRow } from "../../domain/types";

describe("numéro de candidat (copie TypeScript du motif de la base)", () => {
  it("formate les jetons {TYPE} {YEAR} {SEQ:n} sans jamais tronquer un compteur", () => {
    expect(formatCandidateNumber("{TYPE}{YEAR}-{SEQ:5}", "CEPE", 2027, 1)).toBe("CEPE2027-00001");
    expect(formatCandidateNumber("{TYPE}{YEAR}-{SEQ:5}", "CEPE", 2027, 123456)).toBe("CEPE2027-123456");
    expect(formatCandidateNumber("N{SEQ}", "BAC", 2030, 42n)).toBe("N42");
    expect(formatCandidateNumber("{YEAR}/{TYPE}/{SEQ:3}", "BEPC", 2028, "7")).toBe("2028/BEPC/007");
  });
  it("exige un compteur unique et refuse les jetons inconnus", () => {
    expect(validateNumberPattern("{TYPE}{YEAR}-{SEQ:5}")).toBeNull();
    expect(validateNumberPattern("SANS-COMPTEUR")).toMatch(/compteur/);
    expect(validateNumberPattern("{TYPE}-{SEQ}-{SEQ:3}")).toMatch(/une fois/);
    expect(validateNumberPattern("{SEQ}{NOM}")).toMatch(/Jeton inconnu/);
    expect(validateNumberPattern("{S}")).not.toBeNull();
  });
});

describe("décimaux exacts", () => {
  it("normalise et compare sans flottant", () => {
    expect(normalizeDecimal("20.00")).toBe("20");
    expect(normalizeDecimal("014.500")).toBe("14.5");
    expect(normalizeDecimal("0.10")).toBe("0.1");
    expect(compareDecimal("9.9", "10.1")).toBe(-1);
    expect(compareDecimal("10.000", "10")).toBe(0);
    expect(compareDecimal("123456.789", "99999.999")).toBe(1);
    expect(() => normalizeDecimal("1e3")).toThrow();
  });
});

describe("cycle de vie de la session", () => {
  it("n'autorise que les transitions de la spec, avec retours REGISTRATION_CLOSED -> OPEN et RESULTS_ENTERED -> IN_PROGRESS", () => {
    expect(canTransitionSession("PLANNED", "REGISTRATION_OPEN")).toBe(true);
    expect(canTransitionSession("REGISTRATION_CLOSED", "REGISTRATION_OPEN")).toBe(true);
    expect(canTransitionSession("RESULTS_ENTERED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionSession("PLANNED", "PUBLISHED")).toBe(false);
    expect(canTransitionSession("PUBLISHED", "RESULTS_ENTERED")).toBe(false);
    expect(SESSION_TRANSITIONS.ARCHIVED).toEqual([]);
  });
  it("calcule l'avancement et liste les manques d'une publication", () => {
    expect(sessionProgress("PLANNED")).toMatchObject({ index: 0, percent: 0, next: "REGISTRATION_OPEN" });
    expect(sessionProgress("ARCHIVED")).toMatchObject({ index: 6, percent: 100, next: null, allowedNext: [] });
    expect(transitionBlockers("PUBLISHED", { definitionLocked: true, registeredCount: 5, withoutResultCount: 2, unassignedCount: 0 })[0]).toMatch(/2 candidat/);
    expect(transitionBlockers("REGISTRATION_OPEN", { definitionLocked: false, registeredCount: 0, withoutResultCount: 0, unassignedCount: 0 })[0]).toMatch(/figée/);
  });
});

describe("liste blanche des formats d'export", () => {
  const col = (o: object) => [{ header: "H", source: "candidate.number", ...o }];
  it("accepte champs et transformations de la liste, refuse tout le reste (aucune expression libre)", () => {
    expect(validateExportColumns(col({}), "CANDIDATE_LIST", "CSV")).toEqual([]);
    expect(validateExportColumns(col({ transform: "decimal_comma" }), "CANDIDATE_LIST", "CSV")).toEqual([]);
    expect(validateExportColumns(col({ source: "candidate.password" }), "CANDIDATE_LIST", "CSV")[0]?.message).toMatch(/hors liste blanche/);
    expect(validateExportColumns(col({ transform: "eval(x)" }), "CANDIDATE_LIST", "CSV")[0]?.field).toBe("transform");
    expect(validateExportColumns(col({ expression: "a+b" }), "CANDIDATE_LIST", "CSV")[0]?.message).toMatch(/aucune expression libre/);
    expect(validateExportColumns(col({ source: "result.code" }), "CANDIDATE_LIST", "CSV")[0]?.message).toMatch(/n'existe pas/);
    expect(validateExportColumns(col({ source: "paper.score" }), "RESULTS", "CSV")[0]?.field).toBe("paper");
    expect(validateExportColumns(col({ source: "constant" }), "RESULTS", "CSV")[0]?.field).toBe("value");
    expect(validateExportColumns([...col({}), ...col({})], "CANDIDATE_LIST", "CSV")[0]?.message).toMatch(/en double/);
    expect(validateExportColumns(col({}), "CANDIDATE_LIST", "FIXED_WIDTH")[0]?.field).toBe("width");
    expect(validateExportColumns("pas une liste", "CANDIDATE_LIST", "CSV")).toHaveLength(1);
    expect(validateExportFormatShape({ kind: "CANDIDATE_LIST", fileFormat: "CSV", delimiter: undefined })[0]?.field).toBe("delimiter");
    expect(validateExportFormatShape({ kind: "CANDIDATE_LIST", fileFormat: "CSV", delimiter: ";" })).toEqual([]);
  });
  it("les statistiques n'exposent que des compteurs (aucun champ de candidat)", () => {
    expect(validateExportColumns([{ header: "N", source: "stat.admitted" }], "STATISTICS", "CSV")).toEqual([]);
    expect(validateExportColumns([{ header: "N", source: "candidate.last_name" }], "STATISTICS", "CSV")[0]?.message).toMatch(/n'existe pas/);
  });
  it("valide les colonnes, la clé unique et la table de correspondance d'un format d'import", () => {
    const cols = [{ header: "NUM", target: "key.candidate_number" }, { header: "RES", target: "result.code" }];
    expect(validateImportColumns(cols, "RESULTS")).toEqual([]);
    expect(validateImportColumns(cols, "SCORES").some((i) => /paper.score/.test(i.message))).toBe(true);
    expect(validateImportColumns([...cols, { header: "K2", target: "key.cepe_code" }], "RESULTS").some((i) => /Exactement une colonne/.test(i.message))).toBe(true);
    expect(validateImportColumns([...cols, { header: "X", target: "candidate.last_name" }], "RESULTS")[0]?.message).toMatch(/hors liste blanche/);
    expect(validateImportColumns([...cols, { header: "N", target: "paper.score" }], "RESULTS")[0]?.field).toBe("paper");
    expect(validateImportValueMap({ "result.code": { ADMIS: "ADMITTED" } })).toEqual([]);
    expect(validateImportValueMap({ "result.code": { OK: "PASSED" } })).toHaveLength(1);
    expect(validateImportValueMap({ "candidate.sex": { F: "M" } })).toHaveLength(1);
  });
});

describe("rendu des fichiers d'export", () => {
  it("neutralise l'injection de formule dans les cellules texte, pas dans les nombres du module", () => {
    for (const v of ["=1+1", "+33", "-2+3", "@SUM(A1)", "\t=cmd", "\r=x", " =1", "＝1"]) expect(neutralizeFormula(v).startsWith("'"), v).toBe(true);
    for (const v of ["Dupont", "a=b", "12", "", "É=mc2"]) expect(neutralizeFormula(v)).toBe(v);
    const table = buildTable(
      [{ header: "NOM", source: "candidate.last_name" }, { header: "MOY", source: "result.average", transform: "decimal_comma" }],
      [{ candidate: { number: null, officialNumber: null, lastName: "=cmd|' /C calc'!A1", firstName: null, birthDate: null, birthPlace: null, sex: null, track: null, gradeLevel: null, institution: null, status: null, cepeCode: null, nationalId: null }, result: { code: "ADMITTED", average: "14.5", rank: null, mention: null, totalPoints: null } }],
    );
    const csv = toCsv(table, ";");
    expect(csv).toBe("NOM;MOY\r\n'=cmd|' /C calc'!A1;14,5\r\n");
  });
  it("protège séparateur, guillemets et retours à la ligne ; l'en-tête est neutralisé aussi", () => {
    expect(csvField('a;b', ";")).toBe('"a;b"');
    expect(csvField('dit "oui"', ";")).toBe('"dit ""oui"""');
    expect(csvField("l1\nl2", ";")).toBe('"l1\nl2"');
    expect(csvField("a,b", ";")).toBe("a,b");
    expect(toCsv({ headers: ["=H"], rows: [] }, ";")).toBe("'=H\r\n");
  });
  it("applique les transformations de la liste blanche", () => {
    const t = (value: string, transform: string) => applyTransform({ value, numeric: false }, transform).value;
    expect(t("dupont", "upper")).toBe("DUPONT");
    expect(t("DUPONT", "lower")).toBe("dupont");
    expect(t("2016-05-05", "date_dmy")).toBe("05/05/2016");
    expect(t("2016-05-05T10:00", "date_iso")).toBe("2016-05-05");
    expect(t("F", "sex_fm")).toBe("F");
    expect(t("X", "sex_fm")).toBe("");
    expect(t("14.5", "decimal_comma")).toBe("14,5");
    expect(t("42", "pad_left_8")).toBe("00000042");
    expect(t("123456789", "pad_left_8")).toBe("123456789");
    expect(t("x", "none")).toBe("x");
  });
  it("largeur fixe (troncature, jamais de décalage), JSON et encodages", () => {
    const table = { headers: ["A", "B"], rows: [[{ value: "abcdef", numeric: false }, { value: "7", numeric: true }]] };
    expect(toFixedWidth(table, [{ header: "A", source: "constant", width: 4 }, { header: "B", source: "constant", width: 3 }])).toBe("abcd  7\r\n");
    expect(JSON.parse(toJson(table))).toEqual([{ A: "abcdef", B: "7" }]);
    expect(encodeText("é€", "UTF-8")).toEqual(Buffer.from("é€", "utf8"));
    expect([...encodeText("é€中", "ISO-8859-1")]).toEqual([0xe9, 0x3f, 0x3f]);
    expect([...encodeText("é€中", "WINDOWS-1252")]).toEqual([0xe9, 0x80, 0x3f]);
  });
});

describe("analyse d'un fichier de l'autorité", () => {
  const format = (over: Partial<ImportFormatRow> = {}) => ({
    kind: "RESULTS" as const, delimiter: ";", decimalSeparator: "," as const, hasHeader: true, encoding: "UTF-8" as const,
    columns: [{ header: "NUMERO", target: "key.candidate_number" }, { header: "DECISION", target: "result.code" }, { header: "MOYENNE", target: "result.average" }],
    valueMap: { "result.code": { ADMIS: "ADMITTED", AJOURNE: "FAILED", ABSENT: "ABSENT" } },
    ...over,
  });
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("découpe un CSV (guillemets, doublement, retour à la ligne dans un champ, lignes vides)", () => {
    expect(parseDelimited('a;"b;c";"d""e"\r\n\r\n1;2;3\n', ";")).toEqual([["a", "b;c", 'd"e'], ["1", "2", "3"]]);
    expect(parseDelimited('"x\ny";z', ";")).toEqual([["x\ny", "z"]]);
    expect(() => parseDelimited('"non refermé;1', ";")).toThrow(FileError);
  });
  it("lit les décimaux selon le séparateur du format, sans signe, exposant ni milliers", () => {
    expect(parseDecimal("12,5", ",")).toBe("12.5");
    expect(parseDecimal("12.5", ".")).toBe("12.5");
    expect(parseDecimal("12.5", ",")).toBeNull();
    expect(parseDecimal("-1", ".")).toBeNull();
    expect(parseDecimal("1e3", ".")).toBeNull();
    expect(parseDecimal("1 000", ".")).toBeNull();
    expect(parseDecimal("12.3456", ".")).toBeNull();
  });
  it("analyse ligne à ligne : codes mappés, erreurs par ligne, clés en double ; payload sans nom", () => {
    const r = analyze(format(), bytes("NUMERO;DECISION;MOYENNE\r\nA1;ADMIS;12,5\r\nA2;peut-être;10\r\nA1;AJOURNE;8\r\n;ABSENT;\r\nA5;ADMIS;abc\r\n"));
    expect(r.rows.map((x) => [x.lineNo, x.resultCode ?? null, x.average ?? null, x.errors])).toEqual([
      [2, "ADMITTED", "12.5", []],
      [3, null, "10", ["RESULT_CODE_UNKNOWN"]],
      [4, "FAILED", "8", ["KEY_DUPLICATE"]],
      [5, "ABSENT", null, ["KEY_MISSING"]],
      [6, "ADMITTED", null, ["AVERAGE_INVALID"]],
    ]);
    expect(JSON.stringify(payloadOf(r.rows[0]!, "RESULTS"))).toBe('{"key":{"target":"key.candidate_number","value":"A1"},"result":{"code":"ADMITTED","average":"12.5","totalPoints":null,"rank":null,"mention":null}}');
  });
  it("refuse un fichier vide, trop gros, illisible ou sans la colonne attendue ; un absent n'a pas de moyenne", () => {
    expect(() => analyze(format(), bytes(""))).toThrow(/vide/);
    expect(() => analyze(format(), bytes("A;B\r\n1;2"))).toThrow(/absente de l'en-tête/);
    expect(() => analyze(format(), new Uint8Array(6 * 1024 * 1024))).toThrow(/taille maximale/);
    expect(() => analyze(format(), new Uint8Array([0xff, 0xfe, 0x00, 0xd8]))).toThrow(/n'est pas lisible/);
    const r = analyze(format(), bytes("NUMERO;DECISION;MOYENNE\r\nA1;ABSENT;10\r\n"));
    expect(r.rows[0]?.errors).toEqual(["VALUE_WITHOUT_RESULT_FORBIDDEN"]);
    const noHeader = analyze(format({ hasHeader: false }), bytes("A1;ADMIS;11\r\n"));
    expect(noHeader.rows[0]).toMatchObject({ lineNo: 1, resultCode: "ADMITTED", average: "11" });
  });
  it("lit un fichier Windows-1252 et mappe les codes sans tenir compte de la casse", () => {
    const latin = Uint8Array.from([...Buffer.from("NUMERO;DECISION;MOYENNE\r\nA1;ajourné;9,5\r\n", "latin1")]);
    const r = analyze(format({ encoding: "WINDOWS-1252", valueMap: { "result.code": { "AJOURNÉ": "FAILED" } } }), latin);
    expect(r.rows[0]).toMatchObject({ resultCode: "FAILED", average: "9.5", errors: [] });
  });
});

describe("entrées des règles d'un examen blanc", () => {
  const paper = (code: string, o: Partial<SessionPaperRow> = {}): SessionPaperRow => ({ id: `id-${code}`, sessionId: "s", trackCode: null, code, label: code, coefficient: "1.000", scaleMax: "20.00", isOptional: false, ordinal: 1, sourceKind: "placeholder", ...o });
  it("transmet une note absente comme absente (jamais 0), les décimaux canoniques, et ne retient que les épreuves de la série", () => {
    const papers = [paper("EP1", { ordinal: 1 }), paper("EP2", { ordinal: 2, coefficient: "2.000" }), paper("SPEC", { ordinal: 3, trackCode: "A" }), paper("OPT", { ordinal: 4, isOptional: true })];
    const inputs = buildMockInputs(papers, [{ paperId: "id-EP1", status: "ENTERED", score: "14.50" }, { paperId: "id-EP2", status: "ABSENT", score: null }], null);
    expect(inputs.epreuves).toEqual([
      { note: "14.5", coef: "1", bareme: "20", facultative: false, absent: false },
      { note: null, coef: "2", bareme: "20", facultative: false, absent: true },
      { note: null, coef: "1", bareme: "20", facultative: true, absent: true },
    ]);
    expect(inputs.absentCount).toBe(1); // EP2 : l'épreuve facultative non notée ne compte pas
    expect(applicablePapers(papers, "A").map((p) => p.code)).toEqual(["EP1", "EP2", "SPEC", "OPT"]);
  });
  it("mappe les états de saisie d'assess et agrège des empreintes reproductibles", () => {
    expect(mapAssessEntry("ENTERED", "12.0")).toEqual({ status: "ENTERED", score: "12" });
    expect(mapAssessEntry("ENTERED", null)).toBeNull();
    expect(mapAssessEntry("ABSENT_UNEXCUSED", null)).toEqual({ status: "ABSENT", score: null });
    expect(mapAssessEntry("ABSENT_EXCUSED", null)).toEqual({ status: "EXCUSED", score: null });
    expect(mapAssessEntry("EXEMPT", null)).toBeNull();
    expect(mapAssessEntry("NOT_GRADED", "5")).toBeNull();
    expect(combineInputHashes(["a", "b"])).toBe(combineInputHashes(["a", "b"]));
    expect(combineInputHashes(["a", "b"])).not.toBe(combineInputHashes(["b", "a"]));
  });
});

describe("traduction des erreurs de la base", () => {
  const pg = (message: string, extra: object = {}) => Object.assign(new Error(message), extra);
  it("extrait le code `examinations.*` des déclencheurs et choisit le bon statut", () => {
    expect(dbRuleCode(pg("examinations.not_eligible: l'éligibilité doit être établie"))).toBe("examinations.not_eligible");
    expect(dbRuleCode(pg("permission denied for table x"))).toBeNull();
    expect(fromDbError(pg("examinations.not_eligible: statut NEEDS_REVIEW"))).toMatchObject({ kind: "conflict", code: ExamCode.NOT_ELIGIBLE });
    expect(fromDbError(pg("examinations.score_above_scale: la note 11 dépasse le barème 10"))).toMatchObject({ kind: "validation", code: ExamCode.SCORE_ABOVE_SCALE });
    expect(fromDbError(pg("examinations.session_not_found"))).toMatchObject({ kind: "not_found" });
    expect(fromDbError(pg("examinations.une_regle_future: x"))).toMatchObject({ kind: "conflict", code: "examinations.une_regle_future" });
  });
  it("traduit les unicités nommées, les clés étrangères et les contraintes ; une vraie panne reste inattendue", () => {
    expect(fromDbError(pg("duplicate key", { code: "23505", constraint: "candidates_one_live_per_student" }))).toMatchObject({ code: ExamCode.CANDIDATE_DUPLICATE });
    expect(fromDbError(pg("duplicate key", { code: "23505", constraint: "seat_assignments_tenant_id_session_id_room_id_seat_number_key" }))).toMatchObject({ code: ExamCode.SEAT_TAKEN });
    expect(fromDbError(pg("duplicate key", { code: "23505", constraint: "import_batches_tenant_id_session_id_kind_sha256_key" }))).toMatchObject({ code: ExamCode.BATCH_DUPLICATE });
    expect(fromDbError(pg("duplicate key", { code: "23505", constraint: "inconnue" }))).toMatchObject({ kind: "conflict" });
    expect(fromDbError(pg("fk", { code: "23503" }))).toMatchObject({ kind: "validation" });
    expect(fromDbError(pg("check", { code: "23514", constraint: "x" }))).toMatchObject({ kind: "validation" });
    expect(fromDbError(pg("connexion perdue", { code: "08006" }))).toBeNull();
    expect(fromDbError(new Error("boom"))).toBeNull();
  });
});

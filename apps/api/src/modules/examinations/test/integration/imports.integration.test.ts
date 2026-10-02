/**
 * IMPORT des résultats OFFICIELS : fichier unique par empreinte, analyse ligne à ligne selon un format publié (donnée), lot en erreur
 * REFUSÉ, application tout ou rien, lot appliqué immuable, lignes sans nom ni adresse, aucun calcul d'admission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createImportFormat, listImportFormats, publishImportFormat } from "../../application/formats";
import { applyImport, createImport, getBatch, validateImport } from "../../application/imports";
import { bulkSaveScores } from "../../application/scores";
import { getSessionDetail, transitionSession } from "../../application/sessions";
import { publishResult } from "../../application/results";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

const csv = (lines: string[]): string => Buffer.from(lines.join("\r\n"), "utf8").toString("base64");

describeIntegration("examinations : import des résultats officiels", () => {
  let env: Env;
  let sessionId: string;
  let numbers: string[];
  let candidateIds: string[];
  let formatId: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    sessionId = (await openSession(env, "CEPE-IMP")).id;
    const { pupils } = addPupils(env, 4);
    numbers = [];
    candidateIds = [];
    for (const p of pupils) {
      const r = await registerPupil(env, env.ctxA(), sessionId, p);
      numbers.push(r.number);
      candidateIds.push(r.candidateId);
    }
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "IN_PROGRESS"));
    formatId = unwrap(await listImportFormats(env.deps(), env.ctxA(), { status: "PUBLISHED", kind: "RESULTS" }))[0]!.id;
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("un fichier en erreur est analysé ligne à ligne puis REFUSÉ : jamais appliqué", async () => {
    const file = csv(["NUMERO;DECISION;MOYENNE", `${numbers[0]};ADMIS;12,5`, `${numbers[1]};AJOURNE;8,25`, "CEPE2027-99999;ADMIS;11", `${numbers[2]};PEUT-ETRE;10`, `${numbers[3]};ADMIS;abc`]);
    const batch = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "resultats-1.csv", contentBase64: file }));
    expect(batch).toMatchObject({ status: "UPLOADED", formatCode: "RESULTATS_IMPORT_FICTIF@1" });
    const validated = unwrap(await validateImport(env.deps(), env.ctxA(), batch.id));
    expect(validated.batch).toMatchObject({ status: "REJECTED", rowCount: 5, okCount: 2, errorCount: 3 });
    expect(validated.errorsByCode).toEqual({ CANDIDATE_UNKNOWN: 1, RESULT_CODE_UNKNOWN: 1, AVERAGE_INVALID: 1 });
    const detail = unwrap(await getBatch(env.deps(), env.ctxA(), batch.id, { status: "ERROR", page: 1, pageSize: 50 }));
    expect(detail.rows.items.map((r) => [r.lineNo, r.errorCode])).toEqual([[4, "CANDIDATE_UNKNOWN"], [5, "RESULT_CODE_UNKNOWN"], [6, "AVERAGE_INVALID"]]);
    const refused = await applyImport(env.deps(), env.ctxA(), batch.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.batch_not_validated");
    const results = await env.db.admin.query("SELECT count(*)::int AS n FROM examinations.candidate_results WHERE session_id = $1", [sessionId]);
    expect(results.rows[0].n).toBe(0);
  });

  it("le même fichier ne s'importe qu'une fois (empreinte) même rejeté ; un fichier vide ou illisible est refusé", async () => {
    const file = csv(["NUMERO;DECISION;MOYENNE", `${numbers[0]};ADMIS;12,5`, `${numbers[1]};AJOURNE;8,25`, "CEPE2027-99999;ADMIS;11", `${numbers[2]};PEUT-ETRE;10`, `${numbers[3]};ADMIS;abc`]);
    const dup = await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "copie.csv", contentBase64: file });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("examinations.batch_duplicate");
    const empty = await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "vide.csv", contentBase64: "" });
    expect(empty.ok).toBe(false);
    const noHeader = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "sans-entete.csv", contentBase64: csv(["A;B", "1;2"]) }));
    const rejected = unwrap(await validateImport(env.deps(), env.ctxA(), noHeader.id));
    expect(rejected.batch.status).toBe("REJECTED");
    expect(rejected.fileError).toMatch(/absente de l'en-tête/);
  });

  it("un lot sain s'applique en une transaction : résultats IMPORTÉS (jamais calculés), brouillons ; lot immuable ensuite", async () => {
    const file = csv(["NUMERO;DECISION;MOYENNE", `${numbers[0]};ADMIS;12,5`, `${numbers[1]};AJOURNE;8,25`, `${numbers[2]};ABSENT;`, `${numbers[3]};admis;10`]);
    const batch = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "resultats-2.csv", contentBase64: file }));
    const validated = unwrap(await validateImport(env.deps(), env.ctxA(), batch.id));
    expect(validated.batch).toMatchObject({ status: "VALIDATED", okCount: 4, errorCount: 0 });
    const applied = unwrap(await applyImport(env.deps(), env.ctxA(), batch.id));
    expect(applied).toMatchObject({ status: "APPLIED" });
    const rows = (await env.db.admin.query("SELECT c.candidate_number, r.result_code, r.average::text AS average, r.source, r.status, r.import_batch_id, r.rule_version_ref FROM examinations.candidate_results r JOIN examinations.candidates c ON c.id = r.candidate_id WHERE r.session_id = $1 ORDER BY c.candidate_seq", [sessionId])).rows;
    expect(rows.map((r) => [r.result_code, r.average, r.source, r.status])).toEqual([
      ["ADMITTED", "12.500", "IMPORTED", "DRAFT"],
      ["FAILED", "8.250", "IMPORTED", "DRAFT"],
      ["ABSENT", null, "IMPORTED", "DRAFT"],
      ["ADMITTED", "10.000", "IMPORTED", "DRAFT"],
    ]);
    expect(rows.every((r) => r.import_batch_id === batch.id && r.rule_version_ref === null)).toBe(true);
    // lot appliqué : ré-application refusée, base immuable
    const again = await applyImport(env.deps(), env.ctxA(), batch.id);
    expect(again.ok).toBe(false);
    await expect(env.db.tenantDb.run(env.ctxA(), (tx) => tx.query("UPDATE examinations.import_batches SET row_count = 99 WHERE id = $1", [batch.id]))).rejects.toThrow(/batch_closed/);
    await expect(env.db.tenantDb.run(env.ctxA(), (tx) => tx.query("DELETE FROM examinations.import_rows WHERE batch_id = $1", [batch.id]))).rejects.toThrow(/append_only|ajout seul|permission/);
    // les lignes d'import ne contiennent ni nom, ni prénom, ni adresse
    const payloads = (await env.db.admin.query("SELECT payload::text AS p FROM examinations.import_rows WHERE batch_id = $1", [batch.id])).rows.map((r) => r.p).join("\n");
    expect(payloads).not.toMatch(/ELEVE|Prénom|Abidjan/);
    // audit sensible de l'application, sans valeur
    const audit = env.audit.entries.find((e) => e.entry.action === "examinations.import.apply");
    expect(audit?.entry.sensitive).toBe(true);
    expect(JSON.stringify(audit?.entry)).not.toMatch(/12[.,]5|8[.,]25/);
  });

  it("une application qui échoue en cours de route n'applique RIEN (aucune application partielle)", async () => {
    const e2 = await setupEnv();
    try {
      await seedPack(e2);
      const s = (await openSession(e2, "CEPE-ATOM")).id;
      const { pupils } = addPupils(e2, 3);
      const regs = [];
      for (const p of pupils) regs.push(await registerPupil(e2, e2.ctxA(), s, p));
      unwrap(await transitionSession(e2.deps(), e2.ctxA(), s, "REGISTRATION_CLOSED"));
      unwrap(await transitionSession(e2.deps(), e2.ctxA(), s, "IN_PROGRESS"));
      const fmt = unwrap(await listImportFormats(e2.deps(), e2.ctxA(), { status: "PUBLISHED", kind: "RESULTS" }))[0]!.id;
      const batch = unwrap(await createImport(e2.deps(), e2.ctxA(), s, { kind: "RESULTS", formatId: fmt, fileName: "r.csv", contentBase64: csv(["NUMERO;DECISION;MOYENNE", ...regs.map((r) => `${r.number};ADMIS;12`)]) }));
      unwrap(await validateImport(e2.deps(), e2.ctxA(), batch.id));
      // entre la validation et l'application, un candidat est retiré : la base refuse son résultat
      await e2.db.admin.query("SELECT set_config('app.tenant_id', $1, false)", [e2.tenantA]);
      await e2.db.admin.query("UPDATE examinations.candidates SET registration_status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_reason = 'Retrait tardif de test' WHERE id = $1", [regs[2]!.candidateId]);
      const result = await applyImport(e2.deps(), e2.ctxA(), batch.id);
      expect(result.ok).toBe(false);
      const n = (await e2.db.admin.query("SELECT count(*)::int AS n FROM examinations.candidate_results WHERE session_id = $1", [s])).rows[0].n;
      expect(n).toBe(0);
      const st = (await e2.db.admin.query("SELECT status FROM examinations.import_batches WHERE id = $1", [batch.id])).rows[0].status;
      expect(st).toBe("VALIDATED"); // reprise possible après correction
    } finally {
      await e2.drop();
    }
  });

  it("un résultat déjà publié n'est pas écrasé par un import (révision exigée) ; un import de résultats d'un examen blanc est refusé", async () => {
    const r = (await env.db.admin.query("SELECT id FROM examinations.candidate_results WHERE candidate_id = $1", [candidateIds[0]])).rows[0].id as string;
    unwrap(await publishResult(env.deps(), env.ctxA(), r));
    const file = csv(["NUMERO;DECISION;MOYENNE", `${numbers[0]};AJOURNE;5`]);
    const batch = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "RESULTS", formatId, fileName: "resultats-3.csv", contentBase64: file }));
    const validated = unwrap(await validateImport(env.deps(), env.ctxA(), batch.id));
    expect(validated.batch.status).toBe("REJECTED");
    expect(validated.errorsByCode).toEqual({ RESULT_ALREADY_PUBLISHED: 1 });

    const mock = await openSession(env, "CEPE-BLANC-IMP", { kind: "MOCK", mockOf: sessionId });
    const refused = await createImport(env.deps(), env.ctxA(), mock.id, { kind: "RESULTS", formatId, fileName: "blanc.csv", contentBase64: csv(["NUMERO;DECISION;MOYENNE", "X;ADMIS;1"]) });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.mock_not_imported");
  });

  it("import de notes d'épreuves et de numéros officiels : format en données, unicité d'un numéro officiel", async () => {
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), sessionId));
    const numFormat = unwrap(
      await createImportFormat(env.deps(), env.ctxA(), {
        code: "NUMEROS_OFFICIELS_FICTIF", label: "Numéros officiels (fictif)", kind: "OFFICIAL_NUMBERS", encoding: "UTF-8", delimiter: ";", decimalSeparator: ".", hasHeader: true,
        columns: [{ header: "NUMERO", target: "key.candidate_number" }, { header: "NUM_OFFICIEL", target: "identifier.official_number" }], valueMap: {}, sourceKind: "placeholder",
      }),
    );
    unwrap(await publishImportFormat(env.deps(), env.ctxA(), numFormat.id));
    const file = csv(["NUMERO;NUM_OFFICIEL", `${numbers[0]};OFF-0001`, `${numbers[1]};OFF-0002`]);
    const batch = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "OFFICIAL_NUMBERS", formatId: numFormat.id, fileName: "numeros.csv", contentBase64: file }));
    unwrap(await validateImport(env.deps(), env.ctxA(), batch.id));
    unwrap(await applyImport(env.deps(), env.ctxA(), batch.id));
    const ids = (await env.db.admin.query("SELECT value FROM examinations.candidate_identifiers WHERE session_id = $1 AND kind = 'OFFICIAL_NUMBER' ORDER BY value", [sessionId])).rows.map((r) => r.value);
    expect(ids).toEqual(["OFF-0001", "OFF-0002"]);
    // même numéro officiel pour un AUTRE candidat : ligne en erreur
    const dup = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "OFFICIAL_NUMBERS", formatId: numFormat.id, fileName: "numeros2.csv", contentBase64: csv(["NUMERO;NUM_OFFICIEL", `${numbers[2]};OFF-0001`]) }));
    const v = unwrap(await validateImport(env.deps(), env.ctxA(), dup.id));
    expect(v.errorsByCode).toEqual({ OFFICIAL_NUMBER_TAKEN: 1 });

    const scoreFormat = unwrap(
      await createImportFormat(env.deps(), env.ctxA(), {
        code: "NOTES_FICTIF", label: "Notes (fictif)", kind: "SCORES", encoding: "UTF-8", delimiter: ";", decimalSeparator: ",", hasHeader: true,
        columns: [{ header: "NUMERO", target: "key.candidate_number" }, { header: "EP3", target: "paper.score", paper: "EP3" }], valueMap: {}, sourceKind: "placeholder",
      }),
    );
    unwrap(await publishImportFormat(env.deps(), env.ctxA(), scoreFormat.id));
    const ep3 = detail.papers.find((p) => p.code === "EP3")!;
    const sBatch = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "SCORES", formatId: scoreFormat.id, fileName: "notes.csv", contentBase64: csv(["NUMERO;EP3", `${numbers[0]};7,5`, `${numbers[1]};11`]) }));
    const sv = unwrap(await validateImport(env.deps(), env.ctxA(), sBatch.id));
    expect(sv.errorsByCode).toEqual({ SCORE_ABOVE_SCALE: 1 }); // 11 > barème 10
    const sBatch2 = unwrap(await createImport(env.deps(), env.ctxA(), sessionId, { kind: "SCORES", formatId: scoreFormat.id, fileName: "notes2.csv", contentBase64: csv(["NUMERO;EP3", `${numbers[0]};7,5`, `${numbers[1]};9,5`]) }));
    unwrap(await validateImport(env.deps(), env.ctxA(), sBatch2.id));
    unwrap(await applyImport(env.deps(), env.ctxA(), sBatch2.id));
    const scores = (await env.db.admin.query("SELECT score::text AS s, source FROM examinations.paper_scores WHERE paper_id = $1 ORDER BY score", [ep3.id])).rows;
    expect(scores).toEqual([{ s: "7.50", source: "IMPORT" }, { s: "9.50", source: "IMPORT" }]);
    void bulkSaveScores;
  });
});

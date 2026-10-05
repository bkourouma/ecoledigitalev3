/**
 * RÉSULTAT D'EXAMEN ET MOYENNE REÇUS de `examinations` (Q-E18, CEPE -> admission en 6e) : réception idempotente et ordonnée par version,
 * rattachement SÛR au dossier (élève du dossier ou rapprochement CONFIRMÉ, jamais un rapprochement ouvert), moyenne réservée au personnel
 * habilité (lecture tracée sans la valeur), aucune moyenne dans l'audit, isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsConsumedExamResultSchema, admissionsExamResultsDtoSchema } from "@ecoledigitale/contracts/src/v2/admissions";
import { runDetection, resolveDuplicate } from "../../application/duplicates";
import { listApplicationExamResults, recordTransmittedResult, type TransmittedExamResult } from "../../application/exam-results";
import { describeIntegration } from "../support/db";
import { createWorld, openCampaignWith, submittedApplication, unwrap, uuid, type TenantWorld, type World } from "../support/world";

const payload = (over: Partial<TransmittedExamResult> & { studentId: string; resultId: string }, t: TenantWorld): TransmittedExamResult => ({
  sessionId: uuid(0x9001), candidateId: uuid(0x9002), institutionId: t.institutionId, examTypeCode: "CEPE", sessionYear: 2027, outcome: "ADMITTED", admitted: true, average: "12.25", revision: 1, ...over,
});

describeIntegration("admissions : résultat d'examen et moyenne reçus d'examinations (Q-E18)", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  const eventId = (n: number): string => uuid(0xa000 + n);
  const rowsOf = async (resultId: string) => (await w.db.admin.query("SELECT outcome, admitted, average::text AS average, revision FROM admissions.exam_results WHERE source_result_id = $1", [resultId])).rows;

  async function applicationLinkedTo(t: TenantWorld, studentId: string, resolution: "CONFIRMED_DUPLICATE" | "DISMISSED" | "OPEN") {
    const campaign = await openCampaignWith(t, { seats: { CP1: 10 } });
    const app = await submittedApplication(t, campaign.id);
    t.mem.duplicatesFor = [{ studentId, score: 100, reasons: ["EXACT"] }];
    const dups = unwrap(await runDetection(t.deps, t.ctx(), app.id));
    t.mem.duplicatesFor = [];
    const dup = dups.find((d) => d.matchedKind === "STUDENT")!;
    if (resolution !== "OPEN") unwrap(await resolveDuplicate(t.deps, t.ctx(), app.id, dup.id, resolution));
    return app.id;
  }

  it("réception : une ligne par résultat ; un rejeu ou une version plus ancienne ne change RIEN ; une correction (version plus grande) remplace", async () => {
    const t = await w.tenant("recu");
    const student = uuid(0xb001);
    const first = unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc001), outcome: "FAILED", admitted: false, average: "9.4", revision: 2 }, t), eventId(1)));
    expect(first.stored).toBe(true);
    expect(await rowsOf(uuid(0xc001))).toEqual([{ outcome: "FAILED", admitted: false, average: "9.400", revision: 2 }]);
    // même événement rejoué, puis version plus ancienne arrivée en retard : sans effet
    expect(unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc001), outcome: "FAILED", admitted: false, average: "9.4", revision: 2 }, t), eventId(1))).stored).toBe(false);
    expect(unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc001), outcome: "ADMITTED", admitted: true, average: "19", revision: 1 }, t), eventId(2))).stored).toBe(false);
    expect(await rowsOf(uuid(0xc001))).toEqual([{ outcome: "FAILED", admitted: false, average: "9.400", revision: 2 }]);
    // correction approuvée après transmission : la version suivante remplace
    expect(unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc001), outcome: "ADMITTED", admitted: true, average: "10.2", revision: 3 }, t), eventId(3))).stored).toBe(true);
    expect(await rowsOf(uuid(0xc001))).toEqual([{ outcome: "ADMITTED", admitted: true, average: "10.200", revision: 3 }]);
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.exam_results WHERE source_result_id = $1", [uuid(0xc001)])).rows[0].n).toBe(1);
    // la base elle-même refuse de reculer ou de changer l'identité
    await expect(w.db.admin.query("UPDATE admissions.exam_results SET revision = 2 WHERE source_result_id = $1", [uuid(0xc001)])).rejects.toThrow(/exam_result_stale/);
    await expect(w.db.admin.query("UPDATE admissions.exam_results SET student_id = $2, revision = 9 WHERE source_result_id = $1", [uuid(0xc001), uuid(0xb999)])).rejects.toThrow(/exam_result_identity_immutable/);
  });

  it("une charge hors contrat est REFUSÉE proprement (jamais rangée) : issue inconnue, moyenne pour un absent, « admis » incohérent, code invalide", async () => {
    const t = await w.tenant("horscontrat");
    const base = { studentId: uuid(0xb002), resultId: uuid(0xc002) };
    for (const bad of [
      { outcome: "PERFECT" },
      { outcome: "ABSENT", admitted: false, average: "5" },
      { outcome: "FAILED", admitted: true, average: "5" },
      { examTypeCode: "cepe" },
      { average: "douze" },
      { sessionYear: 1800 },
    ] as Array<Partial<TransmittedExamResult>>) {
      const r = await recordTransmittedResult(t.deps, t.ctx(), payload({ ...base, ...bad }, t), eventId(9));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("admissions.invalid_input");
    }
    expect(await rowsOf(base.resultId)).toEqual([]);
    // un absent se range sans moyenne
    expect(unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ ...base, outcome: "ABSENT", admitted: false, average: null }, t), eventId(10))).stored).toBe(true);
  });

  it("rattachement SÛR : rien sans lien ; un rapprochement OUVERT ou écarté ne montre jamais la moyenne d'un autre enfant ; confirmé : oui", async () => {
    const t = await w.tenant("lien");
    const student = uuid(0xb003);
    unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc003) }, t), eventId(20)));
    const open = await applicationLinkedTo(t, student, "OPEN");
    const dismissed = await applicationLinkedTo(t, student, "DISMISSED");
    const confirmed = await applicationLinkedTo(t, student, "CONFIRMED_DUPLICATE");
    const strangerCampaign = await openCampaignWith(t, { seats: { CP1: 10 } });
    const stranger = await submittedApplication(t, strangerCampaign.id);
    expect(unwrap(await listApplicationExamResults(t.deps, t.ctx(), stranger.id, { includeAverage: true })).items).toEqual([]);
    expect(unwrap(await listApplicationExamResults(t.deps, t.ctx(), open, { includeAverage: true })).items).toEqual([]);
    expect(unwrap(await listApplicationExamResults(t.deps, t.ctx(), dismissed, { includeAverage: true })).items).toEqual([]);
    const ok = unwrap(await listApplicationExamResults(t.deps, t.ctx(), confirmed, { includeAverage: true }));
    expect(ok.items).toHaveLength(1);
    expect(ok.items[0]).toMatchObject({ examTypeCode: "CEPE", sessionYear: 2027, outcome: "ADMITTED", admitted: true, average: "12.250", matchedBy: "CONFIRMED_DUPLICATE", averageHidden: false });
    expect(() => admissionsExamResultsDtoSchema.parse(ok)).not.toThrow();
    // le dossier lui-même rattaché à l'élève (après inscription) : lien direct, sans rapprochement
    await w.db.admin.query("UPDATE admissions.applications SET student_id = $2, enrollment_id = $3 WHERE id = $1", [stranger.id, student, uuid(0xd001)]);
    const direct = unwrap(await listApplicationExamResults(t.deps, t.ctx(), stranger.id, { includeAverage: true }));
    expect(direct.items.map((i) => i.matchedBy)).toEqual(["STUDENT"]);
  });

  it("la MOYENNE est réservée au personnel habilité : masquée sans la permission (« admis / non admis » reste visible), lecture tracée sans la valeur", async () => {
    const t = await w.tenant("habilitation");
    const student = uuid(0xb004);
    unwrap(await recordTransmittedResult(t.deps, t.ctx(), payload({ studentId: student, resultId: uuid(0xc004), outcome: "FAILED", admitted: false, average: "8.75" }, t), eventId(30)));
    const appId = await applicationLinkedTo(t, student, "CONFIRMED_DUPLICATE");
    const before = w.audit.entries.length;
    const hidden = unwrap(await listApplicationExamResults(t.deps, t.ctx(), appId, { includeAverage: false }));
    expect(hidden).toMatchObject({ canSeeAverage: false });
    expect(hidden.items[0]).toMatchObject({ outcome: "FAILED", admitted: false, average: null, averageHidden: true });
    expect(JSON.stringify(hidden)).not.toContain("8.75");
    expect(w.audit.entries.length).toBe(before); // aucune lecture de moyenne à tracer
    const shown = unwrap(await listApplicationExamResults(t.deps, t.ctx(), appId, { includeAverage: true }));
    expect(shown.items[0]).toMatchObject({ average: "8.750", averageHidden: false });
    const reads = w.audit.entries.slice(before).filter((e) => e.entry.action === "admissions.exam_result.read_average");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.entry).toMatchObject({ sensitive: true, resourceId: appId, metadata: { results: 1 } });
    expect(JSON.stringify(reads[0]!.entry)).not.toMatch(/8\.75/);
    // ni la réception, ni aucune autre trace d'audit du module, ne contient la moyenne
    expect(JSON.stringify(w.audit.entries.filter((e) => e.entry.action.startsWith("admissions.exam_result")).map((e) => e.entry))).not.toMatch(/8\.75|12\.25/);
    const receive = w.audit.entries.find((e) => e.entry.action === "admissions.exam_result.receive" && (e.entry.metadata as { studentId?: string }).studentId === student)!;
    expect(receive.entry.metadata).toMatchObject({ examTypeCode: "CEPE", outcome: "FAILED", withAverage: true });
  });

  it("ISOLATION A/B : l'autre établissement (tenant) ne voit ni le résultat, ni la moyenne, ni le dossier", async () => {
    const student = uuid(0xb005);
    unwrap(await recordTransmittedResult(w.A.deps, w.A.ctx(), payload({ studentId: student, resultId: uuid(0xc005) }, w.A), eventId(40)));
    const appA = await applicationLinkedTo(w.A, student, "CONFIRMED_DUPLICATE");
    expect(unwrap(await listApplicationExamResults(w.A.deps, w.A.ctx(), appA, { includeAverage: true })).items).toHaveLength(1);
    const asB = await listApplicationExamResults(w.B.deps, w.B.ctx(), appA, { includeAverage: true });
    expect(asB.ok).toBe(false);
    if (!asB.ok) expect(asB.error.code).toBe("admissions.application_not_found");
    const rowsB = await w.B.deps.db.run(w.B.ctx(), (tx) => tx.many("SELECT id FROM admissions.exam_results"), { readOnly: true });
    expect(rowsB).toEqual([]);
    // même identifiant de résultat reçu chez B : aucune collision entre tenants
    expect(unwrap(await recordTransmittedResult(w.B.deps, w.B.ctx(), payload({ studentId: student, resultId: uuid(0xc005) }, w.B), eventId(41))).stored).toBe(true);
    expect((await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.exam_results WHERE source_result_id = $1", [uuid(0xc005)])).rows[0].n).toBe(2);
  });

  it("le schéma partagé accepte la charge produite par examinations (même forme) et n'exige ni nom ni date de naissance", () => {
    const produced = { v: 1, sessionId: uuid(1), candidateId: uuid(2), resultId: uuid(3), studentId: uuid(4), institutionId: uuid(5), examTypeCode: "CEPE", sessionYear: 2027, outcome: "ADMITTED", admitted: true, average: "12.25", revision: 1 };
    expect(admissionsConsumedExamResultSchema.safeParse(produced).success).toBe(true);
    expect(Object.keys(produced).some((k) => /name|birth|nom|naissance/i.test(k))).toBe(false);
  });
});

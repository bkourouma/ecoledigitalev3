/**
 * Q-24 : numérotation des diplômes / attestations à FORMAT LIBRE par établissement (Postgres réel).
 *
 * Invariants : unicité par contrainte quel que soit le motif ; séquence continue pour un motif sans année ; « sans trou »
 * activé par défaut (valeurs historiques inchangées) et OPTIONNEL : un saut du compteur n'est possible que s'il est
 * désactivé, jamais un recul ; une référence émise ne change pas quand le motif change ; isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { awardDiploma, type AwardOutcome } from "../../application/awards";
import { createDiploma } from "../../application/diplomas";
import { issueAwardDocument, issueSuccessAttestation } from "../../application/documents";
import { capitalizePeriod } from "../../application/ledger";
import { advanceNumbering, getNumbering, updateNumbering } from "../../application/numbering";
import { adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { assignAllSlots, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestStudent, type TestWorld } from "../support/world";

describeIntegration("numérotation libre des diplômes et attestations (Postgres réel)", () => {
  let db: HigherTestDb;
  beforeAll(async () => {
    db = await createHigherTestDb(12);
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 3) => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students });
    await assignAllSlots(w, s);
    return { w, s };
  };
  const diplomaFor = async (w: TestWorld, s: School, code: string) =>
    unwrap(await createDiploma(w.deps, s.admin.ctx, { code, label: `Licence ${code}`, gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
  const prepare = async (w: TestWorld, s: School, st: TestStudent) => {
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validatedAt: new Date("2026-09-15T10:00:00Z") })]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    w.ports.cycleResults.set(st.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "14.0", credits: 6 }] });
  };
  const award = async (w: TestWorld, s: School, st: TestStudent, definitionId: string): Promise<Extract<AwardOutcome, { status: "AWARDED" }>> => {
    const r = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId, studentId: st.studentId, via: "MANUAL" }));
    if (r.status !== "AWARDED") throw new Error("octroi attendu");
    return r;
  };
  const view = async (w: TestWorld, s: School, key: string) => unwrap(await getNumbering(w.deps, s.admin.ctx)).find((n) => n.counterKey === key)!;

  it("sans réglage : motifs historiques, garantie « sans trou » active, prochaine référence annoncée", async () => {
    const { w, s } = await fresh(1);
    const all = unwrap(await getNumbering(w.deps, s.admin.ctx));
    expect(all.map((n) => [n.counterKey, n.pattern, n.gapless, n.isDefault, n.continuous, n.nextReference])).toEqual([
      ["DIPLOMA", "DIP-{YYYY}-{SEQ:6}", true, true, false, "DIP-2026-000001"],
      ["AUTHENTICITY", "AUTH/{YYYY}/{SEQ:3}", true, true, false, "AUTH/2026/001"],
      ["ATTESTATION", "ATT-{YYYY}-{SEQ:6}", true, true, false, "ATT-2026-000001"],
    ]);
  });

  it("motif personnalisé : préfixe + année sur 2 chiffres + séquence ; le compteur repart avec l'année ; l'ancien format n'est plus produit", async () => {
    const { w, s } = await fresh(3);
    const def = await diplomaFor(w, s, "N-CUSTOM");
    for (const st of s.students) await prepare(w, s, st);
    const updated = unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "UNI/{YY}-D{SEQ:4}", gapless: true }));
    expect(updated).toMatchObject({ pattern: "UNI/{YY}-D{SEQ:4}", isDefault: false, nextReference: "UNI/26-D0001" });
    const a1 = await award(w, s, s.students[0]!, def.definition.id);
    const a2 = await award(w, s, s.students[1]!, def.definition.id);
    expect([a1.award.reference, a2.award.reference]).toEqual(["UNI/26-D0001", "UNI/26-D0002"]);
    expect(a1.award).toMatchObject({ referenceYear: 2026, referenceSeq: 1 });
    w.clock.set("2027-01-04T09:00:00.000Z");
    const a3 = await award(w, s, s.students[2]!, def.definition.id);
    expect(a3.award).toMatchObject({ reference: "UNI/27-D0001", referenceYear: 2027, referenceSeq: 1 });
    // Duplicata : même numéro, suffixe /Dn, toujours unique.
    const dip1 = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a1.award.id, kind: "DIPLOMA" }));
    expect(dip1.document.reference).toBe("UNI/26-D0001");
    const dup = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a1.award.id, kind: "DIPLOMA", duplicate: true }));
    expect(dup.document.reference).toBe("UNI/26-D0001/D1");
    // Audit sensible du changement de motif.
    const audited = w.audit.entries.find((e) => e.entry.action === "higher.numbering.updated")!.entry;
    expect(audited).toMatchObject({ sensitive: true, resourceId: "DIPLOMA", before: { pattern: "DIP-{YYYY}-{SEQ:6}", isDefault: true }, after: { pattern: "UNI/{YY}-D{SEQ:4}" } });
  });

  it("motif SANS année : séquence continue, elle ne repart pas à 1 au changement d'année (sinon doublon)", async () => {
    const { w, s } = await fresh(3);
    const def = await diplomaFor(w, s, "N-CONT");
    for (const st of s.students) await prepare(w, s, st);
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "DIPL{SEQ:5}", gapless: true }));
    expect((await view(w, s, "DIPLOMA")).continuous).toBe(true);
    const a1 = await award(w, s, s.students[0]!, def.definition.id);
    w.clock.set("2027-02-01T08:00:00.000Z");
    const a2 = await award(w, s, s.students[1]!, def.definition.id);
    w.clock.set("2028-02-01T08:00:00.000Z");
    const a3 = await award(w, s, s.students[2]!, def.definition.id);
    expect([a1.award.reference, a2.award.reference, a3.award.reference]).toEqual(["DIPL00001", "DIPL00002", "DIPL00003"]);
    expect([a1.award.referenceYear, a2.award.referenceYear, a3.award.referenceYear]).toEqual([0, 0, 0]);
    const counters = await adminRows(db, "SELECT year, last_value::int AS last_value FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [s.tenantId]);
    expect(counters).toEqual([{ year: 0, last_value: 3 }]);
  });

  it("changer de motif ne modifie JAMAIS une référence déjà émise ; les trois natures se numérotent indépendamment", async () => {
    const { w, s } = await fresh(2);
    const def = await diplomaFor(w, s, "N-KEEP");
    for (const st of s.students) await prepare(w, s, st);
    const a1 = await award(w, s, s.students[0]!, def.definition.id);
    expect(a1.award.reference).toBe("DIP-2026-000001");
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "LMD-{YYYY}-{SEQ:3}", gapless: true }));
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "AUTHENTICITY", { pattern: "AUT#{SEQ:4}", gapless: true }));
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "ATTESTATION", { pattern: "CERT.{YYYY}.{SEQ:4}", gapless: true }));
    const a2 = await award(w, s, s.students[1]!, def.definition.id);
    expect(a2.award.reference).toBe("LMD-2026-002"); // la séquence continue : la suite du compteur annuel, nouveau format
    const auth = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a1.award.id, kind: "ATTESTATION_AUTHENTICITY" }));
    expect(auth.document.reference).toBe("AUT#0001");
    expect((await adminRows<{ reference: string }>(db, "SELECT reference FROM higher.diploma_awards WHERE id = $1", [a1.award.id]))[0]!.reference).toBe("DIP-2026-000001");
  });

  it("attestation de réussite : son propre motif, deux attestations consécutives", async () => {
    const { w, s } = await fresh(2);
    const [a, b] = s.students;
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
      ...s.ues.map((ue) => ueLine(s, a!, ue, { validatedAt: new Date("2026-08-20T10:00:00Z") })),
      ...s.ues.map((ue) => ueLine(s, b!, ue, { validatedAt: new Date("2026-08-21T10:00:00Z") })),
    ]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    for (const st of [a!, b!]) w.ports.cycleResults.set(st.studentId, s.programNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "12.5", credits: 18 }] });
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "ATTESTATION", { pattern: "CERT.{YYYY}.{SEQ:4}", gapless: true }));
    w.clock.set("2026-12-02T09:00:00.000Z");
    const first = unwrap(await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: a!.studentId, programNodeId: s.programNodeId }));
    const second = unwrap(await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: b!.studentId, programNodeId: s.programNodeId }));
    expect([first.document.reference, second.document.reference]).toEqual(["CERT.2026.0001", "CERT.2026.0002"]);
    expect(first.document).toMatchObject({ referenceYear: 2026, referenceSeq: 1 });
  });

  it("motifs invalides et collisions entre natures refusés (aucune écriture)", async () => {
    const { w, s } = await fresh(1);
    const bad = await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "SANS-SEQUENCE-{YYYY}", gapless: true });
    expect(!bad.ok && bad.error.code).toBe("higher.invalid_input");
    const dup = await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "ATT-{YYYY}-{SEQ:6}", gapless: true });
    expect(!dup.ok && dup.error).toMatchObject({ code: "higher.invalid_input" });
    expect(await adminRows(db, "SELECT 1 FROM higher.numbering_settings WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
  });

  it("« sans trou » ACTIVÉ (défaut) : l'avance du compteur est refusée par le module ET par la base", async () => {
    const { w, s } = await fresh(1);
    const refused = await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 500, reason: "Reprise du registre papier" });
    expect(!refused.ok && refused.error.code).toBe("higher.numbering_gapless");
    // Contournement direct en SQL (superutilisateur : seul le déclencheur juge).
    await db.admin.query("INSERT INTO higher.number_counters (tenant_id, counter_key, year, last_value) VALUES ($1,'DIPLOMA',2026,1)", [s.tenantId]);
    await expect(db.admin.query("UPDATE higher.number_counters SET last_value = 50 WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [s.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.counter_monotonic") });
    await expect(db.admin.query("INSERT INTO higher.number_counters (tenant_id, counter_key, year, last_value) VALUES ($1,'DIPLOMA',2025,40)", [s.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.counter_monotonic") });
  });

  it("« sans trou » DÉSACTIVÉ : saut volontaire motivé et audité ; jamais de recul ; le trou est voulu, l'unicité reste garantie", async () => {
    const { w, s } = await fresh(3);
    const def = await diplomaFor(w, s, "N-JUMP");
    for (const st of s.students) await prepare(w, s, st);
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "DIP-{YYYY}-{SEQ:6}", gapless: false }));
    const a1 = await award(w, s, s.students[0]!, def.definition.id);
    expect(a1.award.reference).toBe("DIP-2026-000001");

    const short = await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 1500, reason: "court" });
    expect(!short.ok && short.error.code).toBe("higher.invalid_input");
    const back = await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 2, reason: "Retour en arrière interdit" });
    expect(!back.ok && back.error).toMatchObject({ code: "higher.invalid_input" });
    const jumped = unwrap(await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 1500, reason: "Reprise du registre papier à la page 1500" }));
    expect(jumped).toMatchObject({ gapless: false, nextNumber: 1500, nextReference: "DIP-2026-001500" });
    const advancedAudit = w.audit.entries.find((e) => e.entry.action === "higher.numbering.advanced")!.entry;
    expect(advancedAudit).toMatchObject({ sensitive: true, reason: "Reprise du registre papier à la page 1500", before: { nextNumber: 2 }, after: { nextNumber: 1500 } });

    const a2 = await award(w, s, s.students[1]!, def.definition.id);
    expect(a2.award.reference).toBe("DIP-2026-001500");
    // Le recul direct en SQL reste interdit même sans garantie « sans trou ».
    await expect(db.admin.query("UPDATE higher.number_counters SET last_value = 3 WHERE tenant_id = $1 AND counter_key = 'DIPLOMA'", [s.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.counter_monotonic") });
    // Réactiver la garantie : plus aucun saut possible, la numérotation continue à partir de là.
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "DIP-{YYYY}-{SEQ:6}", gapless: true }));
    const again = await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 9000, reason: "Tentative après réactivation" });
    expect(!again.ok && again.error.code).toBe("higher.numbering_gapless");
    const a3 = await award(w, s, s.students[2]!, def.definition.id);
    expect(a3.award.reference).toBe("DIP-2026-001501");
  });

  it("unicité garantie par contrainte : une référence en double est rejetée par la base, quel que soit le motif", async () => {
    const { w, s } = await fresh(2);
    const def = await diplomaFor(w, s, "N-UNIQ");
    for (const st of s.students) await prepare(w, s, st);
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "X{SEQ}", gapless: true }));
    const a1 = await award(w, s, s.students[0]!, def.definition.id);
    await expect(
      db.admin.query("UPDATE higher.diploma_awards SET reference = 'Y' WHERE id = $1", [a1.award.id]),
    ).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    await expect(
      db.admin.query(
        `INSERT INTO higher.diploma_awards (id, tenant_id, definition_id, student_id, reference, reference_year, reference_seq, awarded_via, credits_total, requirements_snapshot, eligibility, rule_set_code, rule_version_id, rule_version_no, definition_hash, awarded_at, awarded_by_name, acquired_date, awarded_by)
         SELECT gen_random_uuid(), tenant_id, definition_id, gen_random_uuid(), reference, 0, 99, 'MANUAL', 6, '{}', '{}', 'X', gen_random_uuid(), 1, 'h', now(), 'T', current_date, gen_random_uuid() FROM higher.diploma_awards WHERE id = $1`,
        [a1.award.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("octrois CONCURRENTS avec un motif personnalisé : références distinctes et continues", async () => {
    const N = 6;
    const { w, s } = await fresh(N);
    const def = await diplomaFor(w, s, "N-CONC");
    for (const st of s.students) await prepare(w, s, st);
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "C-{SEQ:3}", gapless: true }));
    const results = await Promise.all(s.students.map((st) => awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL" })));
    const refs = results.map((r) => { const v = unwrap(r); return v.status === "AWARDED" ? v.award.reference : "?"; }).sort();
    expect(refs).toEqual(Array.from({ length: N }, (_, i) => `C-${String(i + 1).padStart(3, "0")}`));
  });

  it("isolation A/B : le motif et le compteur d'un établissement sont invisibles et inopérants pour l'autre", async () => {
    const { w, s } = await fresh(1);
    const tenantB = await db.createTenant();
    const b = ctxFor(tenantB);
    unwrap(await updateNumbering(w.deps, s.admin.ctx, "DIPLOMA", { pattern: "ISO-A-{SEQ:4}", gapless: false }));
    unwrap(await advanceNumbering(w.deps, s.admin.ctx, "DIPLOMA", { nextNumber: 100, reason: "Réservation de numéros pour A" }));
    const seenByB = unwrap(await getNumbering(w.deps, b));
    expect(seenByB.every((n) => n.isDefault && n.gapless && n.nextNumber === 1)).toBe(true);
    const direct = await db.tenantDb.run(b, (tx) => tx.many("SELECT * FROM higher.numbering_settings"));
    expect(direct).toEqual([]);
    // B modifie son propre motif sans effet sur A.
    unwrap(await updateNumbering(w.deps, b, "DIPLOMA", { pattern: "ISO-B-{SEQ:2}", gapless: true }));
    expect((await view(w, s, "DIPLOMA")).pattern).toBe("ISO-A-{SEQ:4}");
    // B ne peut pas avancer le compteur de A (sa propre garantie « sans trou » s'applique).
    const hit = await advanceNumbering(w.deps, b, "DIPLOMA", { nextNumber: 100, reason: "Tentative inter-établissement" });
    expect(!hit.ok && hit.error.code).toBe("higher.numbering_gapless");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { awardDiploma, revokeAward, type AwardOutcome } from "../../application/awards";
import { createDiploma } from "../../application/diplomas";
import {
  assignSlot,
  getAttestationRoster,
  getDocument,
  issueAwardDocument,
  issueSuccessAttestation,
  listSlots,
  listStudentDocuments,
  publishDocument,
  recordDocumentRender,
  recordDocumentSeal,
  revokeDocument,
} from "../../application/documents";
import { capitalizePeriod } from "../../application/ledger";
import { snapshotHash } from "../../domain/snapshot";
import { adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { assignAllSlots, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestStudent, type TestWorld } from "../support/world";

describeIntegration("documents officiels et signataires datés (Postgres réel)", () => {
  let db: HigherTestDb;

  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 3) => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students });
    return { w, s };
  };
  const diplomaFor = async (w: TestWorld, s: School, code: string) =>
    unwrap(await createDiploma(w.deps, s.admin.ctx, { code, label: `Licence ${code}`, gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 12, requirements: [{ ueNodeId: s.ues[0]!.nodeId }, { ueNodeId: s.ues[1]!.nodeId }] }));
  const award = async (w: TestWorld, s: School, st: TestStudent, definitionId: string, ueIdx = [0, 1]): Promise<Extract<AwardOutcome, { status: "AWARDED" }>> => {
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, ueIdx.map((i) => ueLine(s, st, s.ues[i]!, { validatedAt: new Date("2026-09-15T10:00:00Z") })));
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    w.ports.cycleResults.set(st.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "14.0", credits: 12 }] });
    const r = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId, studentId: st.studentId, via: "MANUAL" }));
    if (r.status !== "AWARDED") throw new Error("octroi attendu");
    return r;
  };

  it("AC7.4/R-HIG-08 : sans signataire en vigueur l'émission est REFUSÉE, sans consommer de numéro ni laisser de trace", async () => {
    const { w, s } = await fresh(1);
    const def = await diplomaFor(w, s, "D-NOSIG");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    const refused = await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "ATTESTATION_AUTHENTICITY" });
    expect(!refused.ok && refused.error.code).toBe("higher.signatory_missing");
    expect(!refused.ok && (refused.error as { details?: unknown }).details).toMatchObject({ slot: "AUTHENTICITY" });
    const refusedDiploma = await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" });
    expect(!refusedDiploma.ok && refusedDiploma.error.code).toBe("higher.signatory_missing");
    expect(await adminRows(db, "SELECT 1 FROM higher.official_documents WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
    expect(await adminRows(db, "SELECT 1 FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'AUTHENTICITY'", [s.tenantId])).toHaveLength(0);

    // Un emplacement n'est pas encore en vigueur à la date d'émission : refus aussi.
    unwrap(await assignSlot(w.deps, s.admin.ctx, { slotKey: "AUTHENTICITY", signatoryId: s.signatories.authenticity, validFrom: "2026-12-01" }));
    const future = await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "ATTESTATION_AUTHENTICITY" });
    expect(!future.ok && future.error.code).toBe("higher.signatory_missing");
  });

  it("AC7.1/AC7.6 : diplôme = snapshot immuable + empreinte + code de vérification ; l'émission est idempotente", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s);
    const def = await diplomaFor(w, s, "D-SNAP");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    w.clock.set("2026-11-20T09:00:00.000Z"); // émis bien après la dernière acquisition
    const issued = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" }));
    expect(issued.created).toBe(true);
    const d = issued.document;
    expect(d).toMatchObject({ documentKind: "DIPLOMA", reference: a.award.reference, version: 1, status: "ISSUED", snapshotSchema: "diploma/1", issuedByName: "Directrice des études", renderStatus: "PENDING", signature: null });
    expect(d.snapshotHash).toBe(snapshotHash(d.snapshot));
    expect(d.verificationCode).toMatch(/^VERIFCODE/);
    expect(d.snapshot).toMatchObject({
      v: 1,
      schema: "diploma/1",
      institution: { name: "Établissement de test" },
      student: { fullName: "Étudiant 01", matricule: "MAT-0001", birthDate: "2003-04-12", birthPlace: "Abidjan" },
      diploma: { code: "D-SNAP", gradeCode: "LICENCE" },
      creditsTotal: 12,
      mention: { code: "GOOD", average: "14.000" },
      acquiredDate: "2026-09-15", // date de la dernière acquisition, JAMAIS la date d'émission
      issueDate: "2026-11-20",
      academicYear: { label: "2026-2027" },
      signatories: { DIPLOMA_LEFT: { fullName: "Signataire Gauche", function: "Le Directeur général" }, DIPLOMA_RIGHT: { fullName: "Signataire Droite" } },
    });
    expect((d.snapshot as { ues: unknown[] }).ues).toHaveLength(2);

    const again = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" }));
    expect(again).toMatchObject({ created: false, document: { id: d.id, snapshotHash: d.snapshotHash } });
    expect(w.audit.entries.filter((e) => e.entry.action === "higher.document.issued")).toHaveLength(1);
    expect(w.audit.entries.find((e) => e.entry.action === "higher.document.issued")?.entry.after).toMatchObject({ snapshotHash: d.snapshotHash });
  });

  it("R-HIG-12 : un document émis est immuable (base) ; le scellement n'est écrit qu'une fois", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s);
    const def = await diplomaFor(w, s, "D-IMM");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    const d = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" })).document;
    const q = (sql: string, p: unknown[] = []) => db.admin.query(sql, p);
    await expect(q("UPDATE higher.official_documents SET snapshot = '{}'::jsonb WHERE id = $1", [d.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    await expect(q("UPDATE higher.official_documents SET snapshot_hash = $2 WHERE id = $1", [d.id, "0".repeat(64)])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    await expect(q("UPDATE higher.official_documents SET reference = 'DIP-2026-999999' WHERE id = $1", [d.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
    await expect(q("DELETE FROM higher.official_documents WHERE id = $1", [d.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });

    const sealed = unwrap(await recordDocumentSeal(w.deps, s.admin.ctx, { documentId: d.id, signingKeyId: "k1", signature: "sig-base64", templateKey: "diploma", templateVersion: 1, configVersion: 1 }));
    expect(sealed.signature).toBe("sig-base64");
    const twice = await recordDocumentSeal(w.deps, s.admin.ctx, { documentId: d.id, signingKeyId: "k2", signature: "autre", templateKey: "diploma" });
    expect(twice.ok).toBe(false);
    const rendered = unwrap(await recordDocumentRender(w.deps, s.admin.ctx, { documentId: d.id, status: "RENDERED", objectKey: "tenant/diplomas/x.pdf", pdfHash: "a".repeat(64) }));
    expect(rendered).toMatchObject({ renderStatus: "RENDERED", objectKey: "tenant/diplomas/x.pdf" });
    await expect(q("UPDATE higher.official_documents SET signature = 'forgee' WHERE id = $1", [d.id])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
  });

  it("AC7.3 : AUTH/AAAA/NNN attribué UNE fois par octroi (idempotent), séquentiel sans trou, compteur par année de génération", async () => {
    const { w, s } = await fresh(3);
    await assignAllSlots(w, s);
    const def = await diplomaFor(w, s, "D-AUTH");
    const [s1, s2, s3] = s.students;
    const a1 = await award(w, s, s1!, def.definition.id);
    const a2 = await award(w, s, s2!, def.definition.id);
    const a3 = await award(w, s, s3!, def.definition.id);

    const r1 = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a1.award.id, kind: "ATTESTATION_AUTHENTICITY" }));
    expect(r1.document.reference).toBe("AUTH/2026/001");
    expect(r1.document.snapshot).toMatchObject({ schema: "attestation-authenticity/1", diploma: { awardReference: a1.award.reference }, signatories: { AUTHENTICITY: { fullName: "Signataire Authenticité" } } });
    const regenerated = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a1.award.id, kind: "ATTESTATION_AUTHENTICITY" }));
    expect(regenerated).toMatchObject({ created: false, document: { id: r1.document.id, reference: "AUTH/2026/001" } });
    expect(unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a2.award.id, kind: "ATTESTATION_AUTHENTICITY" })).document.reference).toBe("AUTH/2026/002");
    w.clock.set("2027-02-01T08:00:00.000Z");
    expect(unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a3.award.id, kind: "ATTESTATION_AUTHENTICITY" })).document.reference).toBe("AUTH/2027/001");
    const counters = await adminRows(db, "SELECT year, last_value::int AS last_value FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'AUTHENTICITY' ORDER BY year", [s.tenantId]);
    expect(counters).toEqual([{ year: 2026, last_value: 2 }, { year: 2027, last_value: 1 }]);
  });

  it("AC7.4 : le signataire imprimé est celui en vigueur à l'ÉMISSION ; l'ancien document garde le sien ; duplicata lié à l'original", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s, "2026-01-01");
    const def = await diplomaFor(w, s, "D-DATE");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    const original = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" })).document;
    expect(original.snapshot).toMatchObject({ signatories: { DIPLOMA_LEFT: { fullName: "Signataire Gauche" } } });

    // Changement de directeur général au 1er décembre : l'affectation en cours est close la veille.
    const newLeft = newId();
    w.ports.signatories.add({ signatoryId: newLeft, fullName: "Nouveau Directeur", title: "Dr", function: "Le Directeur général", active: true });
    const slot = unwrap(await assignSlot(w.deps, s.admin.ctx, { slotKey: "DIPLOMA_LEFT", signatoryId: newLeft, validFrom: "2026-12-01" }));
    expect(slot.validFrom).toBe("2026-12-01");
    const slots = unwrap(await listSlots(w.deps, s.admin.ctx)).filter((x) => x.slotKey === "DIPLOMA_LEFT");
    expect(slots.map((x) => [x.validFrom, x.validTo])).toEqual([["2026-01-01", "2026-11-30"], ["2026-12-01", null]]);

    // Avant le 1er décembre : l'ancien en vigueur ; duplicata un jour postérieur : le nouveau signataire, lien conservé.
    w.clock.set("2026-12-15T09:00:00.000Z");
    const dup = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA", duplicate: true }));
    expect(dup.created).toBe(true);
    expect(dup.document).toMatchObject({ version: 2, supersedesId: original.id, reference: `${a.award.reference}/D1` });
    expect(dup.document.snapshot).toMatchObject({ duplicateOf: a.award.reference, signatories: { DIPLOMA_LEFT: { fullName: "Nouveau Directeur" } }, issueDate: "2026-12-15" });
    const old = unwrap(await getDocument(w.deps, s.admin.ctx, original.id));
    expect(old.status).toBe("SUPERSEDED");
    expect(old.snapshot).toMatchObject({ signatories: { DIPLOMA_LEFT: { fullName: "Signataire Gauche" } } }); // l'original ne change jamais
    // Rejouer le duplicata n'en crée pas un troisième sans demande explicite.
    const plain = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" }));
    expect(plain).toMatchObject({ created: false, document: { id: dup.document.id } });
  });

  it("emplacements : recouvrement refusé, signataire désactivé non affectable, et refusé à l'émission s'il l'est devenu", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s, "2026-06-01");
    const earlier = await assignSlot(w.deps, s.admin.ctx, { slotKey: "DIPLOMA_RIGHT", signatoryId: s.signatories.right, validFrom: "2026-03-01" });
    expect(!earlier.ok && earlier.error.code).toBe("higher.slot_overlap");
    const ghost = await assignSlot(w.deps, s.admin.ctx, { slotKey: "DIPLOMA_RIGHT", signatoryId: newId(), validFrom: "2027-01-01" });
    expect(!ghost.ok && ghost.error.code).toBe("higher.signatory_unknown");
    const retired = newId();
    w.ports.signatories.add({ signatoryId: retired, fullName: "Ancien", title: null, function: null, active: false });
    const inactive = await assignSlot(w.deps, s.admin.ctx, { slotKey: "DIPLOMA_RIGHT", signatoryId: retired, validFrom: "2027-01-01" });
    expect(!inactive.ok && inactive.error.code).toBe("higher.signatory_inactive");

    const def = await diplomaFor(w, s, "D-INACT");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    w.ports.signatories.deactivate(s.signatories.right);
    const blocked = await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" });
    expect(!blocked.ok && blocked.error.code).toBe("higher.signatory_inactive");
    expect(await adminRows(db, "SELECT 1 FROM higher.official_documents WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
    // L'historique des affectations ne se supprime pas.
    await expect(db.admin.query("DELETE FROM higher.official_document_slots WHERE tenant_id = $1", [s.tenantId])).rejects.toMatchObject({ message: expect.stringContaining("higher.immutable") });
  });

  it("révocation d'un octroi : documents passés « révoqués » dans la même transaction ; plus d'émission", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s);
    const def = await diplomaFor(w, s, "D-REVDOC");
    const a = await award(w, s, s.students[0]!, def.definition.id);
    const dip = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" })).document;
    const auth = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "ATTESTATION_AUTHENTICITY" })).document;
    unwrap(await revokeAward(w.deps, s.admin.ctx, { awardId: a.award.id, reason: "Erreur matérielle grave" }));
    for (const id of [dip.id, auth.id]) {
      const d = unwrap(await getDocument(w.deps, s.admin.ctx, id));
      expect(d).toMatchObject({ status: "REVOKED", revokeReason: "Erreur matérielle grave" });
      expect(d.revokedAt).not.toBeNull();
    }
    const after = await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA", duplicate: true });
    expect(!after.ok && after.error.code).toBe("higher.award_revoked");
    const again = await revokeDocument(w.deps, s.admin.ctx, { documentId: dip.id, reason: "Déjà révoqué, deuxième tentative" });
    expect(!again.ok && again.error.code).toBe("higher.document_revoked");
  });

  it("AC7.5 : l'étudiant ne voit que ses documents PUBLIÉS", async () => {
    const { w, s } = await fresh(1);
    await assignAllSlots(w, s);
    const def = await diplomaFor(w, s, "D-PUB");
    const st = s.students[0]!;
    const a = await award(w, s, st, def.definition.id);
    const dip = unwrap(await issueAwardDocument(w.deps, s.admin.ctx, { awardId: a.award.id, kind: "DIPLOMA" })).document;
    expect(unwrap(await listStudentDocuments(w.deps, s.admin.ctx, st.studentId, true))).toHaveLength(0);
    expect(unwrap(await listStudentDocuments(w.deps, s.admin.ctx, st.studentId, false))).toHaveLength(1);
    unwrap(await publishDocument(w.deps, s.admin.ctx, dip.id));
    expect(unwrap(await listStudentDocuments(w.deps, s.admin.ctx, st.studentId, true)).map((d) => d.id)).toEqual([dip.id]);
  });

  it("AC7.2 : attestation de réussite — programme complet requis ; date = dernière acquisition ; idempotente ; mention figée", async () => {
    const { w, s } = await fresh(2);
    await assignAllSlots(w, s);
    const [a, b] = s.students;
    // A a acquis les 3 UE (dernière validation le 2026-08-20), B seulement 2.
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [
      ueLine(s, a!, s.ues[0]!, { validatedAt: new Date("2026-06-10T10:00:00Z") }),
      ueLine(s, a!, s.ues[1]!, { validatedAt: new Date("2026-07-01T10:00:00Z") }),
      ueLine(s, a!, s.ues[2]!, { validatedAt: new Date("2026-08-20T10:00:00Z") }),
      ueLine(s, b!, s.ues[0]!),
      ueLine(s, b!, s.ues[1]!),
    ]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    const roster = unwrap(await getAttestationRoster(w.deps, s.admin.ctx, { programNodeId: s.programNodeId }));
    expect(roster.map((r) => [r.fullName, r.eligible, r.ueAcquired, r.ueRequired, r.acquiredDate])).toEqual([["Étudiant 01", true, 3, 3, "2026-08-20"], ["Étudiant 02", false, 2, 3, null]]);

    const refused = await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: b!.studentId, programNodeId: s.programNodeId });
    expect(!refused.ok && refused.error.code).toBe("higher.attestation_not_eligible");
    expect(await adminRows(db, "SELECT 1 FROM higher.number_counters WHERE tenant_id = $1 AND counter_key = 'ATTESTATION'", [s.tenantId])).toHaveLength(0);

    w.ports.cycleResults.set(a!.studentId, s.programNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "12.5", credits: 18 }] });
    w.clock.set("2026-12-02T09:00:00.000Z");
    const issued = unwrap(await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: a!.studentId, programNodeId: s.programNodeId }));
    expect(issued.created).toBe(true);
    expect(issued.document).toMatchObject({ documentKind: "ATTESTATION_SUCCESS", reference: "ATT-2026-000001", snapshotSchema: "attestation-success/1", programNodeId: s.programNodeId });
    expect(issued.document.snapshot).toMatchObject({
      acquiredDate: "2026-08-20", // jamais « aujourd'hui » (2026-12-02) ni le début d'une session
      issueDate: "2026-12-02",
      creditsTotal: 18,
      mention: { code: "GOOD", average: "12.500" },
      academicYear: { label: "2026-2027" },
      program: { code: "GL" },
      signatories: { ATTESTATION_SUCCESS: { fullName: "Signataire Attestation" } },
    });
    expect((issued.document.snapshot as { ues: unknown[] }).ues).toHaveLength(3);
    const again = unwrap(await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: a!.studentId, programNodeId: s.programNodeId }));
    expect(again).toMatchObject({ created: false, document: { id: issued.document.id } });
    const rosterAfter = unwrap(await getAttestationRoster(w.deps, s.admin.ctx, { programNodeId: s.programNodeId }));
    expect(rosterAfter[0]).toMatchObject({ documentId: issued.document.id, reference: "ATT-2026-000001" });

    // Révocation d'une attestation (sans octroi), motif obligatoire.
    expect((await revokeDocument(w.deps, s.admin.ctx, { documentId: issued.document.id, reason: "court" })).ok).toBe(false);
    expect(unwrap(await revokeDocument(w.deps, s.admin.ctx, { documentId: issued.document.id, reason: "Erreur d'identité de l'étudiant" })).status).toBe("REVOKED");
  });

  it("attestation : programme sans UE configurée -> refusée (aucune hypothèse de nombre de semestres)", async () => {
    const { w, s } = await fresh(1);
    const emptyProgram = newId();
    w.ports.curriculum.addProgram(emptyProgram, "VIDE");
    const r = await issueSuccessAttestation(w.deps, s.admin.ctx, { studentId: s.students[0]!.studentId, programNodeId: emptyProgram });
    expect(!r.ok && r.error.code).toBe("higher.attestation_no_ue_configured");
  });
});

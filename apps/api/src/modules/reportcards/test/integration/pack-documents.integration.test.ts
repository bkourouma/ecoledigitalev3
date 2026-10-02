/**
 * Documents des packs (PV de conseil, bilan annuel, documents d'examen) par le service générique des documents officiels :
 * scellement avec la PROVENANCE des règles, rendu avec filigrane et mention « règles de démonstration » quand les résultats
 * viennent d'un jeu fictif, vérification publique qui le dit (sans donnée personnelle), isolation. Rendu factice (aucun Chromium).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { reportcardsPublicVerificationDtoSchema } from "@ecoledigitale/contracts/src/v2/reportcards";
import { renderOfficialDocument, requestOfficialDocument } from "../../application/official-documents";
import { verifyByCode, verifyByFile, DEMONSTRATION_VERIFICATION_NOTE } from "../../application/verify";
import { DEMONSTRATION_NOTICE, DEMONSTRATION_WATERMARK, type PackDocumentKind } from "../../domain/constants";
import { verificationDto } from "../../http/presenters";
import { adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

const input = (kind: PackDocumentKind, sourceId: string, ruleSourceKind?: "placeholder" | "regulation" | "platform") => ({
  kind,
  sourceId,
  title: `Document ${kind} fictif`,
  issuedAt: new Date("2027-06-30T10:00:00.000Z"),
  content: { sourceId, kind },
  context:
    kind === "COUNCIL_MINUTES"
      ? { council: { kindLabel: "Conseil des maîtres", heldOn: "2027-06-28" }, decisions: [{ number: "1", studentName: "ÉLÈVE Fictif", decisionLabel: "Passage (fictif)", justification: "" }] }
      : kind === "EXAM_CONVOCATION"
        ? { text: { convoked: "Vous êtes convoqué(e)." }, candidate: { fullName: "CANDIDAT Fictif", birthLine: "", number: "000123" }, exam: { label: "Examen fictif", sessionLabel: "Session 2027" }, reference: "CONV-1" }
        : { student: { fullName: "ÉLÈVE Fictif" }, enrollment: { classroomLabel: "CE1 A", academicYearLabel: "2026-2027" }, result: { averageDisplay: "12.00" } },
  ...(ruleSourceKind ? { ruleSourceKind } : {}),
});

describeIntegration("documents des packs : scellement, rendu, vérification (Postgres réel)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 1 });
  });
  afterAll(async () => {
    await db.drop();
  });
  const ctx = () => school.admin.ctx;

  it("scelle chaque nature de pack avec son gabarit par défaut, un code opaque et une entrée de l'index public", async () => {
    for (const kind of ["COUNCIL_MINUTES", "ANNUAL_REVIEW", "EXAM_CONVOCATION", "EXAM_SUCCESS_CERTIFICATE", "EXAM_TRANSCRIPT"] as const) {
      const r = unwrap(await requestOfficialDocument(world.deps, ctx(), input(kind, newId())));
      expect(r.created).toBe(true);
      expect(r.record).toMatchObject({ documentKind: kind, renderStatus: "PENDING" });
      expect(r.record.verificationCode).toMatch(/^[A-Z2-7]{26}$/);
      const idx = await adminRows<{ document_kind: string }>(db, "SELECT document_kind FROM reportcards.verification_index WHERE code = $1", [r.record.verificationCode]);
      expect(idx[0]?.document_kind).toBe(kind);
    }
  });

  it("un document dont les résultats viennent d'un jeu de démonstration est marqué À LA SOURCE : provenance scellée, filigrane et mention au rendu", async () => {
    const sealed = unwrap(await requestOfficialDocument(world.deps, ctx(), input("COUNCIL_MINUTES", newId(), "placeholder")));
    const snap = await adminRows<{ snapshot: { ruleSourceKind?: string } }>(db, "SELECT snapshot FROM reportcards.official_documents WHERE id = $1", [sealed.record.id]);
    expect(snap[0]?.snapshot.ruleSourceKind).toBe("placeholder");
    world.renderer.renders.length = 0;
    unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: sealed.record.id }));
    const html = world.renderer.renders[0]!.html;
    expect(html).toContain(DEMONSTRATION_NOTICE);
    expect(html).toContain(`<div class="watermark">${DEMONSTRATION_WATERMARK}</div>`);
    expect(html).toContain("Conseil des maîtres");
  });

  it("un document ordinaire (sans provenance) ou calculé par un jeu non fictif n'est jamais marqué", async () => {
    for (const source of [undefined, "regulation", "platform"] as const) {
      const sealed = unwrap(await requestOfficialDocument(world.deps, ctx(), input("EXAM_CONVOCATION", newId(), source)));
      world.renderer.renders.length = 0;
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: sealed.record.id }));
      const html = world.renderer.renders[0]!.html;
      expect(html, String(source)).not.toContain(DEMONSTRATION_NOTICE);
      expect(html, String(source)).not.toContain('class="watermark"');
    }
  });

  it("la provenance fait partie de l'empreinte signée : un document de démonstration n'a pas la même empreinte qu'un document ordinaire", async () => {
    const a = unwrap(await requestOfficialDocument(world.deps, ctx(), input("ANNUAL_REVIEW", newId(), "placeholder")));
    const b = unwrap(await requestOfficialDocument(world.deps, ctx(), input("ANNUAL_REVIEW", newId())));
    expect(a.record.snapshotHash).not.toBe(b.record.snapshotHash);
  });

  describe("vérification publique", () => {
    let demoCode: string;
    let demoBytes: Uint8Array;
    let plainCode: string;

    beforeAll(async () => {
      const demo = unwrap(await requestOfficialDocument(world.deps, ctx(), input("EXAM_TRANSCRIPT", newId(), "placeholder")));
      const plain = unwrap(await requestOfficialDocument(world.deps, ctx(), input("EXAM_TRANSCRIPT", newId())));
      demoCode = demo.record.verificationCode;
      plainCode = plain.record.verificationCode;
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: demo.record.id }));
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: plain.record.id }));
      const stored = await adminRows<{ object_key: string }>(db, "SELECT object_key FROM reportcards.official_documents WHERE id = $1", [demo.record.id]);
      demoBytes = (await world.storage.get(stored[0]!.object_key))!.bytes;
    });

    it("authentique ET marqué « règles de démonstration » ; aucune donnée personnelle ; contrat de réponse respecté", async () => {
      const v = unwrap(await verifyByCode(world.deps, { code: demoCode }));
      expect(v).toMatchObject({ status: "AUTHENTIC", documentKind: "EXAM_TRANSCRIPT", demonstration: true });
      expect(v.message).toContain(DEMONSTRATION_VERIFICATION_NOTE);
      const dto = verificationDto(v);
      expect(reportcardsPublicVerificationDtoSchema.safeParse(dto).success).toBe(true);
      expect(dto.demonstration).toBe(true);
      expect(JSON.stringify(dto)).not.toMatch(/ÉLÈVE|CANDIDAT|Fictif/);
    });

    it("un document ordinaire : même réponse qu'avant (pas de champ `demonstration`, message inchangé)", async () => {
      const v = unwrap(await verifyByCode(world.deps, { code: plainCode }));
      expect(v.status).toBe("AUTHENTIC");
      expect(v.demonstration).toBeUndefined();
      expect(v.message).not.toContain(DEMONSTRATION_VERIFICATION_NOTE);
      expect("demonstration" in verificationDto(v)).toBe(false);
    });

    it("le PDF téléversé est reconnu pour un document de démonstration (même contrôle d'intégrité)", async () => {
      const f = unwrap(await verifyByFile(world.deps, { bytes: demoBytes }));
      expect(f).toMatchObject({ match: true, status: "AUTHENTIC" });
    });
  });
});

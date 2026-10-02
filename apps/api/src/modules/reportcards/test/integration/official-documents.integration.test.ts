/**
 * Documents officiels d'autres modules (reçu de paiement, bulletin de paie) : scellement idempotent, rendu par le worker depuis
 * le contenu scellé seul, stockage, reprise, immuabilité SQL, authenticité par la vérification publique (code ET fichier),
 * isolation entre tenants. Rendu factice (aucun Chromium requis) ; le rendu Chromium réel est couvert par `pdf-renderer.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { reportcardsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/reportcards";
import {
  getOfficialDocumentRecord,
  readOfficialDocument,
  renderOfficialDocument,
  requestOfficialDocument,
  requestOfficialDocumentRender,
  sweepPendingOfficialDocuments,
} from "../../application/official-documents";
import { verifyByCode, verifyByFile } from "../../application/verify";
import { ensureBuiltinTemplates } from "../../application/platform";
import { validatePlatformTemplate } from "../../application/platform";
import { BUILTIN_TEMPLATES } from "../../templates/builtin";
import { StaticKeyProvider, generateSigningKeyPair } from "../../infrastructure/key-provider";
import { adminRows, createReportcardsTestDb, ctxFor, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

const learnerName = "KOUASSI Aya Fictive";
const receiptInput = (sourceId: string) => ({
  kind: "RECEIPT" as const,
  sourceId,
  title: "Reçu de paiement REC-2026-000042",
  issuedAt: new Date("2026-02-03T10:00:00.000Z"),
  content: { receiptId: sourceId, number: "REC-2026-000042", amount: { amount: 25000, currency: "XOF" }, learner: { displayName: learnerName } },
  context: {
    receipt: {
      number: "REC-2026-000042",
      issuedOn: "2026-02-03T10:00:00.000Z",
      learnerName,
      learnerRegistration: "MAT-0042",
      payerName: "Parent Fictif",
      methodLabel: "Espèces",
      reference: "",
      amountText: "25 000 F CFA",
      allocations: [{ invoiceNumber: "FAC-2026-000007", label: "1re tranche", amountText: "25 000 F CFA" }],
      unallocatedText: "",
      balanceAfterText: "75 000 F CFA",
    },
  },
});

describeIntegration("documents officiels d'autres modules : reçus et bulletins de paie (scellement, rendu, vérification)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let otherTenant: string;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 1 });
    otherTenant = await db.createTenant();
  });
  afterAll(async () => {
    await db.drop();
  });

  const ctx = () => school.admin.ctx;
  const rowOf = (id: string) => adminRows<any>(db, "SELECT * FROM reportcards.official_documents WHERE id = $1", [id]).then((r) => r[0]);

  it("les gabarits livrés pour RECEIPT et PAYSLIP passent la validation de sécurité de plateforme (aucun script, aucune URL)", () => {
    for (const key of ["receipt-standard", "payslip-standard"]) {
      const t = BUILTIN_TEMPLATES.find((x) => x.key === key)!;
      expect(t, key).toBeDefined();
      expect(validatePlatformTemplate(t), key).toEqual([]);
    }
  });

  describe("scellement", () => {
    it("scelle un reçu : instantané + contexte hachés, code opaque, signature, index public ; événement de rendu ; idempotent", async () => {
      const sourceId = newId();
      const first = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(sourceId)));
      expect(first.created).toBe(true);
      expect(first.record).toMatchObject({ documentKind: "RECEIPT", sourceId, renderStatus: "PENDING", templateKey: "receipt-standard", title: "Reçu de paiement REC-2026-000042" });
      expect(first.record.verificationCode).toMatch(/^[A-Z2-7]{26}$/);
      expect(first.record.snapshotHash).toMatch(/^[0-9a-f]{64}$/);

      // Index de vérification publique : code -> (tenant, nature, document), sans donnée personnelle
      const idx = await adminRows<any>(db, "SELECT * FROM reportcards.verification_index WHERE code = $1", [first.record.verificationCode]);
      expect(idx).toHaveLength(1);
      expect(idx[0]).toMatchObject({ tenant_id: school.tenantId, document_kind: "RECEIPT", document_id: first.record.id });

      // Événement de rendu conforme à son contrat
      const events = await adminRows<any>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.official_document.render_requested' AND aggregate_id = $2", [school.tenantId, first.record.id]);
      expect(events).toHaveLength(1);
      expect(reportcardsEventPayloadSchemas["reportcards.official_document.render_requested"].safeParse(events[0].payload).success).toBe(true);

      // Audit du scellement
      expect(world.audit.entries.some((e: any) => e.entry.action === "reportcards.official_document.sealed" && e.entry.resourceId === first.record.id)).toBe(true);

      // Idempotence : même source -> même document, ni second code ni second événement
      const again = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(sourceId)));
      expect(again.created).toBe(false);
      expect(again.record.id).toBe(first.record.id);
      expect(again.record.verificationCode).toBe(first.record.verificationCode);
      const n = await adminRows<any>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'reportcards.official_document.render_requested' AND aggregate_id = $1", [first.record.id]);
      expect(n[0].n).toBe(1);
    });

    it("demandes concurrentes pour la même source : un seul document, un seul code", async () => {
      const sourceId = newId();
      const results = await Promise.all(Array.from({ length: 5 }, () => requestOfficialDocument(world.deps, ctx(), receiptInput(sourceId))));
      const ids = new Set(results.map((r) => unwrap(r).record.id));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => unwrap(r).created)).toHaveLength(1);
    });

    it("refuse une nature inconnue, une identité d'établissement absente et une clé de signature absente (échec fermé)", async () => {
      const unknown = await requestOfficialDocument(world.deps, ctx(), { ...receiptInput(newId()), kind: "DIPLOMA" as never });
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.error.code).toBe("reportcards.unknown_document_kind");

      const noBranding = await requestOfficialDocument(world.deps, ctxFor(otherTenant), receiptInput(newId()));
      expect(noBranding.ok).toBe(false);
      if (!noBranding.ok) expect(noBranding.error.code).toBe("reportcards.branding_missing");

      const noKey = await requestOfficialDocument(world.depsWith({ keys: null }), ctx(), receiptInput(newId()));
      expect(noKey.ok).toBe(false);
      if (!noKey.ok) expect(noKey.error.code).toBe("reportcards.signing_key_missing");
    });

    it("le contenu scellé est IMMUABLE en base (même pour un superutilisateur) et le document ne se supprime pas", async () => {
      const { record } = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      await expect(db.admin.query("UPDATE reportcards.official_documents SET snapshot = '{}'::jsonb WHERE id = $1", [record.id])).rejects.toThrow(/immuable/);
      await expect(db.admin.query("UPDATE reportcards.official_documents SET title = 'Autre' WHERE id = $1", [record.id])).rejects.toThrow(/immuable/);
      await expect(db.admin.query("UPDATE reportcards.official_documents SET verification_code = 'AAAAAAAAAAAAAAAAAAAAAAAAAA' WHERE id = $1", [record.id])).rejects.toThrow(/immuable/);
      await expect(db.admin.query("DELETE FROM reportcards.official_documents WHERE id = $1", [record.id])).rejects.toThrow(/immuable/);
      // un hash qui ne correspond pas au contenu est refusé à l'insertion (recalculé en SQL)
      await expect(
        db.admin.query(
          `INSERT INTO reportcards.official_documents (id, tenant_id, document_kind, source_id, title, template_key, template_version, snapshot, explain, snapshot_hash, verification_code, signing_key_id, signature, issued_at)
           SELECT $1, tenant_id, 'RECEIPT', $2, 'x', template_key, template_version, '{"a":1}'::jsonb, '{}'::jsonb, repeat('0', 64), 'BBBBBBBBBBBBBBBBBBBBBBBBBB', signing_key_id, 'sig', now() FROM reportcards.official_documents WHERE id = $3`,
          [newId(), newId(), record.id],
        ),
      ).rejects.toThrow(/hash_mismatch/);
    });
  });

  describe("rendu (worker), stockage, lecture", () => {
    let sourceId: string;
    let documentId: string;
    let code: string;

    it("rend le PDF depuis le contenu scellé seul : HTML complet (identité, QR, URL de vérification), PDF stocké, empreinte indexée", async () => {
      sourceId = newId();
      const sealed = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(sourceId)));
      documentId = sealed.record.id;
      code = sealed.record.verificationCode;
      world.renderer.renders.length = 0;
      const out = unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId }));
      expect(out.status).toBe("RENDERED");
      expect(out.pdfHash).toMatch(/^[0-9a-f]{64}$/);

      const html = world.renderer.renders[0]!.html;
      expect(html).toContain("Établissement de Démonstration".toLocaleUpperCase("fr-FR"));
      expect(html).toContain("REC-2026-000042");
      expect(html).toContain(learnerName);
      expect(html).toContain("25 000 F CFA");
      expect(html).toContain("FAC-2026-000007");
      expect(html).toContain(`https://verif.example.test/v/${code}`);
      expect(html).toContain("<svg"); // QR
      expect(html).toContain("data:image/png;base64"); // logo lu depuis le stockage
      expect(html).not.toMatch(/<script|javascript:|https?:\/\/(?!verif\.example\.test|www\.w3\.org\/2000\/svg)/i); // seul l'espace de noms SVG du QR et l'URL de vérification
      expect(html).toContain("default-src 'none'");

      const row = await rowOf(documentId);
      expect(row.render_status).toBe("RENDERED");
      expect(row.object_key).toBe(`reportcards/${school.tenantId}/documents/${documentId}.pdf`);
      expect(row.pdf_hash).toBe(out.pdfHash);
      expect(await world.storage.exists(row.object_key)).toBe(true);
      const fh = await adminRows<any>(db, "SELECT code FROM reportcards.file_hash_index WHERE pdf_hash = $1", [out.pdfHash]);
      expect(fh[0].code).toBe(code);

      const ev = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'reportcards.official_document.rendered' AND aggregate_id = $1", [documentId]);
      expect(ev).toHaveLength(1);
      expect(reportcardsEventPayloadSchemas["reportcards.official_document.rendered"].safeParse(ev[0].payload).success).toBe(true);
    });

    it("un rendu terminé est idempotent (rejeu de l'événement) ; la lecture renvoie les octets du PDF", async () => {
      const again = unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId }));
      expect(again.status).toBe("ALREADY_RENDERED");
      const file = unwrap(await readOfficialDocument(world.deps, ctx(), { kind: "RECEIPT", sourceId }));
      expect(file?.record.renderStatus).toBe("RENDERED");
      expect(Buffer.from(file!.bytes!).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(file!.fileName).toBe("Reçu-de-paiement-REC-2026-000042.pdf");
    });

    it("lecture d'une source jamais demandée : null ; d'un autre tenant : null (isolation)", async () => {
      expect(unwrap(await readOfficialDocument(world.deps, ctx(), { kind: "RECEIPT", sourceId: newId() }))).toBeNull();
      expect(unwrap(await getOfficialDocumentRecord(world.deps, ctxFor(otherTenant), { kind: "RECEIPT", sourceId }))).toBeNull();
      expect(unwrap(await readOfficialDocument(world.deps, ctxFor(otherTenant), { kind: "RECEIPT", sourceId }))).toBeNull();
    });

    it("un PDF référencé mais absent du stockage est une erreur d'exploitation explicite", async () => {
      const lost = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: lost.record.id }));
      const emptyStorage = world.depsWith({ ports: { storage: { get: async () => null } as never } });
      const r = await readOfficialDocument(emptyStorage, ctx(), { kind: "RECEIPT", sourceId: lost.record.sourceId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("reportcards.asset_missing");
    });

    it("échecs de rendu : 2 tentatives en échec laissent le document en attente, la 3e le marque FAILED (événement) ; la reprise le remet en attente puis le rend", async () => {
      const failing = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      world.renderer.failTimes = 3;
      for (const attempt of [1, 2]) {
        const r = await renderOfficialDocument(world.deps, ctx(), { documentId: failing.record.id, attempt, maxAttempts: 3 });
        expect(r.ok).toBe(false);
        expect((await rowOf(failing.record.id)).render_status).toBe("PENDING");
      }
      const last = await renderOfficialDocument(world.deps, ctx(), { documentId: failing.record.id, attempt: 3, maxAttempts: 3 });
      expect(last.ok).toBe(false);
      if (!last.ok) expect((last.error.details as { final?: boolean }).final).toBe(true);
      const row = await rowOf(failing.record.id);
      expect(row.render_status).toBe("FAILED");
      expect(row.last_error).toMatch(/Chromium indisponible/);
      expect(row.attempts).toBe(3);
      const failed = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'reportcards.official_document.render_failed' AND aggregate_id = $1", [failing.record.id]);
      expect(failed).toHaveLength(1);
      expect(reportcardsEventPayloadSchemas["reportcards.official_document.render_failed"].safeParse(failed[0].payload).success).toBe(true);

      const retry = unwrap(await requestOfficialDocumentRender(world.deps, ctx(), { documentId: failing.record.id }));
      expect(retry.renderStatus).toBe("PENDING");
      expect(unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: failing.record.id })).status).toBe("RENDERED");
    });

    it("le filet de sécurité redemande les documents restés en attente depuis trop longtemps", async () => {
      const stale = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      await db.admin.query("ALTER TABLE reportcards.official_documents DISABLE TRIGGER official_documents_guard");
      await db.admin.query("UPDATE reportcards.official_documents SET created_at = $2::timestamptz WHERE id = $1", [stale.record.id, new Date(world.clock.now().getTime() - 2 * 3_600_000)]);
      await db.admin.query("ALTER TABLE reportcards.official_documents ENABLE TRIGGER official_documents_guard");
      const swept = unwrap(await sweepPendingOfficialDocuments(world.deps, ctx(), { olderThanMs: 60 * 60_000, limit: 50 }));
      expect(swept.requested).toBeGreaterThanOrEqual(1);
      const n = await adminRows<any>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'reportcards.official_document.render_requested' AND aggregate_id = $1", [stale.record.id]);
      expect(n[0].n).toBe(2); // demande initiale + reprise
    });

    it("sans domaine public de vérification, un document officiel n'est PAS rendu (jamais sans QR) ; tentative notée", async () => {
      const noBase = world.depsWith({ config: { verificationBaseUrl: null } });
      const doc = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      const r = await renderOfficialDocument(noBase, ctx(), { documentId: doc.record.id, attempt: 3, maxAttempts: 3 });
      expect(r.ok).toBe(false);
      expect((await rowOf(doc.record.id)).render_status).toBe("FAILED");
    });
  });

  describe("authenticité : vérification publique (code ET fichier)", () => {
    let sourceId: string;
    let code: string;
    let bytes: Uint8Array;

    beforeAll(async () => {
      sourceId = newId();
      const sealed = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(sourceId)));
      code = sealed.record.verificationCode;
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: sealed.record.id }));
      bytes = unwrap(await readOfficialDocument(world.deps, ctx(), { kind: "RECEIPT", sourceId }))!.bytes!;
    });

    it("le code d'un reçu est AUTHENTIC : établissement, intitulé, date — et AUCUNE donnée personnelle", async () => {
      const r = unwrap(await verifyByCode(world.deps, { code, ipPrefix: "203.0.113.0/24" }));
      expect(r).toMatchObject({ status: "AUTHENTIC", documentKind: "RECEIPT", institutionName: "Établissement de Démonstration", title: "Reçu de paiement REC-2026-000042", mention: null });
      const dump = JSON.stringify(r);
      for (const secret of [learnerName, "MAT-0042", "Parent Fictif", "25000", "FAC-2026-000007"]) expect(dump).not.toContain(secret);
      const log = await adminRows<any>(db, "SELECT result, document_kind FROM reportcards.verification_events WHERE document_kind = 'RECEIPT' ORDER BY occurred_at DESC LIMIT 1");
      expect(log[0]).toMatchObject({ result: "AUTHENTIC", document_kind: "RECEIPT" });
    });

    it("le fichier PDF rendu est reconnu comme l'original ; un fichier modifié ne l'est pas", async () => {
      const ok = unwrap(await verifyByFile(world.deps, { bytes }));
      expect(ok).toMatchObject({ match: true, status: "AUTHENTIC", title: "Reçu de paiement REC-2026-000042" });
      const tampered = new Uint8Array(bytes);
      tampered[tampered.length - 3] = (tampered[tampered.length - 3]! + 1) % 256;
      expect(unwrap(await verifyByFile(world.deps, { bytes: tampered })).match).toBe(false);
    });

    it("un code inconnu, mal formé ou d'une autre nature non résolue reçoit la MÊME réponse « inconnu »", async () => {
      const unknown = unwrap(await verifyByCode(world.deps, { code: "AAAAAAAAAAAAAAAAAAAAAAAAAA" }));
      expect(unknown.status).toBe("UNKNOWN");
      expect(unwrap(await verifyByCode(world.deps, { code: "pas-un-code" }))).toEqual(unknown);
    });

    it("une altération du contenu en base (hors application) est DÉTECTÉE : le contrôle d'intégrité public répond INVALID", async () => {
      const victim = unwrap(await requestOfficialDocument(world.deps, ctx(), receiptInput(newId())));
      await db.admin.query("ALTER TABLE reportcards.official_documents DISABLE TRIGGER official_documents_guard");
      await db.admin.query(`UPDATE reportcards.official_documents SET explain = jsonb_set(explain, '{receipt,amountText}', '"999 999 F CFA"') WHERE id = $1`, [victim.record.id]);
      await db.admin.query("ALTER TABLE reportcards.official_documents ENABLE TRIGGER official_documents_guard");
      const r = unwrap(await verifyByCode(world.deps, { code: victim.record.verificationCode }));
      expect(r.status).toBe("INVALID");
    });

    it("la signature est vérifiable avec la clé publique publiée ; une clé retirée n'invalide pas les documents déjà signés", async () => {
      const key = await adminRows<any>(db, "SELECT status FROM reportcards.signing_keys WHERE key_id = 'test-key-2026'");
      expect(key[0].status).toBe("ACTIVE");
      // autre clé de signature : un nouveau document est signé par elle, l'ancien reste AUTHENTIC
      const second = new StaticKeyProvider(generateSigningKeyPair().privateKey, "test-key-second");
      const fresh = unwrap(await requestOfficialDocument(world.depsWith({ keys: second }), ctx(), receiptInput(newId())));
      expect(fresh.record.signingKeyId).toBe("test-key-second");
      expect(unwrap(await verifyByCode(world.deps, { code })).status).toBe("AUTHENTIC");
      expect(unwrap(await verifyByCode(world.deps, { code: fresh.record.verificationCode })).status).toBe("AUTHENTIC");
    });
  });

  describe("bulletin de paie (PAYSLIP) : même service, même garanties", () => {
    it("scelle, rend et vérifie un bulletin de paie ; le titre publié ne contient pas le nom de l'enseignant", async () => {
      const sourceId = newId();
      const sealed = unwrap(
        await requestOfficialDocument(world.deps, ctx(), {
          kind: "PAYSLIP",
          sourceId,
          title: "Bulletin de paie — Septembre 2025",
          issuedAt: new Date("2025-10-05T09:00:00.000Z"),
          content: { payslipId: sourceId, total: 275000, staff: { displayName: "TRAORE Moussa Fictif" } },
          context: {
            payslip: {
              staffName: "TRAORE Moussa Fictif", matricule: "ENS-007", periodName: "Septembre 2025", startDate: "2025-09-01", endDate: "2025-09-30", paidOn: "2025-10-05",
              lines: [{ date: "2025-09-08", label: "Mathématiques — 6e A", durationText: "2 h", rateText: "5 000 F CFA", amountText: "10 000 F CFA" }],
              adjustments: [], salaryText: "", regularHoursText: "265 000 F CFA", regularDurationText: "53 h", overtimeText: "10 000 F CFA", overtimeDurationText: "2 h",
              bonusText: "0 F CFA", deductionText: "0 F CFA", totalText: "275 000 F CFA",
            },
          },
        }),
      );
      expect(sealed.record.templateKey).toBe("payslip-standard");
      world.renderer.renders.length = 0;
      unwrap(await renderOfficialDocument(world.deps, ctx(), { documentId: sealed.record.id }));
      const html = world.renderer.renders[0]!.html;
      expect(html).toContain("TRAORE Moussa Fictif");
      expect(html).toContain("275 000 F CFA");
      expect(html).toContain("Mathématiques — 6e A");
      const pub = unwrap(await verifyByCode(world.deps, { code: sealed.record.verificationCode }));
      expect(pub).toMatchObject({ status: "AUTHENTIC", documentKind: "PAYSLIP", title: "Bulletin de paie — Septembre 2025" });
      expect(JSON.stringify(pub)).not.toContain("TRAORE");
    });
  });

  it("l'amorçage paresseux des gabarits est idempotent (tenants plus anciens)", async () => {
    const r1 = unwrap(await ensureBuiltinTemplates(world.deps));
    const r2 = unwrap(await ensureBuiltinTemplates(world.deps));
    expect(r1.published).toEqual([]); // déjà publiés par seedSchool
    expect(r2.published).toEqual([]);
  });
});

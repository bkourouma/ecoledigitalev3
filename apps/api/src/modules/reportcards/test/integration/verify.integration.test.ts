import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { reportcardsEventPayloadSchemas, reportcardsPublicVerificationDtoSchema, reportcardsFileVerificationDtoSchema } from "@ecoledigitale/contracts/src/v2/reportcards";
import { checkIntegrity } from "../../application/integrity";
import { createBatch, reissueReportCard } from "../../application/issue";
import { revokeReportCard } from "../../application/lifecycle";
import { ensureSigningKeyRegistered, listPublicKeys, retireSigningKey } from "../../application/platform";
import { renderReportCard } from "../../application/render";
import { updateReportcardsSettings } from "../../application/reference";
import { UNKNOWN_VERIFICATION, truncateIp, verifyByCode, verifyByFile } from "../../application/verify";
import { generateVerificationCode, verifyDocumentSignature } from "../../domain/signing";
import { makeSampleBundle } from "../../infrastructure/in-memory-ports";
import { StaticKeyProvider, generateSigningKeyPair } from "../../infrastructure/key-provider";
import * as present from "../../http/presenters";
import { adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("vérification publique d'authenticité (US4)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let ids: string[];
  let codes: string[];

  const dto = async (code: string) => present.verificationDto(unwrap(await verifyByCode(world.deps, { code, ipPrefix: "203.0.113.0/24" })));
  const cardRow = (id: string) => adminRows<any>(db, "SELECT * FROM reportcards.report_cards WHERE id = $1", [id]).then((r) => r[0]);

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 3 });
    unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    const rows = await adminRows<any>(db, "SELECT id, verification_code FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [school.tenantId]);
    ids = rows.map((r) => r.id);
    codes = rows.map((r) => r.verification_code);
    for (const id of ids) unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: id }));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("document authentique : statut, nature, établissement, intitulé, date d'émission, clé et signature — conforme au contrat", async () => {
    const r = await dto(codes[0]!);
    expect(reportcardsPublicVerificationDtoSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({
      status: "AUTHENTIC",
      documentKind: "REPORT_CARD",
      institutionName: "Établissement de Démonstration",
      title: "Bulletin de notes — Semestre 1 — 2025-2026",
      issuedAt: world.clock.now().toISOString(),
      mention: null,
      supersededByIssuedAt: null,
      revokedAt: null,
      keyId: "test-key-2026",
    });
    expect(r.keyFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("MINIMISATION : aucune note, date de naissance, adresse, nom, matricule ni identifiant d'élève dans la réponse (AC4.2)", async () => {
    const dump = JSON.stringify(await dto(codes[0]!));
    for (const forbidden of ["ELEVE1", "Prénom1", "MAT-001", "2010-03-04", "Ville Test", "1 rue de l'Exemple", "14,50", "14.50", "12,58", "Classe Test A", school.students[0]!.studentId, school.students[0]!.enrollmentId, "Admis", "Assez bien", "Personne Fictive"]) {
      expect(dump, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(await dto(codes[0]!)).sort()).toEqual(["documentKind", "institutionName", "issuedAt", "keyFingerprint", "keyId", "mention", "message", "revokedAt", "signature", "snapshotHash", "status", "supersededByIssuedAt", "title"]);
  });

  it("la mention n'apparaît que si le tenant l'a explicitement activée (Q-31)", async () => {
    expect((await dto(codes[0]!)).mention).toBeNull();
    unwrap(await updateReportcardsSettings(world.deps, school.admin.ctx, { verificationShowsMention: true }));
    expect((await dto(codes[0]!)).mention).toBe("Assez bien");
    unwrap(await updateReportcardsSettings(world.deps, school.admin.ctx, { verificationShowsMention: false }));
    expect((await dto(codes[0]!)).mention).toBeNull();
  });

  it("UNIFORMITÉ : code inexistant, mal formé, vide, en minuscules ou provisoire reçoivent EXACTEMENT la même réponse (AC4.5)", async () => {
    const t = await db.createTenant();
    const s = await seedSchool(world, t, { students: 1, closed: false });
    unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, provisional: true }));
    const provisional = (await adminRows<any>(db, "SELECT verification_code FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0].verification_code;
    const same = await Promise.all(
      [generateVerificationCode(), "abc", "", codes[0]!.toLowerCase(), "A".repeat(25), `${codes[0]}X`, "'; DROP TABLE reportcards.report_cards;--", provisional].map((c) => dto(c)),
    );
    for (const r of same) expect(r).toEqual(present.verificationDto(UNKNOWN_VERIFICATION));
    expect(same[0]!.status).toBe("UNKNOWN");
    expect(await adminRows(db, "SELECT 1 FROM reportcards.report_cards")).not.toHaveLength(0);
  });

  it("signature vérifiable HORS LIGNE avec la clé publique publiée, à partir des seuls champs de la réponse", async () => {
    const r = await dto(codes[1]!);
    const keys = unwrap(await listPublicKeys(world.deps));
    const key = keys.find((k) => k.keyId === r.keyId)!;
    expect(key.status).toBe("ACTIVE");
    expect(verifyDocumentSignature(key.publicKey, { snapshotHash: r.snapshotHash!, verificationCode: codes[1]!, issuedAt: r.issuedAt! }, r.signature!)).toBe(true);
    expect(verifyDocumentSignature(key.publicKey, { snapshotHash: r.snapshotHash!, verificationCode: codes[2]!, issuedAt: r.issuedAt! }, r.signature!)).toBe(false);
  });

  it("chaque vérification aboutie est journalisée avec l'IP TRONQUÉE, jamais l'IP complète (AC4.5)", async () => {
    const rows = await adminRows<any>(db, "SELECT result, ip_prefix, report_card_id FROM reportcards.verification_events WHERE tenant_id = $1", [school.tenantId]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.ip_prefix === "203.0.113.0/24" && r.result === "AUTHENTIC")).toBe(true);
    expect(truncateIp("203.0.113.57")).toBe("203.0.113.0/24");
    expect(truncateIp("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
    expect(truncateIp("2001:db8:abcd:12:ffff:1:2:3")).toBe("2001:db8:abcd::/48");
    expect(truncateIp(undefined)).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("203.0.113.57");
  });

  describe("remplacement et révocation", () => {
    it("remplacé : « document remplacé par une version plus récente émise le … » sans révéler le contenu de la nouvelle version", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const old = (await adminRows<any>(db, "SELECT id, verification_code FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0];
      world.clock.advance(86_400_000); // le lendemain
      world.results.setState({ ...world.results.states.get(`${s.classroomId}:${s.periodId}`)!, resultsVersion: 2, closureHash: "f".repeat(64) });
      world.results.setBundle(s.students[0]!.enrollmentId, s.periodId, makeSampleBundle({ studentId: s.students[0]!.studentId, enrollmentId: s.students[0]!.enrollmentId, classroomId: s.classroomId, periodId: s.periodId, yearId: s.yearId, stateId: s.stateId, ruleVersionId: s.ruleVersionId, pack: "SECONDARY", resultsVersion: 2, closureHash: "f".repeat(64), average: "17.77", lastName: "ELEVE1", firstNames: "Prénom1" }));
      const fresh = unwrap(await reissueReportCard(world.deps, s.admin.ctx, { reportCardId: old.id, reason: "Reclôture de la période" }));
      const r = await dto(old.verification_code);
      expect(r).toMatchObject({ status: "SUPERSEDED", supersededByIssuedAt: fresh.issuedAt.toISOString(), revokedAt: null, mention: null });
      expect(r.message).toBe("Document remplacé par une version plus récente émise le 4 février 2026.");
      expect(JSON.stringify(r)).not.toContain("17,77");
      expect(JSON.stringify(r)).not.toContain(fresh.verificationCode); // le nouveau code n'est pas divulgué
      // La nouvelle version est authentique.
      expect((await dto(fresh.verificationCode)).status).toBe("AUTHENTIC");
      world.clock.advance(-86_400_000);
    });

    it("révoqué : « document révoqué » avec la date, jamais le motif ; événement audité", async () => {
      unwrap(await revokeReportCard(world.deps, school.admin.ctx, { reportCardId: ids[2]!, reason: "Erreur grave : motif confidentiel" }));
      const r = await dto(codes[2]!);
      expect(r).toMatchObject({ status: "REVOKED", revokedAt: world.clock.now().toISOString() });
      expect(r.message).toMatch(/révoqué/);
      expect(JSON.stringify(r)).not.toContain("confidentiel");
      expect(await adminRows(db, "SELECT 1 FROM reportcards.verification_events WHERE tenant_id = $1 AND result = 'REVOKED'", [school.tenantId])).not.toHaveLength(0);
    });
  });

  describe("comparaison d'un fichier téléversé (AC4.4)", () => {
    const pdfOf = async (id: string): Promise<Uint8Array> => {
      const render = (await adminRows<any>(db, "SELECT object_key FROM reportcards.renders WHERE report_card_id = $1 AND status = 'RENDERED'", [id]))[0];
      return (await world.storage.get(render.object_key))!.bytes;
    };

    it("le PDF original est reconnu (« identique à l'original émis le … »), un fichier modifié non", async () => {
      const bytes = await pdfOf(ids[0]!);
      const ok = unwrap(await verifyByFile(world.deps, { bytes, ipPrefix: "198.51.100.0/24" }));
      expect(reportcardsFileVerificationDtoSchema.safeParse(present.fileVerificationDto(ok)).success).toBe(true);
      expect(ok).toMatchObject({ match: true, status: "AUTHENTIC", institutionName: "Établissement de Démonstration" });
      expect(ok.message).toBe("Ce fichier est identique à l'original émis le 3 février 2026.");
      const tampered = new Uint8Array(bytes);
      tampered[tampered.length - 20] = (tampered[tampered.length - 20]! + 1) % 256;
      const ko = unwrap(await verifyByFile(world.deps, { bytes: tampered }));
      expect(ko).toMatchObject({ match: false, status: null, institutionName: null, issuedAt: null });
      expect(ko.message).toMatch(/ne correspond à aucun original/);
      expect(await adminRows(db, "SELECT 1 FROM reportcards.verification_events WHERE result = 'FILE_MATCH' AND ip_prefix = '198.51.100.0/24'")).toHaveLength(1);
    });

    it("le PDF d'un document révoqué est reconnu mais signalé révoqué", async () => {
      const r = unwrap(await verifyByFile(world.deps, { bytes: await pdfOf(ids[2]!) }));
      expect(r).toMatchObject({ match: true, status: "REVOKED" });
      expect(r.message).toMatch(/révoqué/);
    });

    it("fichier vide ou > 10 Mo : refusé", async () => {
      expect((await verifyByFile(world.deps, { bytes: new Uint8Array(0) })).ok).toBe(false);
      const big = await verifyByFile(world.deps, { bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
      expect(big.ok).toBe(false);
      if (!big.ok) expect(big.error.code).toBe("reportcards.file_too_large");
    });
  });

  describe("intégrité : toute altération est détectée", () => {
    it("snapshot altéré en base (par un administrateur qui neutralise le déclencheur) : INVALID + événement `integrity.mismatch` ; le contrôle nocturne le signale", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 2 });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const rows = await adminRows<any>(db, "SELECT id, verification_code, snapshot_hash FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [t]);
      // Avant altération : tout est intact.
      const clean = unwrap(await checkIntegrity(world.deps, s.admin.ctx));
      expect(clean).toMatchObject({ checked: 2, mismatches: [] });
      // Attaque : DISABLE TRIGGER (DDL explicite) puis modification du contenu.
      await db.admin.query("ALTER TABLE reportcards.report_cards DISABLE TRIGGER report_cards_immutable");
      await db.admin.query("UPDATE reportcards.report_cards SET snapshot = jsonb_set(snapshot, '{results,summary,averageDisplay}', '\"20,00\"') WHERE id = $1", [rows[0].id]);
      await db.admin.query("ALTER TABLE reportcards.report_cards ENABLE ALWAYS TRIGGER report_cards_immutable");

      const r = await dto(rows[0].verification_code);
      expect(r.status).toBe("INVALID");
      expect(r.message).toMatch(/contrôle d'intégrité/);
      expect(JSON.stringify(r)).not.toContain("20,00");
      expect((await dto(rows[1].verification_code)).status).toBe("AUTHENTIC");

      const report = unwrap(await checkIntegrity(world.deps, s.admin.ctx));
      expect(report.checked).toBe(2);
      expect(report.mismatches).toHaveLength(1);
      expect(report.mismatches[0]).toMatchObject({ reportCardId: rows[0].id, reason: "HASH", expectedHash: rows[0].snapshot_hash });
      const ev = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.integrity.mismatch'", [t]);
      expect(ev.length).toBeGreaterThanOrEqual(2); // une à la consultation publique, une au contrôle nocturne
      for (const e of ev) expect(reportcardsEventPayloadSchemas["reportcards.integrity.mismatch"].safeParse(e.payload).success).toBe(true);
    });

    it("signature falsifiée : INVALID (le hash seul ne suffit pas à authentifier)", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const row = (await adminRows<any>(db, "SELECT id, verification_code FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0];
      const forged = new StaticKeyProvider(generateSigningKeyPair().privateKey, "forged-key-01").sign({ snapshotHash: "a".repeat(64), verificationCode: row.verification_code, issuedAt: world.clock.now() });
      await db.admin.query("ALTER TABLE reportcards.report_cards DISABLE TRIGGER report_cards_immutable");
      await db.admin.query("UPDATE reportcards.report_cards SET signature = $2 WHERE id = $1", [row.id, forged]);
      await db.admin.query("ALTER TABLE reportcards.report_cards ENABLE ALWAYS TRIGGER report_cards_immutable");
      expect((await dto(row.verification_code)).status).toBe("INVALID");
      const report = unwrap(await checkIntegrity(world.deps, s.admin.ctx));
      expect(report.mismatches[0]).toMatchObject({ reportCardId: row.id, reason: "SIGNATURE" });
    });
  });

  describe("rotation des clés (AC4.6)", () => {
    it("un document signé par une clé retirée reste vérifiable ; la nouvelle clé signe les nouveaux ; deux clés listées", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1 });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
      const oldCard = (await adminRows<any>(db, "SELECT verification_code FROM reportcards.report_cards WHERE tenant_id = $1", [t]))[0];

      // Rotation : nouvelle clé active, ancienne retirée.
      const next = new StaticKeyProvider(generateSigningKeyPair().privateKey, "test-key-2027");
      const rotated = world.depsWith({ keys: next });
      unwrap(await ensureSigningKeyRegistered(rotated));
      unwrap(await retireSigningKey(rotated, { keyId: world.keys.keyId, actorId: "00000000-0000-4000-8000-000000000001" }));
      const keys = unwrap(await listPublicKeys(rotated));
      expect(keys.map((k) => [k.keyId, k.status])).toEqual(expect.arrayContaining([["test-key-2026", "RETIRED"], ["test-key-2027", "ACTIVE"]]));
      expect(keys.find((k) => k.keyId === "test-key-2026")!.retiredAt).not.toBeNull();

      const r = await dto(oldCard.verification_code);
      expect(r).toMatchObject({ status: "AUTHENTIC", keyId: "test-key-2026" });
      // L'ancienne clé ne peut plus être ré-enregistrée comme active, et une collision d'identifiant est refusée.
      const back = await ensureSigningKeyRegistered(world.depsWith({ keys: world.keys }));
      expect(back.ok).toBe(false);
      const collision = await ensureSigningKeyRegistered(world.depsWith({ keys: new StaticKeyProvider(generateSigningKeyPair().privateKey, "test-key-2027") }));
      expect(collision.ok).toBe(false);
      if (!collision.ok) expect(collision.error.code).toBe("reportcards.signing_key_conflict");
    });
  });

  it("feature `reportcard.public-verification` désactivée pour le tenant : réponse uniforme « inconnu »", async () => {
    const off = world.depsWith({ verificationEnabled: async () => false });
    const r = unwrap(await verifyByCode(off, { code: codes[0]! }));
    expect(r).toEqual(UNKNOWN_VERIFICATION);
  });
});

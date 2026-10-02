/**
 * Diplômes et attestations de bout en bout, avec les VRAIS adaptateurs (aucun port en mémoire entre modules) :
 *
 *   people + academic -> assess -> results (règles nationales) -> higher (capitalisation, octroi, document)
 *     -> reportcards : scellement Ed25519, gabarit de plateforme (VRAI moteur de gabarits), PDF (moteur factice), stockage,
 *        index de vérification publique -> page publique : code, fichier téléversé, document révoqué / remplacé / altéré.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { updateProgram } from "../../src/modules/academic";
import {
  assignSlot,
  awardDiploma,
  createDiploma,
  createHigherDeps,
  createRulesAdapter,
  getDocument,
  getDocumentDownload,
  issueAwardDocument,
  issueSuccessAttestation,
  onResultsPeriodClosed,
  renderOfficialDocument,
  revokeDocument,
  type HigherDeps,
} from "../../src/modules/higher";
import {
  FakePdfRenderer,
  InMemoryStorage,
  createReportcardsDeps,
  createSignatory,
  ensureBuiltinTemplates,
  generateSigningKeyPair,
  putBranding,
  verifyByCode,
  verifyByFile,
  type ReportcardsDeps,
} from "../../src/modules/reportcards";
import { buildPlatformPorts, createAdapterKit, type PlatformPorts } from "../../src/platform/adapters";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, bindCreditRules, closeSemester, createAssemblyWorld, publishAssessment, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

describeIntegration("diplômes : scellement, PDF et vérification publique (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let admin: RequestContext;
  let ports: PlatformPorts;
  let hd: HigherDeps;
  let publicRc: ReportcardsDeps;
  let storage: InMemoryStorage;
  let renderer: FakePdfRenderer;
  let awardId: string;
  let closure: { state: { id: string; resultsVersion: number } };

  const BASE = "https://verif.example.test";

  beforeAll(async () => {
    w = await createAssemblyWorld();
    admin = w.director;
    await bindCreditRules(w);
    school = await seedHigherSchool(w, { pupils: 1 });
    // L'étudiant réussit tout (la validation vient des règles nationales, pas du test).
    const { ue1, ue2 } = school.seed;
    for (const node of [ue1.ecueIds[0]!, ue1.ecueIds[1]!, ue2.ecueIds[0]!, ue2.ecueIds[1]!]) {
      await publishAssessment(w, school, { typeCode: "DEVOIR", nodeId: node, scores: ["18"] });
      await publishAssessment(w, school, { typeCode: "EXAMEN", nodeId: node, scores: ["18"] });
    }
    closure = (await closeSemester(w, school)) as unknown as typeof closure;
    unwrap(await updateProgram(w.academic.deps, admin, school.seed.programId, { isCycle: true }));

    // Plateforme : clé de signature et domaine de vérification dans l'ENVIRONNEMENT, moteur PDF factice.
    const { privateKeyPem } = generateSigningKeyPair();
    storage = new InMemoryStorage(w.clock);
    renderer = new FakePdfRenderer();
    const kit = createAdapterKit({
      tenantDb: w.tenantDb,
      systemDb: w.systemDb,
      clock: w.clock,
      logger: noopLogger,
      env: { REPORTCARDS_SIGNING_KEY: privateKeyPem, REPORTCARDS_SIGNING_KEY_ID: "test-docs-key-1", REPORTCARDS_VERIFICATION_BASE_URL: BASE },
    });
    ports = buildPlatformPorts(kit, Object.assign(storage, { driver: "disk" as const, delete: async (k: string) => void storage.objects.delete(k) }), { documentRenderer: renderer });
    hd = createHigherDeps({ db: w.tenantDb, clock: w.clock, portsProvider: () => ({ ...ports.higher, rules: createRulesAdapter(() => kit.rules) }) });
    publicRc = createReportcardsDeps({ db: w.tenantDb, systemDb: w.systemDb, clock: w.clock, portsProvider: () => ({ ...ports.reportcards, storage }) });

    // Identité de l'établissement, signataires, gabarits.
    const rc = createReportcardsDeps({ db: w.tenantDb, systemDb: w.systemDb, clock: w.clock, ports: { storage } });
    unwrap(await ensureBuiltinTemplates(rc));
    unwrap(await putBranding(rc, admin, { legalName: "Établissement de démonstration", headerLeft: ["Ministère exemple"], address: "1 rue de l'Exemple", primaryColor: "#14532D" }));
    const left = unwrap(await createSignatory(rc, admin, { fullName: "Personne Fictive Une", title: "Directeur", jobFunction: "Direction générale" }));
    const right = unwrap(await createSignatory(rc, admin, { fullName: "Personne Fictive Deux", title: "Directrice", jobFunction: "Direction des études" }));
    const attest = unwrap(await createSignatory(rc, admin, { fullName: "Personne Fictive Trois", title: "Responsable", jobFunction: "Scolarité" }));
    const auth = unwrap(await createSignatory(rc, admin, { fullName: "Personne Fictive Quatre", title: "Secrétaire", jobFunction: "Secrétariat général" }));
    for (const [slotKey, signatoryId] of [["DIPLOMA_LEFT", left.id], ["DIPLOMA_RIGHT", right.id], ["ATTESTATION_SUCCESS", attest.id], ["AUTHENTICITY", auth.id]] as const) {
      unwrap(await assignSlot(hd, admin, { slotKey, signatoryId, validFrom: "2020-01-01" }));
    }

    // Capitalisation, diplôme et octroi (règles réelles).
    const payload = { v: 1, classroomId: school.ref.classroomId, academicPeriodId: school.ref.academicPeriodId, stateId: closure.state.id, resultsVersion: closure.state.resultsVersion };
    unwrap(await onResultsPeriodClosed(hd, admin, payload));
    const def = unwrap(await createDiploma(hd, admin, { code: "LIC-INFO", label: "Licence en informatique", gradeCode: "LICENCE", curriculumNodeId: school.seed.programId, uvRequired: 12, requirements: [{ ueNodeId: ue1.lineageId }, { ueNodeId: ue2.lineageId }] }));
    const award = unwrap(await awardDiploma(hd, admin, { definitionId: def.definition.id, studentId: school.pupils[0]!.studentId, via: "MANUAL" }));
    if (award.status !== "AWARDED") throw new Error(`octroi attendu, reçu ${award.status}`);
    awardId = award.award.id;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("le code de vérification émis par higher respecte le format de la vérification publique (26 caractères base32)", async () => {
    const doc = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document;
    expect(doc.verificationCode).toMatch(/^[A-Z2-7]{26}$/);
    expect(doc).toMatchObject({ renderStatus: "PENDING", signature: null });
  });

  it("le worker scelle puis rend : signature Ed25519, PDF stocké, gabarit de plateforme rempli depuis le snapshot", async () => {
    const doc = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document;
    const done = unwrap(await renderOfficialDocument(hd, admin, doc.id));
    expect(done).toMatchObject({ renderStatus: "RENDERED", signingKeyId: "test-docs-key-1", templateKey: "higher-diploma" });
    expect(done.signature).toBeTruthy();
    expect(done.objectKey).toBe(`tenants/${w.tenantId}/higher/documents/${doc.id}.pdf`);
    const stored = await storage.get(done.objectKey!);
    expect(stored?.contentType).toBe("application/pdf");
    expect(Buffer.from(stored!.bytes.subarray(0, 5)).toString()).toBe("%PDF-");

    // HTML réellement produit par le moteur de gabarits de reportcards : contenu du snapshot, QR, code, aucune donnée hors snapshot
    const html = renderer.renders.at(-1)!.html;
    expect(html).toContain("ÉTABLISSEMENT DE DÉMONSTRATION");
    expect(html).toContain("Licence en informatique");
    expect(html).toContain("ETUDIANT1");
    expect(html).toContain("UE1");
    expect(html).toContain("Personne Fictive Une");
    expect(html).toContain("Personne Fictive Deux");
    expect(html).toContain(`Code : ${doc.verificationCode}`);
    expect(html).toContain(`${BASE}/v/${doc.verificationCode}`);
    expect(html).toContain("<svg xmlns");
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toContain(`N° ${doc.reference}`);

    // idempotent : un second passage ne recrée ni ne resigne
    const again = unwrap(await renderOfficialDocument(hd, admin, doc.id));
    expect(again).toMatchObject({ signature: done.signature, pdfHash: done.pdfHash });
    const keys = await adminRows<{ key_id: string; status: string }>(w, "SELECT key_id, status FROM reportcards.signing_keys WHERE key_id = 'test-docs-key-1'");
    expect(keys).toEqual([{ key_id: "test-docs-key-1", status: "ACTIVE" }]);
  });

  it("téléchargement : URL signée de reportcards (stockage) pour un PDF prêt, aucun chemin de stockage dans la réponse", async () => {
    const doc = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document;
    const dl = unwrap(await getDocumentDownload(hd, admin, doc.id));
    expect(dl.status).toBe("READY");
    if (dl.status === "READY") {
      expect(dl.url).toMatch(/^memory:\/\//);
      expect(dl.fileName).toBe(`${doc.reference}.pdf`);
      expect(dl.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("vérification publique par code : AUTHENTIQUE, réponse minimale sans donnée personnelle ; code inconnu : réponse uniforme", async () => {
    const doc = unwrap(await getDocument(hd, admin, (unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document).id));
    const r = unwrap(await verifyByCode(publicRc, { code: doc.verificationCode }));
    expect(r).toMatchObject({ status: "AUTHENTIC", documentKind: "DIPLOMA", institutionName: "Établissement de démonstration", keyId: "test-docs-key-1", snapshotHash: doc.snapshotHash });
    expect(r.title).toBe("Diplôme — Licence en informatique");
    expect(JSON.stringify(r)).not.toMatch(/ETUDIANT|Prenom|Abidjan|MAT-|2005-/);
    expect(unwrap(await verifyByCode(publicRc, { code: "A".repeat(26) })).status).toBe("UNKNOWN");
    expect(unwrap(await verifyByCode(publicRc, { code: "pas-un-code" })).status).toBe("UNKNOWN");
    const events = await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM reportcards.verification_events WHERE tenant_id = $1 AND document_kind = 'DIPLOMA' AND result = 'AUTHENTIC'", [w.tenantId]);
    expect(Number(events[0]!.n)).toBeGreaterThan(0);
  });

  it("vérification par fichier téléversé : le PDF émis est reconnu, un fichier modifié ne l'est pas", async () => {
    const doc = unwrap(await getDocument(hd, admin, (unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document).id));
    const bytes = (await storage.get(doc.objectKey!))!.bytes;
    const same = unwrap(await verifyByFile(publicRc, { bytes }));
    expect(same).toMatchObject({ match: true, status: "AUTHENTIC", institutionName: "Établissement de démonstration" });
    const altered = new Uint8Array(bytes.length + 1);
    altered.set(bytes);
    altered[bytes.length] = 0x20;
    expect(unwrap(await verifyByFile(publicRc, { bytes: altered })).match).toBe(false);
  });

  it("empreinte ou signature altérée en base : INVALIDE (jamais « authentique ») ; révocation : RÉVOQUÉ", async () => {
    const attest = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "ATTESTATION_AUTHENTICITY" })).document;
    unwrap(await renderOfficialDocument(hd, admin, attest.id));
    expect(unwrap(await verifyByCode(publicRc, { code: attest.verificationCode })).status).toBe("AUTHENTIC");
    // Altération hors application (superutilisateur, déclencheurs suspendus le temps de l'essai).
    await w.db.admin.query("ALTER TABLE higher.official_documents DISABLE TRIGGER USER");
    try {
      await w.db.admin.query("UPDATE higher.official_documents SET signature = repeat('A', 86) WHERE id = $1", [attest.id]);
      expect(unwrap(await verifyByCode(publicRc, { code: attest.verificationCode })).status).toBe("INVALID");
      await w.db.admin.query("UPDATE higher.official_documents SET signature = $2 WHERE id = $1", [attest.id, attest.signature ?? (await getDocument(hd, admin, attest.id).then((d) => (d.ok ? d.value.signature : null)))]);
      await w.db.admin.query("UPDATE higher.official_documents SET snapshot = jsonb_set(snapshot, '{reference}', '\"ALTERE\"') WHERE id = $1", [attest.id]);
      expect(unwrap(await verifyByCode(publicRc, { code: attest.verificationCode })).status).toBe("INVALID");
    } finally {
      await w.db.admin.query("ALTER TABLE higher.official_documents ENABLE TRIGGER USER");
    }
  });

  it("duplicata : l'original devient REMPLACÉ ; révocation de l'octroi : le document est RÉVOQUÉ, plus servi ni rendu", async () => {
    const original = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA" })).document;
    unwrap(await renderOfficialDocument(hd, admin, original.id));
    w.clock.set(new Date(w.clock.now().getTime() + 86_400_000));
    const dup = unwrap(await issueAwardDocument(hd, admin, { awardId, kind: "DIPLOMA", duplicate: true })).document;
    unwrap(await renderOfficialDocument(hd, admin, dup.id));
    expect(unwrap(await verifyByCode(publicRc, { code: original.verificationCode })).status).toBe("SUPERSEDED");
    expect(unwrap(await verifyByCode(publicRc, { code: dup.verificationCode })).status).toBe("AUTHENTIC");
    unwrap(await revokeDocument(hd, admin, { documentId: dup.id, reason: "Erreur d'identité de l'étudiant" }));
    expect(unwrap(await verifyByCode(publicRc, { code: dup.verificationCode })).status).toBe("REVOKED");
    expect(await getDocumentDownload(hd, admin, dup.id)).toMatchObject({ ok: false, error: { code: "higher.document_revoked" } });
    // la page publique d'un tenant dont la fonction est désactivée répond comme pour un code inconnu
    const disabled = createReportcardsDeps({ db: w.tenantDb, systemDb: w.systemDb, clock: w.clock, portsProvider: () => ports.reportcards, verificationEnabled: async () => false });
    expect(unwrap(await verifyByCode(disabled, { code: original.verificationCode })).status).toBe("UNKNOWN");
  });

  it("sans clé de signature configurée : le scellement échoue explicitement, aucun document « scellé » en silence", async () => {
    const bare = createAdapterKit({ tenantDb: w.tenantDb, systemDb: w.systemDb, clock: w.clock, logger: noopLogger, env: {} });
    const barePorts = buildPlatformPorts(bare, storage as never, { documentRenderer: new FakePdfRenderer() });
    const hdBare = createHigherDeps({ db: w.tenantDb, clock: w.clock, portsProvider: () => ({ ...ports.higher, documents: barePorts.higher.documents! }) });
    const fresh = unwrap(await issueSuccessAttestation(hd, admin, { studentId: school.pupils[0]!.studentId, programNodeId: school.seed.programId })).document;
    const r = await renderOfficialDocument(hdBare, admin, fresh.id);
    expect(r).toMatchObject({ ok: false, error: { code: "reportcards.signing_key_missing" } });
    expect(unwrap(await getDocument(hd, admin, fresh.id))).toMatchObject({ signature: null, renderStatus: "PENDING" });
  });
});

/**
 * Intégration (Postgres réel ; s'ignore sans TEST_DATABASE_URL) : FORMULAIRE PUBLIC — fermeture sans texte de consentement, liste
 * blanche de la réponse, aucune fuite (capacités, effectifs, identifiants), aucun compte créé, jeton à usage unique (concurrence),
 * délai minimal, expiration, rejeu, leurre, limiteur, doublon neutre, consentement versionné, suivi par code, dépôt de pièce,
 * réponse à une offre par lien à usage unique.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import { admissionsPublicFormDtoSchema, admissionsPublicTrackDtoSchema, type AdmissionsPublicSubmitBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { getApplication } from "../../application/applications";
import { issueOffer } from "../../application/offers";
import { purgePublicFormData } from "../../application/jobs";
import { getPublicForm, respondOfferPublic, submitPublicApplication, trackApplication, uploadTrackedDocument, viewOfferPublic, type PublicOutcome } from "../../application/public-form";
import { managePublicLink, updateSettings, upsertRequirement } from "../../application/reference";
import { describeIntegration } from "../support/db";
import { acceptApplication, createWorld, ensureConsentText, openCampaignWith, openPublicForm, submittedApplication, unwrap, type TenantWorld, type World } from "../support/world";

const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (test)";
const PDF = new TextEncoder().encode("%PDF-1.4 pièce publique\n%%EOF");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

describeIntegration("admissions : formulaire public", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  const ok = <T>(o: PublicOutcome<T>): T => {
    if (o.kind !== "ok") throw new Error(`attendu ok, reçu ${o.kind}${o.kind === "error" ? ` (${o.error.code})` : ""}`);
    return o.value;
  };

  let counter = 0;
  function bodyFor(token: string, overrides: Partial<AdmissionsPublicSubmitBody> = {}): AdmissionsPublicSubmitBody {
    counter += 1;
    return {
      formToken: token,
      applicantFirstName: `Mamadou${counter}`,
      applicantLastName: "Diallo",
      applicantBirthDate: "2019-02-03",
      applicantGender: "MALE",
      isRepeating: false,
      desiredGradeLevelCode: "CP1",
      fundingTypeRequested: "PRIVATE",
      guardians: [{ relationshipCode: "FATHER", firstName: "Ibrahim", lastName: "Diallo", phone: "+22505111111", email: `ibrahim${counter}@example.test`, isPrimary: true, isFinancialResponsible: true, canConsent: true }],
      consent: { accepted: true, textVersion: "v1", guardianIndex: 0 },
      ...overrides,
    };
  }

  async function opened(slug: string, options: Parameters<typeof openPublicForm>[1] = {}): Promise<{ t: TenantWorld; school: string; campaignId: string }> {
    const t = await w.tenant(slug);
    const school = await openPublicForm(t, options);
    const campaign = await openCampaignWith(t, { seats: { CP1: 4, CP2: 4 } });
    return { t, school, campaignId: campaign.id };
  }

  const newToken = async (t: TenantWorld, school: string): Promise<string> => ok(await getPublicForm(t.deps, { slug: school, ip: IP })).formToken;
  const submit = (t: TenantWorld, school: string, body: AdmissionsPublicSubmitBody, ip = IP) => submitPublicApplication(t.deps, { slug: school, body, ip, userAgent: UA });
  const applicationsOf = async (t: TenantWorld): Promise<number> => (await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.applications WHERE tenant_id = $1", [t.id])).rows[0].n;

  describe("ouverture et contenu de la réponse", () => {
    it("tout ce qui est fermé répond la MÊME chose : lien inconnu, désactivé, formulaire fermé, aucun texte de consentement publié", async () => {
      const t = await w.tenant("ferme");
      const campaign = await openCampaignWith(t, { seats: { CP1: 4 } });
      void campaign;
      expect((await getPublicForm(t.deps, { slug: "a".repeat(26), ip: IP })).kind).toBe("closed"); // inconnu
      const link = unwrap(await managePublicLink(t.deps, t.ctx(), { institutionId: t.institutionId, enabled: true }));
      const slug = link.publicFormSlug as string;
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed"); // formulaire non ouvert
      await ensureConsentText(t);
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, publicFormEnabled: true }));
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("ok");
      unwrap(await managePublicLink(t.deps, t.ctx(), { institutionId: t.institutionId, enabled: false }));
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed"); // lien désactivé : fermeture immédiate
      unwrap(await managePublicLink(t.deps, t.ctx(), { institutionId: t.institutionId, enabled: true }));
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, publicFormEnabled: false }));
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed"); // paramètre fermé
    });

    it("sans campagne ouverte, le formulaire est fermé ; changer de lien invalide l'ancien", async () => {
      const t = await w.tenant("sans-campagne");
      const slug = await openPublicForm(t);
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed");
      await openCampaignWith(t, { seats: { CP1: 1 } });
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("ok");
      const rotated = unwrap(await managePublicLink(t.deps, t.ctx(), { institutionId: t.institutionId, rotate: true })).publicFormSlug as string;
      expect(rotated).not.toBe(slug);
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed");
      expect((await getPublicForm(t.deps, { slug: rotated, ip: IP })).kind).toBe("ok");
    });

    it("le formulaire ne renvoie QUE la liste blanche : jamais capacité, effectif, place restante, liste d'attente, identifiant interne", async () => {
      const { t, school } = await opened("liste-blanche");
      unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE", label: "Acte de naissance", required: true }));
      const form = ok(await getPublicForm(t.deps, { slug: school, ip: IP }));
      expect(admissionsPublicFormDtoSchema.safeParse(form).success).toBe(true); // schéma strict : toute clé en trop est refusée
      expect(Object.keys(form).sort()).toEqual(["antiSpam", "consent", "documents", "formToken", "grades", "institutionName", "relationships"]);
      expect(form.grades.map((g) => g.code).sort()).toEqual(["CP1", "CP2"]);
      expect(form.documents[0]).toMatchObject({ code: "ACTE", label: "Acte de naissance", required: true });
      expect(form.consent).toMatchObject({ kind: "DATA_PROCESSING", version: "v1" });
      const blob = JSON.stringify(form);
      for (const leak of [t.institutionId, t.id, t.workflowId, /"seats/i, /seatsLeft/i, /waitlist/i, /capacit/i]) expect(typeof leak === "string" ? blob.includes(leak) : leak.test(blob), String(leak)).toBe(false);
      // Le jeton émis n'est pas stocké en clair : seule son empreinte l'est.
      const { rows } = await w.db.admin.query("SELECT token_hash FROM admissions.public_form_sessions WHERE tenant_id = $1", [t.id]);
      expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash) && r.token_hash !== form.formToken)).toBe(true);
    });

    it("sans texte de consentement publié le formulaire reste fermé ; CAPTCHA exigé sans port : fermé (échec fermé)", async () => {
      const t = await w.tenant("captcha");
      const slug = await openPublicForm(t);
      await openCampaignWith(t, { seats: { CP1: 1 } });
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, captchaRequired: true }));
      expect((await getPublicForm(t.deps, { slug, ip: IP })).kind).toBe("closed"); // aucun prestataire branché : pas de formulaire « sans protection »
    });
  });

  describe("dépôt d'une candidature", () => {
    it("crée la candidature SUBMITTED, trace le consentement parental (version, voie, empreintes) et ne crée AUCUN compte ni élève", async () => {
      const { t, school, campaignId } = await opened("depot");
      const token = await newToken(t, school);
      const res = ok(await submit(t, school, bodyFor(token, { applicantFirstName: "Ousmane", applicantLastName: "Sylla" })));
      expect(res.trackingCode).toMatch(/^[A-HJKMN-Z2-9]{4}(-[A-HJKMN-Z2-9]{4}){3}$/);
      expect(Object.keys(res).sort()).toEqual(["message", "trackingCode"]);
      const { rows } = await w.db.admin.query("SELECT a.id, a.status, a.created_via, a.tracking_code_hash, s.code FROM admissions.applications a JOIN admissions.workflow_stages s ON s.id = a.stage_id WHERE a.campaign_id = $1", [campaignId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "SUBMITTED", created_via: "PUBLIC_FORM", code: "SUBMITTED" });
      expect(rows[0].tracking_code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows[0])).not.toContain(res.trackingCode.replace(/-/g, ""));
      const consent = await w.db.admin.query("SELECT kind, text_version, given_via, ip_hash, ua_hash, evidence_ref FROM admissions.consents WHERE application_id = $1", [rows[0].id]);
      expect(consent.rows).toHaveLength(1);
      expect(consent.rows[0]).toMatchObject({ kind: "DATA_PROCESSING", text_version: "v1", given_via: "PUBLIC_FORM", evidence_ref: null });
      expect(consent.rows[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(consent.rows[0].ua_hash).toMatch(/^[0-9a-f]{64}$/);
      // IP et agent ne sont JAMAIS stockés en clair (consentements, tentatives, jetons).
      const tables = await w.db.admin.query("SELECT (SELECT string_agg(to_jsonb(c)::text, '') FROM admissions.consents c WHERE tenant_id = $1) || (SELECT string_agg(to_jsonb(s)::text, '') FROM admissions.submission_attempts s WHERE tenant_id = $1) || (SELECT string_agg(to_jsonb(f)::text, '') FROM admissions.public_form_sessions f WHERE tenant_id = $1) AS blob", [t.id]);
      expect(tables.rows[0].blob).not.toContain("203.0.113");
      expect(tables.rows[0].blob).not.toContain("Mozilla");
      // Aucun compte, aucun élève, aucune écriture dans people / academic / finance.
      expect(t.mem.students.size).toBe(0);
      expect(t.mem.calls.filter((c) => c !== "findDuplicates")).toEqual([]); // seule la LECTURE des doublons d'élèves a lieu
      const outbox = await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'admissions.%'", [t.id]);
      expect(outbox.rows.map((r) => r.type)).toEqual(expect.arrayContaining(["admissions.application.submitted"]));
      const blob = JSON.stringify((await w.db.admin.query("SELECT payload::text AS p FROM kernel.domain_events WHERE tenant_id = $1", [t.id])).rows);
      expect(blob).not.toMatch(/Ousmane|Sylla|ibrahim/i);
    });

    it("la réponse est identique pour un dépôt neuf et un doublon exact (aucune énumération) ; le doublon n'est signalé qu'en interne", async () => {
      const { t, school, campaignId } = await opened("doublon-public");
      const fixed = { applicantFirstName: "Kadidia", applicantLastName: "Cissé", applicantBirthDate: "2019-07-07" };
      const first = ok(await submit(t, school, bodyFor(await newToken(t, school), fixed)));
      const second = ok(await submit(t, school, bodyFor(await newToken(t, school), { ...fixed, applicantFirstName: "KADIDIA" })));
      expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
      expect(second.message).toBe(first.message);
      expect(second.trackingCode).not.toBe(first.trackingCode);
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.applications WHERE campaign_id = $1", [campaignId])).rows[0].n).toBe(1);
      const attempt = await w.db.admin.query("SELECT outcome, application_id FROM admissions.submission_attempts WHERE tenant_id = $1 AND outcome = 'REJECTED_DUPLICATE'", [t.id]);
      expect(attempt.rows).toHaveLength(1);
      expect(attempt.rows[0].application_id).not.toBeNull();
      // Le faux code ne suit rien : indiscernable d'un code inconnu.
      expect((await trackApplication(t.deps, { school, trackingCode: second.trackingCode })).kind).toBe("closed");
      expect((await trackApplication(t.deps, { school, trackingCode: first.trackingCode })).kind).toBe("ok");
    });

    it("jeton à USAGE UNIQUE : 4 dépôts simultanés avec le même jeton -> une seule candidature ; rejeu refusé", async () => {
      const { t, school, campaignId } = await opened("jeton-unique");
      const token = await newToken(t, school);
      const results = await Promise.all([0, 1, 2, 3].map(() => submit(t, school, bodyFor(token))));
      expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "invalid")).toHaveLength(3);
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.applications WHERE campaign_id = $1", [campaignId])).rows[0].n).toBe(1);
      expect((await submit(t, school, bodyFor(token))).kind).toBe("invalid"); // rejeu
      const consumed = await w.db.admin.query("SELECT count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS n FROM admissions.public_form_sessions WHERE tenant_id = $1", [t.id]);
      expect(consumed.rows[0].n).toBe(1);
    });

    it("jeton trop rapide (délai minimal), expiré, inconnu ou d'un autre établissement : refusé, aucune candidature écrite", async () => {
      const { t, school } = await opened("jeton-refuse", { minimumFormSeconds: 600 });
      const fast = await newToken(t, school);
      expect((await submit(t, school, bodyFor(fast))).kind).toBe("invalid"); // un robot qui poste dans la seconde
      expect(await applicationsOf(t)).toBe(0);
      expect((await submit(t, school, bodyFor("t".repeat(43)))).kind).toBe("invalid");
      // Expiration : le jeton est prêt (délai écoulé) mais échu.
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, minimumFormSeconds: 0 }));
      const token = await newToken(t, school);
      await w.db.admin.query("ALTER TABLE admissions.public_form_sessions DISABLE TRIGGER public_form_sessions_guard");
      await w.db.admin.query("UPDATE admissions.public_form_sessions SET expires_at = now() - interval '1 minute', min_ready_at = now() - interval '2 minutes', issued_at = now() - interval '3 minutes' WHERE tenant_id = $1", [t.id]);
      await w.db.admin.query("ALTER TABLE admissions.public_form_sessions ENABLE TRIGGER public_form_sessions_guard");
      expect((await submit(t, school, bodyFor(token))).kind).toBe("invalid");
      expect(await applicationsOf(t)).toBe(0);
      // Jeton émis pour un AUTRE établissement : sans effet (RLS + clé de tenant).
      const other = await opened("autre-ecole");
      const foreignToken = await newToken(other.t, other.school);
      expect((await submit(t, school, bodyFor(foreignToken))).kind).toBe("invalid");
    });

    it("champ leurre rempli : réponse d'apparence normale (code factice jamais stocké), aucune candidature, tentative journalisée", async () => {
      const { t, school } = await opened("leurre");
      const res = ok(await submit(t, school, { ...bodyFor(await newToken(t, school)), website: "http://spam.example" } as AdmissionsPublicSubmitBody));
      expect(res.trackingCode).toMatch(/^[A-HJKMN-Z2-9]{4}(-[A-HJKMN-Z2-9]{4}){3}$/);
      expect(await applicationsOf(t)).toBe(0);
      expect((await w.db.admin.query("SELECT outcome FROM admissions.submission_attempts WHERE tenant_id = $1", [t.id])).rows.map((r) => r.outcome)).toEqual(["REJECTED_BOT"]);
      expect((await trackApplication(t.deps, { school, trackingCode: res.trackingCode })).kind).toBe("closed");
    });

    it("limiteur par empreinte d'IP (comptage en base) : au-delà du plafond de l'établissement, refus ; une autre IP n'est pas touchée", async () => {
      const { t, school } = await opened("limiteur", { submissionsPer10Min: 2 });
      for (let i = 0; i < 2; i += 1) ok(await submit(t, school, bodyFor(await newToken(t, school))));
      const third = await submit(t, school, bodyFor(await newToken(t, school)));
      expect(third.kind).toBe("rate_limited");
      if (third.kind === "rate_limited") expect(third.retryAfterSeconds).toBeGreaterThan(0);
      expect((await submit(t, school, bodyFor(await newToken(t, school, )), "198.51.100.20")).kind).toBe("ok");
      expect(await applicationsOf(t)).toBe(3);
    });

    it("consentement parental : version affichée obligatoire, tuteur habilité obligatoire ; sans consentement valide rien n'est écrit", async () => {
      const { t, school } = await opened("consentement");
      const stale = await submit(t, school, bodyFor(await newToken(t, school), { consent: { accepted: true, textVersion: "v0", guardianIndex: 0 } }));
      expect(stale.kind).toBe("invalid");
      const notEntitled = await submit(t, school, bodyFor(await newToken(t, school), { guardians: [{ relationshipCode: "OTHER", firstName: "Oncle", lastName: "Diallo", phone: "+22505222222", isPrimary: true, isFinancialResponsible: false, canConsent: false }] }));
      expect(notEntitled.kind).toBe("invalid");
      const wrongIndex = await submit(t, school, bodyFor(await newToken(t, school), { consent: { accepted: true, textVersion: "v1", guardianIndex: 3 } }));
      expect(wrongIndex.kind).toBe("invalid");
      expect(await applicationsOf(t)).toBe(0);
    });

    it("niveau non proposé ou lien de parenté inconnu : refusé ; confirmation limitée à UNE par contact et par jour", async () => {
      const { t, school } = await opened("confirmations");
      expect((await submit(t, school, bodyFor(await newToken(t, school), { desiredGradeLevelCode: "6EME" }))).kind).toBe("invalid");
      expect((await submit(t, school, bodyFor(await newToken(t, school), { guardians: [{ relationshipCode: "ALIEN", firstName: "X", lastName: "Y", phone: "+22505333333", isPrimary: true, isFinancialResponsible: false, canConsent: true }] }))).kind).toBe("invalid");
      const shared = { relationshipCode: "MOTHER", firstName: "Aïssata", lastName: "Bah", email: "aissata@example.test", phone: "+22505444444", isPrimary: true, isFinancialResponsible: true, canConsent: true };
      ok(await submit(t, school, bodyFor(await newToken(t, school), { applicantFirstName: "Premier", guardians: [shared] })));
      ok(await submit(t, school, bodyFor(await newToken(t, school), { applicantFirstName: "Second", guardians: [shared] })));
      const received = t.mem.sent.filter((m) => m.templateCode === "APPLICATION_RECEIVED");
      expect(received).toHaveLength(1); // un seul message : le service ne sert pas de relais de spam
      const log = await w.db.admin.query("SELECT status, error_code FROM admissions.notification_log WHERE tenant_id = $1 AND template_code = 'APPLICATION_RECEIVED' AND dedupe_key NOT LIKE 'contact:%' ORDER BY queued_at", [t.id]);
      expect(log.rows.map((r) => r.status)).toEqual(["SENT", "SKIPPED"]);
      expect(log.rows[1].error_code).toBe("CONTACT_DAILY_LIMIT");
    });

    it("CAPTCHA exigé avec un port branché : un jeton refusé est invalide, un jeton accepté passe", async () => {
      const t = await w.tenant("captcha-ok");
      t.mem.captcha = { verify: async (token) => token === "bon" };
      const { createAdmissionsDeps } = await import("../../application/deps");
      const { SystemDb } = await import("@ecoledigitale/database");
      const deps = createAdmissionsDeps({ db: w.db.tenantDb, systemDb: new SystemDb(w.db.tenantDb, { logger: noopLogger }), clock: w.clock, ports: t.mem.ports(), config: { fingerprintSecret: "secret-de-test-0123456789abcdef" } });
      const school = await openPublicForm({ ...t, deps } as TenantWorld);
      await openCampaignWith(t, { seats: { CP1: 2 } });
      unwrap(await updateSettings(deps, t.ctx(), { institutionId: t.institutionId, captchaRequired: true }));
      const token = ok(await getPublicForm(deps, { slug: school, ip: IP })).formToken;
      expect((await submitPublicApplication(deps, { slug: school, body: { ...bodyFor(token), captchaToken: "mauvais" }, ip: IP, userAgent: UA })).kind).toBe("invalid");
      const token2 = ok(await getPublicForm(deps, { slug: school, ip: IP })).formToken;
      expect((await submitPublicApplication(deps, { slug: school, body: { ...bodyFor(token2), captchaToken: "bon" }, ip: IP, userAgent: UA })).kind).toBe("ok");
    });
  });

  describe("suivi par code, pièces, offre", () => {
    it("suivi par code : statut GROSSIER, libellés de pièces, rien d'interne ; un code d'un autre établissement est introuvable", async () => {
      const { t, school } = await opened("suivi");
      unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE", label: "Acte de naissance", required: true, acceptsMime: ["application/pdf"] }));
      const res = ok(await submit(t, school, bodyFor(await newToken(t, school))));
      const track = ok(await trackApplication(t.deps, { school, trackingCode: res.trackingCode }));
      expect(admissionsPublicTrackDtoSchema.safeParse(track).success).toBe(true);
      expect(track.phase).toBe("RECEIVED");
      expect(track.missingDocuments).toEqual([expect.objectContaining({ label: "Acte de naissance", rejected: false })]);
      const blob = JSON.stringify(track);
      expect(blob).not.toMatch(/UNDER_REVIEW|SUBMITTED|stage|campaign|Diallo|Mamadou|seats/i);
      // Casse et séparateurs du code sont tolérés ; un code d'un autre établissement ne suit rien.
      expect((await trackApplication(t.deps, { school, trackingCode: res.trackingCode.toLowerCase().replace(/-/g, " ") })).kind).toBe("ok");
      const other = await opened("suivi-autre");
      expect((await trackApplication(other.t.deps, { school: other.school, trackingCode: res.trackingCode })).kind).toBe("closed");
      expect((await trackApplication(t.deps, { school: other.school, trackingCode: res.trackingCode })).kind).toBe("closed");
    });

    it("dépôt d'une pièce par la famille : type RÉEL contrôlé ; une pièce déjà acceptée ne se remplace pas ; jamais la pièce d'un autre dossier", async () => {
      const { t, school } = await opened("piece-publique");
      const req = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE", label: "Acte de naissance", required: true, acceptsMime: ["application/pdf"] }));
      const code = ok(await submit(t, school, bodyFor(await newToken(t, school)))).trackingCode;
      const forged = await uploadTrackedDocument(t.deps, { school, trackingCode: code, requirementId: req.id, fileName: "acte.pdf", bytes: EXE });
      expect(forged.kind).toBe("error");
      const good = await uploadTrackedDocument(t.deps, { school, trackingCode: code, requirementId: req.id, fileName: "acte.pdf", bytes: PDF });
      expect(good.kind).toBe("ok");
      const track = ok(await trackApplication(t.deps, { school, trackingCode: code }));
      expect(track.missingDocuments).toHaveLength(1); // déposée mais pas encore relue : toujours « à fournir » côté famille
      expect((await uploadTrackedDocument(t.deps, { school, trackingCode: "ZZZZ-ZZZZ-ZZZZ-ZZZZ", requirementId: req.id, fileName: "a.pdf", bytes: PDF })).kind).toBe("closed");
    });

    it("réponse à une offre par lien à usage unique : consultation sans donnée nominative, acceptation = saga, rejeu idempotent, refus, lien d'un autre établissement", async () => {
      const { t, school } = await opened("offre-publique");
      const campaign = await openCampaignWith(t, { seats: { CP1: 3 }, code: "C-OFFRE" });
      const app = await submittedApplication(t, campaign.id);
      await acceptApplication(t, app.id);
      const issued = unwrap(await issueOffer(t.deps, t.ctx(), app.id, { classroomId: t.rooms.cp1, conditions: "Visite médicale avant la rentrée." }));
      const view = ok(await viewOfferPublic(t.deps, { school, token: issued.responseToken }));
      expect(view).toMatchObject({ gradeLabel: "Cours préparatoire 1", classroomLabel: "CP1 A", status: "PENDING", conditions: "Visite médicale avant la rentrée." });
      expect(Object.keys(view).sort()).toEqual(["classroomLabel", "conditions", "expiresAt", "gradeLabel", "institutionName", "status"]);
      expect(JSON.stringify(view)).not.toMatch(/Konaté|Awa|Mariam/);
      const other = await opened("offre-autre");
      expect((await viewOfferPublic(other.t.deps, { school: other.school, token: issued.responseToken })).kind).toBe("closed");
      expect((await viewOfferPublic(t.deps, { school, token: "x".repeat(43) })).kind).toBe("closed");
      const accepted = ok(await respondOfferPublic(t.deps, { school, token: issued.responseToken, accept: true }));
      expect(accepted).toEqual({ status: "ACCEPTED" });
      expect(t.mem.students.size).toBe(1);
      const replay = ok(await respondOfferPublic(t.deps, { school, token: issued.responseToken, accept: true }));
      expect(replay).toEqual({ status: "ACCEPTED" });
      expect(t.mem.students.size).toBe(1);
      const refuse = await respondOfferPublic(t.deps, { school, token: issued.responseToken, accept: false });
      expect(refuse.kind).toBe("error"); // déjà acceptée : le refus tardif est impossible
      const detail = unwrap(await getApplication(t.deps, t.ctx(), app.id));
      expect(detail.stageCode).toBe("AWAITING_PAYMENT");
    });

    it("l'échec de l'acceptation publique (ex. port d'inscription en panne) est NEUTRE pour la famille et tracé pour le secrétariat ; l'offre reste en attente", async () => {
      const { t, school } = await opened("offre-panne");
      const campaign = await openCampaignWith(t, { seats: { CP1: 3 }, code: "C-PANNE" });
      const app = await submittedApplication(t, campaign.id);
      await acceptApplication(t, app.id);
      const issued = unwrap(await issueOffer(t.deps, t.ctx(), app.id, { classroomId: t.rooms.cp1 }));
      t.mem.failAt = "enrollStudent";
      const r = await respondOfferPublic(t.deps, { school, token: issued.responseToken, accept: true });
      expect(r.kind).toBe("error");
      expect((await w.db.admin.query("SELECT status FROM admissions.offers WHERE id = $1", [issued.offer.id])).rows[0].status).toBe("PENDING");
      const trace = w.audit.entries.find((e) => e.entry.action === "admissions.offer.accept_failed" && e.entry.resourceId === issued.offer.id);
      expect(trace?.entry.metadata).toMatchObject({ code: "admissions.injected_failure", via: "GUARDIAN_LINK" });
      expect(unwrap(await getApplication(t.deps, t.ctx(), app.id)).stageCode).toBe("ACCEPTED");
    });

    it("purge : jetons expirés et tentatives anciennes supprimés ; rien d'actif n'est touché", async () => {
      const { t, school } = await opened("purge");
      ok(await getPublicForm(t.deps, { slug: school, ip: IP }));
      await w.db.admin.query("ALTER TABLE admissions.public_form_sessions DISABLE TRIGGER public_form_sessions_guard");
      await w.db.admin.query("UPDATE admissions.public_form_sessions SET expires_at = now() - interval '3 days', min_ready_at = now() - interval '4 days', issued_at = now() - interval '5 days' WHERE tenant_id = $1", [t.id]);
      await w.db.admin.query("ALTER TABLE admissions.public_form_sessions ENABLE TRIGGER public_form_sessions_guard");
      ok(await getPublicForm(t.deps, { slug: school, ip: IP })); // un jeton actif
      await w.db.admin.query("INSERT INTO admissions.submission_attempts (id, tenant_id, institution_id, ip_hash, outcome, attempted_at) VALUES (gen_random_uuid(), $1, $2, $3, 'ACCEPTED', now() - interval '45 days')", [t.id, t.institutionId, "a".repeat(64)]);
      expect(await purgePublicFormData(t.deps, t.systemCtx())).toEqual({ sessions: 1, attempts: 1 });
      expect((await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.public_form_sessions WHERE tenant_id = $1", [t.id])).rows[0].n).toBe(1);
    });
  });
});

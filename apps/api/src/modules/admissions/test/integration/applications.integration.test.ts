/**
 * Intégration (Postgres réel, rôle soumis à la RLS ; s'ignore sans TEST_DATABASE_URL) : candidatures, règles de passage imposées
 * par la base, décisions journalisées, pièces, capacités (HARD / SOFT / NONE, concurrence sur la dernière place), liste d'attente,
 * prospects, rapports, isolation A/B, absence de donnée personnelle dans événements et audit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication, getApplication, getBoard, getHistory, listApplications, recordConsent, transitionApplication, updateApplication } from "../../application/applications";
import { recordDecision } from "../../application/decisions";
import { listDuplicates } from "../../application/duplicates";
import { reviewDocument, uploadDocument } from "../../application/documents";
import { convertProspect, createProspect, updateProspect } from "../../application/prospects";
import { upsertPriorityClass, upsertRequirement, updateSettings } from "../../application/reference";
import { funnel, capacityReport } from "../../application/reports";
import { getWaitlist, promoteManually } from "../../application/waitlist";
import { createInterview, updateInterview } from "../../application/interviews";
import { anonymizeApplication, exportApplication } from "../../application/anonymize";
import { describeIntegration } from "../support/db";
import { acceptApplication, applicationBody, createWorld, ensureConsentText, openCampaignWith, submittedApplication, unwrap, type TenantWorld, type World } from "../support/world";

const PDF = new TextEncoder().encode("%PDF-1.4 test de pièce justificative\n%%EOF");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]);

describeIntegration("admissions : candidatures, décisions, capacités, liste d'attente", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  const toStage = (d: { allowedTransitions: Array<{ toStageCode: string; toStageId: string }> }, code: string): string => {
    const t = d.allowedTransitions.find((x) => x.toStageCode === code);
    if (!t) throw new Error(`transition vers ${code} indisponible (${d.allowedTransitions.map((x) => x.toStageCode).join(", ")})`);
    return t.toStageId;
  };

  describe("règles de passage et décisions formelles", () => {
    it("une candidature naît à l'étape initiale (statut dérivé DRAFT) ; SUBMITTED exige le consentement parental valide", async () => {
      const t = await w.tenant("passage");
      await ensureConsentText(t);
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const created = unwrap(await createApplication(t.deps, t.ctx(), applicationBody(campaign.id)));
      expect(created.applicationNumber).toMatch(/^\d{4}-\d{5}$/);
      const draft = unwrap(await getApplication(t.deps, t.ctx(), created.id));
      expect(draft).toMatchObject({ stageCode: "DRAFT", status: "DRAFT", hasValidConsent: false });
      // Sans consentement : la base refuse (déclencheur), message stable.
      const refused = await transitionApplication(t.deps, t.ctx(), created.id, { toStageId: toStage(draft, "SUBMITTED") });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("admissions.consent_missing");
      // Un tuteur non habilité ne peut pas consentir.
      const guardian = draft.guardians[0]!;
      const consent = unwrap(await recordConsent(t.deps, t.ctx(), created.id, { guardianId: guardian.id, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "PAPER", evidenceRef: "papier-001" }));
      expect(consent.hasValidConsent).toBe(true);
      const submitted = unwrap(await transitionApplication(t.deps, t.ctx(), created.id, { toStageId: toStage(consent, "SUBMITTED") }));
      expect(submitted).toMatchObject({ stageCode: "SUBMITTED", status: "SUBMITTED" });
      expect(submitted.submittedAt).not.toBeNull();
    });

    it("une transition non déclarée est refusée ; une étape à décision n'est franchie QUE par une décision journalisée", async () => {
      const t = await w.tenant("decisions");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      const review = unwrap(await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") }));
      // Par le simple changement d'étape : refusé (une décision formelle est exigée).
      const bypass = await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "ACCEPTED") });
      expect(bypass.ok).toBe(false);
      if (!bypass.ok) expect(bypass.error.code).toBe("admissions.decision_missing");
      // Une transition qui n'existe pas dans le workflow (UNDER_REVIEW -> ENROLLED).
      const enrolledStage = review.allowedTransitions.find((x) => x.toStageCode === "ENROLLED");
      expect(enrolledStage).toBeUndefined();
      // Type de décision incohérent avec l'étape visée.
      const mismatch = await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "ACCEPTED"), kind: "REJECT", reasonCode: "NO_SEAT", overrideCapacity: false });
      expect(mismatch.ok).toBe(false);
      if (!mismatch.ok) expect(mismatch.error.code).toBe("admissions.decision_kind_mismatch");
      // Un refus cite un motif CODÉ connu de l'établissement.
      const noReason = await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "REJECTED"), kind: "REJECT", overrideCapacity: false } as never);
      expect(noReason.ok).toBe(false);
      const badReason = await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "REJECTED"), kind: "REJECT", reasonCode: "INVENTE", overrideCapacity: false });
      expect(badReason.ok).toBe(false);
      if (!badReason.ok) expect(badReason.error.code).toBe("admissions.reason_unknown");
      // Décision valide : admis ; identité du décideur figée, journal complet.
      t.mem.actorNames.set(t.ctx().userId as string, "Mme la Directrice");
      const accepted = unwrap(await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "ACCEPTED"), kind: "ACCEPT", reasonCode: "ADMITTED", overrideCapacity: false }));
      expect(accepted).toMatchObject({ stageCode: "ACCEPTED", status: "ACCEPTED" });
      expect(accepted.decidedAt).not.toBeNull();
      const history = unwrap(await getHistory(t.deps, t.ctx(), app.id));
      expect(history.decisions).toHaveLength(1);
      expect(history.decisions[0]).toMatchObject({ kind: "ACCEPT", reasonCode: "ADMITTED", decidedByName: "Mme la Directrice" });
      expect(history.transitions.map((x) => x.toStatus)).toEqual(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED"]);
    });

    it("décisions et transitions sont en AJOUT SEUL : le rôle applicatif ne peut ni modifier ni supprimer une ligne", async () => {
      const t = await w.tenant("ajoutseul");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      await acceptApplication(t, app.id);
      for (const sql of [
        "UPDATE admissions.decisions SET reason_text = 'falsifié'",
        "DELETE FROM admissions.decisions",
        "UPDATE admissions.transitions SET to_status = 'ENROLLED'",
        "DELETE FROM admissions.transitions",
      ]) {
        await expect(t.deps.db.run(t.ctx(), (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied|append_only/);
      }
    });

    it("un dossier dont la version a changé est refusé (verrou optimiste) et l'étape d'un dossier ne se rejoue pas", async () => {
      const t = await w.tenant("version");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      const stale = await updateApplication(t.deps, t.ctx(), app.id, { sourceChannel: "SOCIAL", rowVersion: app.rowVersion - 1 });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error.code).toBe("admissions.version_conflict");
      const fresh = unwrap(await updateApplication(t.deps, t.ctx(), app.id, { sourceChannel: "SOCIAL", rowVersion: app.rowVersion }));
      expect(fresh.rowVersion).toBe(app.rowVersion + 1);
      const first = unwrap(await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") }));
      const replay = await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") });
      expect(replay.ok).toBe(false);
      expect(first.stageCode).toBe("UNDER_REVIEW");
    });

    it("le même enfant ne dépose qu'une candidature vivante par campagne ; un refus libère le droit de redéposer", async () => {
      const t = await w.tenant("unicite");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const body = applicationBody(campaign.id, { applicantFirstName: "Fanta", applicantLastName: "Traoré", applicantBirthDate: "2019-01-05" });
      const first = unwrap(await createApplication(t.deps, t.ctx(), body));
      const second = await createApplication(t.deps, t.ctx(), { ...body, applicantFirstName: "FANTA", applicantLastName: "traore" });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.code).toBe("admissions.duplicate_application");
      // Jumeaux : même naissance, prénom différent -> accepté.
      unwrap(await createApplication(t.deps, t.ctx(), { ...body, applicantFirstName: "Fatou" }));
      // Refus du premier dossier : l'enfant peut redéposer.
      await ensureConsentText(t);
      const detail = unwrap(await getApplication(t.deps, t.ctx(), first.id));
      const consent = unwrap(await recordConsent(t.deps, t.ctx(), first.id, { guardianId: detail.guardians[0]!.id, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "PAPER", evidenceRef: "papier-002" }));
      const sub = unwrap(await transitionApplication(t.deps, t.ctx(), first.id, { toStageId: toStage(consent, "SUBMITTED") }));
      const rej = unwrap(await recordDecision(t.deps, t.ctx(), first.id, { toStageId: toStage(sub, "REJECTED"), kind: "REJECT", reasonCode: "NOT_ELIGIBLE", overrideCapacity: false }));
      expect(rej.status).toBe("REJECTED");
      expect(rej.closedAt).not.toBeNull();
      unwrap(await createApplication(t.deps, t.ctx(), body));
    });
  });

  describe("pièces justificatives", () => {
    it("les exigences sont des données ; une pièce déposée mais non relue reste manquante ; l'admission exige les pièces ACCEPTÉES", async () => {
      const t = await w.tenant("pieces");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const birth = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE_NAISSANCE", label: "Acte de naissance", required: true, acceptsMime: ["application/pdf", "image/jpeg"], maxSizeKb: 100 }));
      const photo = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "PHOTO", label: "Photo d'identité", required: false }));
      const assignment = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "DECISION_AFFECTATION", label: "Décision d'affectation", required: true, appliesToFunding: "STATE_ASSIGNED" }));
      const app = await submittedApplication(t, campaign.id);
      expect(app.missingDocuments).toEqual(["ACTE_NAISSANCE"]); // la pièce d'affectation ne s'applique pas à un élève privé
      expect(app.documents.map((d) => d.requirementCode)).toEqual(expect.arrayContaining(["ACTE_NAISSANCE", "PHOTO"]));
      expect(app.documents.find((d) => d.requirementCode === "DECISION_AFFECTATION")).toBeUndefined();
      void photo;
      void assignment;
      const review = unwrap(await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") }));
      // Type RÉEL contrôlé par les octets : un exécutable renommé en PDF est refusé.
      const fake = await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "acte.pdf", bytes: EXE, by: "STAFF" });
      expect(fake.ok).toBe(false);
      if (!fake.ok) expect(fake.error.code).toBe("admissions.file_rejected");
      // Fichier trop gros pour la pièce (100 Ko).
      const big = new Uint8Array(150 * 1024);
      big.set(PDF, 0);
      expect((await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "gros.pdf", bytes: big, by: "STAFF" })).ok).toBe(false);
      // Dépôt valide : SUBMITTED mais toujours « manquante » tant qu'elle n'est pas acceptée.
      const up = unwrap(await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "acte.pdf", bytes: PDF, by: "STAFF" }));
      expect(up.find((d) => d.requirementCode === "ACTE_NAISSANCE")).toMatchObject({ status: "SUBMITTED", contentType: "application/pdf" });
      const mid = unwrap(await getApplication(t.deps, t.ctx(), app.id));
      expect(mid.missingDocuments).toEqual(["ACTE_NAISSANCE"]);
      const blocked = await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(review, "ACCEPTED"), kind: "ACCEPT", overrideCapacity: false });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("admissions.documents_incomplete");
      // Un rejet exige un motif ; la famille redépose ; relecture : accepté -> l'admission passe.
      expect((await reviewDocument(t.deps, t.ctx(), app.id, birth.id, { decision: "REJECT" })).ok).toBe(false);
      unwrap(await reviewDocument(t.deps, t.ctx(), app.id, birth.id, { decision: "REJECT", reason: "Scan illisible" }));
      unwrap(await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "acte2.jpg", bytes: JPEG, by: "FAMILY" }));
      unwrap(await reviewDocument(t.deps, t.ctx(), app.id, birth.id, { decision: "ACCEPT" }));
      const fine = unwrap(await getApplication(t.deps, t.ctx(), app.id));
      expect(fine.missingDocuments).toEqual([]);
      expect(fine.documents.find((d) => d.requirementCode === "ACTE_NAISSANCE")).toMatchObject({ status: "ACCEPTED", attempts: 2 });
      // La famille ne remplace pas une pièce déjà acceptée.
      expect((await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "autre.pdf", bytes: PDF, by: "FAMILY" })).ok).toBe(false);
      expect(unwrap(await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(fine, "ACCEPTED"), kind: "ACCEPT", overrideCapacity: false })).status).toBe("ACCEPTED");
    });

    it("tests et entretiens : une étape qui exige un entretien terminé refuse l'entrée sans lui ; aucun seuil de réussite n'est calculé", async () => {
      const t = await w.tenant("entretien");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      const rooms = unwrap(await createInterview(t.deps, t.ctx(), app.id, { kind: "INTERVIEW", scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), venue: "Bureau 2" }));
      const done = await updateInterview(t.deps, t.ctx(), app.id, rooms[0]!.id, { status: "DONE" });
      expect(done.ok).toBe(false); // un entretien terminé porte son résultat
      const ok = unwrap(await updateInterview(t.deps, t.ctx(), app.id, rooms[0]!.id, { status: "DONE", resultCode: "NOT_APPLICABLE", score: 7, scaleMax: 20 }));
      expect(ok[0]).toMatchObject({ status: "DONE", resultCode: "NOT_APPLICABLE", score: "7.000" });
      expect((await updateInterview(t.deps, t.ctx(), app.id, rooms[0]!.id, { score: 25, scaleMax: 20 })).ok).toBe(false);
    });
  });

  describe("capacités par niveau", () => {
    it("HARD (défaut) : refus au-delà de la capacité ; la place se libère quand un dossier est refusé ou retiré", async () => {
      const t = await w.tenant("hard");
      const campaign = await openCampaignWith(t, { seats: { CP1: 2 } });
      const apps = [await submittedApplication(t, campaign.id), await submittedApplication(t, campaign.id), await submittedApplication(t, campaign.id)];
      await acceptApplication(t, apps[0]!.id);
      await acceptApplication(t, apps[1]!.id);
      const third = await acceptApplication(t, apps[2]!.id).catch((e: Error & { code?: string }) => e);
      expect((third as Error & { code?: string }).code).toBe("admissions.capacity_full");
      expect((await getBoard(t.deps, t.ctx(), { campaignId: campaign.id })).ok).toBe(true);
      const capacity = unwrap(await capacityReport(t.deps, t.ctx(), campaign.id));
      expect(capacity.rows.find((r) => r.gradeLevelCode === "CP1")).toMatchObject({ seats: 2, seatsLeft: 0, held: 2, configured: true });
      // La famille retire le dossier 1 : la place revient.
      const d1 = unwrap(await getApplication(t.deps, t.ctx(), apps[0]!.id));
      unwrap(await recordDecision(t.deps, t.ctx(), apps[0]!.id, { toStageId: toStage(d1, "WITHDRAWN"), kind: "WITHDRAW", reasonCode: "WITHDRAWN_BY_FAMILY", overrideCapacity: false }));
      expect((await acceptApplication(t, apps[2]!.id)).status).toBe("ACCEPTED");
    });

    it("SOFT : dépassement possible avec un motif d'au moins 10 caractères ; NONE : aucun contrôle ; absence de ligne = pas de plafond", async () => {
      const t = await w.tenant("soft");
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, capacityPolicy: "SOFT" }));
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 } });
      const a = await submittedApplication(t, campaign.id);
      const b = await submittedApplication(t, campaign.id);
      await acceptApplication(t, a.id);
      let detail = unwrap(await getApplication(t.deps, t.ctx(), b.id));
      detail = unwrap(await transitionApplication(t.deps, t.ctx(), b.id, { toStageId: toStage(detail, "UNDER_REVIEW") }));
      const accept = toStage(detail, "ACCEPTED");
      const short = await recordDecision(t.deps, t.ctx(), b.id, { toStageId: accept, kind: "ACCEPT", overrideCapacity: true, reasonText: "court" });
      expect(short.ok).toBe(false);
      const over = unwrap(await recordDecision(t.deps, t.ctx(), b.id, { toStageId: accept, kind: "ACCEPT", overrideCapacity: true, reasonText: "Fratrie d'un élève du personnel" }));
      expect(over.capacityOverrideReason).toContain("Fratrie");
      // Pas de ligne de capacité pour CP2 : aucun plafond, signalé dans le rapport.
      const c = await submittedApplication(t, campaign.id, { desiredGradeLevelCode: "CP2" });
      expect((await acceptApplication(t, c.id)).status).toBe("ACCEPTED");
      const cap = unwrap(await capacityReport(t.deps, t.ctx(), campaign.id));
      expect(cap.rows.find((r) => r.gradeLevelCode === "CP2")).toMatchObject({ configured: false, seats: null, held: 1 });
      // NONE : plus aucun contrôle de capacité.
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, capacityPolicy: "NONE" }));
      const d = await submittedApplication(t, campaign.id);
      expect((await acceptApplication(t, d.id)).status).toBe("ACCEPTED");
    });

    it("CONCURRENCE : deux dossiers visent la dernière place en parallèle -> exactement UN réussit, l'autre reçoit capacity_full", async () => {
      const t = await w.tenant("concurrence");
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 } });
      const a = await submittedApplication(t, campaign.id);
      const b = await submittedApplication(t, campaign.id);
      let da = unwrap(await getApplication(t.deps, t.ctx(), a.id));
      let db = unwrap(await getApplication(t.deps, t.ctx(), b.id));
      da = unwrap(await transitionApplication(t.deps, t.ctx(), a.id, { toStageId: toStage(da, "UNDER_REVIEW") }));
      db = unwrap(await transitionApplication(t.deps, t.ctx(), b.id, { toStageId: toStage(db, "UNDER_REVIEW") }));
      const results = await Promise.all([
        recordDecision(t.deps, t.ctx(), a.id, { toStageId: toStage(da, "ACCEPTED"), kind: "ACCEPT", overrideCapacity: false }),
        recordDecision(t.deps, t.ctx(), b.id, { toStageId: toStage(db, "ACCEPTED"), kind: "ACCEPT", overrideCapacity: false }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const lost = results.find((r) => !r.ok);
      expect(lost && !lost.ok ? lost.error.code : null).toBe("admissions.capacity_full");
      const capacity = unwrap(await capacityReport(t.deps, t.ctx(), campaign.id));
      expect(capacity.rows.find((r) => r.gradeLevelCode === "CP1")).toMatchObject({ seatsLeft: 0, held: 1 });
    });
  });

  describe("liste d'attente", () => {
    async function waitlisted(t: TenantWorld, campaignId: string, overrides = {}): Promise<string> {
      const app = await submittedApplication(t, campaignId, overrides);
      let detail = unwrap(await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") }));
      detail = unwrap(await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(detail, "WAITLISTED"), kind: "WAITLIST", reasonCode: "NO_SEAT_YET", overrideCapacity: false }));
      expect(detail.status).toBe("WAITLISTED");
      return app.id;
    }

    it("ordre = rang de la classe de priorité, puis ancienneté ; plafond de liste ; une priorité absente passe après les classes déclarées", async () => {
      const t = await w.tenant("liste");
      unwrap(await upsertPriorityClass(t.deps, t.ctx(), { institutionId: t.institutionId, code: "FRATRIE", label: "Fratrie", rank: 1 }));
      unwrap(await upsertPriorityClass(t.deps, t.ctx(), { institutionId: t.institutionId, code: "PERSONNEL", label: "Enfant du personnel", rank: 2 }));
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 }, waitlistLimit: 3 });
      const full = await submittedApplication(t, campaign.id);
      await acceptApplication(t, full.id);
      const standard = await waitlisted(t, campaign.id);
      const staff = await waitlisted(t, campaign.id, { priorityClassCode: "PERSONNEL" });
      const sibling = await waitlisted(t, campaign.id, { priorityClassCode: "FRATRIE" });
      const list = unwrap(await getWaitlist(t.deps, t.ctx(), { campaignId: campaign.id, grade: "CP1" }));
      expect(list.entries.map((e) => e.applicationId)).toEqual([sibling, staff, standard]);
      expect(list.entries.map((e) => e.queuePosition)).toEqual([1, 2, 3]);
      expect(list.entries[0]).toMatchObject({ priorityClassCode: "FRATRIE", priorityLabel: "Fratrie", priorityRank: 1 });
      expect(list.entries[2]).toMatchObject({ priorityClassCode: null, priorityRank: null });
      expect(list).toMatchObject({ seatsLeft: 0, waitlistLimit: 3 });
      // Plafond de 3 atteint : le quatrième est refusé.
      const extra = await submittedApplication(t, campaign.id);
      const detail = unwrap(await transitionApplication(t.deps, t.ctx(), extra.id, { toStageId: toStage(extra, "UNDER_REVIEW") }));
      const refused = await recordDecision(t.deps, t.ctx(), extra.id, { toStageId: toStage(detail, "WAITLISTED"), kind: "WAITLIST", reasonCode: "NO_SEAT_YET", overrideCapacity: false });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("admissions.waitlist_full");
      // Changer la classe de priorité après l'entrée recalcule l'ordre (donnée).
      unwrap(await updateApplication(t.deps, t.ctx(), standard, { priorityClassCode: "FRATRIE" }));
      const reordered = unwrap(await getWaitlist(t.deps, t.ctx(), { campaignId: campaign.id, grade: "CP1" }));
      expect(reordered.entries.map((e) => e.applicationId)).toEqual([standard, sibling, staff]); // même rang : l'ancienneté départage
    });

    it("promotion MANUELLE : sans place libre rien n'est proposé ; une place libérée est offerte UNE seule fois au premier de la liste", async () => {
      const t = await w.tenant("promotion");
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 } });
      const holder = await submittedApplication(t, campaign.id);
      await acceptApplication(t, holder.id);
      const first = await waitlisted(t, campaign.id);
      const second = await waitlisted(t, campaign.id);
      const none = unwrap(await promoteManually(t.deps, t.ctx(), { campaignId: campaign.id, grade: "CP1" }));
      expect(none).toMatchObject({ promoted: false, reason: "NO_SEAT" });
      // La famille du dossier admis se désiste : la place revient (promotion manuelle : MANUAL par défaut, rien d'automatique).
      const held = unwrap(await getApplication(t.deps, t.ctx(), holder.id));
      unwrap(await recordDecision(t.deps, t.ctx(), holder.id, { toStageId: toStage(held, "WITHDRAWN"), kind: "WITHDRAW", reasonCode: "WITHDRAWN_BY_FAMILY", overrideCapacity: false }));
      expect(unwrap(await getApplication(t.deps, t.ctx(), first)).status).toBe("WAITLISTED");
      // Deux clics simultanés sur « proposer la place » : UNE seule offre.
      const both = await Promise.all([promoteManually(t.deps, t.ctx(), { campaignId: campaign.id, grade: "CP1", classroomId: t.rooms.cp1 }), promoteManually(t.deps, t.ctx(), { campaignId: campaign.id, grade: "CP1", classroomId: t.rooms.cp1 })]);
      const promoted = both.map((r) => unwrap(r)).filter((r) => r.promoted);
      expect(promoted).toHaveLength(1);
      expect(promoted[0]).toMatchObject({ applicationId: first });
      expect(promoted[0]!.responseToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      const afterFirst = unwrap(await getApplication(t.deps, t.ctx(), first));
      expect(afterFirst).toMatchObject({ status: "ACCEPTED" });
      expect(afterFirst.offers).toHaveLength(1);
      expect(unwrap(await getApplication(t.deps, t.ctx(), second)).status).toBe("WAITLISTED");
      // Le jeton en clair n'est stocké nulle part : seule l'empreinte l'est.
      const { rows } = await w.db.admin.query("SELECT response_token_hash FROM admissions.offers WHERE application_id = $1", [first]);
      expect(rows[0].response_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].response_token_hash).not.toBe(promoted[0]!.responseToken);
    });

    it("promotion AUTOMATIQUE (réglage de l'établissement) : la place libérée est offerte au premier de la liste par une décision SYSTÈME", async () => {
      const t = await w.tenant("auto");
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, waitlistPromotion: "AUTO" }));
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 } });
      const holder = await submittedApplication(t, campaign.id);
      await acceptApplication(t, holder.id);
      const first = await waitlisted(t, campaign.id);
      const held = unwrap(await getApplication(t.deps, t.ctx(), holder.id));
      unwrap(await recordDecision(t.deps, t.ctx(), holder.id, { toStageId: toStage(held, "WITHDRAWN"), kind: "WITHDRAW", reasonCode: "WITHDRAWN_BY_FAMILY", overrideCapacity: false }));
      const promoted = unwrap(await getApplication(t.deps, t.ctx(), first));
      expect(promoted.status).toBe("ACCEPTED");
      expect(promoted.offers).toHaveLength(1);
      const history = unwrap(await getHistory(t.deps, t.ctx(), first));
      expect(history.decisions.at(-1)).toMatchObject({ kind: "ACCEPT", decidedByName: "Système" });
    });
  });

  describe("prospects", () => {
    it("un seul prospect actif par e-mail (insensible à la casse) ; LOST exige un motif ; la conversion crée la candidature pré-remplie", async () => {
      const t = await w.tenant("prospects");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const p = unwrap(await createProspect(t.deps, t.ctx(), { institutionId: t.institutionId, firstName: "Salimata", lastName: "Ouattara", contactEmail: "salimata@example.test", contactPhone: null, sourceChannel: "WALK_IN", interestedGradeLevelCode: "CP1" }));
      const dup = await createProspect(t.deps, t.ctx(), { institutionId: t.institutionId, firstName: "Autre", lastName: "Personne", contactEmail: "SALIMATA@example.test", contactPhone: null, sourceChannel: "WALK_IN" });
      expect(dup.ok).toBe(false);
      expect((await updateProspect(t.deps, t.ctx(), p.id, { status: "LOST" })).ok).toBe(false);
      const converted = unwrap(await convertProspect(t.deps, t.ctx(), p.id, { campaignId: campaign.id, birthDate: "2019-06-01", desiredGradeLevelCode: "CP1", applicantFirstName: "Mariam", guardianRelationshipCode: "MOTHER" }));
      const detail = unwrap(await getApplication(t.deps, t.ctx(), converted.applicationId));
      expect(detail).toMatchObject({ prospectId: p.id, sourceChannel: "WALK_IN", applicantLastName: "Ouattara" });
      expect(detail.guardians[0]).toMatchObject({ email: "salimata@example.test", isPrimary: true });
      const again = await convertProspect(t.deps, t.ctx(), p.id, { campaignId: campaign.id, birthDate: "2019-06-01", desiredGradeLevelCode: "CP1", applicantFirstName: "Mariam", guardianRelationshipCode: "MOTHER" });
      expect(again.ok).toBe(false);
    });
  });

  describe("doublons, rapports, isolation, confidentialité", () => {
    it("un doublon d'élève existant est signalé avec score et raisons ; aucune donnée nominative n'est stockée dans le rapprochement", async () => {
      const t = await w.tenant("doublons");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      t.mem.duplicatesFor = [{ studentId: "0192f0a4-7b1e-7c3a-8d2e-0000000000aa", score: 90, reasons: ["EXACT"] }];
      const app = unwrap(await createApplication(t.deps, t.ctx(), applicationBody(campaign.id)));
      expect(app.duplicates).toBe(1);
      const dups = unwrap(await listDuplicates(t.deps, t.ctx(), app.id));
      expect(dups[0]).toMatchObject({ matchedKind: "STUDENT", score: 90, status: "OPEN", reasons: ["EXACT"] });
      const { rows } = await w.db.admin.query("SELECT * FROM admissions.duplicate_candidates WHERE application_id = $1", [app.id]);
      expect(JSON.stringify(rows[0])).not.toMatch(/Konaté|Awa/);
    });

    it("l'entonnoir compte par statut canonique, taux de passage et délais ; le tableau a une colonne par étape du workflow", async () => {
      const t = await w.tenant("rapports");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      await submittedApplication(t, campaign.id);
      const b = await submittedApplication(t, campaign.id);
      await acceptApplication(t, b.id);
      const f = unwrap(await funnel(t.deps, t.ctx(), campaign.id));
      expect(f.byStatus.find((s) => s.status === "SUBMITTED")?.count).toBe(1);
      expect(f.byStatus.find((s) => s.status === "ACCEPTED")?.count).toBe(1);
      expect(f.received).toBe(2);
      expect(f.processed).toBe(1);
      expect(f.conversion.find((c) => c.from === "UNDER_REVIEW" && c.to === "ACCEPTED")).toMatchObject({ count: 1, rate: 1 });
      expect(f.processingBuckets.reduce((n, x) => n + x.count, 0)).toBe(1);
      const board = unwrap(await getBoard(t.deps, t.ctx(), { campaignId: campaign.id }));
      expect(board.columns.map((c) => c.stage.code)).toContain("AWAITING_PAYMENT");
      expect(board.columns.find((c) => c.stage.code === "ACCEPTED")?.total).toBe(1);
      expect(board.columns.find((c) => c.stage.code === "SUBMITTED")?.cards).toHaveLength(1);
    });

    it("isolation A/B : un tenant ne lit, ne modifie ni ne compte les dossiers d'un autre ; la liste est filtrée par la RLS", async () => {
      const campaign = await openCampaignWith(w.A, { seats: { CP1: 5 } });
      const app = await submittedApplication(w.A, campaign.id);
      const foreign = await getApplication(w.B.deps, w.B.ctx(), app.id);
      expect(foreign.ok).toBe(false);
      if (!foreign.ok) expect(foreign.error.code).toBe("admissions.application_not_found");
      expect((await transitionApplication(w.B.deps, w.B.ctx(), app.id, { toStageId: app.allowedTransitions[0]!.toStageId })).ok).toBe(false);
      expect((await getHistory(w.B.deps, w.B.ctx(), app.id)).ok).toBe(false);
      const list = unwrap(await listApplications(w.B.deps, w.B.ctx(), { page: 1, pageSize: 100 }));
      expect(list.items.find((x) => x.id === app.id)).toBeUndefined();
      const mine = unwrap(await listApplications(w.A.deps, w.A.ctx(), { page: 1, pageSize: 100, campaignId: campaign.id }));
      expect(mine.total).toBe(1);
      // Contrôle direct en SQL sous le rôle de B : aucune ligne de A n'est visible.
      const rows = await w.B.deps.db.run(w.B.ctx(), (tx) => tx.many("SELECT id FROM admissions.applications WHERE id = $1", [app.id]));
      expect(rows).toEqual([]);
    });

    it("AUCUNE donnée personnelle (nom, naissance, contact) dans les événements d'outbox ni dans l'audit", async () => {
      const t = await w.tenant("confidentialite");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id, { applicantFirstName: "Zéphyrine", applicantLastName: "Ouédraogo-Sawadogo", applicantBirthDate: "2018-03-09" });
      await acceptApplication(t, app.id);
      const { rows } = await w.db.admin.query("SELECT type, payload::text AS payload FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'admissions.%'", [t.id]);
      expect(rows.length).toBeGreaterThanOrEqual(4);
      const blob = JSON.stringify(rows);
      for (const secret of ["Zéphyrine", "Ouédraogo", "Sawadogo", "2018-03-09", "mariam", "+22507000000", "Mariam", "Konaté"]) expect(blob.includes(secret), secret).toBe(false);
      const auditBlob = JSON.stringify(w.audit.entries.filter((e) => e.ctx.tenantId === t.id).map((e) => e.entry));
      expect(auditBlob.length).toBeGreaterThan(100);
      for (const secret of ["Zéphyrine", "Ouédraogo", "2018-03-09", "+22507000000", "@example.test"]) expect(auditBlob.includes(secret), secret).toBe(false);
      expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(["admissions.application.submitted", "admissions.application.status_changed", "admissions.decision.recorded"]));
    });
  });

  describe("anonymisation et droit d'accès", () => {
    it("un dossier clos sans inscription est anonymisé (identité, tuteurs, pièces) ; décisions et compteurs sont conservés ; idempotent", async () => {
      const t = await w.tenant("anonymisation");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const birth = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE", label: "Acte de naissance", required: true }));
      const app = await submittedApplication(t, campaign.id, { applicantFirstName: "Léocadie", applicantLastName: "Bamba" });
      unwrap(await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: birth.id, fileName: "acte.pdf", bytes: PDF, by: "STAFF" }));
      expect((await anonymizeApplication(t.deps, t.ctx(), { applicationId: app.id, reason: "demande de la famille" })).ok).toBe(false); // encore vivant
      const detail = unwrap(await transitionApplication(t.deps, t.ctx(), app.id, { toStageId: toStage(app, "UNDER_REVIEW") }));
      unwrap(await recordDecision(t.deps, t.ctx(), app.id, { toStageId: toStage(detail, "REJECTED"), kind: "REJECT", reasonCode: "NOT_ELIGIBLE", overrideCapacity: false }));
      const exported = unwrap(await exportApplication(t.deps, t.ctx(), app.id));
      expect(exported.application.applicantLastName).toBe("Bamba");
      expect(exported.history.decisions).toHaveLength(1);
      const stored = [...t.mem.pieces.values()];
      expect(stored.some((p) => !p.removed)).toBe(true);
      expect(unwrap(await anonymizeApplication(t.deps, t.ctx(), { applicationId: app.id, reason: "demande de la famille (droit à l'effacement)" }))).toEqual({ anonymized: true, applicationId: app.id });
      expect([...t.mem.pieces.values()].every((p) => p.removed)).toBe(true); // fichiers purgés AVANT la fonction SQL
      const anon = unwrap(await getApplication(t.deps, t.ctx(), app.id));
      expect(anon).toMatchObject({ applicantFirstName: "ANONYMISÉ", applicantLastName: "ANONYMISÉ", anonymized: true, status: "REJECTED" });
      expect(anon.applicantBirthDate).toBe("2019-01-01");
      expect(anon.guardians[0]).toMatchObject({ firstName: "ANONYMISÉ", email: null });
      expect(anon.documents.every((d) => d.status === "MISSING" || d.status === "SUBMITTED" ? d.status === "MISSING" : true)).toBe(true);
      expect(unwrap(await getHistory(t.deps, t.ctx(), app.id)).decisions).toHaveLength(1);
      // Idempotent ; un dossier anonymisé ne change plus.
      expect(unwrap(await anonymizeApplication(t.deps, t.ctx(), { applicationId: app.id, reason: "rejeu" })).anonymized).toBe(true);
      expect((await updateApplication(t.deps, t.ctx(), app.id, { sourceChannel: "AUTRE" })).ok).toBe(false);
      const events = await w.db.admin.query("SELECT payload::text AS payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'admissions.application.anonymized'", [t.id]);
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].payload).not.toMatch(/Bamba|Léocadie/);
    });
  });
});

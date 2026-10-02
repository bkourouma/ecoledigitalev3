/**
 * Intégration (Postgres réel ; s'ignore sans TEST_DATABASE_URL) : offres d'admission et SAGA d'inscription — création atomique de
 * l'élève INACTIF, de ses tuteurs, de l'inscription PENDING et de la facture, rejeu idempotent, annulation totale à chaque étape en
 * échec, ENROLLED DÉRIVÉ de la confirmation (une seule fois), expiration, délai de paiement, refus de la famille, doublons.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import { getApplication, getHistory, transitionApplication } from "../../application/applications";
import { recordDecision } from "../../application/decisions";
import { listDuplicates, resolveDuplicate } from "../../application/duplicates";
import { handleEnrollmentConfirmed, handleEnrollmentEnded } from "../../application/enrollment-events";
import { enforcePaymentDeadline, expireOffers } from "../../application/jobs";
import { acceptOffer, declineOffer, issueOffer, setOfferClassroom, withdrawOffer } from "../../application/offers";
import { updateSettings } from "../../application/reference";
import type { FailPoint } from "../../infrastructure/in-memory-ports";
import { describeIntegration } from "../support/db";
import { acceptApplication, createWorld, openCampaignWith, submittedApplication, unwrap, YEAR_ID, type TenantWorld, type World } from "../support/world";

describeIntegration("admissions : offres et saga d'inscription", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  interface Ready {
    t: TenantWorld;
    campaignId: string;
    appId: string;
    offerId: string;
    token: string;
  }

  async function ready(slug: string, options: { seats?: number; classroom?: boolean; applicant?: Parameters<typeof submittedApplication>[2] } = {}): Promise<Ready> {
    const t = await w.tenant(slug);
    // Sans classe désignée, une classe UNIQUE du niveau est retenue d'office ; avec DEUX classes le secrétariat doit choisir.
    if (options.classroom === false) t.mem.addClassroom({ institutionId: t.institutionId, academicYearId: YEAR_ID, gradeLevelCode: "CP1", label: "CP1 B" });
    const campaign = await openCampaignWith(t, { seats: { CP1: options.seats ?? 3 } });
    const app = await submittedApplication(t, campaign.id, options.applicant);
    await acceptApplication(t, app.id);
    const issued = unwrap(await issueOffer(t.deps, t.ctx(), app.id, { ...(options.classroom === false ? {} : { classroomId: t.rooms.cp1 }) }));
    return { t, campaignId: campaign.id, appId: app.id, offerId: issued.offer.id, token: issued.responseToken };
  }

  const stateOf = async (r: Ready) => {
    const { rows } = await w.db.admin.query("SELECT s.code AS stage, a.status, a.student_id, a.enrollment_id, a.invoice_id, a.enrollment_confirmed_at, o.status AS offer_status FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id LEFT JOIN admissions.offers o ON o.application_id = a.id WHERE a.id = $1", [r.appId]);
    return rows[0] as { stage: string; status: string; student_id: string | null; enrollment_id: string | null; invoice_id: string | null; enrollment_confirmed_at: Date | null; offer_status: string };
  };
  const eventTypes = async (r: Ready): Promise<string[]> => (await w.db.admin.query("SELECT type FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'admissions.%' ORDER BY occurred_at, id", [r.t.id])).rows.map((x) => x.type as string);

  describe("émission de l'offre", () => {
    it("le lien de réponse est à usage unique : le secret n'est jamais stocké (empreinte seule) ; une seule offre en attente ; échéance = politique de l'établissement", async () => {
      const r = await ready("emission");
      const { rows } = await w.db.admin.query("SELECT response_token_hash, expires_at, issued_at FROM admissions.offers WHERE id = $1", [r.offerId]);
      expect(rows[0].response_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.token).not.toContain(rows[0].response_token_hash);
      const days = (rows[0].expires_at.getTime() - rows[0].issued_at.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(14); // valeur par défaut du RÉGLAGE, jamais une constante du code
      const second = await issueOffer(r.t.deps, r.t.ctx(), r.appId, { classroomId: r.t.rooms.cp1 });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.code).toBe("admissions.offer_exists");
      // Un message part par le port (jamais de simulation) : lien dans le FRAGMENT, adresse non stockée.
      const sent = r.t.mem.sent.find((m) => m.templateCode === "OFFER_ISSUED");
      expect(String(sent?.data["link"])).toContain("#t=");
      const log = await w.db.admin.query("SELECT status, error_code, to_jsonb(n)::text AS row FROM admissions.notification_log n WHERE application_id = $1 AND template_code = 'OFFER_ISSUED'", [r.appId]);
      expect(log.rows[0].status).toBe("SENT");
      expect(log.rows[0].row).not.toMatch(/example\.test|\+2250/);
    });

    it("sans canal de notification : la ligne est SKIPPED / CHANNEL_UNAVAILABLE (aucune simulation d'envoi)", async () => {
      const t = await w.tenant("sans-canal");
      t.mem.notifierEnabled = false;
      const campaign = await openCampaignWith(t, { seats: { CP1: 3 } });
      const app = await submittedApplication(t, campaign.id);
      await acceptApplication(t, app.id);
      const issued = unwrap(await issueOffer(t.deps, t.ctx(), app.id, { classroomId: t.rooms.cp1 }));
      expect(issued.notified).toBe("SKIPPED");
      const log = await w.db.admin.query("SELECT status, error_code FROM admissions.notification_log WHERE application_id = $1 AND template_code = 'OFFER_ISSUED'", [app.id]);
      expect(log.rows[0]).toMatchObject({ status: "SKIPPED", error_code: "CHANNEL_UNAVAILABLE" });
      expect(t.mem.sent).toHaveLength(0);
    });

    it("une offre se retire ; une offre retirée ou échue n'est plus acceptable", async () => {
      const r = await ready("retrait");
      unwrap(await withdrawOffer(r.t.deps, r.t.ctx(), r.offerId, "Erreur de saisie de la classe"));
      const accept = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
      expect(accept.ok).toBe(false);
      if (!accept.ok) expect(accept.error.code).toBe("admissions.offer_not_pending");
      const again = unwrap(await issueOffer(r.t.deps, r.t.ctx(), r.appId, { classroomId: r.t.rooms.cp1, validityDays: 3 }));
      w.clock.advanceDays(4);
      const late = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: again.offer.id, via: "GUARDIAN_LINK" });
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.error.code).toBe("admissions.offer_expired");
      w.clock.advanceDays(-4);
    });

    it("la classe visée doit être du bon niveau, de l'établissement et ouverte ; sans classe désignée l'acceptation est refusée", async () => {
      const r = await ready("classe", { classroom: false });
      const none = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.error.code).toBe("admissions.classroom_required");
      const wrongGrade = await setOfferClassroom(r.t.deps, r.t.ctx(), r.offerId, r.t.rooms.cp2);
      expect(wrongGrade.ok).toBe(false);
      if (!wrongGrade.ok) expect(wrongGrade.error.code).toBe("admissions.classroom_invalid");
      const foreign = await setOfferClassroom(r.t.deps, r.t.ctx(), r.offerId, w.A.rooms.cp1);
      expect(foreign.ok).toBe(false);
      expect(unwrap(await setOfferClassroom(r.t.deps, r.t.ctx(), r.offerId, r.t.rooms.cp1)).classroomId).toBe(r.t.rooms.cp1);
    });
  });

  describe("saga d'acceptation (une transaction)", () => {
    it("crée ATOMIQUEMENT élève INACTIF + tuteurs + inscription PENDING + facture ; le dossier passe à l'étape qui crée l'inscription", async () => {
      const r = await ready("saga");
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      expect(out).toMatchObject({ replayed: false, status: "ACCEPTED" });
      expect(out.invoiceId).not.toBeNull();
      const st = await stateOf(r);
      expect(st).toMatchObject({ stage: "AWAITING_PAYMENT", status: "ACCEPTED", offer_status: "ACCEPTED" });
      expect(st.student_id).toBe(out.studentId);
      expect(st.enrollment_id).toBe(out.enrollmentId);
      expect(st.enrollment_confirmed_at).toBeNull(); // ENROLLED est DÉRIVÉ de la confirmation, jamais posé ici
      const student = r.t.mem.students.get(out.studentId)!;
      expect(student.status).toBe("INACTIVE");
      expect(student.externalRef).toBe(`admissions-offer-${r.offerId}`);
      expect(student.guardians).toHaveLength(1);
      expect(student.guardians[0]).toMatchObject({ relationshipCode: "MOTHER", isPrimaryContact: true, isFinancialResponsible: true });
      expect([...r.t.mem.enrollments.values()][0]).toMatchObject({ status: "PENDING", classroomId: r.t.rooms.cp1 });
      expect([...r.t.mem.enrollments.values()][0]!.input).toMatchObject({ applicationId: r.appId, fundingType: "PRIVATE" });
      expect(r.t.mem.invoices.size).toBe(1);
      // Aucun matricule n'est généré par admissions : il vient de `people`.
      expect(student.number).toMatch(/^MAT-/);
      expect(await eventTypes(r)).toEqual(expect.arrayContaining(["admissions.offer.accepted", "admissions.application.status_changed"]));
      // Les tuteurs du dossier restent consultables ; l'identité du candidat est GELÉE (la source de vérité devient people).
      const frozen = await getApplication(r.t.deps, r.t.ctx(), r.appId);
      expect(frozen.ok && frozen.value.studentId).toBe(out.studentId);
      await expect(r.t.deps.db.run(r.t.ctx(), (tx) => tx.query("UPDATE admissions.applications SET applicant_last_name = 'AUTRE' WHERE id = $1", [r.appId]))).rejects.toThrow(/application_frozen_after_enrollment/);
    });

    it("idempotent par offre : un rejeu renvoie le même résultat sans rien recréer", async () => {
      const r = await ready("rejeu");
      const first = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      const again = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      expect(again).toMatchObject({ replayed: true, studentId: first.studentId, enrollmentId: first.enrollmentId, invoiceId: first.invoiceId });
      expect(r.t.mem.students.size).toBe(1);
      expect(r.t.mem.enrollments.size).toBe(1);
      expect(r.t.mem.invoices.size).toBe(1);
    });

    const POINTS: FailPoint[] = ["findDuplicates", "createStudent", "createGuardian", "linkGuardian", "enrollStudent", "issueInvoice"];
    for (const point of POINTS) {
      it(`ÉCHEC à l'étape « ${point} » : rien n'est créé en base, l'offre reste en attente, l'appel est rejouable`, async () => {
        const r = await ready(`echec-${point.toLowerCase()}`);
        r.t.mem.failAt = point;
        const failed = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
        expect(failed.ok).toBe(false);
        if (!failed.ok) expect(failed.error.code).toBe("admissions.injected_failure");
        const st = await stateOf(r);
        expect(st).toMatchObject({ stage: "ACCEPTED", offer_status: "PENDING", student_id: null, enrollment_id: null, invoice_id: null });
        expect(await eventTypes(r)).not.toContain("admissions.offer.accepted");
        const pending = await w.db.admin.query("SELECT count(*)::int AS n FROM admissions.notification_log WHERE application_id = $1 AND template_code = 'OFFER_ACCEPTED'", [r.appId]);
        expect(pending.rows[0].n).toBe(0);
        // Rejouable : la panne est levée, l'acceptation aboutit (l'élève déjà créé en mémoire est retrouvé par sa clé d'idempotence).
        const retry = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
        expect(retry.replayed).toBe(false);
        expect(r.t.mem.students.size).toBe(1);
        expect((await stateOf(r)).stage).toBe("AWAITING_PAYMENT");
      });
    }

    it("sans port people / academic / finance branché : échec FERMÉ (admissions.port_unavailable), rien n'est créé", async () => {
      const r = await ready("ports-absents");
      const { createAdmissionsDeps } = await import("../../application/deps");
      const { SystemDb } = await import("@ecoledigitale/database");
      const bare = createAdmissionsDeps({ db: w.db.tenantDb, systemDb: new SystemDb(w.db.tenantDb, { logger: noopLogger }), clock: w.clock, ports: { catalog: r.t.mem.catalog_, documents: r.t.mem.documents_ } });
      const failed = await acceptOffer(bare, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.code).toBe("admissions.port_unavailable");
      expect(await stateOf(r)).toMatchObject({ stage: "ACCEPTED", offer_status: "PENDING", student_id: null });
    });

    it("l'acceptation par délégation du secrétariat exige une pièce justificative et trace qui a accepté", async () => {
      const r = await ready("delegation");
      const noEvidence = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "STAFF_DELEGATION" });
      expect(noEvidence.ok).toBe(false);
      const detail = unwrap(await getApplication(r.t.deps, r.t.ctx(), r.appId));
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "STAFF_DELEGATION", guardianId: detail.guardians[0]!.id, evidenceRef: "courrier-signe-2026-017" }));
      expect(out.replayed).toBe(false);
      const audit = w.audit.entries.find((e) => e.entry.action === "admissions.offer.accept" && e.entry.resourceId === r.offerId);
      expect(audit?.entry.metadata).toMatchObject({ via: "STAFF_DELEGATION", evidenceRef: "courrier-signe-2026-017" });
    });

    it("le sexe du candidat est obligatoire pour créer le dossier de l'élève (people l'exige)", async () => {
      const r = await ready("sexe", { applicant: { applicantGender: null } });
      const failed = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.code).toBe("admissions.applicant_gender_required");
      expect(r.t.mem.students.size).toBe(0);
    });

    it("aucun frais d'inscription dû : aucune facture, l'inscription est confirmée d'emblée par academic", async () => {
      const r = await ready("sans-frais");
      r.t.mem.feeDue = false;
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      expect(out.invoiceId).toBeNull();
      expect([...r.t.mem.enrollments.values()][0]?.status).toBe("ACTIVE");
      // academic a publié `academic.enrollment.confirmed` dans la même transaction : le dossier passe à ENROLLED.
      const done = unwrap(await handleEnrollmentConfirmed(r.t.deps, r.t.systemCtx(), { enrollmentId: out.enrollmentId }));
      expect(done.alreadyEnrolled).toBe(false);
      expect((await stateOf(r)).status).toBe("ENROLLED");
    });
  });

  describe("ENROLLED dérivé de la confirmation de l'inscription", () => {
    it("academic.enrollment.confirmed : dossier ENROLLED (acteur SYSTÈME), élève activé, pièces rattachées ; un événement en double ne produit qu'UN passage", async () => {
      const r = await ready("confirmation");
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      const first = unwrap(await handleEnrollmentConfirmed(r.t.deps, r.t.systemCtx(), { enrollmentId: out.enrollmentId, studentId: out.studentId }));
      expect(first).toMatchObject({ ignored: false, alreadyEnrolled: false, applicationId: r.appId });
      const st = await stateOf(r);
      expect(st).toMatchObject({ stage: "ENROLLED", status: "ENROLLED" });
      expect(st.enrollment_confirmed_at).not.toBeNull();
      expect(r.t.mem.students.get(out.studentId)!.status).toBe("ACTIVE");
      const history = unwrap(await getHistory(r.t.deps, r.t.ctx(), r.appId));
      expect(history.transitions.at(-1)).toMatchObject({ toStatus: "ENROLLED", actorKind: "SYSTEM" });
      const again = unwrap(await handleEnrollmentConfirmed(r.t.deps, r.t.systemCtx(), { enrollmentId: out.enrollmentId }));
      expect(again.alreadyEnrolled).toBe(true);
      const enrolledEvents = (await eventTypes(r)).filter((x) => x === "admissions.application.enrolled");
      expect(enrolledEvents).toHaveLength(1);
      expect(history.transitions.filter((x) => x.toStatus === "ENROLLED")).toHaveLength(1);
      // Un dossier ENROLLED ne change plus ; une confirmation d'une inscription créée hors admissions est ignorée.
      expect(unwrap(await handleEnrollmentConfirmed(r.t.deps, r.t.systemCtx(), { enrollmentId: "0192f0a4-7b1e-7c3a-8d2e-00000000ffff" })).ignored).toBe(true);
      await expect(r.t.deps.db.run(r.t.ctx(), (tx) => tx.query("UPDATE admissions.applications SET stage_id = (SELECT id FROM admissions.workflow_stages WHERE code = 'DRAFT' LIMIT 1) WHERE id = $1", [r.appId]))).rejects.toThrow();
    });

    it("ENROLLED exige la confirmation : impossible de le poser à la main, par transition comme par SQL direct", async () => {
      const r = await ready("sans-confirmation");
      unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      await expect(
        r.t.deps.db.run(r.t.ctx(), (tx) => tx.query("UPDATE admissions.applications SET stage_id = (SELECT id FROM admissions.workflow_stages s WHERE s.code = 'ENROLLED' AND s.workflow_id = applications.workflow_id) WHERE id = $1", [r.appId])),
      ).rejects.toThrow(/enrolled|check/i);
      expect((await stateOf(r)).stage).toBe("AWAITING_PAYMENT");
    });

    it("l'inscription annulée par un autre acteur avant paiement clôt le dossier et libère la place", async () => {
      const r = await ready("annulee", { seats: 1 });
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      expect(unwrap(await handleEnrollmentEnded(r.t.deps, r.t.systemCtx(), { enrollmentId: out.enrollmentId })).closed).toBe(true);
      expect((await stateOf(r)).status).toBe("REJECTED");
    });
  });

  describe("doublons au moment de l'inscription", () => {
    it("politique BLOCK : un doublon non tranché empêche l'inscription ; une fois écarté, la saga aboutit", async () => {
      const r = await ready("block");
      unwrap(await updateSettings(r.t.deps, r.t.ctx(), { institutionId: r.t.institutionId, duplicatePolicy: "BLOCK" }));
      r.t.mem.duplicatesFor = [{ studentId: "0192f0a4-7b1e-7c3a-8d2e-0000000000b1", score: 95, reasons: ["EXACT"] }];
      const blocked = await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe("admissions.duplicates_pending");
      expect(r.t.mem.students.size).toBe(0);
      // La détection a eu lieu hors de la saga annulée : on la rejoue puis on tranche.
      r.t.mem.duplicatesFor = [];
      const { runDetection } = await import("../../application/duplicates");
      r.t.mem.duplicatesFor = [{ studentId: "0192f0a4-7b1e-7c3a-8d2e-0000000000b1", score: 95, reasons: ["EXACT"] }];
      const dups = unwrap(await runDetection(r.t.deps, r.t.ctx(), r.appId));
      expect(dups).toHaveLength(1);
      unwrap(await resolveDuplicate(r.t.deps, r.t.ctx(), r.appId, dups[0]!.id, "DISMISSED"));
      expect(unwrap(await listDuplicates(r.t.deps, r.t.ctx(), r.appId))[0]!.status).toBe("DISMISSED");
      r.t.mem.duplicatesFor = [];
      expect(unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" })).replayed).toBe(false);
    });

    it("un candidat déjà élève de l'établissement (doublon confirmé) réutilise son dossier : AUCUN nouvel élève n'est créé", async () => {
      const r = await ready("reutilisation");
      const existing = await r.t.mem.students_.createStudent(r.t.ctx(), { externalRef: "legacy-1", firstName: "Awa", lastName: "Konaté", birthDate: "2019-04-12", birthPlace: null, gender: "FEMALE", nationality: null });
      await r.t.mem.students_.changeStudentStatus(r.t.ctx(), existing.studentId, "ACTIVE", "retour");
      r.t.mem.duplicatesFor = [{ studentId: existing.studentId, score: 100, reasons: ["EXACT"] }];
      const { runDetection } = await import("../../application/duplicates");
      const dups = unwrap(await runDetection(r.t.deps, r.t.ctx(), r.appId));
      unwrap(await resolveDuplicate(r.t.deps, r.t.ctx(), r.appId, dups.find((d) => d.matchedKind === "STUDENT")!.id, "CONFIRMED_DUPLICATE"));
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      expect(out.studentId).toBe(existing.studentId);
      expect(r.t.mem.students.size).toBe(1);
    });
  });

  describe("expiration, délai de paiement, refus de la famille", () => {
    it("offre échue : travail planifié -> EXPIRED, dossier clos « offre expirée » par une décision système, place libérée, promotion automatique", async () => {
      const t = await w.tenant("expiration");
      unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, waitlistPromotion: "AUTO" }));
      const campaign = await openCampaignWith(t, { seats: { CP1: 1 } });
      const holder = await submittedApplication(t, campaign.id);
      await acceptApplication(t, holder.id);
      const issued = unwrap(await issueOffer(t.deps, t.ctx(), holder.id, { classroomId: t.rooms.cp1, validityDays: 2 }));
      const next = await submittedApplication(t, campaign.id);
      let detail = unwrap(await getApplication(t.deps, t.ctx(), next.id));
      detail = unwrap(await transitionApplication(t.deps, t.ctx(), next.id, { toStageId: detail.allowedTransitions.find((x) => x.toStageCode === "UNDER_REVIEW")!.toStageId }));
      unwrap(await recordDecision(t.deps, t.ctx(), next.id, { toStageId: detail.allowedTransitions.find((x) => x.toStageCode === "WAITLISTED")!.toStageId, kind: "WAITLIST", reasonCode: "NO_SEAT_YET", overrideCapacity: false }));
      // Avant l'échéance : rien ne bouge.
      expect(await expireOffers(t.deps, t.systemCtx())).toEqual({ expired: 0, failed: 0 });
      w.clock.advanceDays(3);
      try {
        expect(await expireOffers(t.deps, t.systemCtx())).toEqual({ expired: 1, failed: 0 });
        expect(await expireOffers(t.deps, t.systemCtx())).toEqual({ expired: 0, failed: 0 }); // idempotent
      } finally {
        w.clock.advanceDays(-3);
      }
      const closed = unwrap(await getApplication(t.deps, t.ctx(), holder.id));
      expect(closed).toMatchObject({ status: "REJECTED", stageCode: "OFFER_EXPIRED", closureKind: "OFFER_EXPIRED" });
      expect(closed.offers[0]).toMatchObject({ id: issued.offer.id, status: "EXPIRED" });
      const history = unwrap(await getHistory(t.deps, t.ctx(), holder.id));
      expect(history.decisions.at(-1)).toMatchObject({ kind: "WITHDRAW", reasonCode: "OFFER_EXPIRED", decidedByName: "Système" });
      // La place libérée est offerte au premier de la liste d'attente.
      const promoted = unwrap(await getApplication(t.deps, t.ctx(), next.id));
      expect(promoted.status).toBe("ACCEPTED");
      expect(promoted.offers).toHaveLength(1);
    });

    it("délai de paiement VIDE par défaut : aucune annulation ; une fois configuré et dépassé : inscription et facture annulées, dossier clos, aucun élève supprimé", async () => {
      const r = await ready("delai");
      const out = unwrap(await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" }));
      w.clock.advanceDays(60);
      try {
        expect(await enforcePaymentDeadline(r.t.deps, r.t.systemCtx())).toEqual({ cancelled: 0, skipped: 0 }); // question métier Q-A05 : pas de délai
        unwrap(await updateSettings(r.t.deps, r.t.ctx(), { institutionId: r.t.institutionId, paymentDeadlineDays: 30 }));
        expect(await enforcePaymentDeadline(r.t.deps, r.t.systemCtx())).toEqual({ cancelled: 1, skipped: 0 });
        expect(await enforcePaymentDeadline(r.t.deps, r.t.systemCtx())).toEqual({ cancelled: 0, skipped: 0 });
      } finally {
        w.clock.advanceDays(-60);
      }
      const st = await stateOf(r);
      expect(st).toMatchObject({ stage: "OFFER_EXPIRED", status: "REJECTED" });
      expect(r.t.mem.enrollments.get(out.enrollmentId)?.status).toBe("CANCELLED");
      expect(r.t.mem.invoices.get(out.invoiceId!)?.cancelled).toBe(true);
      expect(r.t.mem.students.has(out.studentId)).toBe(true); // jamais supprimé : son matricule reste consommé
      expect(st.student_id).toBe(out.studentId);
    });

    it("la famille refuse l'offre : offre DECLINED, dossier clos « retiré par la famille », place libérée", async () => {
      const r = await ready("refus", { seats: 1 });
      expect(unwrap(await declineOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId }))).toEqual({ status: "DECLINED" });
      expect(await stateOf(r)).toMatchObject({ stage: "WITHDRAWN", status: "REJECTED", offer_status: "DECLINED" });
      expect(unwrap(await declineOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId }))).toEqual({ status: "DECLINED" }); // idempotent
      expect((await acceptOffer(r.t.deps, r.t.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" })).ok).toBe(false);
      expect(await eventTypes(r)).toContain("admissions.offer.declined");
    });
  });

  it("isolation A/B : une offre d'un tenant est introuvable depuis un autre", async () => {
    const r = await ready("isolation-offres");
    const foreign = await acceptOffer(w.B.deps, w.B.ctx(), { offerId: r.offerId, via: "GUARDIAN_LINK" });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("admissions.offer_not_found");
    expect((await withdrawOffer(w.B.deps, w.B.ctx(), r.offerId, "tentative d'un autre tenant")).ok).toBe(false);
  });
});

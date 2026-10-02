/**
 * Formulaire PUBLIC de candidature (US4) : un lien par établissement (`public_form_index`, table globale), SANS authentification,
 * SANS compte créé, SANS donnée sensible exposée.
 *
 * Anti-spam en six couches : (1) jeton de formulaire à usage unique (empreinte SHA-256 seule, expirant, valable après un délai
 * minimal) ; (2) champ leurre (honeypot) ; (3) limiteur par empreinte d'IP — Redis (`runtime.rateLimiter`, couche HTTP) ET
 * comptage en base des tentatives récentes ; (4) CAPTCHA si l'établissement l'exige (échec fermé si le port est absent) ;
 * (5) schéma Zod strict (couche HTTP) ; (6) une confirmation au plus par contact et par jour. IP et agent ne sont JAMAIS stockés
 * en clair (HMAC).
 *
 * Réponses NEUTRES : le dépôt renvoie un code de suivi et un message identique pour tous (y compris un doublon exact ou un robot
 * pris au leurre) ; aucune capacité, aucun effectif, aucune place restante, aucune liste d'attente n'est exposé. Un lien désactivé,
 * un formulaire fermé ou un établissement sans texte de consentement publié répondent de la même façon : « introuvable ».
 */
import { createSystemContext, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AdmissionsPublicFormDto,
  AdmissionsPublicSubmitBody,
  AdmissionsPublicTrackDto,
} from "@ecoledigitale/contracts/src/v2/admissions";
import { ADMISSIONS_HONEYPOT_FIELD } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict } from "../domain/errors";
import { identityKey } from "../domain/identity";
import { ipFingerprint, newOpaqueToken, newTrackingCode, tokenHash, trackingCodeHash, userAgentFingerprint } from "../domain/tokens";
import { CLOSURE_LABELS, PUBLIC_PHASE_LABELS, PUBLIC_SUBMIT_MESSAGE, publicPhaseOf } from "../domain/tracking";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as pub from "../infrastructure/public-repository";
import * as ref from "../infrastructure/reference-repository";
import * as wf from "../infrastructure/workflow-repository";
import { createApplicationInTx, submitInTx } from "./applications";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { detectDuplicates } from "./duplicates";
import { acceptOffer, declineOffer, recordAcceptFailure } from "./offers";
import { uploadDocument } from "./documents";
import { nowIso } from "./support";

export type PublicOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** Lien inconnu, désactivé, formulaire fermé, aucun texte de consentement publié : réponse unique « introuvable ». */
  | { readonly kind: "closed" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }
  /** Jeton absent, rejoué, expiré ou trop rapide ; CAPTCHA refusé ; consentement absent : réponse unique « requête invalide ». */
  | { readonly kind: "invalid" }
  | { readonly kind: "error"; readonly error: AppError };

interface Target {
  readonly ctx: RequestContext;
  readonly institutionId: string;
}

const closed = { kind: "closed" } as const;

/** Résout le lien AVANT tout contexte de tenant (lecture ouverte de la table globale, via `SystemDb`). */
export async function resolveTarget(deps: AdmissionsDeps, slug: string): Promise<Target | null> {
  if (!deps.systemDb) return null;
  const row = await deps.systemDb.run("admissions-public-form", (tx) => ref.lookupSlug(tx, slug), { readOnly: true });
  if (!row || !row.enabled) return null;
  const ctx = createSystemContext(row.tenantId);
  // Fonction vendable « formulaire public » du tenant propriétaire du lien (résolue APRÈS lui) ; absente = formulaire « introuvable ».
  if (deps.features && !(await deps.features.isEnabled(ctx, "admissions.public-form"))) return null;
  return { ctx, institutionId: row.institutionId };
}

// ---------------------------------------------------------------------------
// GET du formulaire
// ---------------------------------------------------------------------------

export async function getPublicForm(deps: AdmissionsDeps, input: { slug: string; ip: string }): Promise<PublicOutcome<AdmissionsPublicFormDto>> {
  const target = await resolveTarget(deps, input.slug);
  if (!target) return closed;
  const { ctx, institutionId } = target;
  const r = await inTx<PublicOutcome<AdmissionsPublicFormDto>>(deps, ctx, async (tx) => {
    const settings = await ref.getSettingsRow(tx, institutionId);
    if (!settings || !settings.publicFormEnabled) return ok(closed);
    if (settings.captchaRequired && !deps.ports.captcha) return ok(closed); // échec fermé : pas de formulaire sans la protection annoncée
    const consent = await ref.getCurrentConsentText(tx, institutionId, "DATA_PROCESSING");
    if (!consent) return ok(closed); // aucun texte de consentement publié : formulaire fermé
    const campaign = await wf.findOpenCampaign(tx, institutionId, nowIso(deps));
    if (!campaign) return ok(closed);
    const institution = await deps.ports.catalog.getInstitution(ctx, institutionId);
    if (!institution) return ok(closed);
    const catalogGrades = await deps.ports.catalog.gradeLevels(ctx, institutionId);
    const capacities = await wf.listCapacities(tx, campaign.id);
    const open = new Set(capacities.map((c) => c.gradeLevelCode));
    const grades = (open.size === 0 ? catalogGrades : catalogGrades.filter((g) => open.has(g.code))).map((g) => ({ code: g.code, label: g.label }));
    if (grades.length === 0) return ok(closed);
    const token = newOpaqueToken();
    await pub.insertFormSession(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId, tokenHash: tokenHash(token, "form"), minReadySeconds: settings.minimumFormSeconds, ttlMinutes: deps.config.formTokenTtlMinutes, ipHash: ipFingerprint(deps.fingerprintSecret, input.ip) });
    const requirements = await ref.listRequirements(tx, institutionId, { activeOnly: true });
    const relationships = await deps.ports.catalog.relationshipTypes(ctx);
    const dto: AdmissionsPublicFormDto = {
      institutionName: institution.name,
      grades,
      documents: requirements.map((d) => ({ code: d.code, label: d.label, required: d.required, acceptsMime: d.acceptsMime, maxSizeKb: d.maxSizeKb })),
      relationships: relationships.map((x) => ({ code: x.code, label: x.label })),
      consent: { kind: "DATA_PROCESSING", version: consent.version, language: consent.language, body: consent.body },
      antiSpam: { minimumFormSeconds: settings.minimumFormSeconds, captchaRequired: settings.captchaRequired, honeypotField: ADMISSIONS_HONEYPOT_FIELD },
      formToken: token,
    };
    return ok({ kind: "ok", value: dto });
  });
  return r.ok ? r.value : { kind: "error", error: r.error };
}

// ---------------------------------------------------------------------------
// Dépôt
// ---------------------------------------------------------------------------

async function logAttempt(deps: AdmissionsDeps, target: Target, input: { ipHash: string; uaHash: string | null; outcome: string; applicationId?: string | null }): Promise<void> {
  try {
    await deps.db.run(target.ctx, (tx) => pub.insertAttempt(tx, { id: deps.newId(), tenantId: target.ctx.tenantId, institutionId: target.institutionId, ipHash: input.ipHash, uaHash: input.uaHash, outcome: input.outcome, applicationId: input.applicationId ?? null }));
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "admissions : tentative de dépôt non journalisée");
  }
}

/** Faux code de suivi, de même forme qu'un vrai, jamais stocké : réponse à un robot pris au leurre ou à un doublon exact. */
const decoyCode = (): string => newTrackingCode();

export async function submitPublicApplication(deps: AdmissionsDeps, input: { slug: string; body: AdmissionsPublicSubmitBody; ip: string; userAgent: string }): Promise<PublicOutcome<{ trackingCode: string; message: string }>> {
  const target = await resolveTarget(deps, input.slug);
  if (!target) return closed;
  const { ctx, institutionId } = target;
  const ipHash = ipFingerprint(deps.fingerprintSecret, input.ip);
  const uaHash = input.userAgent ? userAgentFingerprint(deps.fingerprintSecret, input.userAgent) : null;
  const body = input.body;

  // Contexte de décision (lecture) : lien ouvert, limite de débit, texte de consentement en vigueur.
  const pre = await inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await ref.getSettingsRow(tx, institutionId);
      if (!settings || !settings.publicFormEnabled) return ok(null);
      const consent = await ref.getCurrentConsentText(tx, institutionId, "DATA_PROCESSING");
      if (!consent) return ok(null);
      const recent = await pub.recentAttempts(tx, ipHash, deps.config.attemptsWindowMinutes);
      return ok({ settings, consent, recent });
    },
    { readOnly: true },
  );
  if (!pre.ok) return { kind: "error", error: pre.error };
  if (!pre.value) return closed;
  const { settings, consent, recent } = pre.value;

  if (recent >= settings.submissionsPer10Min) {
    await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_RATE" });
    return { kind: "rate_limited", retryAfterSeconds: deps.config.attemptsWindowMinutes * 60 };
  }
  const honeypot = (body as Record<string, unknown>)[ADMISSIONS_HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_BOT" });
    return { kind: "ok", value: { trackingCode: decoyCode(), message: PUBLIC_SUBMIT_MESSAGE } };
  }
  if (settings.captchaRequired) {
    const verified = deps.ports.captcha ? await deps.ports.captcha.verify(body.captchaToken, input.ip) : false;
    if (!verified) {
      await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_BOT" });
      return { kind: "invalid" };
    }
  }
  if (body.consent.textVersion !== consent.version) {
    await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_VALIDATION" });
    return { kind: "invalid" };
  }

  type Done = { kind: "created"; trackingCode: string; applicationId: string } | { kind: "token" } | { kind: "duplicate"; applicationId: string } | { kind: "closed" } | { kind: "validation" };
  const trackingCode = newTrackingCode();
  const tx1 = await inTx<Done>(deps, ctx, async (tx, scope) => {
    // 1. Jeton à usage unique : consommation ATOMIQUE (un seul gagnant sous concurrence).
    if (!(await pub.consumeFormSession(tx, tokenHash(body.formToken, "form")))) return ok({ kind: "token" });
    const campaign = await wf.findOpenCampaign(tx, institutionId, nowIso(deps));
    if (!campaign) return ok({ kind: "closed" });
    // 2. Niveau demandé : parmi ceux que le formulaire propose.
    const capacities = await wf.listCapacities(tx, campaign.id);
    const grades = await deps.ports.catalog.gradeLevels(ctx, institutionId);
    const allowed = new Set((capacities.length === 0 ? grades.map((g) => g.code) : capacities.map((c) => c.gradeLevelCode)));
    if (!allowed.has(body.desiredGradeLevelCode)) return ok({ kind: "validation" });
    const relationships = new Set((await deps.ports.catalog.relationshipTypes(ctx)).map((x) => x.code));
    if (relationships.size > 0 && body.guardians.some((g) => !relationships.has(g.relationshipCode))) return ok({ kind: "validation" });
    // 3. Tuteur qui consent : habilité.
    const consenting = body.guardians[body.consent.guardianIndex];
    if (!consenting || !consenting.canConsent) return ok({ kind: "validation" });
    // 4. Doublon exact : réponse NEUTRE, signalé en interne seulement.
    const existing = await apps.findLiveApplicationByIdentity(tx, campaign.id, identityKey({ lastName: body.applicantLastName, firstName: body.applicantFirstName, birthDate: body.applicantBirthDate }));
    if (existing) return ok({ kind: "duplicate", applicationId: existing });

    const created = await createApplicationInTx(
      deps,
      ctx,
      tx,
      {
        campaignId: campaign.id,
        applicantFirstName: body.applicantFirstName,
        applicantLastName: body.applicantLastName,
        applicantBirthDate: body.applicantBirthDate,
        applicantBirthPlace: body.applicantBirthPlace ?? null,
        applicantGender: body.applicantGender ?? null,
        applicantNationality: body.applicantNationality ?? null,
        previousSchool: body.previousSchool ?? null,
        previousGradeLevelCode: body.previousGradeLevelCode ?? null,
        isRepeating: body.isRepeating,
        desiredGradeLevelCode: body.desiredGradeLevelCode,
        fundingTypeRequested: body.fundingTypeRequested,
        assignmentReference: body.assignmentReference ?? null,
        sourceChannel: "PUBLIC_FORM",
        guardians: body.guardians,
      },
      { via: "PUBLIC_FORM", requireOpenCampaign: true, trackingCodeHash: trackingCodeHash(trackingCode), createdBy: null },
    );
    if (!created.ok) return created.error.kind === "validation" || created.error.kind === "conflict" ? ok({ kind: "validation" }) : created;
    // 5. Consentement parental tracé : version du texte, date, voie, empreintes (jamais d'IP en clair).
    const guardianId = created.value.guardianIds[body.consent.guardianIndex] as string;
    await apps.insertConsent(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId: created.value.id, guardianId, kind: "DATA_PROCESSING", textVersion: consent.version, givenVia: "PUBLIC_FORM", evidenceRef: null, ipHash, uaHash });
    // 6. Soumission (sortie de DRAFT : événement `submitted`, confirmation limitée à une par contact et par jour).
    const events = new EventBuffer(deps, ctx);
    const submitted = await submitInTx(deps, ctx, tx, scope, events, created.value.id);
    if (!submitted.ok) return submitted;
    const report = await detectDuplicates(deps, ctx, tx, submitted.value);
    await pub.insertAttempt(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId, ipHash, uaHash, outcome: "ACCEPTED", applicationId: created.value.id });
    events.audit({ action: "admissions.application.public_submit", resourceType: "application", resourceId: created.value.id, metadata: { campaignId: campaign.id, grade: body.desiredGradeLevelCode, duplicatesOpen: report.open } });
    await events.flush(tx);
    return ok({ kind: "created", trackingCode, applicationId: created.value.id });
  });
  if (!tx1.ok) {
    await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_VALIDATION" });
    return { kind: "error", error: tx1.error };
  }
  const done = tx1.value;
  switch (done.kind) {
    case "created":
      return { kind: "ok", value: { trackingCode: done.trackingCode, message: PUBLIC_SUBMIT_MESSAGE } };
    case "duplicate":
      await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_DUPLICATE", applicationId: done.applicationId });
      return { kind: "ok", value: { trackingCode: decoyCode(), message: PUBLIC_SUBMIT_MESSAGE } };
    case "token":
      await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_TOKEN" });
      return { kind: "invalid" };
    case "closed":
      return closed;
    case "validation":
      await logAttempt(deps, target, { ipHash, uaHash, outcome: "REJECTED_VALIDATION" });
      return { kind: "invalid" };
  }
}

// ---------------------------------------------------------------------------
// Suivi par code (POST : le code n'est jamais dans l'URL)
// ---------------------------------------------------------------------------

export async function trackApplication(deps: AdmissionsDeps, input: { school: string; trackingCode: string }): Promise<PublicOutcome<AdmissionsPublicTrackDto>> {
  const target = await resolveTarget(deps, input.school);
  if (!target) return closed;
  const r = await inTx<PublicOutcome<AdmissionsPublicTrackDto>>(
    deps,
    target.ctx,
    async (tx) => {
      const app = await apps.getApplicationByTracking(tx, trackingCodeHash(input.trackingCode));
      if (!app || app.anonymizedAt || app.institutionId !== target.institutionId) return ok(closed);
      const phase = publicPhaseOf({ status: app.status as never, createsEnrollment: app.stageCreatesEnrollment });
      const docs = await cases.listApplicationDocuments(tx, app.id);
      const missing = docs
        .filter((d) => d.applicable && d.required && d.status !== "ACCEPTED")
        .map((d) => ({ requirementId: d.requirementId, label: d.requirementLabel, rejected: d.status === "REJECTED", reason: d.status === "REJECTED" ? d.rejectionReason : null }));
      const pending = await cases.getPendingOffer(tx, app.id);
      let closureLabel: string | null = null;
      if (app.status === "REJECTED") {
        // Libellé NEUTRE du motif codé (jamais le détail interne) ; sinon libellé générique de la clôture.
        const history = await apps.getHistory(tx, app.id);
        const last = [...history.decisions].reverse().find((d) => d.reasonLabel);
        closureLabel = last?.reasonLabel ?? CLOSURE_LABELS[(app.stageClosureKind ?? "REJECTED_BY_SCHOOL") as keyof typeof CLOSURE_LABELS];
      }
      return ok({
        kind: "ok",
        value: {
          phase,
          phaseLabel: PUBLIC_PHASE_LABELS[phase],
          missingDocuments: phase === "DOCUMENTS_NEEDED" || phase === "UNDER_REVIEW" || phase === "RECEIVED" ? missing : [],
          offer: pending && phase === "OFFER_PENDING" ? { expiresAt: pending.expiresAt } : null,
          closureLabel,
          updatedAt: app.updatedAt,
        },
      });
    },
    { readOnly: true },
  );
  return r.ok ? r.value : { kind: "error", error: r.error };
}

export async function uploadTrackedDocument(
  deps: AdmissionsDeps,
  input: { school: string; trackingCode: string; requirementId: string; fileName: string; bytes: Uint8Array },
): Promise<PublicOutcome<{ received: true }>> {
  const target = await resolveTarget(deps, input.school);
  if (!target) return closed;
  const found = await inTx(deps, target.ctx, async (tx) => ok(await apps.getApplicationByTracking(tx, trackingCodeHash(input.trackingCode))), { readOnly: true });
  if (!found.ok) return { kind: "error", error: found.error };
  const app = found.value;
  if (!app || app.anonymizedAt || app.institutionId !== target.institutionId) return closed;
  const r = await uploadDocument(deps, target.ctx, { applicationId: app.id, requirementId: input.requirementId, fileName: input.fileName, bytes: input.bytes, by: "FAMILY" });
  if (!r.ok) return { kind: "error", error: r.error };
  return { kind: "ok", value: { received: true } };
}

// ---------------------------------------------------------------------------
// Réponse à une offre par lien à usage unique
// ---------------------------------------------------------------------------

export interface OfferView {
  readonly institutionName: string;
  readonly gradeLabel: string;
  readonly classroomLabel: string | null;
  readonly expiresAt: string;
  readonly conditions: string | null;
  readonly status: string;
}

export async function viewOfferPublic(deps: AdmissionsDeps, input: { school: string; token: string }): Promise<PublicOutcome<OfferView>> {
  const target = await resolveTarget(deps, input.school);
  if (!target) return closed;
  const r = await inTx<PublicOutcome<OfferView>>(
    deps,
    target.ctx,
    async (tx) => {
      const offer = await cases.getOfferByTokenHash(tx, tokenHash(input.token, "offer"));
      if (!offer) return ok(closed);
      const app = await apps.getApplicationRow(tx, offer.applicationId);
      if (!app || app.anonymizedAt || app.institutionId !== target.institutionId) return ok(closed);
      const institution = await deps.ports.catalog.getInstitution(target.ctx, app.institutionId);
      const grades = await deps.ports.catalog.gradeLevels(target.ctx, app.institutionId);
      const room = offer.classroomId ? await deps.ports.catalog.classroom(target.ctx, offer.classroomId) : null;
      const status = offer.status === "PENDING" && Date.parse(offer.expiresAt) <= deps.clock.now().getTime() ? "EXPIRED" : offer.status;
      return ok({
        kind: "ok",
        value: { institutionName: institution?.name ?? "", gradeLabel: grades.find((g) => g.code === offer.gradeLevelCode)?.label ?? offer.gradeLevelCode, classroomLabel: room?.label ?? null, expiresAt: offer.expiresAt, conditions: offer.conditions, status },
      });
    },
    { readOnly: true },
  );
  return r.ok ? r.value : { kind: "error", error: r.error };
}

export async function respondOfferPublic(deps: AdmissionsDeps, input: { school: string; token: string; accept: boolean; guardianId?: string | undefined }): Promise<PublicOutcome<{ status: "ACCEPTED" | "DECLINED" }>> {
  const target = await resolveTarget(deps, input.school);
  if (!target) return closed;
  const found = await inTx(
    deps,
    target.ctx,
    async (tx) => {
      const offer = await cases.getOfferByTokenHash(tx, tokenHash(input.token, "offer"));
      if (!offer) return ok(null);
      const app = await apps.getApplicationRow(tx, offer.applicationId);
      return ok(app && !app.anonymizedAt && app.institutionId === target.institutionId ? offer : null);
    },
    { readOnly: true },
  );
  if (!found.ok) return { kind: "error", error: found.error };
  if (!found.value) return closed;
  const offerId = found.value.id;
  if (input.accept) {
    const r = await acceptOffer(deps, target.ctx, { offerId, via: "GUARDIAN_LINK", ...(input.guardianId ? { guardianId: input.guardianId } : {}) });
    if (!r.ok) {
      await recordAcceptFailure(deps, target.ctx, { offerId, code: r.error.code, via: "GUARDIAN_LINK" });
      return { kind: "error", error: r.error };
    }
    return { kind: "ok", value: { status: "ACCEPTED" } };
  }
  const d = await declineOffer(deps, target.ctx, { offerId, ...(input.guardianId ? { guardianId: input.guardianId } : {}) });
  if (!d.ok) return { kind: "error", error: d.error };
  return { kind: "ok", value: { status: "DECLINED" } };
}

void err;
void conflict;
void AdmissionsCode;

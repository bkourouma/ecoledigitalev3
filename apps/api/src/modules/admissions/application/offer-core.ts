/**
 * Émission d'une offre d'admission (US9) dans la transaction de l'appelant : réutilisée par l'émission manuelle et par la
 * promotion depuis la liste d'attente. Le lien de réponse est un jeton à USAGE UNIQUE : seule son empreinte est stockée ; le
 * secret n'est montré qu'au personnel (une fois) et envoyé au tuteur par le port de notification.
 */
import type { Tx } from "@ecoledigitale/database";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsOfferDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, validation } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import { NOTIFICATION_TEMPLATES } from "../domain/default-workflow";
import { newOpaqueToken, tokenHash } from "../domain/tokens";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as ref from "../infrastructure/reference-repository";
import * as wf from "../infrastructure/workflow-repository";
import type { AdmissionsDeps, EventBuffer, TxScope } from "./deps";
import { defaultRecipient, notifyGuardian, type Delivery } from "./notifications";
import { applicationRef } from "./transitions";

export const OFFER_VIEW_PATH = (slug: string | null): string => (slug ? `/v2/apply/${slug}/offer` : "/v2/apply/offer");

/** Lien de réponse : le jeton est dans le FRAGMENT (jamais envoyé au serveur ni journalisé). */
export function offerLink(deps: AdmissionsDeps, slug: string | null, token: string): string {
  const base = (deps.config.publicBaseUrl ?? "").replace(/\/+$/, "");
  return `${base}${OFFER_VIEW_PATH(slug)}#t=${token}`;
}

export interface IssuedOffer {
  readonly offer: AdmissionsOfferDto;
  readonly responseToken: string;
  readonly guardianId: string | null;
  readonly notified: () => Delivery;
}

export interface IssueOfferInput {
  readonly classroomId?: string | null | undefined;
  readonly conditions?: string | null | undefined;
  readonly validityDays?: number | undefined;
}

/** Valide qu'une classe est utilisable pour ce dossier : existe, même établissement, même niveau, ouverte aux inscriptions. */
export async function checkClassroom(deps: AdmissionsDeps, ctx: RequestContext, app: Pick<apps.ApplicationRow, "institutionId" | "desiredGradeLevelCode">, classroomId: string): Promise<Result<{ id: string; label: string }, AppError>> {
  const room = await deps.ports.catalog.classroom(ctx, classroomId);
  if (!room) return err(validation(AdmissionsCode.CLASSROOM_INVALID, "Classe inconnue.", "classroomId"));
  if (room.institutionId !== app.institutionId) return err(validation(AdmissionsCode.CLASSROOM_INVALID, "Cette classe appartient à un autre établissement.", "classroomId"));
  if (room.gradeLevelCode !== app.desiredGradeLevelCode) return err(validation(AdmissionsCode.CLASSROOM_INVALID, "Cette classe n'est pas du niveau demandé par la candidature.", "classroomId"));
  if (!room.open) return err(conflict(AdmissionsCode.CLASSROOM_INVALID, "Cette classe n'accepte plus d'inscription."));
  return ok({ id: room.id, label: room.label });
}

/** Classe unique du niveau pour l'année de la campagne (utilisée quand la promotion automatique n'a pas de classe désignée). */
export async function soleClassroom(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, app: Pick<apps.ApplicationRow, "institutionId" | "campaignId" | "desiredGradeLevelCode">): Promise<string | null> {
  const campaign = await wf.getCampaignRow(tx, app.campaignId);
  if (!campaign) return null;
  try {
    const rooms = await deps.ports.catalog.classroomsOf(ctx, { institutionId: app.institutionId, academicYearId: campaign.academicYearId, gradeLevelCode: app.desiredGradeLevelCode });
    return rooms.length === 1 ? (rooms[0] as { id: string }).id : null;
  } catch {
    return null;
  }
}

export async function issueOfferInTx(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, app: apps.ApplicationRow, input: IssueOfferInput): Promise<Result<IssuedOffer, AppError>> {
  if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
  if (app.stageCanonicalStatus !== "ACCEPTED" || app.stageCreatesEnrollment) {
    return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Une offre ne s'émet que pour un dossier admis, avant la création de l'inscription."));
  }
  if (await cases.getPendingOffer(tx, app.id)) return err(conflict(AdmissionsCode.OFFER_EXISTS, "Une offre est déjà en attente pour cette candidature."));

  let classroomId: string | null = input.classroomId ?? null;
  if (classroomId) {
    const ok1 = await checkClassroom(deps, ctx, app, classroomId);
    if (!ok1.ok) return ok1;
  } else {
    classroomId = await soleClassroom(deps, ctx, tx, app);
  }

  const settings = await ref.ensureSettingsRow(tx, ctx.tenantId, app.institutionId);
  const days = input.validityDays ?? settings.offerValidityDays;
  const issuedAt = deps.clock.now();
  const expiresAt = new Date(issuedAt.getTime() + days * 86_400_000);
  const token = newOpaqueToken();
  const id = deps.newId();
  await cases.insertOffer(tx, { id, tenantId: ctx.tenantId, applicationId: app.id, gradeLevelCode: app.desiredGradeLevelCode, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), classroomId, tokenHash: tokenHash(token, "offer"), conditions: input.conditions ?? null });
  const offer = (await cases.getOffer(tx, id)) as AdmissionsOfferDto & { applicationId: string };
  events.add(AdmissionsEvents.OFFER_ISSUED, { v: 1, ...applicationRef(app), offerId: id, classroomId }, { type: "offer", id });
  events.audit({ action: "admissions.offer.issue", resourceType: "offer", resourceId: id, metadata: { applicationId: app.id, classroomId, validityDays: days } });

  const guardians = await apps.listGuardians(tx, app.id);
  const recipient = defaultRecipient(guardians);
  let notified: () => Delivery = () => "SKIPPED";
  if (recipient) {
    const index = await ref.getIndexOfInstitution(tx, app.institutionId);
    const handle = await notifyGuardian(deps, ctx, tx, scope, {
      tenantId: ctx.tenantId,
      applicationId: app.id,
      recipient,
      templateCode: NOTIFICATION_TEMPLATES.OFFER_ISSUED,
      dedupeKey: `offer:${id}`,
      data: { link: offerLink(deps, index?.slug ?? null, token), expiresAt: expiresAt.toISOString() },
    });
    notified = handle.status;
  }
  return ok({ offer, responseToken: token, guardianId: recipient?.id ?? null, notified });
}

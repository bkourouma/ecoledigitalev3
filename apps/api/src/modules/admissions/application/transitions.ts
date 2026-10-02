/**
 * Cœur du changement d'étape. UNE fonction écrit le changement (le déclencheur SQL `applications_guard` valide la transition
 * déclarée, les pièces, le consentement, l'entretien, la décision journalisée, la capacité, les doublons), publie
 * `admissions.application.status_changed` (et `submitted` à la sortie de DRAFT), enregistre la notification de l'étape et signale
 * une place libérée. Aucune donnée personnelle dans l'événement ni dans l'audit.
 */
import type { Tx } from "@ecoledigitale/database";
import type { RequestContext } from "@ecoledigitale/kernel";
import type { AdmissionStatus } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsEvents } from "../domain/events";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { EventBuffer, type AdmissionsDeps, type TxScope } from "./deps";
import { defaultRecipient, notifyGuardian } from "./notifications";

export const applicationRef = (app: Pick<apps.ApplicationRow, "id" | "campaignId" | "institutionId" | "desiredGradeLevelCode">) => ({
  applicationId: app.id,
  campaignId: app.campaignId,
  institutionId: app.institutionId,
  gradeLevelCode: app.desiredGradeLevelCode,
});

export type SeatFreedHandler = (deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, app: apps.ApplicationRow) => Promise<void>;

export interface MoveResult {
  readonly before: apps.ApplicationRow;
  readonly after: apps.ApplicationRow;
  readonly freedSeat: boolean;
}

export interface MoveOptions {
  readonly capacityOverrideReason?: string | null;
  readonly onSeatFreed?: SeatFreedHandler | undefined;
  /** Données du gabarit de notification de l'étape d'arrivée (lien d'offre…). */
  readonly notifyData?: Readonly<Record<string, string | readonly string[]>>;
  readonly skipNotification?: boolean;
}

/** Libellés des pièces exigées encore non acceptées (données du gabarit « pièces manquantes »). */
export async function missingDocumentLabels(tx: Tx, applicationId: string): Promise<string[]> {
  const docs = await cases.listApplicationDocuments(tx, applicationId);
  return docs.filter((d) => d.applicable && d.required && d.status !== "ACCEPTED").map((d) => d.requirementLabel);
}

/**
 * Déplace le dossier vers l'étape `toStageId`. `before` doit avoir été lu `FOR UPDATE` par l'appelant. Une violation d'une règle
 * de passage lève une erreur Postgres que `inTx` traduit en code `admissions.*` stable (rollback complet).
 */
export async function moveStage(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, before: apps.ApplicationRow, toStageId: string, options: MoveOptions = {}): Promise<MoveResult> {
  await apps.moveApplicationStage(tx, before.id, toStageId, { capacityOverrideReason: options.capacityOverrideReason ?? null });
  const after = (await apps.getApplicationRow(tx, before.id)) as apps.ApplicationRow;
  const ref = applicationRef(after);
  events.add(
    AdmissionsEvents.APPLICATION_STATUS_CHANGED,
    { v: 1, ...ref, fromStatus: before.status as AdmissionStatus, toStatus: after.status as AdmissionStatus, fromStageId: before.stageId, stageId: after.stageId, stageCode: after.stageCode },
    { type: "application", id: after.id },
  );
  if (before.status === "DRAFT" && after.status !== "DRAFT") {
    events.add(AdmissionsEvents.APPLICATION_SUBMITTED, { v: 1, ...ref, via: after.createdVia }, { type: "application", id: after.id });
  }
  events.audit({
    action: "admissions.application.transition",
    resourceType: "application",
    resourceId: after.id,
    metadata: { fromStage: before.stageCode, toStage: after.stageCode, fromStatus: before.status, toStatus: after.status },
  });

  if (!options.skipNotification && after.stageNotifyTemplateCode && !after.anonymizedAt) {
    const guardians = await apps.listGuardians(tx, after.id);
    const recipient = defaultRecipient(guardians);
    if (recipient) {
      const data: Record<string, string | readonly string[]> = { ...(options.notifyData ?? {}) };
      if (after.status === "MISSING_DOCUMENT") data["missingDocuments"] = await missingDocumentLabels(tx, after.id);
      await notifyGuardian(deps, ctx, tx, scope, {
        tenantId: ctx.tenantId,
        applicationId: after.id,
        recipient,
        templateCode: after.stageNotifyTemplateCode,
        dedupeKey: `stage:${after.stageId}:v${after.rowVersion}`,
        data,
        oncePerContactPerDay: before.status === "DRAFT" && after.createdVia === "PUBLIC_FORM",
      });
    }
  }

  const freedSeat = before.stageHoldsSeat && !after.stageHoldsSeat;
  if (freedSeat && options.onSeatFreed) await options.onSeatFreed(deps, ctx, tx, scope, events, after);
  return { before, after, freedSeat };
}

/**
 * Réactions aux événements des autres modules (abonnés du worker, `subscribers.ts`). Tolérance de lecture : une charge illisible est
 * IGNORÉE (journalisée), jamais une erreur qui rejouerait l'événement indéfiniment ; une défaillance transitoire (port non branché, base)
 * remonte pour que le worker rejoue.
 *
 *  - `tenancy.institution.created`                 -> modèle de pack `councils` (SECONDARY seulement) ;
 *  - `results.period.reopened`                     -> effets de `results` annulés, séances closes / signées signalées « à revoir » ;
 *  - `councils.minutes.generated`                  -> PDF demandé à `reportcards` depuis le snapshot seul ;
 *  - `reportcards.official_document.rendered`      -> (COUNCIL_MINUTES) objet rendu et empreinte enregistrés.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { z } from "zod";
import { CouncilsCode } from "../domain/errors";
import { type CouncilsDeps } from "./deps";
import { onResultsReopened } from "./effects";
import { onMinutesRendered, requestMinutesRender } from "./minutes";
import { instantiateCouncilsReferenceData } from "./template";

const uuid = z.string().uuid();
export const institutionCreatedReader = z.object({ institutionId: uuid, pack: z.string(), educationSystem: z.string().optional() }).passthrough();
export const periodReopenedReader = z.object({ stateId: uuid }).passthrough();
export const minutesGeneratedReader = z.object({ minutesId: uuid }).passthrough();
export const documentRenderedReader = z.object({ documentId: uuid, documentKind: z.string(), sourceId: uuid }).passthrough();

export interface IncomingEvent {
  id: string;
  type: string;
  aggregateId?: string | undefined;
  payload: unknown;
  occurredAt?: Date | string | undefined;
}

/** Une erreur « bénigne » n'a aucun intérêt à être rejouée : ressource disparue, pays sans modèle de pack. */
export function isBenignConsumerError(e: AppError): boolean {
  return e.kind === "not_found" || e.code === CouncilsCode.TEMPLATE_UNAVAILABLE;
}

export async function onInstitutionCreated(deps: CouncilsDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ applied: boolean }, AppError>> {
  const p = institutionCreatedReader.safeParse(event.payload);
  if (!p.success || p.data.pack !== "SECONDARY") return ok({ applied: false });
  const r = await instantiateCouncilsReferenceData(deps, ctx, { institutionId: p.data.institutionId, educationSystem: p.data.educationSystem });
  return r.ok ? ok({ applied: r.value.created.roles + r.value.created.councilTypes + r.value.created.decisionTypes + r.value.created.settings > 0 }) : r;
}

export async function onPeriodReopened(deps: CouncilsDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ reverted: number }, AppError>> {
  const p = periodReopenedReader.safeParse(event.payload);
  if (!p.success) return ok({ reverted: 0 });
  const r = await onResultsReopened(deps, ctx, { stateId: p.data.stateId, occurredAt: event.occurredAt ? new Date(event.occurredAt) : deps.clock.now() });
  return r.ok ? ok({ reverted: r.value.reverted }) : r;
}

export async function onMinutesGenerated(deps: CouncilsDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ requested: boolean }, AppError>> {
  const p = minutesGeneratedReader.safeParse(event.payload);
  if (!p.success) return ok({ requested: false });
  return requestMinutesRender(deps, ctx, p.data.minutesId);
}

export async function onOfficialDocumentRendered(deps: CouncilsDeps, ctx: RequestContext, event: IncomingEvent): Promise<Result<{ updated: boolean }, AppError>> {
  const p = documentRenderedReader.safeParse(event.payload);
  if (!p.success || p.data.documentKind !== "COUNCIL_MINUTES") return ok({ updated: false });
  return onMinutesRendered(deps, ctx, p.data.sourceId);
}

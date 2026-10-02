/**
 * Banque d'appréciations : phrases réutilisables PROPOSÉES à l'instituteur, jamais appliquées sans sa validation. Données du
 * tenant (≤ 300 caractères) ; une phrase `placeholder` est étiquetée dans l'interface.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryCreatePhraseBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import { filterPhrases, type PhraseFilter } from "../domain/competency";
import { PrimaryCode, conflict, notFound } from "../domain/errors";
import type { Phrase, Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import { getPhraseRow, insertPhraseRow, listPhraseRows, updatePhraseRow } from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";

export async function listPhrases(deps: PrimarySchoolDeps, ctx: RequestContext, filter: PhraseFilter = {}): Promise<Result<Phrase[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(filterPhrases(await listPhraseRows(tx), filter)), { readOnly: true });
}

export async function createPhrase(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryCreatePhraseBody): Promise<Result<Phrase, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const phrase = await guarded(
      () => insertPhraseRow(tx, { id: deps.newId(), tenantId: ctx.tenantId, code: input.code, scope: input.scope, body: input.body, ratingLevelCode: input.ratingLevelCode ?? null, gradeLevelCode: input.gradeLevelCode ?? null, sourceKind: input.sourceKind }),
      () => conflict(PrimaryCode.PHRASE_DUPLICATE, `Une phrase de code « ${input.code} » existe déjà.`, { code: input.code }),
    );
    const events = new EventBuffer(deps, ctx);
    // Le TEXTE de la phrase n'est pas journalisé : son code suffit.
    events.audit({ action: "primary_school.phrase.created", resourceType: "appreciation_phrase", resourceId: phrase.id, after: { code: phrase.code, scope: phrase.scope } });
    await events.flush(tx);
    return ok(phrase);
  });
}

export async function updatePhrase(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  id: Uuid,
  patch: { body?: string | undefined; ratingLevelCode?: string | null | undefined; gradeLevelCode?: string | null | undefined; active?: boolean | undefined },
): Promise<Result<Phrase, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getPhraseRow(tx, id);
    if (!current) return err(notFound(PrimaryCode.PHRASE_NOT_FOUND, "Phrase", id));
    const updated = (await updatePhraseRow(tx, id, patch)) as Phrase;
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.phrase.updated", resourceType: "appreciation_phrase", resourceId: id, before: { active: current.active }, after: { active: updated.active } });
    await events.flush(tx);
    return ok(updated);
  });
}

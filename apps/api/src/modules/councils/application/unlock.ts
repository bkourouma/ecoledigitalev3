/**
 * Verrouillage et déverrouillage motivé (spec 006 US5).
 *
 *  - `CLOSED` et `SIGNED` verrouillent (gardes de la base, valables pour tout rôle). Déverrouiller = DEMANDE MOTIVÉE (20 caractères)
 *    APPROUVÉE — par une AUTRE personne que le demandeur quand l'établissement l'impose (quatre yeux, défaut) —, consommée par UNE
 *    réouverture, refusée tant qu'un effet est `APPLIED` (il doit d'abord être annulé, ou il est irréversible).
 *  - La réouverture remplace le PV (version n+1 à la reclôture) et écarte les effets non appliqués ; elle est publiée
 *    (`councils.council.reopened`) pour que les bulletins concernés soient marqués « à rééditer ».
 *  - Approuver est une opération SENSIBLE (MFA, audit). `councils` ne rouvre JAMAIS un conseil de lui-même.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { CouncilsCouncilDetailDto, CouncilsUnlockDto } from "@ecoledigitale/contracts/src/v2/councils";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import * as repo from "../infrastructure/councils-repository";
import * as effectsRepo from "../infrastructure/effects-repository";
import * as minutesRepo from "../infrastructure/minutes-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type CouncilsDeps } from "./deps";
import { councilPayload, detailOf } from "./councils";
import { actorNameOf, assertMayView, loadCouncil } from "./support";
import { unlockDto } from "./views";

export async function listUnlockRequests(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<{ items: CouncilsUnlockDto[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const council = await loadCouncil(tx, councilId);
      if (!council.ok) return council;
      const may = await assertMayView(deps, ctx, caps, council.value);
      if (!may.ok) return may;
      return ok({ items: (await minutesRepo.listUnlocks(tx, councilId)).map(unlockDto) });
    },
    { readOnly: true },
  );
}

export async function requestUnlock(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string, input: { reason: string }): Promise<Result<CouncilsUnlockDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.unlockRequest) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Demander un déverrouillage exige l'autorisation dédiée."));
  const reason = input.reason.trim();
  if (reason.length < 20) return err(invalid(CouncilsCode.INVALID_INPUT, "Le motif de déverrouillage doit faire 20 caractères au moins.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const council = await loadCouncil(tx, councilId, { lock: true });
    if (!council.ok) return council;
    if (council.value.status !== "CLOSED" && council.value.status !== "SIGNED") return err(conflict(CouncilsCode.INVALID_STATE, `La séance n'est pas verrouillée (état : ${council.value.status}).`));
    const id = deps.newId();
    await minutesRepo.insertUnlock(tx, { id, tenantId: ctx.tenantId, councilId, requestedBy: human.value, requestedByName: await actorNameOf(deps, ctx), reason });
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.UNLOCK_REQUESTED, { v: 1, unlockRequestId: id, councilId }, { type: "councils.unlock_request", id });
    ev.audit({ action: "councils.unlock.requested", resourceType: "unlock_request", resourceId: id, sensitive: true, reason, after: { councilId } });
    await ev.flush(tx);
    return ok(unlockDto((await minutesRepo.getUnlock(tx, id)) as NonNullable<Awaited<ReturnType<typeof minutesRepo.getUnlock>>>));
  });
}

async function decide(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string, status: "APPROVED" | "REJECTED", note: string | undefined): Promise<Result<CouncilsUnlockDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.unlockApprove) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Approuver ou refuser un déverrouillage exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const req = await minutesRepo.getUnlock(tx, id, { lock: true });
    if (!req) return err(notFound(CouncilsCode.NOT_FOUND, "Demande de déverrouillage", id));
    if (req.status !== "REQUESTED") return err(conflict("councils.unlock_transition", `Cette demande est déjà ${req.status}.`));
    const council = await loadCouncil(tx, req.councilId);
    if (!council.ok) return council;
    const settings = await reference.getSettings(tx, council.value.institutionId);
    const samePerson = req.requestedBy === human.value;
    // Quatre yeux : l'approbation vient d'une AUTRE personne que le demandeur quand l'établissement l'impose (la base le revérifie).
    if (status === "APPROVED" && samePerson && (settings?.requireSeparateUnlocker ?? true)) return err(forbidden("councils.four_eyes_required", "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)."));
    await minutesRepo.decideUnlock(tx, id, { status, decidedBy: human.value, decidedByName: await actorNameOf(deps, ctx), note: note ?? null, fourEyesWaived: samePerson });
    const ev = new EventBuffer(deps, ctx);
    ev.add(status === "APPROVED" ? CouncilsEvents.UNLOCK_APPROVED : CouncilsEvents.UNLOCK_REJECTED, { v: 1, unlockRequestId: id, councilId: req.councilId }, { type: "councils.unlock_request", id });
    ev.audit({ action: status === "APPROVED" ? "councils.unlock.approved" : "councils.unlock.rejected", resourceType: "unlock_request", resourceId: id, sensitive: true, reason: note ?? null, after: { councilId: req.councilId, samePerson } });
    await ev.flush(tx);
    return ok(unlockDto((await minutesRepo.getUnlock(tx, id)) as NonNullable<Awaited<ReturnType<typeof minutesRepo.getUnlock>>>));
  });
}

export const approveUnlock = (deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { note?: string | undefined }): Promise<Result<CouncilsUnlockDto, AppError>> => decide(deps, ctx, caps, id, "APPROVED", input.note);
export const rejectUnlock = (deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { note: string }): Promise<Result<CouncilsUnlockDto, AppError>> => decide(deps, ctx, caps, id, "REJECTED", input.note);

/**
 * Rouvre la séance : exige UNE demande approuvée, la consomme, et refuse tant qu'un effet est `APPLIED`. La base impose tout cela
 * (`councils.unlock_not_approved`, `councils.effect_irreversible`, `councils.four_eyes_required`) ; ici, des messages précis avant d'écrire.
 */
export async function reopenCouncil(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsCouncilDetailDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.unlockApprove) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Rouvrir une séance exige l'autorisation d'approuver un déverrouillage."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "CLOSED" && council.status !== "SIGNED") return err(conflict(CouncilsCode.INVALID_STATE, `La séance n'est pas verrouillée (état : ${council.status}).`));
    const approved = (await minutesRepo.listUnlocks(tx, councilId)).find((u) => u.status === "APPROVED");
    if (!approved) return err(forbidden("councils.unlock_not_approved", "Le déverrouillage exige une demande motivée approuvée."));
    const applied = (await effectsRepo.listEffectsOfCouncil(tx, councilId)).filter((e) => e.status === "APPLIED");
    if (applied.length > 0) {
      const irreversible = applied.some((e) => e.irreversible);
      return err(conflict("councils.effect_irreversible", irreversible ? "Des effets appliqués sont irréversibles : la séance ne peut plus être rouverte (corrigez par une décision de la direction hors conseil)." : "Des effets appliqués doivent d'abord être annulés avant la réouverture.", { effects: applied.map((e) => ({ id: e.id, kind: e.effectKind, irreversible: e.irreversible })) }));
    }
    const previous = await minutesRepo.getLiveMinutes(tx, councilId);
    await repo.reopenCouncilRow(tx, councilId);
    const reopened = (await repo.getCouncil(tx, councilId)) as CouncilRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_REOPENED, { ...councilPayload(reopened), reopenCount: reopened.reopenCount }, { type: "councils.council", id: councilId });
    if (previous) ev.add(CouncilsEvents.MINUTES_SUPERSEDED, { v: 1, minutesId: previous.id, councilId, version: previous.version, snapshotHash: previous.snapshotHash }, { type: "councils.minutes", id: previous.id });
    ev.audit({ action: "councils.council.reopened", resourceType: "council", resourceId: councilId, sensitive: true, reason: approved.reason, after: { reopenCount: reopened.reopenCount, unlockRequestId: approved.id } });
    await ev.flush(tx);
    return ok(await detailOf(deps, ctx, tx, reopened));
  });
}

/** Job quotidien : une demande restée ouverte (ou approuvée sans réouverture) au-delà du délai paramétré passe `EXPIRED`. */
export async function expireUnlockRequests(deps: CouncilsDeps, ctx: RequestContext): Promise<Result<{ expired: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const before = new Date(deps.clock.now().getTime() - deps.config.unlockExpiryDays * 86_400_000);
    const rows = await minutesRepo.listOpenUnlockRequestsBefore(tx, before);
    const ev = new EventBuffer(deps, ctx);
    for (const r of rows) {
      await minutesRepo.expireUnlock(tx, r.id);
      ev.audit({ action: "councils.unlock.expired", resourceType: "unlock_request", resourceId: r.id, after: { councilId: r.councilId } });
    }
    await ev.flush(tx);
    return ok({ expired: rows.length });
  });
}

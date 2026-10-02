/**
 * Délibération : propositions (suggestions des règles et propositions humaines), résolution humaine, décisions (spec 006 US3).
 *
 *  - L'HUMAIN DÉCIDE : une suggestion de règle n'a aucune valeur sans humain ; elle ne passe `ACCEPTED`/`REJECTED` que par un utilisateur
 *    identifié (`resolved_by` posé par la base) ; une décision exige un utilisateur de session ET un DÉCIDEUR participant PRÉSENT dont le
 *    rôle porte `can_decide` ; code, famille et groupe exclusif sont recopiés du type PAR LA BASE.
 *  - La suggestion et la décision sont conservées côte à côte ; s'en écarter (familles PASSAGE / REPEAT) exige une justification de
 *    20 caractères ; décider un passage ou un redoublement pour un élève SANS résultat exploitable exige la même justification.
 *  - Une décision référence la version de l'instantané sur laquelle elle est prise (posée par la base).
 *  - Aucune règle de décision ici : on compare des codes fournis par `results`, on ne calcule rien.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsDecisionDto, CouncilsDecisionInput, CouncilsProposalDto, CouncilsProposalInput } from "@ecoledigitale/contracts/src/v2/councils";
import { requiredJustificationLength, traceSuggestion } from "../domain/decisions";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import * as repo from "../infrastructure/councils-repository";
import * as reference from "../infrastructure/reference-repository";
import type { AgendaItemRow, CouncilRow, DecisionRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type CouncilsDeps } from "./deps";
import { actorNameOf, assertMayView, loadCouncil } from "./support";
import { decisionDto, factsOf, proposalDto } from "./views";

async function loadItem(tx: Tx, itemId: string, lock = false): Promise<Result<{ item: AgendaItemRow; council: CouncilRow }, AppError>> {
  const item = await repo.getAgendaItem(tx, itemId, { lock });
  if (!item) return err(notFound(CouncilsCode.NOT_FOUND, "Élève de l'ordre du jour", itemId));
  const council = await repo.getCouncil(tx, item.councilId, { lock });
  return council ? ok({ item, council }) : err(notFound(CouncilsCode.NOT_FOUND, "Conseil", item.councilId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Propositions
// ---------------------------------------------------------------------------------------------------------------------

export async function listProposalsView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string): Promise<Result<CouncilsProposalDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadItem(tx, itemId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value.council);
      if (!may.ok) return may;
      return ok((await repo.listProposals(tx, itemId)).map(proposalDto));
    },
    { readOnly: true },
  );
}

/** Proposition HUMAINE (appréciation générale, distinction, remarque, décision proposée) : l'auteur est l'utilisateur de la session. */
export async function addProposal(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string, input: CouncilsProposalInput): Promise<Result<CouncilsProposalDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.proposalWrite && !caps.decisionRecord) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Proposer exige l'autorisation de proposition."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadItem(tx, itemId, true);
    if (!loaded.ok) return loaded;
    const { council } = loaded.value;
    const may = await assertMayView(deps, ctx, caps, council);
    if (!may.ok) return may;
    if (council.status !== "PLANNED" && council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Les propositions d'une séance ${council.status} sont figées.`));
    const id = deps.newId();
    await repo.insertProposal(tx, { id, tenantId: ctx.tenantId, councilId: council.id, agendaItemId: itemId, kind: input.kind, code: input.code ?? null, body: input.body ?? null, origin: "HUMAN", proposedBy: human.value, proposedByName: await actorNameOf(deps, ctx), ruleVersionRef: null });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.proposal.created", resourceType: "proposal", resourceId: id, after: { kind: input.kind, councilId: council.id, hasBody: input.body !== undefined } });
    await ev.flush(tx);
    return ok(proposalDto((await repo.getProposal(tx, id)) as NonNullable<Awaited<ReturnType<typeof repo.getProposal>>>));
  });
}

/** Accepte, refuse ou retire une proposition : acte d'un utilisateur identifié, jamais d'un job (suggestion de règle comprise). */
export async function resolveProposal(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, proposalId: string, action: "ACCEPTED" | "REJECTED" | "WITHDRAWN", input: { note?: string | undefined }): Promise<Result<CouncilsProposalDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.decisionRecord) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Résoudre une proposition exige l'autorisation d'enregistrer les décisions."));
  return inTx(deps, ctx, async (tx) => {
    const proposal = await repo.getProposal(tx, proposalId, { lock: true });
    if (!proposal) return err(notFound(CouncilsCode.NOT_FOUND, "Proposition", proposalId));
    const council = await loadCouncil(tx, proposal.councilId, { lock: true });
    if (!council.ok) return council;
    if (council.value.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, "Une proposition se résout séance ouverte."));
    if (proposal.status !== "PROPOSED") return err(conflict("councils.proposal_resolved", `Cette proposition est déjà ${proposal.status}.`));
    await repo.resolveProposal(tx, proposalId, action, human.value, input.note ?? null);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: `councils.proposal.${action.toLowerCase()}`, resourceType: "proposal", resourceId: proposalId, sensitive: true, after: { kind: proposal.kind, origin: proposal.origin, councilId: proposal.councilId } });
    await ev.flush(tx);
    return ok(proposalDto((await repo.getProposal(tx, proposalId)) as NonNullable<Awaited<ReturnType<typeof repo.getProposal>>>));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------------------------------------------------

async function decisionViews(tx: Tx, councilId: string, rows: readonly DecisionRow[]): Promise<CouncilsDecisionDto[]> {
  const types = new Map((await reference.listDecisionTypes(tx)).map((t) => [t.id, t]));
  const participants = new Map((await repo.listParticipants(tx, councilId)).map((p) => [p.id, p]));
  return rows.map((d) => decisionDto(d, { typeLabel: types.get(d.decisionTypeId)?.label ?? null, deciderName: participants.get(d.deciderParticipantId)?.displayName ?? null }));
}

export async function listDecisionsView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string): Promise<Result<CouncilsDecisionDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadItem(tx, itemId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value.council);
      if (!may.ok) return may;
      return ok(await decisionViews(tx, loaded.value.council.id, await repo.listDecisionsOfItem(tx, itemId)));
    },
    { readOnly: true },
  );
}

const decisionPayload = (d: DecisionRow): { v: 1 } & Record<string, unknown> => ({ v: 1, decisionId: d.id, councilId: d.councilId, enrollmentId: d.enrollmentId, studentId: d.studentId, decisionTypeCode: d.decisionTypeCode, family: d.family });

export async function recordDecision(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string, input: CouncilsDecisionInput): Promise<Result<CouncilsDecisionDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.decisionRecord) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Enregistrer une décision exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadItem(tx, itemId, true);
    if (!loaded.ok) return loaded;
    const { item, council } = loaded.value;
    if (council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Les décisions se prennent séance ouverte (état : ${council.status}).`));
    const type = await reference.getDecisionType(tx, input.decisionTypeId);
    if (!type) return err(notFound(CouncilsCode.TYPE_NOT_FOUND, "Type de décision", input.decisionTypeId));
    if (!type.active) return err(conflict(CouncilsCode.TYPE_INACTIVE, "Ce type de décision est désactivé."));
    if (type.appliesTo !== "BOTH" && type.appliesTo !== council.scope) return err(invalid("councils.decision_scope", "Ce type de décision ne s'applique pas à ce type de séance.", "decisionTypeId"));
    const decider = await repo.getParticipant(tx, input.deciderParticipantId);
    if (!decider || decider.councilId !== council.id) return err(notFound(CouncilsCode.NOT_A_PARTICIPANT, "Participant", input.deciderParticipantId));
    if (decider.presence !== "PRESENT") return err(invalid("councils.decider_not_present", "Le décideur doit être un participant présent de la séance.", "deciderParticipantId"));
    const role = await reference.getRoleByCode(tx, decider.roleCode);
    if (!role?.canDecide) return err(invalid("councils.decider_not_allowed", "Ce rôle ne peut pas porter une décision.", "deciderParticipantId"));
    if (type.requiresVote && input.mode !== "VOTE") return err(invalid("councils.vote_required", "Ce type de décision exige un vote.", "mode"));
    if (type.requiresTarget && input.targetGradeLevelId === undefined) return err(invalid("councils.target_required", "Ce type de décision exige une série ou un niveau visé.", "targetGradeLevelId"));
    if (type.requiresJustification && (input.justification?.trim().length ?? 0) < 10) return err(invalid("councils.justification_required", "Ce type de décision exige une justification (10 caractères au moins).", "justification"));

    const facts = factsOf(item);
    const trace = traceSuggestion({ facts, family: type.family, finalCode: type.resultsFinalCode });
    const needed = requiredJustificationLength({ family: type.family, differsFromSuggestion: trace.differsFromSuggestion, facts });
    if (needed > 0 && (input.justification?.trim().length ?? 0) < needed) {
      return err(invalid(CouncilsCode.JUSTIFICATION_REQUIRED, `Cette décision ${trace.differsFromSuggestion ? "s'écarte de la suggestion de la règle" : "concerne un élève sans résultat exploitable"} : une justification de ${needed} caractères au moins est exigée.`, "justification"));
    }

    // Deux décisions d'un même groupe exclusif ne coexistent pas : la première est RETIRÉE avec un motif, la nouvelle porte `supersedes_id`.
    let supersedes: string | null = null;
    if (type.exclusiveGroup) {
      const live = (await repo.listDecisionsOfItem(tx, itemId)).find((d) => d.status === "RECORDED" && d.exclusiveGroup === type.exclusiveGroup);
      if (live) {
        if (input.supersedesDecisionId !== live.id) return err(conflict(CouncilsCode.DUPLICATE, "Une décision du même groupe existe déjà pour cet élève : désignez-la pour la remplacer (avec un motif de retrait).", { decisionId: live.id }));
        await repo.withdrawDecision(tx, live.id, input.supersedeReason as string);
        supersedes = live.id;
      }
    } else if (input.supersedesDecisionId !== undefined) {
      return err(invalid(CouncilsCode.INVALID_INPUT, "Cette décision n'appartient à aucun groupe exclusif : elle n'en remplace aucune.", "supersedesDecisionId"));
    }

    const id = deps.newId();
    await repo.insertDecision(tx, {
      id,
      tenantId: ctx.tenantId,
      councilId: council.id,
      agendaItemId: itemId,
      enrollmentId: item.enrollmentId,
      studentId: item.studentId,
      decisionTypeId: type.id,
      decisionTypeCode: type.code,
      family: type.family,
      suggestedCode: trace.suggestedCode,
      suggestionRef: trace.suggestionRef,
      differsFromSuggestion: trace.differsFromSuggestion,
      justification: input.justification?.trim() ?? null,
      decisionMode: input.mode,
      votesFor: input.mode === "VOTE" ? (input.votesFor ?? null) : null,
      votesAgainst: input.mode === "VOTE" ? (input.votesAgainst ?? null) : null,
      votesAbstain: input.mode === "VOTE" ? (input.votesAbstain ?? null) : null,
      targetProgramId: input.targetProgramId ?? null,
      targetGradeLevelId: input.targetGradeLevelId ?? null,
      targetLabel: input.targetLabel ?? null,
      deciderParticipantId: decider.id,
      recordedBy: human.value,
      recordedByName: await actorNameOf(deps, ctx),
      supersedesId: supersedes,
    });
    const row = (await repo.getDecision(tx, id)) as DecisionRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.DECISION_RECORDED, decisionPayload(row), { type: "councils.decision", id });
    ev.audit({
      action: "councils.decision.recorded",
      resourceType: "decision",
      resourceId: id,
      sensitive: true,
      // jamais la justification : le code, la famille, l'écart et la version de l'instantané
      after: { councilId: council.id, enrollmentId: row.enrollmentId, decisionTypeCode: row.decisionTypeCode, family: row.family, differsFromSuggestion: row.differsFromSuggestion, factsVersion: row.factsVersion, supersedes },
    });
    await ev.flush(tx);
    return ok((await decisionViews(tx, council.id, [row]))[0] as CouncilsDecisionDto);
  });
}

export async function withdrawDecision(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, decisionId: string, input: { reason: string }): Promise<Result<CouncilsDecisionDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.decisionRecord) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Retirer une décision exige l'autorisation dédiée."));
  const reason = input.reason.trim();
  if (reason.length < 5) return err(invalid(CouncilsCode.INVALID_INPUT, "Le motif de retrait doit faire 5 caractères au moins.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const decision = await repo.getDecision(tx, decisionId, { lock: true });
    if (!decision) return err(notFound(CouncilsCode.NOT_FOUND, "Décision", decisionId));
    const council = await loadCouncil(tx, decision.councilId, { lock: true });
    if (!council.ok) return council;
    if (council.value.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, "Une décision se retire séance ouverte ; sinon, demandez un déverrouillage motivé."));
    if (decision.status !== "RECORDED") return err(conflict("councils.decision_final", `Cette décision est déjà ${decision.status}.`));
    await repo.withdrawDecision(tx, decisionId, reason);
    const row = (await repo.getDecision(tx, decisionId)) as DecisionRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.DECISION_WITHDRAWN, decisionPayload(row), { type: "councils.decision", id: decisionId });
    ev.audit({ action: "councils.decision.withdrawn", resourceType: "decision", resourceId: decisionId, sensitive: true, reason, after: { councilId: row.councilId, family: row.family } });
    await ev.flush(tx);
    return ok((await decisionViews(tx, row.councilId, [row]))[0] as CouncilsDecisionDto);
  });
}

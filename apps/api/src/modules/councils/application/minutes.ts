/**
 * Procès-verbal : snapshot immuable, hash calculé par la BASE, signatures datées sur CE hash, passage automatique à `SIGNED` (spec 006 US4).
 *
 *  - Le snapshot `council-minutes/1` est construit de façon DÉTERMINISTE (domaine pur) ; le PDF est rendu par le worker (`reportcards`,
 *    nature `COUNCIL_MINUTES`) DEPUIS CE SNAPSHOT SEUL ; la signature complète passe PV puis séance à `SIGNED` PAR LA BASE (aucune
 *    étape manuelle, signatures sérialisées par verrou de ligne).
 *  - L'HUMAIN signe : un participant signe pour LUI-MÊME (sa fiche de personnel est liée à son compte) ; une signature papier
 *    numérisée est enregistrée par le secrétariat avec sa pièce. La base refuse un hash différent, un participant non exigé ou absent.
 *  - Une réouverture remplace le PV (version n+1) sans l'effacer ; un PV `SUPERSEDED` reste consultable.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsMinutesDetailDto, CouncilsMinutesDto, CouncilsMinutesSnapshot } from "@ecoledigitale/contracts/src/v2/councils";
import { buildFacts, type FactsSources } from "../domain/facts";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import { buildMinutesSnapshot, type MinutesInput } from "../domain/minutes";
import * as repo from "../infrastructure/councils-repository";
import * as minutesRepo from "../infrastructure/minutes-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow, MinutesRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type CouncilsDeps } from "./deps";
import { applyPendingEffects, planEffects } from "./effects";
import { councilPayload } from "./councils";
import { assertMayView, councilRefOf, displayContext, loadCouncil } from "./support";
import { factsOf, minutesDto, placeholderNoticeOf } from "./views";

const minutesPayload = (m: MinutesRow): { v: 1 } & Record<string, unknown> => ({ v: 1, minutesId: m.id, councilId: m.councilId, version: m.version, snapshotHash: m.snapshotHash });

const EMPTY_FACTS: FactsSources = { results: null, attendance: null, discipline: null, funding: { type: null, stateAssigned: false }, repeating: false };

async function viewOf(tx: Tx, m: MinutesRow): Promise<CouncilsMinutesDto> {
  const snapshot = await minutesRepo.getSnapshot(tx, m.id);
  const missing = m.status === "GENERATED" ? await minutesRepo.missingSigners(tx, m.id) : [];
  return minutesDto(m, { signatures: await minutesRepo.listSignatures(tx, m.id), missing, placeholderNotice: placeholderNoticeOf(snapshot) });
}

/** Génère le procès-verbal d'une séance CLOSE : snapshot déterministe, hash posé par la base, rendu demandé au worker. */
export async function generateMinutes(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsMinutesDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.minutesGenerate) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Générer le procès-verbal exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "CLOSED") return err(conflict(CouncilsCode.INVALID_STATE, `Le procès-verbal se génère séance close (état : ${council.status}).`));
    if (!council.heldOn) return err(conflict(CouncilsCode.INVALID_STATE, "La séance n'a pas de date réelle."));
    const live = await minutesRepo.getLiveMinutes(tx, councilId);
    if (live) return err(conflict(CouncilsCode.ALREADY_EXISTS, "Un procès-verbal vivant existe déjà pour cette séance : réouvrez la séance (déverrouillage motivé) pour en produire une nouvelle version."));
    const type = (await reference.getCouncilTypesByIds(tx, [council.councilTypeId]))[0];
    if (!type) return err(notFound(CouncilsCode.TYPE_NOT_FOUND, "Type de conseil", council.councilTypeId));
    const display = await displayContext(deps, ctx, council, type, undefined, { withRuleSource: false });
    const classroom = await deps.ports.academic.getClassroom(ctx, council.classroomId).catch((e: unknown) => (isAppError(e) ? null : Promise.reject(e)));
    const institutionName = await deps.ports.academic.getInstitutionName(ctx, council.institutionId).catch((e: unknown) => (isAppError(e) ? null : Promise.reject(e)));
    const state = await deps.ports.resultsRead.getStateView(ctx, { classroomId: council.classroomId, academicYearId: council.academicYearId, academicPeriodId: council.academicPeriodId }).catch((e: unknown) => (isAppError(e) ? null : Promise.reject(e)));
    const participants = await repo.listParticipants(tx, councilId);
    const items = await repo.listAgendaItems(tx, councilId);
    const decisions = await repo.listDecisionsOfCouncil(tx, councilId, { recordedOnly: true });
    const byParticipant = new Map(participants.map((p) => [p.id, p]));
    const input: MinutesInput = {
      council: {
        id: council.id,
        institutionId: council.institutionId,
        institutionName,
        classroomId: council.classroomId,
        classroomName: display.classroomName,
        gradeLevelCode: classroom?.gradeLevelCode ?? null,
        academicYearId: council.academicYearId,
        academicPeriodId: council.academicPeriodId,
        periodLabel: display.periodLabel,
        typeCode: type.code,
        typeLabel: type.label,
        scope: council.scope,
        heldOn: council.heldOn,
        location: council.location,
        reopenCount: council.reopenCount,
        quorumWaived: council.quorumWaived,
        quorumWaiverReason: council.quorumWaiverReason,
        signerFunctions: type.signerFunctions,
        signerRoleCodes: type.signerRoleCodes,
        ruleVersionRef: state?.ruleVersionRef ?? null,
        ruleSourceKind: state?.ruleSourceKind ?? null,
      },
      participants: participants.map((p) => ({ id: p.id, displayName: p.displayName, roleCode: p.roleCode, councilFunction: p.councilFunction, presence: p.presence })),
      students: items.map((i) => ({ agendaItemId: i.id, enrollmentId: i.enrollmentId, studentId: i.studentId, name: i.studentDisplayName, position: i.position, factsVersion: i.factsVersion, factsHash: i.factsHash, facts: factsOf(i) ?? buildFacts(EMPTY_FACTS) })),
      decisions: decisions.map((d) => ({
        agendaItemId: d.agendaItemId,
        decisionTypeCode: d.decisionTypeCode,
        family: d.family,
        suggestedCode: d.suggestedCode,
        differsFromSuggestion: d.differsFromSuggestion,
        justification: d.justification,
        mode: d.decisionMode,
        votesFor: d.votesFor,
        votesAgainst: d.votesAgainst,
        votesAbstain: d.votesAbstain,
        targetLabel: d.targetLabel,
        deciderName: byParticipant.get(d.deciderParticipantId)?.displayName ?? "",
      })),
      proposals: (await repo.listProposalsOfCouncil(tx, councilId)).map((p) => ({ agendaItemId: p.agendaItemId, kind: p.kind, code: p.code, body: p.body, status: p.status, createdAt: p.createdAt.toISOString() })),
    };
    const snapshot: CouncilsMinutesSnapshot = buildMinutesSnapshot(input);
    const id = deps.newId();
    await minutesRepo.insertMinutes(tx, { id, tenantId: ctx.tenantId, councilId, snapshot, generatedBy: human.value });
    const row = (await minutesRepo.getMinutes(tx, id)) as MinutesRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.MINUTES_GENERATED, minutesPayload(row), { type: "councils.minutes", id });
    ev.audit({ action: "councils.minutes.generated", resourceType: "minutes", resourceId: id, after: { councilId, version: row.version, snapshotHash: row.snapshotHash } });
    await ev.flush(tx);
    return ok(await viewOf(tx, row));
  });
}

export async function listMinutesView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<{ items: CouncilsMinutesDto[] }, AppError>> {
  if (!caps.minutesRead) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Consulter un procès-verbal exige l'autorisation dédiée."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadCouncil(tx, councilId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value);
      if (!may.ok) return may;
      const items: CouncilsMinutesDto[] = [];
      for (const m of await minutesRepo.listMinutesOfCouncil(tx, councilId)) items.push(await viewOf(tx, m));
      return ok({ items });
    },
    { readOnly: true },
  );
}

export async function getMinutesDetail(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, minutesId: string): Promise<Result<CouncilsMinutesDetailDto, AppError>> {
  if (!caps.minutesRead) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Consulter un procès-verbal exige l'autorisation dédiée."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const m = await minutesRepo.getMinutes(tx, minutesId);
      if (!m) return err(notFound(CouncilsCode.NOT_FOUND, "Procès-verbal", minutesId));
      const council = await loadCouncil(tx, m.councilId);
      if (!council.ok) return council;
      const may = await assertMayView(deps, ctx, caps, council.value);
      if (!may.ok) return may;
      return ok({ minutes: await viewOf(tx, m), snapshot: (await minutesRepo.getSnapshot(tx, minutesId)) as CouncilsMinutesSnapshot });
    },
    { readOnly: true },
  );
}

/** URL signée (≤ 5 min) du PDF rendu, après contrôle de permission. Un PV `SUPERSEDED` reste téléchargeable. */
export async function getMinutesPdf(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, minutesId: string): Promise<Result<{ url: string; expiresAt: string; renderHash: string }, AppError>> {
  const human = requireHuman(ctx); // une URL signée est délivrée à un utilisateur identifié et journalisée
  if (!human.ok) return human;
  if (!caps.minutesRead) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Télécharger un procès-verbal exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const m = await minutesRepo.getMinutes(tx, minutesId);
    if (!m) return err(notFound(CouncilsCode.NOT_FOUND, "Procès-verbal", minutesId));
    const council = await loadCouncil(tx, m.councilId);
    if (!council.ok) return council;
    const may = await assertMayView(deps, ctx, caps, council.value);
    if (!may.ok) return may;
    const doc = await deps.ports.documents.getMinutesDocument(ctx, minutesId);
    if (!doc || doc.renderStatus !== "RENDERED" || !doc.objectKey) return err(conflict(CouncilsCode.MINUTES_NOT_RENDERED, "Le PDF du procès-verbal n'est pas encore prêt : le rendu est en cours.", { renderStatus: doc?.renderStatus ?? "NOT_REQUESTED" }));
    const ttl = Math.min(300, Math.max(30, deps.config.pdfUrlTtlSeconds));
    const signed = await deps.ports.documents.signedReadUrl(ctx, doc.objectKey, ttl);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.minutes.downloaded", resourceType: "minutes", resourceId: minutesId, after: { version: m.version } });
    await ev.flush(tx);
    return ok({ url: signed.url, expiresAt: signed.expiresAt.toISOString(), renderHash: doc.pdfHash ?? m.renderHash ?? m.snapshotHash });
  });
}

/** Suite d'une signature : si la base a passé la séance à `SIGNED`, publier, marquer la délibération signée et produire les effets. */
async function afterSignature(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, ev: EventBuffer, minutesId: string, councilBefore: CouncilRow): Promise<void> {
  const council = (await repo.getCouncil(tx, councilBefore.id)) as CouncilRow;
  const minutes = (await minutesRepo.getMinutes(tx, minutesId)) as MinutesRow;
  if (council.status === "SIGNED" && councilBefore.status !== "SIGNED") {
    ev.add(CouncilsEvents.MINUTES_SIGNED, minutesPayload(minutes), { type: "councils.minutes", id: minutesId });
    ev.add(CouncilsEvents.COUNCIL_SIGNED, councilPayload(council), { type: "councils.council", id: council.id });
    ev.audit({ action: "councils.council.signed", resourceType: "council", resourceId: council.id, sensitive: true, after: { minutesId, version: minutes.version } });
    if (council.resultsDeliberationId && council.heldOn) await deps.ports.resultsWrite.markDeliberationSigned(ctx, { deliberationId: council.resultsDeliberationId, heldOn: council.heldOn, councilRef: councilRefOf(council.id) });
    await planEffects(deps, ctx, tx, ev, council);
    await applyPendingEffects(deps, ctx, tx, ev, council);
  }
}

async function loadSignable(tx: Tx, minutesId: string): Promise<Result<{ minutes: MinutesRow; council: CouncilRow }, AppError>> {
  const minutes = await minutesRepo.getMinutes(tx, minutesId, { lock: true });
  if (!minutes) return err(notFound(CouncilsCode.NOT_FOUND, "Procès-verbal", minutesId));
  const council = await repo.getCouncil(tx, minutes.councilId, { lock: true });
  if (!council) return err(notFound(CouncilsCode.NOT_FOUND, "Conseil", minutes.councilId));
  if (minutes.status !== "GENERATED") return err(conflict("councils.minutes_not_signable", `Ce procès-verbal est ${minutes.status} : il ne se signe plus.`));
  return ok({ minutes, council });
}

/** Signature électronique : le participant signe pour LUI-MÊME le hash du PV (l'identité vient du compte, jamais de la requête). */
export async function signMinutes(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, minutesId: string): Promise<Result<CouncilsMinutesDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.minutesSign) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Signer un procès-verbal exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadSignable(tx, minutesId);
    if (!loaded.ok) return loaded;
    const { minutes, council } = loaded.value;
    const staffId = await deps.ports.staff.staffIdOfUser(ctx, human.value);
    if (!staffId) return err(forbidden(CouncilsCode.NOT_A_PARTICIPANT, "Votre compte n'est lié à aucune fiche du personnel : vous ne pouvez pas signer en tant que participant."));
    const mine = new Set((await repo.listParticipantsOfStaff(tx, council.id, staffId)).map((p) => p.id));
    const missing = (await minutesRepo.missingSigners(tx, minutesId)).filter((p) => mine.has(p.participantId));
    if (missing.length === 0) {
      const already = (await minutesRepo.listSignatures(tx, minutesId)).some((s) => mine.has(s.participantId));
      return err(already ? conflict(CouncilsCode.DUPLICATE, "Vous avez déjà signé ce procès-verbal.") : forbidden(CouncilsCode.NOT_A_PARTICIPANT, "Vous n'êtes pas un signataire exigé de ce procès-verbal (ou vous n'êtes pas présent)."));
    }
    const ev = new EventBuffer(deps, ctx);
    for (const signer of missing) {
      const id = deps.newId();
      await minutesRepo.insertSignature(tx, { id, tenantId: ctx.tenantId, minutesId, participantId: signer.participantId, method: "ELECTRONIC", signedHash: minutes.snapshotHash, signedByUser: human.value, evidenceObjectKey: null });
      ev.audit({ action: "councils.minutes.signed_by_participant", resourceType: "minutes", resourceId: minutesId, sensitive: true, after: { participantId: signer.participantId, method: "ELECTRONIC", snapshotHash: minutes.snapshotHash } });
    }
    await afterSignature(deps, ctx, tx, ev, minutesId, council);
    await ev.flush(tx);
    return ok(await viewOf(tx, (await minutesRepo.getMinutes(tx, minutesId)) as MinutesRow));
  });
}

/** Signature papier numérisée d'un participant, enregistrée par le secrétariat avec sa pièce (jamais sans pièce). */
export async function addPaperSignature(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, minutesId: string, input: { participantId: string; evidenceObjectKey: string }): Promise<Result<CouncilsMinutesDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.minutesSign) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Enregistrer une signature exige l'autorisation dédiée."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadSignable(tx, minutesId);
    if (!loaded.ok) return loaded;
    const { minutes, council } = loaded.value;
    if (!(await deps.ports.storage.objectExists(ctx, input.evidenceObjectKey))) return err(invalid(CouncilsCode.INVALID_REFERENCE, "La pièce de la signature papier est introuvable dans le stockage.", "evidenceObjectKey"));
    const missing = (await minutesRepo.missingSigners(tx, minutesId)).find((p) => p.participantId === input.participantId);
    if (!missing) return err(invalid("councils.not_a_signer", "Ce participant n'est pas un signataire exigé (ou a déjà signé, ou n'est pas présent).", "participantId"));
    await minutesRepo.insertSignature(tx, { id: deps.newId(), tenantId: ctx.tenantId, minutesId, participantId: input.participantId, method: "SCANNED_PAPER", signedHash: minutes.snapshotHash, signedByUser: human.value, evidenceObjectKey: input.evidenceObjectKey });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.minutes.paper_signature_recorded", resourceType: "minutes", resourceId: minutesId, sensitive: true, after: { participantId: input.participantId, method: "SCANNED_PAPER", snapshotHash: minutes.snapshotHash } });
    await afterSignature(deps, ctx, tx, ev, minutesId, council);
    await ev.flush(tx);
    return ok(await viewOf(tx, (await minutesRepo.getMinutes(tx, minutesId)) as MinutesRow));
  });
}

export async function revokeMinutes(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, minutesId: string, input: { reason: string }): Promise<Result<CouncilsMinutesDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.minutesRevoke) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Révoquer un procès-verbal exige l'autorisation dédiée."));
  const reason = input.reason.trim();
  if (reason.length < 10) return err(invalid(CouncilsCode.INVALID_INPUT, "Le motif de révocation doit faire 10 caractères au moins.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const m = await minutesRepo.getMinutes(tx, minutesId, { lock: true });
    if (!m) return err(notFound(CouncilsCode.NOT_FOUND, "Procès-verbal", minutesId));
    if (m.status !== "GENERATED" && m.status !== "SIGNED") return err(conflict("councils.minutes_final", `Ce procès-verbal est déjà ${m.status}.`));
    await minutesRepo.markMinutesRevoked(tx, minutesId, reason);
    const row = (await minutesRepo.getMinutes(tx, minutesId)) as MinutesRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.MINUTES_REVOKED, minutesPayload(row), { type: "councils.minutes", id: minutesId });
    ev.audit({ action: "councils.minutes.revoked", resourceType: "minutes", resourceId: minutesId, sensitive: true, reason, after: { councilId: row.councilId, version: row.version } });
    await ev.flush(tx);
    return ok(await viewOf(tx, row));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendu (abonnés du worker, exécutés sous le contexte SYSTÈME : aucun acte réglementaire ici)
// ---------------------------------------------------------------------------------------------------------------------

/** `councils.minutes.generated` : demande le PDF à `reportcards` DEPUIS LE SNAPSHOT SEUL. Idempotent (par nature et source). */
export async function requestMinutesRender(deps: CouncilsDeps, ctx: RequestContext, minutesId: string): Promise<Result<{ requested: boolean }, AppError>> {
  const prepared = await inTx(
    deps,
    ctx,
    async (tx) => {
      const m = await minutesRepo.getMinutes(tx, minutesId);
      if (!m || (m.status !== "GENERATED" && m.status !== "SIGNED")) return ok(null);
      const council = await repo.getCouncil(tx, m.councilId);
      if (!council) return ok(null);
      const snapshot = (await minutesRepo.getSnapshot(tx, minutesId)) as CouncilsMinutesSnapshot;
      const settings = await reference.getSettings(tx, council.institutionId);
      return ok({ m, council, snapshot, templateKey: settings?.minutesTemplateKey ?? null });
    },
    { readOnly: true },
  );
  if (!prepared.ok) return prepared;
  if (!prepared.value) return ok({ requested: false });
  const { m, council, snapshot, templateKey } = prepared.value;
  const title = `Procès-verbal — ${snapshot.council.typeLabel}${snapshot.classroom.name ? ` — ${snapshot.classroom.name}` : ""} — ${snapshot.council.heldOn} (v${m.version})`;
  await deps.ports.documents.requestMinutes(ctx, { minutesId, title, issuedAt: m.generatedAt, snapshot: snapshot as unknown as Record<string, unknown>, ruleSourceKind: snapshot.references.ruleSourceKind, templateKey });
  void council;
  return ok({ requested: true });
}

/** `reportcards.official_document.rendered` (COUNCIL_MINUTES) : enregistre l'objet rendu et son empreinte. */
export async function onMinutesRendered(deps: CouncilsDeps, ctx: RequestContext, minutesId: string): Promise<Result<{ updated: boolean }, AppError>> {
  const doc = await deps.ports.documents.getMinutesDocument(ctx, minutesId);
  if (!doc) return ok({ updated: false });
  return inTx<{ updated: boolean }>(deps, ctx, async (tx) => {
    const m = await minutesRepo.getMinutes(tx, minutesId);
    if (!m) return ok({ updated: false });
    // Un PV remplacé ou révoqué pendant son rendu est figé : le rendu tardif est ignoré, sans erreur.
    if (m.status !== "GENERATED" && m.status !== "SIGNED") return ok({ updated: false });
    const ev = new EventBuffer(deps, ctx);
    if (doc.renderStatus === "RENDERED" && doc.objectKey && doc.pdfHash) {
      if (m.renderStatus === "RENDERED" && m.renderHash === doc.pdfHash) return ok({ updated: false });
      await minutesRepo.setMinutesRendered(tx, minutesId, { objectKey: doc.objectKey, hash: doc.pdfHash });
      ev.add(CouncilsEvents.MINUTES_RENDERED, { ...minutesPayload(m), renderHash: doc.pdfHash }, { type: "councils.minutes", id: minutesId });
    } else if (doc.renderStatus === "FAILED") {
      await minutesRepo.setMinutesRenderFailed(tx, minutesId);
    } else {
      return ok({ updated: false });
    }
    await ev.flush(tx);
    return ok({ updated: true });
  });
}


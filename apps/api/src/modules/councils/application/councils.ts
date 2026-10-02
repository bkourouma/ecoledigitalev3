/**
 * Cycle de vie d'une séance : créer, convoquer, composer, ouvrir (quorum), clore, annuler (spec 006 US1, US2).
 *
 *  - L'HUMAIN décide : ouverture, clôture, annulation exigent un utilisateur identifié (module ET base : `councils.human_decision_required`).
 *  - AUCUNE valeur réglementaire : le quorum, les rôles exigés, les signataires sont des DONNÉES du type de conseil (`NULL` = aucun
 *    contrôle) ; seule exigence structurelle : un PRÉSIDENT présent pour ouvrir. La base impose le quorum à l'ouverture.
 *  - L'état des résultats (`results`) doit être au moins celui du type (`min_results_status`) pour créer la séance.
 *  - À l'ouverture, `results` ouvre la délibération `COUNCIL` ; à la clôture elle est marquée tenue avec la DATE RÉELLE de la séance.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  CouncilsConvokeReportDto,
  CouncilsCouncilDetailDto,
  CouncilsCouncilDto,
  CouncilsCreateInput,
  CouncilsListDto,
  CouncilsListQuery,
  CouncilsParticipantDto,
  CouncilsParticipantInput,
  CouncilsProposedParticipantDto,
  CouncilsQuorumDto,
  CouncilsUpdateInput,
} from "@ecoledigitale/contracts/src/v2/councils";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import { resultsReady } from "../domain/machines";
import { proposeParticipants } from "../domain/participants";
import * as repo from "../infrastructure/councils-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow, ParticipantRow, RoleRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, safely, todayOf, type CallerCaps, type CouncilsDeps } from "./deps";
import { applyPendingEffects, planEffects } from "./effects";
import { actorNameOf, assertMayView, clampPage, councilRefOf, displayContext, loadCouncil, loadRoles, ruleSourceOf } from "./support";
import { councilDto, participantDto } from "./views";

export const councilPayload = (c: CouncilRow): { v: 1 } & Record<string, unknown> => ({
  v: 1,
  councilId: c.id,
  institutionId: c.institutionId,
  classroomId: c.classroomId,
  academicYearId: c.academicYearId,
  academicPeriodId: c.academicPeriodId,
  scope: c.scope,
  status: c.status,
});

async function councilView(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, row: CouncilRow, options: { withRuleSource?: boolean } = {}): Promise<CouncilsCouncilDto> {
  const type = (await reference.getCouncilTypesByIds(tx, [row.councilTypeId]))[0];
  const counts = (await repo.countsOfCouncils(tx, [row.id])).get(row.id);
  return councilDto(row, await displayContext(deps, ctx, row, type, counts, options));
}

// ---------------------------------------------------------------------------------------------------------------------
// Création et lectures
// ---------------------------------------------------------------------------------------------------------------------

export async function createCouncil(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsCreateInput): Promise<Result<CouncilsCouncilDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const type = await reference.getCouncilType(tx, input.councilTypeId);
    if (!type) return err(notFound(CouncilsCode.TYPE_NOT_FOUND, "Type de conseil", input.councilTypeId));
    if (!type.active) return err(conflict(CouncilsCode.TYPE_INACTIVE, "Ce type de conseil est désactivé."));
    const periodId = input.academicPeriodId ?? null;
    if (type.scope === "PERIOD" && periodId === null) return err(invalid(CouncilsCode.SCOPE_MISMATCH, "Un conseil de période désigne la période.", "academicPeriodId"));
    if (type.scope === "YEAR" && periodId !== null) return err(invalid(CouncilsCode.SCOPE_MISMATCH, "Un bilan de fin d'année ne porte pas de période.", "academicPeriodId"));

    const classroom = await deps.ports.academic.getClassroom(ctx, input.classroomId);
    if (!classroom) return err(notFound(CouncilsCode.CLASSROOM_NOT_FOUND, "Classe", input.classroomId));
    if (!classroom.active) return err(conflict(CouncilsCode.CLASSROOM_NOT_ACTIVE, "La classe n'est pas active : aucun conseil n'y est ouvert."));
    if (periodId !== null) {
      const period = await deps.ports.academic.getPeriod(ctx, periodId);
      if (!period || period.academicYearId !== classroom.academicYearId) return err(invalid(CouncilsCode.INVALID_REFERENCE, "Cette période n'appartient pas à l'année de la classe.", "academicPeriodId"));
    }
    // Le conseil délibère sur des résultats au moins aussi avancés que le minimum du type (verrouillés par défaut).
    const state = await deps.ports.resultsRead.getStateView(ctx, { classroomId: classroom.classroomId, academicYearId: classroom.academicYearId, academicPeriodId: periodId });
    if (!state) return err(conflict(CouncilsCode.RESULTS_NOT_READY, "Aucun résultat n'est calculé pour cette classe et cette période.", { required: type.minResultsStatus, actual: "NONE" }));
    if (!resultsReady(state.status, type.minResultsStatus)) {
      return err(conflict(CouncilsCode.RESULTS_NOT_READY, `Les résultats sont à l'état ${state.status} : ce type de conseil exige au moins ${type.minResultsStatus}.`, { required: type.minResultsStatus, actual: state.status }));
    }
    const id = deps.newId();
    await repo.insertCouncil(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId: classroom.institutionId,
      academicYearId: classroom.academicYearId,
      classroomId: classroom.classroomId,
      academicPeriodId: periodId,
      councilTypeId: type.id,
      scope: type.scope,
      resultsStateId: state.stateId,
      title: input.title ?? null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      location: input.location ?? null,
      createdBy: human.value,
    });
    const row = (await repo.getCouncil(tx, id)) as CouncilRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_CREATED, councilPayload(row), { type: "councils.council", id });
    ev.audit({ action: "councils.council.created", resourceType: "council", resourceId: id, after: { classroomId: row.classroomId, councilTypeId: row.councilTypeId, periodId } });
    await ev.flush(tx);
    return ok(councilDto(row, { type, classroomName: classroom.name, periodLabel: periodId ? ((await deps.ports.academic.getPeriod(ctx, periodId))?.label ?? null) : null, ruleSourceKind: state.ruleSourceKind, counts: undefined }));
  });
}

export async function listCouncilsView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, q: CouncilsListQuery): Promise<Result<CouncilsListDto, AppError>> {
  // Un enseignant sans lecture générale ne liste que les séances d'UNE de ses classes, désignée explicitement.
  if (!caps.read && !caps.manage) {
    const allowed = caps.proposalWrite === true && q.classroomId !== undefined && ctx.userId !== null && (await deps.ports.staff.isStaffAssignedToClassroom(ctx, ctx.userId, q.classroomId));
    if (!allowed) return ok({ items: [], total: 0, page: q.page, pageSize: q.pageSize });
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { rows, total } = await repo.listCouncils(tx, q, clampPage(q.page, q.pageSize));
      const types = new Map((await reference.getCouncilTypesByIds(tx, [...new Set(rows.map((r) => r.councilTypeId))])).map((t) => [t.id, t]));
      const counts = await repo.countsOfCouncils(tx, rows.map((r) => r.id));
      const items: CouncilsCouncilDto[] = [];
      // Le calendrier n'interroge pas `results` par séance (liste) : la provenance des règles se lit sur le détail.
      for (const r of rows) items.push(councilDto(r, await displayContext(deps, ctx, r, types.get(r.councilTypeId), counts.get(r.id), { withRuleSource: false })));
      return ok({ items, total, page: q.page, pageSize: q.pageSize });
    },
    { readOnly: true },
  );
}

async function quorumView(tx: Tx, council: CouncilRow, allowWaiver: boolean): Promise<CouncilsQuorumDto> {
  const q = await repo.checkQuorum(tx, council.id);
  return { met: q?.met ?? false, presentCount: q?.presentCount ?? 0, requiredMin: q?.requiredMin ?? null, missingRoles: q?.missingRoles ?? [], presidentPresent: q?.presidentPresent ?? false, waiverAllowed: allowWaiver };
}

export async function getCouncilDetail(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<CouncilsCouncilDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadCouncil(tx, id);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value);
      if (!may.ok) return may;
      return ok(await detailOf(deps, ctx, tx, loaded.value));
    },
    { readOnly: true },
  );
}

export async function detailOf(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, row: CouncilRow): Promise<CouncilsCouncilDetailDto> {
  const council = await councilView(deps, ctx, tx, row);
  const roles = await loadRoles(tx);
  const participants = (await repo.listParticipants(tx, row.id)).map((p) => participantDto(p, roles));
  const settings = await reference.getSettings(tx, row.institutionId);
  const quorum = await quorumView(tx, row, settings?.allowQuorumWaiver ?? true);
  const warnings: Array<{ code: string; message: string }> = [];
  if (council.ruleSourceKind === "placeholder") warnings.push({ code: "rules_placeholder", message: "Jeu de règles de démonstration, non réglementaire : les suggestions n'ont aucune valeur officielle." });
  if (council.counts.agendaItems === 0 && row.status === "PLANNED") warnings.push({ code: "agenda_not_prepared", message: "L'ordre du jour n'est pas préparé." });
  if (!quorum.presidentPresent && row.status === "PLANNED") warnings.push({ code: "no_president_present", message: "Aucun président présent : la séance ne peut pas être ouverte." });
  return { council, participants, quorum, warnings };
}

export async function updateCouncil(deps: CouncilsDeps, ctx: RequestContext, id: string, input: CouncilsUpdateInput): Promise<Result<CouncilsCouncilDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, id, { lock: true });
    if (!loaded.ok) return loaded;
    const row = loaded.value;
    if (row.status !== "PLANNED" && row.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Une séance ${row.status} ne se modifie plus.`));
    if (input.heldOn !== undefined && row.status !== "PLANNED") return err(conflict(CouncilsCode.INVALID_STATE, "La date de la séance ne change plus après l'ouverture."));
    await repo.updateCouncilFields(tx, id, { title: input.title, scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt === null ? null : new Date(input.scheduledAt), location: input.location, heldOn: input.heldOn });
    const updated = (await repo.getCouncil(tx, id)) as CouncilRow;
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.council.updated", resourceType: "council", resourceId: id, before: { scheduledAt: row.scheduledAt, location: row.location }, after: { scheduledAt: updated.scheduledAt, location: updated.location } });
    await ev.flush(tx);
    return ok(await councilView(deps, ctx, tx, updated));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------------------------------------------------

export async function listParticipantsView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsParticipantDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadCouncil(tx, councilId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value);
      if (!may.ok) return may;
      const roles = await loadRoles(tx);
      return ok((await repo.listParticipants(tx, councilId)).map((p) => participantDto(p, roles)));
    },
    { readOnly: true },
  );
}

/** Participants PROPOSÉS : professeur principal et enseignants affectés à la classe (aucun nom figé avant l'ajout). */
export async function listProposedParticipants(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsProposedParticipantDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadCouncil(tx, councilId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value);
      if (!may.ok) return may;
      const assignments = await deps.ports.staff.listAssignmentsForClassroom(ctx, loaded.value.classroomId, loaded.value.heldOn ?? todayOf(deps));
      const roles = await reference.listRoles(tx);
      const active = new Set(roles.filter((r) => r.active).map((r) => r.code));
      const existing = new Set((await repo.listParticipants(tx, councilId)).map((p) => p.staffId).filter((s): s is string => s !== null));
      return ok(proposeParticipants(assignments, active).filter((p) => !existing.has(p.staffId)).map((p) => ({ staffId: p.staffId, displayName: p.displayName, roleCode: p.roleCode, councilFunction: p.councilFunction, source: p.source })));
    },
    { readOnly: true },
  );
}

export async function addParticipant(deps: CouncilsDeps, ctx: RequestContext, councilId: string, input: CouncilsParticipantInput): Promise<Result<CouncilsParticipantDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    if (loaded.value.status !== "PLANNED" && loaded.value.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Les participants d'une séance ${loaded.value.status} sont figés.`));
    const role = await reference.getRoleByCode(tx, input.roleCode);
    if (!role) return err(notFound(CouncilsCode.INVALID_REFERENCE, "Rôle de participant", input.roleCode));
    // Nom FIGÉ à la convocation : lu de la fiche du personnel (people), sinon saisi pour une personne externe.
    let displayName = input.displayName?.trim();
    if (input.staffId) {
      const names = await deps.ports.staff.getStaffNames(ctx, [input.staffId]);
      const known = names.get(input.staffId);
      if (!known) return err(notFound(CouncilsCode.INVALID_REFERENCE, "Membre du personnel", input.staffId));
      displayName = known;
    }
    if (!displayName) return err(invalid(CouncilsCode.INVALID_INPUT, "Le nom du participant est obligatoire.", "displayName"));
    const id = deps.newId();
    await repo.insertParticipant(tx, { id, tenantId: ctx.tenantId, councilId, roleCode: role.code, councilFunction: input.councilFunction ?? null, staffId: input.staffId ?? null, personId: input.personId ?? null, displayName, isVoting: input.isVoting ?? true });
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.participant.added", resourceType: "participant", resourceId: id, after: { councilId, roleCode: role.code, function: input.councilFunction ?? null } });
    await ev.flush(tx);
    return ok(participantDto((await repo.getParticipant(tx, id)) as ParticipantRow, new Map([[role.code, role]])));
  });
}

async function loadParticipantOf(tx: Tx, councilId: string, participantId: string): Promise<Result<ParticipantRow, AppError>> {
  const p = await repo.getParticipant(tx, participantId);
  return p && p.councilId === councilId ? ok(p) : err(notFound(CouncilsCode.NOT_FOUND, "Participant", participantId));
}

export async function patchParticipant(deps: CouncilsDeps, ctx: RequestContext, councilId: string, participantId: string, input: { councilFunction?: "PRESIDENT" | "SECRETARY" | null | undefined; isVoting?: boolean | undefined }): Promise<Result<CouncilsParticipantDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const council = await loadCouncil(tx, councilId, { lock: true });
    if (!council.ok) return council;
    const p = await loadParticipantOf(tx, councilId, participantId);
    if (!p.ok) return p;
    // Un président suppléant se désigne AVANT l'ouverture, jamais pendant une décision en cours (cas limite spec §13).
    if (input.councilFunction !== undefined && council.value.status !== "PLANNED") return err(conflict(CouncilsCode.INVALID_STATE, "La présidence et le secrétariat ne changent qu'avant l'ouverture de la séance."));
    await repo.updateParticipant(tx, participantId, { councilFunction: input.councilFunction, isVoting: input.isVoting });
    const roles = await loadRoles(tx);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.participant.updated", resourceType: "participant", resourceId: participantId, after: { function: input.councilFunction, isVoting: input.isVoting } });
    await ev.flush(tx);
    return ok(participantDto((await repo.getParticipant(tx, participantId)) as ParticipantRow, roles));
  });
}

export async function removeParticipant(deps: CouncilsDeps, ctx: RequestContext, councilId: string, participantId: string): Promise<Result<{ removed: true }, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const council = await loadCouncil(tx, councilId, { lock: true });
    if (!council.ok) return council;
    const p = await loadParticipantOf(tx, councilId, participantId);
    if (!p.ok) return p;
    await repo.deleteParticipant(tx, participantId);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.participant.removed", resourceType: "participant", resourceId: participantId, before: { councilId, roleCode: p.value.roleCode } });
    await ev.flush(tx);
    return ok({ removed: true as const });
  });
}

export async function setPresence(deps: CouncilsDeps, ctx: RequestContext, councilId: string, participantId: string, presence: string): Promise<Result<CouncilsParticipantDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const council = await loadCouncil(tx, councilId, { lock: true });
    if (!council.ok) return council;
    const p = await loadParticipantOf(tx, councilId, participantId);
    if (!p.ok) return p;
    await repo.updateParticipant(tx, participantId, { presence });
    const roles = await loadRoles(tx);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.participant.presence_set", resourceType: "participant", resourceId: participantId, before: { presence: p.value.presence }, after: { presence } });
    await ev.flush(tx);
    return ok(participantDto((await repo.getParticipant(tx, participantId)) as ParticipantRow, roles));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Convocation : UNE notification par participant, idempotente
// ---------------------------------------------------------------------------------------------------------------------

export async function convokeCouncil(deps: CouncilsDeps, ctx: RequestContext, councilId: string, input: { participantIds?: readonly string[] | undefined }): Promise<Result<CouncilsConvokeReportDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "PLANNED") return err(conflict(CouncilsCode.INVALID_STATE, `Seule une séance planifiée se convoque (état : ${council.status}).`));
    const all = await repo.listParticipants(tx, councilId);
    const wanted = input.participantIds ? all.filter((p) => input.participantIds?.includes(p.id)) : all;
    const now = deps.clock.now();
    const classroom = await deps.ports.academic.getClassroom(ctx, council.classroomId).catch((e: unknown) => (isAppError(e) ? null : Promise.reject(e)));
    const warnings: Array<{ code: string; message: string }> = [];
    let notified = 0;
    for (const p of wanted) {
      await repo.markConvoked(tx, p.id, now);
      // Rejouer n'envoie pas une seconde notification : un participant déjà notifié est ignoré (et `clientKey` = son identifiant).
      if (p.notifiedAt !== null) continue;
      if (p.staffId === null) {
        warnings.push({ code: "external_not_notified", message: `${p.displayName} est une personne externe : à convoquer hors de l'application.` });
        continue;
      }
      try {
        const r = await deps.ports.notifications.notifyParticipants(ctx, {
          councilId,
          staffIds: [p.staffId],
          clientKey: p.id,
          variables: { subject: "Convocation au conseil de classe", date: (council.scheduledAt ?? now).toISOString().slice(0, 10), time: (council.scheduledAt ?? now).toISOString().slice(11, 16), place: council.location ?? "", classroomName: classroom?.name ?? "" },
        });
        if (r.queued > 0) {
          await repo.markNotified(tx, p.id, now, p.id);
          notified += 1;
        } else {
          warnings.push({ code: "not_notified", message: `Aucune remise n'a pu être mise en file pour ${p.displayName}.` });
        }
      } catch (e) {
        // Convocation créée, `notified_at` vide, avertissement : aucune notification n'est simulée.
        const code = isAppError(e) ? e.code : "notification_failed";
        warnings.push({ code, message: `${p.displayName} n'a pas pu être notifié(e) (${isAppError(e) ? e.message : "canal indisponible"}).` });
      }
    }
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_CONVOKED, { ...councilPayload(council), convoked: wanted.length }, { type: "councils.council", id: councilId });
    ev.audit({ action: "councils.council.convoked", resourceType: "council", resourceId: councilId, after: { convoked: wanted.length, notified } });
    await ev.flush(tx);
    return ok({ councilId, convoked: wanted.length, notified, warnings });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Ouverture, clôture, annulation
// ---------------------------------------------------------------------------------------------------------------------

const staffParticipantsOf = (participants: readonly ParticipantRow[]): Array<{ staffId: string; role: string }> =>
  participants.filter((p) => p.staffId !== null && p.presence === "PRESENT").map((p) => ({ staffId: p.staffId as string, role: p.roleCode }));

export async function openCouncil(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string, input: { quorumWaiverReason?: string | undefined }): Promise<Result<CouncilsCouncilDetailDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.sessionRun) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ouvrir une séance exige l'autorisation de conduire la séance."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "PLANNED") return err(conflict(CouncilsCode.INVALID_STATE, `Seule une séance planifiée s'ouvre (état : ${council.status}).`));
    const settings = await reference.getSettings(tx, council.institutionId);
    const q = (await repo.checkQuorum(tx, councilId)) ?? { met: false, presentCount: 0, requiredMin: null, missingRoles: [], presidentPresent: false };
    if (!q.presidentPresent) return err(invalid("councils.president_required", "Un président présent est nécessaire pour ouvrir la séance."));
    const waiver = input.quorumWaiverReason?.trim() ?? "";
    let waived = false;
    if (!q.met) {
      if (!(settings?.allowQuorumWaiver ?? true)) return err(conflict(CouncilsCode.QUORUM_NOT_MET, "Le quorum n'est pas atteint et l'établissement n'autorise pas l'ouverture sans quorum.", { presentCount: q.presentCount, required: q.requiredMin, missingRoles: q.missingRoles }));
      if (waiver.length < 10) return err(conflict(CouncilsCode.QUORUM_NOT_MET, "Le quorum n'est pas atteint : ouvrir exige un motif de dérogation d'au moins 10 caractères.", { presentCount: q.presentCount, required: q.requiredMin, missingRoles: q.missingRoles }));
      waived = true;
    }
    if (!council.resultsStateId) return err(conflict(CouncilsCode.RESULTS_UNAVAILABLE, "La séance n'est pas rattachée à un état de résultats."));
    const participants = await repo.listParticipants(tx, councilId);
    const heldOn = council.heldOn ?? todayOf(deps);
    // `results` ouvre (ou lie) la délibération de la séance : sans ce port, l'ouverture est refusée (échec fermé).
    const deliberation = await deps.ports.resultsWrite.openDeliberation(ctx, { stateId: council.resultsStateId, heldOn, participants: staffParticipantsOf(participants), councilRef: councilRefOf(councilId) });
    await repo.openCouncil(tx, councilId, { heldOn, quorumWaived: waived, quorumWaiverReason: waived ? waiver : null, resultsDeliberationId: deliberation.deliberationId });
    const opened = (await repo.getCouncil(tx, councilId)) as CouncilRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_OPENED, councilPayload(opened), { type: "councils.council", id: councilId });
    if (waived) ev.add(CouncilsEvents.QUORUM_WAIVED, { ...councilPayload(opened), presentCount: q.presentCount }, { type: "councils.council", id: councilId });
    ev.audit({ action: "councils.council.opened", resourceType: "council", resourceId: councilId, sensitive: true, reason: waived ? waiver : null, after: { quorumWaived: waived, presentCount: q.presentCount } });
    await ev.flush(tx);
    return ok(await detailOf(deps, ctx, tx, opened));
  });
}

export async function closeCouncil(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsCouncilDetailDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  if (!caps.sessionRun) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Clore une séance exige l'autorisation de conduire la séance."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Seule une séance ouverte se clôt (état : ${council.status}).`));
    const type = (await reference.getCouncilTypesByIds(tx, [council.councilTypeId]))[0];
    if (type?.requiresDecisionPerStudent) {
      const undecided = await repo.countUndecided(tx, councilId);
      if (undecided > 0) return err(conflict(CouncilsCode.UNDECIDED_STUDENTS, `${undecided} élève(s) n'ont pas de décision : la séance ne peut pas être close.`, { undecided }));
    }
    await repo.setCouncilStatus(tx, councilId, "CLOSED");
    const closed = (await repo.getCouncil(tx, councilId)) as CouncilRow;
    if (closed.resultsDeliberationId && closed.heldOn) {
      await deps.ports.resultsWrite.markDeliberationHeld(ctx, { deliberationId: closed.resultsDeliberationId, heldOn: closed.heldOn, participants: staffParticipantsOf(await repo.listParticipants(tx, councilId)), councilRef: councilRefOf(councilId) });
    }
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_CLOSED, councilPayload(closed), { type: "councils.council", id: councilId });
    ev.audit({ action: "councils.council.closed", resourceType: "council", resourceId: councilId, sensitive: true });
    // Effets au déclencheur `CLOSED` (réglage d'établissement) : les décisions produisent leurs effets dès la clôture.
    await planEffects(deps, ctx, tx, ev, closed);
    await applyPendingEffects(deps, ctx, tx, ev, closed);
    await ev.flush(tx);
    return ok(await detailOf(deps, ctx, tx, closed));
  });
}

export async function cancelCouncil(deps: CouncilsDeps, ctx: RequestContext, councilId: string, input: { reason: string }): Promise<Result<CouncilsCouncilDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const reason = input.reason.trim();
  if (reason.length < 5) return err(invalid(CouncilsCode.INVALID_INPUT, "Annuler une séance exige un motif de 5 caractères au moins.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "PLANNED" && council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `Une séance ${council.status} ne s'annule pas : demandez un déverrouillage motivé si une erreur doit être corrigée.`));
    await repo.cancelCouncil(tx, councilId, reason);
    if (council.resultsDeliberationId) await deps.ports.resultsWrite.cancelDeliberation(ctx, { deliberationId: council.resultsDeliberationId, councilRef: councilRefOf(councilId) });
    const cancelled = (await repo.getCouncil(tx, councilId)) as CouncilRow;
    const ev = new EventBuffer(deps, ctx);
    ev.add(CouncilsEvents.COUNCIL_CANCELLED, councilPayload(cancelled), { type: "councils.council", id: councilId });
    ev.audit({ action: "councils.council.cancelled", resourceType: "council", resourceId: councilId, sensitive: true, reason });
    await ev.flush(tx);
    return ok(await councilView(deps, ctx, tx, cancelled));
  });
}

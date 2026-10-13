/**
 * Conseil des maîtres : dossier de séance par élève, feuille de présence, décisions, procès-verbal figé.
 *
 * Le conseil RÉUTILISE `results.deliberations` (kind COUNCIL) et `results.decisions` : la règle propose, le conseil confirme, la
 * justification d'un écart est conservée par `results` (R-RES-05). Ce module ne tient que le DOSSIER (cas à examiner, proposition de
 * l'instituteur, notes) et la PRÉSENCE. Le quorum n'est JAMAIS une constante : il vient de la règle `quorum_conseil` du RuleSet
 * lié ; sans règle liée, aucun quorum bloquant (présence comptée et affichée).
 *
 * Droits : préparer ses dossiers (`primary.council.prepare`) ≠ présider, décider et demander le PV (`primary.council.manage`).
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryDecideCaseBody, PrimaryPrepareCouncilBody, PrimaryPutAttendanceBody, PrimaryUpdateCaseBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import type { Tx } from "@ecoledigitale/database";
import { buildMinutes, countAttendance, decisionNeedsJustification, JUSTIFICATION_MIN_LENGTH, signatureProblems } from "../domain/council";
import { PrimaryCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { PrimaryEvents } from "../domain/events";
import type { CallerCaps, CouncilAttendanceRow, CouncilCase, CouncilRole, SourceKind, Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import {
  deleteUnsignedAttendanceNotIn,
  findMinutesByHash,
  getCaseRow,
  insertCaseIfAbsent,
  insertMinutes,
  latestMinutes,
  listAttendanceOf,
  listCasesOf,
  listCouncilSummaries,
  markCaseDecided,
  setMinutesDocument,
  signAttendance,
  updateCaseRow,
  upsertAttendanceRow,
} from "../infrastructure/council-repository";
import { requireClassAccess } from "./access";
import { actorOf, EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";
import type { ConfirmedDecision, PeriodInfo, ProposalInfo } from "./ports";

/** Issue d'inscription correspondant à un code de décision de fin d'année (codes de `results` -> codes d'`academic`). */
export function outcomeCodeOfDecision(finalCode: string | null): string | null {
  switch (finalCode) {
    case "PROMOTED":
      return "PROMOTED";
    case "REPEAT":
    case "REPEATED":
      return "REPEATED";
    case "ORIENTED":
    case "REORIENTED":
    case "EXCLUDED":
    case "GRADUATED":
      return finalCode;
    default:
      return null; // PENDING, COUNCIL_REVIEW… : pas une issue
  }
}

const isLastPeriod = (periods: readonly PeriodInfo[], periodId: Uuid): boolean => periods.length > 0 && [...periods].sort((a, b) => b.ordinal - a.ordinal)[0]?.id === periodId;

const councilRoleOf = (assignmentRole: string): CouncilRole => (assignmentRole === "HOMEROOM" ? "HOMEROOM" : assignmentRole === "LEAD" ? "SPECIALIST" : "TEACHER");

export interface CouncilCaseView extends CouncilCase {
  studentName: string | null;
  ruleProposalCode: string | null;
  finalCode: string | null;
  justification: string | null;
}

export interface CouncilOverview {
  deliberationId: Uuid;
  classroomId: Uuid;
  periodId: Uuid;
  academicYearId: Uuid;
  heldOn: string | null;
  ruleSourceKind: SourceKind | null;
  counts: { total: number; open: number; decided: number; deferred: number };
  quorum: { convened: number; present: number; met: boolean | null; source: "rule" | "none" };
  cases: CouncilCaseView[];
  attendance: Array<CouncilAttendanceRow & { staffName: string | null }>;
  minutesDocumentId: Uuid | null;
}

/** Une règle non branchée ne bloque pas la préparation (les motifs viennent alors des propositions) ; toute autre erreur remonte. */
async function tolerant<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isAppError(e) && e.code === PrimaryCode.PORT_UNAVAILABLE) return fallback;
    throw e;
  }
}

async function overviewOf(deps: PrimarySchoolDeps, ctx: RequestContext, tx: Tx, deliberationId: Uuid, cases: Array<CouncilCase & { academicPeriodId: string | null }>): Promise<Result<CouncilOverview, AppError>> {
  const first = cases[0];
  if (!first || !first.academicPeriodId) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", deliberationId));
  const delib = await deps.ports.results.getDeliberation(ctx, { deliberationId, classroomId: first.classroomId, periodId: first.academicPeriodId });
  if (!delib) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", deliberationId));
  const roster = await deps.ports.classrooms.listRoster(ctx, first.classroomId);
  const names = new Map(roster.map((r) => [r.enrollmentId, r.displayName]));
  const proposals = await deps.ports.results.listProposals(ctx, { classroomId: first.classroomId, periodId: delib.periodId });
  const byEnrollment = new Map<string, ProposalInfo>(proposals.map((p) => [p.enrollmentId, p]));
  const attendance = await listAttendanceOf(tx, deliberationId);
  const staffNames = await deps.ports.teaching.staffNames(ctx, attendance.map((a) => a.staffId));
  const { convened, present } = countAttendance(attendance);
  const quorumRule = await tolerant(() => deps.ports.rules.quorum(ctx, { classroomId: first.classroomId, periodId: delib.periodId, convened, present }), null);
  const ruleSourceKind = await tolerant(() => deps.ports.results.getRuleSourceKind(ctx, { classroomId: first.classroomId, periodId: delib.periodId }), null);
  const minutes = await latestMinutes(tx, deliberationId);
  const views: CouncilCaseView[] = cases.map((c) => {
    const p = byEnrollment.get(c.enrollmentId);
    return { ...c, studentName: names.get(c.enrollmentId) ?? null, ruleProposalCode: p?.ruleProposalCode ?? null, finalCode: p?.finalCode ?? null, justification: p?.justification ?? null };
  });
  return ok<CouncilOverview>({
    deliberationId,
    classroomId: first.classroomId,
    periodId: delib.periodId,
    academicYearId: delib.academicYearId,
    heldOn: delib.heldOn,
    ruleSourceKind,
    counts: {
      total: cases.length,
      open: cases.filter((c) => c.status === "OPEN").length,
      decided: cases.filter((c) => c.status === "DECIDED").length,
      deferred: cases.filter((c) => c.status === "DEFERRED").length,
    },
    quorum: { convened, present, met: quorumRule ? quorumRule.met : null, source: quorumRule ? "rule" : "none" },
    cases: views,
    attendance: attendance.map((a) => ({ ...a, staffName: staffNames.get(a.staffId) ?? null })),
    minutesDocumentId: minutes?.documentId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Préparation
// ---------------------------------------------------------------------------

export async function prepareCouncil(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryPrepareCouncilBody, caps: CallerCaps): Promise<Result<CouncilOverview, AppError>> {
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const { classroom } = access.value;
  const periods = await deps.ports.classrooms.listPeriods(ctx, classroom.academicYearId);
  if (!periods.some((p) => p.id === input.periodId)) return err(validation(PrimaryCode.INVALID_INPUT, "Cette période n'appartient pas à l'année de la classe.", "periodId"));
  const roster = await deps.ports.classrooms.listRoster(ctx, classroom.id);
  if (roster.length === 0) return err(validation(PrimaryCode.INVALID_INPUT, "La classe n'a aucun élève inscrit.", "classroomId"));
  const staff = await deps.ports.teaching.listClassroomStaff(ctx, classroom.id);

  return inTx(deps, ctx, async (tx) => {
    const participants = staff.map((s) => ({ staffId: s.staffId, role: councilRoleOf(s.roleCode) }));
    const opening = await deps.ports.results.openCouncil(ctx, { classroomId: classroom.id, periodId: input.periodId, heldOn: input.heldOn, participants });
    const proposals = await deps.ports.results.listProposals(ctx, { classroomId: classroom.id, periodId: input.periodId });
    const proposalOf = new Map(proposals.map((p) => [p.enrollmentId, p]));
    const flags = await tolerant(() => deps.ports.rules.councilFlags(ctx, { classroomId: classroom.id, periodId: input.periodId, enrollmentIds: roster.map((r) => r.enrollmentId) }), new Map<Uuid, readonly string[]>());
    let created = 0;
    for (const r of roster) {
      const reasons = new Set<string>(flags.get(r.enrollmentId) ?? []);
      if (proposalOf.get(r.enrollmentId)?.ruleProposalCode === "COUNCIL_REVIEW" && reasons.size === 0) reasons.add("RULE_REVIEW");
      const inserted = await guarded(() =>
        insertCaseIfAbsent(tx, { id: deps.newId(), tenantId: ctx.tenantId, deliberationId: opening.deliberationId, classroomId: classroom.id, periodId: input.periodId, enrollmentId: r.enrollmentId, studentId: r.studentId, reasonCodes: [...reasons], proposalCode: null }),
      );
      if (inserted) created += 1;
    }
    // Feuille de présence initiale : les maîtres affectés sont CONVOQUÉS ; la présence reste à constater. Jamais écrasée.
    if ((await listAttendanceOf(tx, opening.deliberationId)).length === 0) {
      for (const p of participants) await upsertAttendanceRow(tx, { tenantId: ctx.tenantId, deliberationId: opening.deliberationId, staffId: p.staffId, roleCode: p.role, convened: true, present: null, note: null });
    }
    const events = new EventBuffer(deps, ctx);
    if (created > 0) {
      events.add(PrimaryEvents.COUNCIL_PREPARED, { v: 1, deliberationId: opening.deliberationId, classroomId: classroom.id, periodId: input.periodId, cases: created }, { type: "primary_school.council", id: opening.deliberationId });
    }
    events.audit({ action: "primary_school.council.prepared", resourceType: "deliberation", resourceId: opening.deliberationId, metadata: { classroomId: classroom.id, periodId: input.periodId, casesCreated: created } });
    await events.flush(tx);
    const cases = await listCasesOf(tx, opening.deliberationId);
    return overviewOf(deps, ctx, tx, opening.deliberationId, cases);
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function getCouncil(deps: PrimarySchoolDeps, ctx: RequestContext, deliberationId: Uuid, caps: CallerCaps): Promise<Result<CouncilOverview, AppError>> {
  const probe = await inTx(deps, ctx, async (tx) => ok(await listCasesOf(tx, deliberationId)), { readOnly: true });
  if (!probe.ok) return probe;
  const first = probe.value[0];
  if (!first) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", deliberationId));
  const access = await requireClassAccess(deps, ctx, first.classroomId, caps);
  if (!access.ok) return access;
  return inTx(deps, ctx, async (tx) => overviewOf(deps, ctx, tx, deliberationId, probe.value), { readOnly: true });
}

export interface CouncilSummary {
  deliberationId: Uuid;
  classroomId: Uuid;
  periodId: Uuid;
  total: number;
  open: number;
  decided: number;
}

export async function listCouncils(deps: PrimarySchoolDeps, ctx: RequestContext, filter: { classroomId?: Uuid | undefined; periodId?: Uuid | undefined }, caps: CallerCaps): Promise<Result<CouncilSummary[], AppError>> {
  let visible: ReadonlySet<Uuid> | null = null;
  if (!caps.allClasses) {
    const staffId = ctx.userId ? await deps.ports.teaching.staffIdForUser(ctx, ctx.userId) : null;
    visible = new Set(staffId ? await deps.ports.teaching.classroomIdsOfStaff(ctx, staffId) : []);
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await listCouncilSummaries(tx, filter);
      return ok(
        rows
          .filter((r) => r.periodId !== null && (visible === null || visible.has(r.classroomId)))
          .map((r) => ({ deliberationId: r.deliberationId, classroomId: r.classroomId, periodId: r.periodId as Uuid, total: r.total, open: r.open, decided: r.decided })),
      );
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Dossier : proposition de l'instituteur, notes
// ---------------------------------------------------------------------------

export async function updateCouncilCase(deps: PrimarySchoolDeps, ctx: RequestContext, caseId: Uuid, patch: PrimaryUpdateCaseBody, caps: CallerCaps): Promise<Result<CouncilCase, AppError>> {
  const probe = await inTx(deps, ctx, async (tx) => ok(await getCaseRow(tx, caseId)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.COUNCIL_CASE_NOT_FOUND, "Dossier de conseil", caseId));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  const staffId = access.value.staffId;
  return inTx(deps, ctx, async (tx) => {
    const current = await getCaseRow(tx, caseId, true);
    if (!current) return err(notFound(PrimaryCode.COUNCIL_CASE_NOT_FOUND, "Dossier de conseil", caseId));
    if (current.status === "DECIDED") return err(conflict(PrimaryCode.CASE_ALREADY_DECIDED, "Ce dossier est décidé : il ne change plus.", { caseId }));
    const updated = await guarded(() =>
      updateCaseRow(tx, caseId, {
        proposalCode: patch.proposalCode,
        proposalNote: patch.proposalNote,
        discussionNote: patch.discussionNote,
        status: patch.status,
        reasonCodes: patch.reasonCodes,
        ...(patch.proposalCode !== undefined && patch.proposalCode !== null ? { proposedByStaffId: staffId } : {}),
      }),
    );
    const events = new EventBuffer(deps, ctx);
    // Ni note de discussion ni proposition dans l'audit : le dossier (table) porte le détail.
    events.audit({ action: "primary_school.council_case.updated", resourceType: "council_case", resourceId: caseId, metadata: { classroomId: current.classroomId, deliberationId: current.deliberationId, status: updated.status } });
    await events.flush(tx);
    return ok(updated);
  });
}

// ---------------------------------------------------------------------------
// Décision (confirmation en séance)
// ---------------------------------------------------------------------------

export interface DecisionView {
  case: CouncilCase;
  decisionId: Uuid;
  finalCode: string;
  ruleProposalCode: string | null;
  changedFromProposal: boolean;
  /** Issue d'inscription enregistrée (conseil de fin d'année seulement). */
  outcomeRecorded: string | null;
}

export async function decideCouncilCase(deps: PrimarySchoolDeps, ctx: RequestContext, caseId: Uuid, input: PrimaryDecideCaseBody, caps: CallerCaps): Promise<Result<DecisionView, AppError>> {
  if (!caps.councilManage) return err(forbidden("Confirmer une décision du conseil exige le droit de gérer le conseil."));
  const probe = await inTx(deps, ctx, async (tx) => ok(await getCaseRow(tx, caseId)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.COUNCIL_CASE_NOT_FOUND, "Dossier de conseil", caseId));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  const { classroom } = access.value;

  return inTx(deps, ctx, async (tx) => {
    const current = await getCaseRow(tx, caseId, true);
    if (!current) return err(notFound(PrimaryCode.COUNCIL_CASE_NOT_FOUND, "Dossier de conseil", caseId));
    if (current.status === "DECIDED") return err(conflict(PrimaryCode.CASE_ALREADY_DECIDED, "Ce dossier est déjà décidé.", { caseId }));
    if (!current.academicPeriodId) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", current.deliberationId));
    const delib = await deps.ports.results.getDeliberation(ctx, { deliberationId: current.deliberationId, classroomId: current.classroomId, periodId: current.academicPeriodId });
    if (!delib) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", current.deliberationId));
    const proposals = await deps.ports.results.listProposals(ctx, { classroomId: current.classroomId, periodId: delib.periodId });
    const proposal = proposals.find((p) => p.enrollmentId === current.enrollmentId);
    const periods = await deps.ports.classrooms.listPeriods(ctx, classroom.academicYearId);
    let confirmed: ConfirmedDecision;
    if (proposal) {
      if (decisionNeedsJustification(proposal.ruleProposalCode, input.finalCode) && (input.justification?.trim().length ?? 0) < JUSTIFICATION_MIN_LENGTH) {
        return err(validation(PrimaryCode.INVALID_INPUT, `Une décision différente de la proposition de la règle exige une justification (${JUSTIFICATION_MIN_LENGTH} caractères au moins).`, "justification"));
      }
      confirmed = await deps.ports.results.confirmDecision(ctx, { decisionId: proposal.decisionId, deliberationId: current.deliberationId, finalCode: input.finalCode, justification: input.justification });
    } else {
      // Aucune proposition de la règle (résultats de la période non calculés, ex. école neuve) : le conseil de FIN D'ANNÉE peut trancher
      // lui-même, à condition d'indiquer la décision et de la motiver ; la justification est conservée avec la décision (L-50).
      const noProposal = (message: string) => conflict(PrimaryCode.CASE_NO_DECISION, message, { enrollmentId: current.enrollmentId });
      if (!isLastPeriod(periods, delib.periodId)) {
        return err(noProposal("La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés. Seul le conseil de fin d'année peut trancher sans proposition."));
      }
      if (!input.finalCode) return err(validation(PrimaryCode.INVALID_INPUT, "La règle n'a rien proposé : indiquez la décision du conseil.", "finalCode"));
      if ((input.justification?.trim().length ?? 0) < JUSTIFICATION_MIN_LENGTH) {
        return err(validation(PrimaryCode.INVALID_INPUT, `Sans proposition de la règle, la décision du conseil doit être motivée (${JUSTIFICATION_MIN_LENGTH} caractères au moins).`, "justification"));
      }
      confirmed = await deps.ports.results.publishManualDecision(ctx, {
        classroomId: current.classroomId,
        periodId: delib.periodId,
        deliberationId: current.deliberationId,
        enrollmentId: current.enrollmentId,
        finalCode: input.finalCode,
        justification: (input.justification as string).trim(),
        councilRef: caseId,
      });
    }
    const decided = await guarded(() => markCaseDecided(tx, caseId, confirmed.decisionId));

    // La décision de FIN D'ANNÉE alimente l'issue d'inscription, sans saisie manuelle ; la reconduction annuelle la lit.
    let outcomeRecorded: string | null = null;
    const outcomeCode = outcomeCodeOfDecision(confirmed.finalCode);
    if (outcomeCode && isLastPeriod(periods, delib.periodId)) {
      await deps.ports.outcomes.recordOutcome(ctx, { enrollmentId: current.enrollmentId, outcomeCode, decisionRef: confirmed.decisionId });
      outcomeRecorded = outcomeCode;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "primary_school.council_case.decided",
      resourceType: "council_case",
      resourceId: caseId,
      reason: confirmed.changedFromProposal || !proposal ? (input.justification ?? null) : null,
      metadata: { classroomId: current.classroomId, deliberationId: current.deliberationId, decisionId: confirmed.decisionId, changedFromProposal: confirmed.changedFromProposal, manual: !proposal, outcomeRecorded },
      sensitive: confirmed.changedFromProposal || !proposal,
    });
    await events.flush(tx);
    return ok<DecisionView>({ case: decided, decisionId: confirmed.decisionId, finalCode: confirmed.finalCode, ruleProposalCode: confirmed.ruleProposalCode, changedFromProposal: confirmed.changedFromProposal, outcomeRecorded });
  });
}

/**
 * Réaction à `results.decision.confirmed` (décision confirmée HORS de ce module, ex. écran de `results`) : marque le dossier décidé
 * et enregistre l'issue de fin d'année. Idempotent. Retourne `false` si aucun dossier ne correspond.
 */
export async function onDecisionConfirmed(deps: PrimarySchoolDeps, ctx: RequestContext, input: { decisionId: Uuid; enrollmentId: Uuid; finalCode: string | null; periodId: Uuid | null }): Promise<Result<{ caseUpdated: boolean; outcomeRecorded: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const rows = await tx.many(
      `SELECT id, status, classroom_id, deliberation_id FROM primary_school.council_cases WHERE enrollment_id = $1 AND status <> 'DECIDED' AND academic_period_id IS NOT DISTINCT FROM COALESCE($2::uuid, academic_period_id)`,
      [input.enrollmentId, input.periodId],
    );
    let caseUpdated = false;
    let outcomeRecorded: string | null = null;
    for (const r of rows) {
      await guarded(() => markCaseDecided(tx, r.id, input.decisionId));
      caseUpdated = true;
      const classroom = await deps.ports.classrooms.getClassroom(ctx, r.classroom_id);
      const outcomeCode = outcomeCodeOfDecision(input.finalCode);
      if (classroom && outcomeCode && input.periodId) {
        const periods = await deps.ports.classrooms.listPeriods(ctx, classroom.academicYearId);
        if (isLastPeriod(periods, input.periodId)) {
          await deps.ports.outcomes.recordOutcome(ctx, { enrollmentId: input.enrollmentId, outcomeCode, decisionRef: input.decisionId });
          outcomeRecorded = outcomeCode;
        }
      }
    }
    return ok({ caseUpdated, outcomeRecorded });
  });
}

// ---------------------------------------------------------------------------
// Présence
// ---------------------------------------------------------------------------

export async function putCouncilAttendance(deps: PrimarySchoolDeps, ctx: RequestContext, deliberationId: Uuid, input: PrimaryPutAttendanceBody, caps: CallerCaps): Promise<Result<CouncilOverview, AppError>> {
  if (!caps.councilManage) return err(forbidden("La feuille de présence relève de la présidence du conseil."));
  const probe = await inTx(deps, ctx, async (tx) => ok(await listCasesOf(tx, deliberationId)), { readOnly: true });
  if (!probe.ok) return probe;
  const first = probe.value[0];
  if (!first) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", deliberationId));
  const access = await requireClassAccess(deps, ctx, first.classroomId, caps);
  if (!access.ok) return access;
  const problems = signatureProblems(input.participants, input.signedStaffIds ?? []);
  if (problems.length > 0) return err(validation(PrimaryCode.ATTENDANCE_UNKNOWN_SIGNER, problems[0] as string, "signedStaffIds", { problems }));

  return inTx(deps, ctx, async (tx) => {
    for (const p of input.participants) {
      await guarded(() =>
        upsertAttendanceRow(tx, { tenantId: ctx.tenantId, deliberationId, staffId: p.staffId, roleCode: p.roleCode, convened: p.convened, present: p.present ?? null, note: p.note ?? null }),
      );
    }
    await guarded(() => deleteUnsignedAttendanceNotIn(tx, deliberationId, input.participants.map((p) => p.staffId)));
    await guarded(() => signAttendance(tx, deliberationId, input.signedStaffIds ?? [], deps.clock.now()));
    const events = new EventBuffer(deps, ctx);
    const counts = countAttendance(await listAttendanceOf(tx, deliberationId));
    events.audit({ action: "primary_school.council_attendance.recorded", resourceType: "deliberation", resourceId: deliberationId, metadata: { ...counts, signed: (input.signedStaffIds ?? []).length } });
    await events.flush(tx);
    const cases = await listCasesOf(tx, deliberationId);
    return overviewOf(deps, ctx, tx, deliberationId, cases);
  });
}

// ---------------------------------------------------------------------------
// Procès-verbal
// ---------------------------------------------------------------------------

export interface MinutesView {
  documentId: Uuid | null;
  version: number;
  contentHash: string;
  alreadyRequested: boolean;
}

export async function requestCouncilMinutes(deps: PrimarySchoolDeps, ctx: RequestContext, deliberationId: Uuid, input: { heldOn?: string | undefined }, caps: CallerCaps): Promise<Result<MinutesView, AppError>> {
  if (!caps.councilManage) return err(forbidden("Le procès-verbal relève de la présidence du conseil."));
  const probe = await inTx(deps, ctx, async (tx) => ok(await listCasesOf(tx, deliberationId)), { readOnly: true });
  if (!probe.ok) return probe;
  const first = probe.value[0];
  if (!first) return err(notFound(PrimaryCode.COUNCIL_NOT_FOUND, "Conseil", deliberationId));
  const access = await requireClassAccess(deps, ctx, first.classroomId, caps);
  if (!access.ok) return access;
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;

  return inTx(deps, ctx, async (tx) => {
    const cases = await listCasesOf(tx, deliberationId);
    const overview = await overviewOf(deps, ctx, tx, deliberationId, cases);
    if (!overview.ok) return overview;
    const o = overview.value;
    const heldOn = input.heldOn ?? o.heldOn;
    if (!heldOn) return err(conflict(PrimaryCode.MINUTES_NOT_READY, "Indiquez la date réelle de la séance (heldOn) avant de demander le procès-verbal.", { reason: "held_on_missing" }));
    const convened = o.attendance.filter((a) => a.convened);
    if (convened.length === 0 || !convened.some((a) => a.present === true)) return err(conflict(PrimaryCode.MINUTES_NOT_READY, "La feuille de présence ne compte aucun maître présent.", { reason: "attendance_empty" }));
    if (o.counts.decided === 0) return err(conflict(PrimaryCode.MINUTES_NOT_READY, "Aucune décision n'est encore confirmée.", { reason: "no_decision" }));
    const { content, contentHash } = buildMinutes({ deliberationId, classroomId: o.classroomId, periodId: o.periodId, heldOn, ruleSourceKind: o.ruleSourceKind, attendance: o.attendance, cases: o.cases });

    const existing = await findMinutesByHash(tx, deliberationId, contentHash);
    if (existing) return ok<MinutesView>({ documentId: existing.documentId, version: existing.version, contentHash, alreadyRequested: true });
    const previous = await latestMinutes(tx, deliberationId);
    const row = await guarded(() =>
      insertMinutes(tx, { id: deps.newId(), tenantId: ctx.tenantId, deliberationId, classroomId: o.classroomId, periodId: o.periodId, version: (previous?.version ?? 0) + 1, content, contentHash, ruleSourceKind: o.ruleSourceKind, requestedBy: userId }),
    );
    // Le document est demandé à reportcards depuis le contenu FIGÉ ; si la nature n'est pas livrée, tout est annulé (échec fermé).
    const doc = await deps.ports.documents.requestCouncilMinutes(ctx, {
      minutesId: row.id,
      deliberationId,
      classroomId: o.classroomId,
      title: "Procès-verbal du conseil des maîtres",
      issuedAt: deps.clock.now(),
      content: content as unknown as Record<string, unknown>,
      contentHash,
      ruleSourceKind: o.ruleSourceKind,
    });
    await guarded(() => setMinutesDocument(tx, row.id, doc.documentId));
    const events = new EventBuffer(deps, ctx);
    events.add(PrimaryEvents.COUNCIL_MINUTES_REQUESTED, { v: 1, deliberationId, classroomId: o.classroomId, periodId: o.periodId, version: row.version, documentId: doc.documentId }, { type: "primary_school.council", id: deliberationId });
    events.audit({ action: "primary_school.council.minutes_requested", resourceType: "deliberation", resourceId: deliberationId, metadata: { version: row.version, documentId: doc.documentId, decisions: o.counts.decided }, sensitive: true });
    await events.flush(tx);
    return ok<MinutesView>({ documentId: doc.documentId, version: row.version, contentHash, alreadyRequested: false });
  });
}

export { actorOf };

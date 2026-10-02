/**
 * Séances, participants, ordre du jour, propositions, décisions. SQL paramétré, `Tx` reçu en paramètre (RLS du tenant).
 * Les invariants (acteur humain, machine à états, quorum, verrouillage, décideur habilité…) sont IMPOSÉS par les déclencheurs de
 * `2104_councils_guards.sql` : ce fichier n'en recopie aucun, il écrit.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AgendaItemRow, CouncilRow, CouncilStatusValue, DecisionRow, ParticipantRow, ProposalRow } from "./rows";

// ---------------------------------------------------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------------------------------------------------

const COUNCIL_COLS = `c.id, c.institution_id AS "institutionId", c.academic_year_id AS "academicYearId", c.classroom_id AS "classroomId",
  c.academic_period_id AS "academicPeriodId", c.council_type_id AS "councilTypeId", c.scope, c.results_state_id AS "resultsStateId",
  c.results_deliberation_id AS "resultsDeliberationId", c.status, c.title, c.scheduled_at AS "scheduledAt", c.location, c.held_on::text AS "heldOn",
  c.opened_at AS "openedAt", c.opened_by AS "openedBy", c.closed_at AS "closedAt", c.closed_by AS "closedBy", c.signed_at AS "signedAt",
  c.quorum_waived AS "quorumWaived", c.quorum_waiver_reason AS "quorumWaiverReason", c.reopen_count AS "reopenCount", c.cancel_reason AS "cancelReason",
  c.row_version AS "rowVersion", c.created_by AS "createdBy", c.created_at AS "createdAt"`;

export const getCouncil = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<CouncilRow | null> =>
  tx.queryOne<CouncilRow>(`SELECT ${COUNCIL_COLS} FROM councils.councils c WHERE c.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export interface CouncilFilter {
  classroomId?: string | undefined;
  academicYearId?: string | undefined;
  academicPeriodId?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Restreint aux séances de ces classes (périmètre d'un enseignant) ; `undefined` = toutes. */
  classroomIds?: readonly string[] | undefined;
}

function where(f: CouncilFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (f.classroomId) add("c.classroom_id = ?", f.classroomId);
  if (f.academicYearId) add("c.academic_year_id = ?", f.academicYearId);
  if (f.academicPeriodId) add("c.academic_period_id = ?", f.academicPeriodId);
  if (f.status) add("c.status = ?", f.status);
  if (f.from) add("coalesce(c.held_on, (c.scheduled_at AT TIME ZONE 'Africa/Abidjan')::date) >= ?::date", f.from);
  if (f.to) add("coalesce(c.held_on, (c.scheduled_at AT TIME ZONE 'Africa/Abidjan')::date) <= ?::date", f.to);
  if (f.classroomIds) add("c.classroom_id = ANY(?::uuid[])", f.classroomIds);
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export async function listCouncils(tx: Tx, f: CouncilFilter, page: { limit: number; offset: number }): Promise<{ rows: CouncilRow[]; total: number }> {
  const w = where(f);
  const rows = await tx.many<CouncilRow>(
    `SELECT ${COUNCIL_COLS} FROM councils.councils c ${w.sql} ORDER BY coalesce(c.scheduled_at, c.created_at) DESC, c.id LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`,
    [...w.params, page.limit, page.offset],
  );
  const total = (await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM councils.councils c ${w.sql}`, w.params))?.n ?? 0;
  return { rows, total };
}

export interface CouncilCounts {
  councilId: string;
  agendaItems: number;
  decided: number;
  participants: number;
  present: number;
}

export async function countsOfCouncils(tx: Tx, ids: readonly string[]): Promise<Map<string, CouncilCounts>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.many<CouncilCounts>(
    `SELECT c.id AS "councilId",
       (SELECT count(*)::int FROM councils.agenda_items a WHERE a.council_id = c.id) AS "agendaItems",
       (SELECT count(*)::int FROM councils.agenda_items a WHERE a.council_id = c.id AND a.status = 'DECIDED') AS decided,
       (SELECT count(*)::int FROM councils.participants p WHERE p.council_id = c.id) AS participants,
       (SELECT count(*)::int FROM councils.participants p WHERE p.council_id = c.id AND p.presence = 'PRESENT') AS present
     FROM councils.councils c WHERE c.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.councilId, r]));
}

export interface NewCouncil {
  id: string;
  tenantId: string;
  institutionId: string;
  academicYearId: string;
  classroomId: string;
  academicPeriodId: string | null;
  councilTypeId: string;
  scope: "PERIOD" | "YEAR";
  resultsStateId: string | null;
  title: string | null;
  scheduledAt: Date | null;
  location: string | null;
  createdBy: string;
}

export async function insertCouncil(tx: Tx, c: NewCouncil): Promise<void> {
  await tx.query(
    `INSERT INTO councils.councils (id, tenant_id, institution_id, academic_year_id, classroom_id, academic_period_id, council_type_id, scope, results_state_id, title, scheduled_at, location, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [c.id, c.tenantId, c.institutionId, c.academicYearId, c.classroomId, c.academicPeriodId, c.councilTypeId, c.scope, c.resultsStateId, c.title, c.scheduledAt, c.location, c.createdBy],
  );
}

export interface CouncilPatch {
  title?: string | null | undefined;
  scheduledAt?: Date | null | undefined;
  location?: string | null | undefined;
  heldOn?: string | null | undefined;
  resultsStateId?: string | null | undefined;
}

export async function updateCouncilFields(tx: Tx, id: string, p: CouncilPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, value: unknown, cast = ""): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (p.title !== undefined) add("title", p.title);
  if (p.scheduledAt !== undefined) add("scheduled_at", p.scheduledAt);
  if (p.location !== undefined) add("location", p.location);
  if (p.heldOn !== undefined) add("held_on", p.heldOn, "::date");
  if (p.resultsStateId !== undefined) add("results_state_id", p.resultsStateId);
  if (sets.length === 0) return;
  await tx.query(`UPDATE councils.councils SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function openCouncil(tx: Tx, id: string, o: { heldOn: string; quorumWaived: boolean; quorumWaiverReason: string | null; resultsDeliberationId: string | null }): Promise<void> {
  await tx.query(
    `UPDATE councils.councils SET status = 'OPEN', held_on = coalesce(held_on, $2::date), quorum_waived = $3, quorum_waiver_reason = $4,
       results_deliberation_id = coalesce(results_deliberation_id, $5) WHERE id = $1`,
    [id, o.heldOn, o.quorumWaived, o.quorumWaiverReason, o.resultsDeliberationId],
  );
}

export const setCouncilStatus = (tx: Tx, id: string, status: CouncilStatusValue): Promise<unknown> => tx.query("UPDATE councils.councils SET status = $2 WHERE id = $1", [id, status]);

export const cancelCouncil = (tx: Tx, id: string, reason: string): Promise<unknown> => tx.query("UPDATE councils.councils SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1", [id, reason]);

/** Réouverture : la base vérifie la demande approuvée, l'absence d'effet appliqué, l'acteur humain, et remplace le PV. */
export const reopenCouncilRow = (tx: Tx, id: string): Promise<unknown> => tx.query("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [id]);

/** Séances vivantes (ni annulées) d'une classe sur une période : la base impose un conseil vivant par (classe, type, période). */
export const listCouncilsByStateIds = (tx: Tx, stateIds: readonly string[]): Promise<CouncilRow[]> =>
  stateIds.length === 0 ? Promise.resolve([]) : tx.many<CouncilRow>(`SELECT ${COUNCIL_COLS} FROM councils.councils c WHERE c.results_state_id = ANY($1::uuid[])`, [stateIds]);

export const listCouncilsOfClassroom = (tx: Tx, classroomId: string): Promise<CouncilRow[]> =>
  tx.many<CouncilRow>(`SELECT ${COUNCIL_COLS} FROM councils.councils c WHERE c.classroom_id = $1 AND c.status <> 'CANCELLED' ORDER BY coalesce(c.held_on::timestamptz, c.scheduled_at, c.created_at)`, [classroomId]);

// ---------------------------------------------------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------------------------------------------------

const PART_COLS = `p.id, p.council_id AS "councilId", p.role_code AS "roleCode", p.council_function AS "councilFunction", p.staff_id AS "staffId", p.person_id AS "personId",
  p.display_name AS "displayName", p.is_voting AS "isVoting", p.presence, p.convoked_at AS "convokedAt", p.notified_at AS "notifiedAt", p.notification_ref AS "notificationRef"`;

export const listParticipants = (tx: Tx, councilId: string): Promise<ParticipantRow[]> =>
  tx.many<ParticipantRow>(`SELECT ${PART_COLS} FROM councils.participants p WHERE p.council_id = $1 ORDER BY coalesce(p.council_function, 'Z'), p.display_name, p.id`, [councilId]);
export const getParticipant = (tx: Tx, id: string): Promise<ParticipantRow | null> => tx.queryOne<ParticipantRow>(`SELECT ${PART_COLS} FROM councils.participants p WHERE p.id = $1`, [id]);
export const findParticipantByStaff = (tx: Tx, councilId: string, staffId: string): Promise<ParticipantRow | null> =>
  tx.queryOne<ParticipantRow>(`SELECT ${PART_COLS} FROM councils.participants p WHERE p.council_id = $1 AND p.staff_id = $2 ORDER BY p.id LIMIT 1`, [councilId, staffId]);
export const listParticipantsOfStaff = (tx: Tx, councilId: string, staffId: string): Promise<ParticipantRow[]> =>
  tx.many<ParticipantRow>(`SELECT ${PART_COLS} FROM councils.participants p WHERE p.council_id = $1 AND p.staff_id = $2 ORDER BY p.id`, [councilId, staffId]);

export interface NewParticipant {
  id: string;
  tenantId: string;
  councilId: string;
  roleCode: string;
  councilFunction: "PRESIDENT" | "SECRETARY" | null;
  staffId: string | null;
  personId: string | null;
  displayName: string;
  isVoting: boolean;
}

export async function insertParticipant(tx: Tx, p: NewParticipant): Promise<void> {
  await tx.query(
    `INSERT INTO councils.participants (id, tenant_id, council_id, role_code, council_function, staff_id, person_id, display_name, is_voting)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [p.id, p.tenantId, p.councilId, p.roleCode, p.councilFunction, p.staffId, p.personId, p.displayName, p.isVoting],
  );
}

export async function updateParticipant(tx: Tx, id: string, p: { councilFunction?: "PRESIDENT" | "SECRETARY" | null | undefined; isVoting?: boolean | undefined; presence?: string | undefined }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, value: unknown): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (p.councilFunction !== undefined) add("council_function", p.councilFunction);
  if (p.isVoting !== undefined) add("is_voting", p.isVoting);
  if (p.presence !== undefined) add("presence", p.presence);
  if (sets.length === 0) return;
  await tx.query(`UPDATE councils.participants SET ${sets.join(", ")} WHERE id = $1`, params);
}

export const deleteParticipant = (tx: Tx, id: string): Promise<unknown> => tx.query("DELETE FROM councils.participants WHERE id = $1", [id]);

export const markConvoked = (tx: Tx, id: string, at: Date): Promise<unknown> => tx.query("UPDATE councils.participants SET convoked_at = coalesce(convoked_at, $2) WHERE id = $1", [id, at]);
export const markNotified = (tx: Tx, id: string, at: Date, ref: string): Promise<unknown> => tx.query("UPDATE councils.participants SET notified_at = $2, notification_ref = $3 WHERE id = $1", [id, at, ref]);

// ---------------------------------------------------------------------------------------------------------------------
// Ordre du jour
// ---------------------------------------------------------------------------------------------------------------------

const ITEM_COLS = `a.id, a.council_id AS "councilId", a.enrollment_id AS "enrollmentId", a.student_id AS "studentId", a.student_display_name AS "studentDisplayName",
  a.position, a.status, a.facts, a.facts_hash AS "factsHash", a.facts_version AS "factsVersion", a.prepared_at AS "preparedAt", a.rule_version_ref AS "ruleVersionRef"`;

export const listAgendaItems = (tx: Tx, councilId: string): Promise<AgendaItemRow[]> =>
  tx.many<AgendaItemRow>(`SELECT ${ITEM_COLS} FROM councils.agenda_items a WHERE a.council_id = $1 ORDER BY a.position, a.student_display_name, a.id`, [councilId]);
export const getAgendaItem = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<AgendaItemRow | null> =>
  tx.queryOne<AgendaItemRow>(`SELECT ${ITEM_COLS} FROM councils.agenda_items a WHERE a.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const findAgendaItemByEnrollment = (tx: Tx, councilId: string, enrollmentId: string): Promise<AgendaItemRow | null> =>
  tx.queryOne<AgendaItemRow>(`SELECT ${ITEM_COLS} FROM councils.agenda_items a WHERE a.council_id = $1 AND a.enrollment_id = $2`, [councilId, enrollmentId]);

export interface AgendaCounts {
  agendaItemId: string;
  decisionCount: number;
  pendingProposals: number;
}

export async function agendaCounts(tx: Tx, councilId: string): Promise<Map<string, AgendaCounts>> {
  const rows = await tx.many<AgendaCounts>(
    `SELECT a.id AS "agendaItemId",
       (SELECT count(*)::int FROM councils.decisions d WHERE d.agenda_item_id = a.id AND d.status = 'RECORDED') AS "decisionCount",
       (SELECT count(*)::int FROM councils.proposals p WHERE p.agenda_item_id = a.id AND p.status = 'PROPOSED') AS "pendingProposals"
     FROM councils.agenda_items a WHERE a.council_id = $1`,
    [councilId],
  );
  return new Map(rows.map((r) => [r.agendaItemId, r]));
}

export async function insertAgendaItem(tx: Tx, a: { id: string; tenantId: string; councilId: string; enrollmentId: string; studentId: string; studentDisplayName: string; position: number; facts: unknown; ruleVersionRef: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO councils.agenda_items (id, tenant_id, council_id, enrollment_id, student_id, student_display_name, position, facts, rule_version_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [a.id, a.tenantId, a.councilId, a.enrollmentId, a.studentId, a.studentDisplayName, a.position, JSON.stringify(a.facts), a.ruleVersionRef],
  );
}

/** Reconstruit l'instantané : la base calcule hash et version (inchangés si le contenu est identique), refuse sous une décision. */
export async function updateAgendaFacts(tx: Tx, id: string, facts: unknown, ruleVersionRef: string | null, studentDisplayName: string, position: number): Promise<void> {
  await tx.query("UPDATE councils.agenda_items SET facts = $2::jsonb, rule_version_ref = $3, student_display_name = $4, position = $5 WHERE id = $1", [id, JSON.stringify(facts), ruleVersionRef, studentDisplayName, position]);
}

export const setAgendaStatus = (tx: Tx, id: string, status: "PENDING" | "REVIEWED"): Promise<unknown> => tx.query("UPDATE councils.agenda_items SET status = $2 WHERE id = $1", [id, status]);
export const deleteAgendaItem = (tx: Tx, id: string): Promise<unknown> => tx.query("DELETE FROM councils.agenda_items WHERE id = $1", [id]);

// ---------------------------------------------------------------------------------------------------------------------
// Propositions
// ---------------------------------------------------------------------------------------------------------------------

const PROP_COLS = `p.id, p.council_id AS "councilId", p.agenda_item_id AS "agendaItemId", p.kind, p.code, p.body, p.origin, p.proposed_by AS "proposedBy",
  p.proposed_by_name AS "proposedByName", p.status, p.resolved_by AS "resolvedBy", p.resolved_at AS "resolvedAt", p.resolution_note AS "resolutionNote",
  p.rule_version_ref AS "ruleVersionRef", p.created_at AS "createdAt"`;

export const listProposals = (tx: Tx, agendaItemId: string): Promise<ProposalRow[]> => tx.many<ProposalRow>(`SELECT ${PROP_COLS} FROM councils.proposals p WHERE p.agenda_item_id = $1 ORDER BY p.created_at, p.id`, [agendaItemId]);
export const listProposalsOfCouncil = (tx: Tx, councilId: string): Promise<ProposalRow[]> => tx.many<ProposalRow>(`SELECT ${PROP_COLS} FROM councils.proposals p WHERE p.council_id = $1 ORDER BY p.created_at, p.id`, [councilId]);
export const getProposal = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<ProposalRow | null> =>
  tx.queryOne<ProposalRow>(`SELECT ${PROP_COLS} FROM councils.proposals p WHERE p.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export async function insertProposal(
  tx: Tx,
  p: { id: string; tenantId: string; councilId: string; agendaItemId: string; kind: string; code: string | null; body: string | null; origin: "RULE_SUGGESTION" | "HUMAN"; proposedBy: string | null; proposedByName: string | null; ruleVersionRef: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO councils.proposals (id, tenant_id, council_id, agenda_item_id, kind, code, body, origin, proposed_by, proposed_by_name, rule_version_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [p.id, p.tenantId, p.councilId, p.agendaItemId, p.kind, p.code, p.body, p.origin, p.proposedBy, p.proposedByName, p.ruleVersionRef],
  );
}

export const resolveProposal = (tx: Tx, id: string, status: "ACCEPTED" | "REJECTED" | "WITHDRAWN", resolvedBy: string, note: string | null): Promise<unknown> =>
  tx.query("UPDATE councils.proposals SET status = $2, resolved_by = $3, resolution_note = $4 WHERE id = $1", [id, status, resolvedBy, note]);

/** Suggestions de règle déjà matérialisées pour cet élève (relance idempotente de la préparation). */
export const listRuleSuggestions = (tx: Tx, agendaItemId: string): Promise<ProposalRow[]> =>
  tx.many<ProposalRow>(`SELECT ${PROP_COLS} FROM councils.proposals p WHERE p.agenda_item_id = $1 AND p.origin = 'RULE_SUGGESTION' ORDER BY p.created_at, p.id`, [agendaItemId]);

// ---------------------------------------------------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------------------------------------------------

const DEC_COLS = `d.id, d.council_id AS "councilId", d.agenda_item_id AS "agendaItemId", d.enrollment_id AS "enrollmentId", d.student_id AS "studentId",
  d.decision_type_id AS "decisionTypeId", d.decision_type_code AS "decisionTypeCode", d.family, d.exclusive_group AS "exclusiveGroup", d.suggested_code AS "suggestedCode",
  d.suggestion_ref AS "suggestionRef", d.differs_from_suggestion AS "differsFromSuggestion", d.justification, d.decision_mode AS "decisionMode",
  d.votes_for AS "votesFor", d.votes_against AS "votesAgainst", d.votes_abstain AS "votesAbstain", d.target_program_id AS "targetProgramId",
  d.target_grade_level_id AS "targetGradeLevelId", d.target_label AS "targetLabel", d.decider_participant_id AS "deciderParticipantId",
  d.recorded_by AS "recordedBy", d.recorded_by_name AS "recordedByName", d.facts_version AS "factsVersion", d.facts_hash AS "factsHash",
  d.decided_at AS "decidedAt", d.status, d.withdrawn_reason AS "withdrawnReason", d.supersedes_id AS "supersedesId"`;

export const listDecisionsOfItem = (tx: Tx, agendaItemId: string): Promise<DecisionRow[]> => tx.many<DecisionRow>(`SELECT ${DEC_COLS} FROM councils.decisions d WHERE d.agenda_item_id = $1 ORDER BY d.decided_at, d.id`, [agendaItemId]);
export const listDecisionsOfCouncil = (tx: Tx, councilId: string, options: { recordedOnly?: boolean } = {}): Promise<DecisionRow[]> =>
  tx.many<DecisionRow>(`SELECT ${DEC_COLS} FROM councils.decisions d WHERE d.council_id = $1${options.recordedOnly ? " AND d.status = 'RECORDED'" : ""} ORDER BY d.decided_at, d.id`, [councilId]);
export const getDecision = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<DecisionRow | null> =>
  tx.queryOne<DecisionRow>(`SELECT ${DEC_COLS} FROM councils.decisions d WHERE d.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
export const listDecisionsOfEnrollment = (tx: Tx, enrollmentId: string): Promise<DecisionRow[]> =>
  tx.many<DecisionRow>(`SELECT ${DEC_COLS} FROM councils.decisions d WHERE d.enrollment_id = $1 ORDER BY d.decided_at, d.id`, [enrollmentId]);

export const listDecisionsOfStudent = (tx: Tx, studentId: string): Promise<DecisionRow[]> =>
  tx.many<DecisionRow>(`SELECT ${DEC_COLS} FROM councils.decisions d WHERE d.student_id = $1 AND d.status = 'RECORDED' ORDER BY d.decided_at DESC, d.id`, [studentId]);

export const listAcceptedProposalsOfItems = (tx: Tx, itemIds: readonly string[]): Promise<ProposalRow[]> =>
  itemIds.length === 0 ? Promise.resolve([]) : tx.many<ProposalRow>(`SELECT ${PROP_COLS} FROM councils.proposals p WHERE p.agenda_item_id = ANY($1::uuid[]) AND p.status IN ('ACCEPTED','MODIFIED') ORDER BY p.created_at, p.id`, [itemIds]);

/** Décisions par code pour une classe (comptages seulement : jamais l'identité d'un élève). */
export const decisionCountsOfClassroom = (tx: Tx, classroomId: string): Promise<Array<{ code: string; n: number }>> =>
  tx.many(`SELECT d.decision_type_code AS code, count(*)::int AS n FROM councils.decisions d JOIN councils.councils c ON c.tenant_id = d.tenant_id AND c.id = d.council_id
            WHERE c.classroom_id = $1 AND d.status = 'RECORDED' AND c.status <> 'CANCELLED' GROUP BY d.decision_type_code ORDER BY d.decision_type_code`, [classroomId]);

export interface NewDecision {
  id: string;
  tenantId: string;
  councilId: string;
  agendaItemId: string;
  enrollmentId: string;
  studentId: string;
  decisionTypeId: string;
  decisionTypeCode: string;
  family: string;
  suggestedCode: string | null;
  suggestionRef: string | null;
  differsFromSuggestion: boolean;
  justification: string | null;
  decisionMode: string;
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  targetProgramId: string | null;
  targetGradeLevelId: string | null;
  targetLabel: string | null;
  deciderParticipantId: string;
  recordedBy: string;
  recordedByName: string;
  supersedesId: string | null;
}

export async function insertDecision(tx: Tx, d: NewDecision): Promise<void> {
  await tx.query(
    `INSERT INTO councils.decisions (id, tenant_id, council_id, agenda_item_id, enrollment_id, student_id, decision_type_id, decision_type_code, family, suggested_code, suggestion_ref,
        differs_from_suggestion, justification, decision_mode, votes_for, votes_against, votes_abstain, target_program_id, target_grade_level_id, target_label,
        decider_participant_id, recorded_by, recorded_by_name, supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [d.id, d.tenantId, d.councilId, d.agendaItemId, d.enrollmentId, d.studentId, d.decisionTypeId, d.decisionTypeCode, d.family, d.suggestedCode, d.suggestionRef, d.differsFromSuggestion, d.justification, d.decisionMode, d.votesFor, d.votesAgainst, d.votesAbstain, d.targetProgramId, d.targetGradeLevelId, d.targetLabel, d.deciderParticipantId, d.recordedBy, d.recordedByName, d.supersedesId],
  );
}

export const withdrawDecision = (tx: Tx, id: string, reason: string): Promise<unknown> => tx.query("UPDATE councils.decisions SET status = 'WITHDRAWN', withdrawn_reason = $2 WHERE id = $1", [id, reason]);

// ---------------------------------------------------------------------------------------------------------------------
// Calculs de séance de la base (source unique : fonctions SQL de 2104)
// ---------------------------------------------------------------------------------------------------------------------

export interface QuorumRow {
  met: boolean;
  presentCount: number;
  requiredMin: number | null;
  missingRoles: string[];
  presidentPresent: boolean;
}

/** `councils.check_quorum` : la base fait foi à l'ouverture ; cette lecture renseigne l'écran AVANT l'ouverture. */
export const checkQuorum = (tx: Tx, councilId: string): Promise<QuorumRow | null> =>
  tx.queryOne<QuorumRow>(`SELECT met, present_count AS "presentCount", required_min AS "requiredMin", missing_roles AS "missingRoles", president_present AS "presidentPresent" FROM councils.check_quorum($1)`, [councilId]);

export const countUndecided = async (tx: Tx, councilId: string): Promise<number> =>
  (await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM councils.agenda_items WHERE council_id = $1 AND status <> 'DECIDED'", [councilId]))?.n ?? 0;

/**
 * Règles d'affectation d'enseignement (fonctions PURES) : qui est responsable de quoi.
 *
 * Une affectation n'est JAMAIS l'autorisation de paie (la paie lit l'intervenant réel d'une séance, spec 017).
 *
 * Résolution du responsable d'un nœud dans une classe (`resolveResponsible`, spec 009 AC2.3) :
 *    LEAD explicite du nœud  >  généraliste (`covers_all_subjects`)  >  titulaire (`HOMEROOM`)
 * avec deux précisions : un nœud transversal (conduite) n'a JAMAIS de responsable ; un SUBSTITUTE actif (suppléance de
 * longue durée, `replaces_assignment_id`) prend la place de l'affectation qu'il remplace pendant ses dates.
 */
import type { PeopleAssignmentRole } from "@ecoledigitale/contracts/src/v2/people";

export interface AssignmentFact {
  readonly id: string;
  readonly staffId: string;
  readonly classroomId: string;
  readonly curriculumNodeId: string | null;
  readonly periodId: string | null;
  readonly roleCode: PeopleAssignmentRole;
  readonly replacesAssignmentId: string | null;
  readonly coversAllSubjects: boolean;
  readonly status: "ACTIVE" | "ENDED" | "CANCELLED";
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export interface NodeFact {
  readonly id: string;
  readonly isMandatory: boolean;
  readonly isTransversal: boolean;
  readonly label?: string | null;
}

export type ResponsibleVia = "LEAD" | "GENERALIST" | "HOMEROOM" | "SUBSTITUTE";

export interface Responsible {
  readonly staffId: string;
  readonly assignmentId: string;
  readonly via: ResponsibleVia;
}

/** Une affectation compte à une date si elle est ACTIVE et couvre la date (bornes incluses). */
export function isActiveOn(a: Pick<AssignmentFact, "status" | "startsOn" | "endsOn">, onDate: string): boolean {
  return a.status === "ACTIVE" && a.startsOn <= onDate && (a.endsOn === null || a.endsOn >= onDate);
}

const periodMatches = (a: AssignmentFact, periodId: string | undefined): boolean => periodId === undefined || a.periodId === null || a.periodId === periodId;

/** Une affectation de LEAD « couvre » le nœud (explicitement ou comme généraliste). */
function leadCovers(a: AssignmentFact, nodeId: string): "LEAD" | "GENERALIST" | null {
  if (a.roleCode !== "LEAD") return null;
  if (a.curriculumNodeId === nodeId) return "LEAD";
  if (a.coversAllSubjects && a.curriculumNodeId === null) return "GENERALIST";
  return null;
}

/** Préfère l'affectation de période précise à celle valable pour toutes les périodes. */
function preferPeriod<T extends AssignmentFact>(list: readonly T[], periodId: string | undefined): T | undefined {
  return list.find((a) => periodId !== undefined && a.periodId === periodId) ?? list.find((a) => a.periodId === null) ?? list[0];
}

function withSubstitute(base: AssignmentFact, all: readonly AssignmentFact[], onDate: string): { assignment: AssignmentFact; substituted: boolean } {
  const sub = all.find((s) => s.roleCode === "SUBSTITUTE" && s.replacesAssignmentId === base.id && isActiveOn(s, onDate));
  return sub ? { assignment: sub, substituted: true } : { assignment: base, substituted: false };
}

export interface ResolveInput {
  readonly classroomId: string;
  readonly nodeId: string;
  readonly nodeIsTransversal: boolean;
  readonly periodId?: string | undefined;
  readonly onDate: string;
}

/** Le responsable d'un nœud dans une classe à une date, ou `null` (aucun, ou nœud transversal). */
export function resolveResponsible(assignments: readonly AssignmentFact[], input: ResolveInput): Responsible | null {
  if (input.nodeIsTransversal) return null;
  const live = assignments.filter((a) => a.classroomId === input.classroomId && isActiveOn(a, input.onDate) && periodMatches(a, input.periodId));
  const finalize = (base: AssignmentFact, via: ResponsibleVia): Responsible => {
    const { assignment, substituted } = withSubstitute(base, assignments.filter((a) => a.classroomId === input.classroomId), input.onDate);
    return { staffId: assignment.staffId, assignmentId: assignment.id, via: substituted ? "SUBSTITUTE" : via };
  };
  const explicit = preferPeriod(live.filter((a) => leadCovers(a, input.nodeId) === "LEAD"), input.periodId);
  if (explicit) return finalize(explicit, "LEAD");
  const generalist = preferPeriod(live.filter((a) => leadCovers(a, input.nodeId) === "GENERALIST"), input.periodId);
  if (generalist) return finalize(generalist, "GENERALIST");
  const homeroom = live.find((a) => a.roleCode === "HOMEROOM");
  if (homeroom) return finalize(homeroom, "HOMEROOM");
  return null;
}

/** Rôles qui rendent un enseignant « affecté » à une classe pour la VISIBILITÉ de ses élèves. */
export const CLASS_ACCESS_ROLES: readonly PeopleAssignmentRole[] = ["LEAD", "CO_TEACHER", "HOMEROOM", "SUBSTITUTE", "SUPERVISOR"];
/** Rôles qui autorisent à saisir des notes / faire l'appel d'un nœud précis. */
export const NODE_ACCESS_ROLES: readonly PeopleAssignmentRole[] = ["LEAD", "CO_TEACHER", "SUBSTITUTE"];

export interface IsAssignedInput {
  readonly staffId: string;
  readonly classroomId: string;
  readonly nodeId?: string | undefined;
  readonly onDate: string;
}

/**
 * Le membre du personnel est-il affecté (à la date) à la classe — et, si `nodeId` est fourni, à CE nœud (affectation du
 * nœud ou généraliste ; un simple titulaire de classe n'est pas autorisé à noter toutes les matières) ?
 */
export function isStaffAssigned(assignments: readonly AssignmentFact[], input: IsAssignedInput): boolean {
  return assignments.some((a) => {
    if (a.staffId !== input.staffId || a.classroomId !== input.classroomId || !isActiveOn(a, input.onDate)) return false;
    if (input.nodeId === undefined) return CLASS_ACCESS_ROLES.includes(a.roleCode);
    if (!NODE_ACCESS_ROLES.includes(a.roleCode)) return false;
    return a.curriculumNodeId === input.nodeId || (a.coversAllSubjects && a.curriculumNodeId === null);
  });
}

/**
 * Nœuds obligatoires NON transversaux sans LEAD actif (explicite ou généraliste) : donnée brute, sans seuil.
 * `periodId` omis : un LEAD de n'importe quelle période compte.
 */
export function listUnstaffedNodes(
  nodes: readonly NodeFact[],
  assignments: readonly AssignmentFact[],
  input: { classroomId: string; periodId?: string | undefined; onDate: string },
): NodeFact[] {
  const leads = assignments.filter((a) => a.classroomId === input.classroomId && a.roleCode === "LEAD" && isActiveOn(a, input.onDate) && periodMatches(a, input.periodId));
  return nodes.filter((n) => n.isMandatory && !n.isTransversal && !leads.some((a) => leadCovers(a, n.id) !== null));
}

// ---------------------------------------------------------------------------
// Forme d'une affectation (cohérence avec les CHECK de la base)
// ---------------------------------------------------------------------------

export interface AssignmentShape {
  readonly roleCode: PeopleAssignmentRole;
  readonly curriculumNodeId?: string | null | undefined;
  readonly coversAllSubjects?: boolean | undefined;
  readonly replacesAssignmentId?: string | null | undefined;
}

/** Messages d'erreur de forme (français) ; liste vide si la forme est valide. */
export function assignmentShapeProblems(a: AssignmentShape): string[] {
  const problems: string[] = [];
  const node = a.curriculumNodeId ?? null;
  const covers = a.coversAllSubjects ?? false;
  if (a.roleCode === "HOMEROOM" && node !== null) problems.push("Un titulaire de classe (HOMEROOM) n'a pas de nœud précis.");
  if (a.roleCode !== "HOMEROOM" && node === null && !covers) problems.push("Une affectation vise un nœud, ou toutes les matières pour un généraliste.");
  if (covers && node !== null) problems.push("Un généraliste (covers_all_subjects) n'a pas de nœud précis.");
  if (a.roleCode === "SUBSTITUTE" && !a.replacesAssignmentId) problems.push("Un remplaçant de longue durée désigne l'affectation qu'il remplace.");
  if (a.roleCode !== "SUBSTITUTE" && a.replacesAssignmentId) problems.push("Seul un SUBSTITUTE peut désigner une affectation remplacée.");
  return problems;
}

/**
 * Participants PROPOSÉS d'un conseil à partir des affectations d'enseignement de la classe (spec 006 AC2.1) — domaine pur.
 *
 * Le professeur principal (affectation `HOMEROOM`) et les enseignants de la classe sont proposés ; le nom n'est figé qu'à
 * l'ajout du participant à la séance. Le code de rôle de participant proposé n'existe que si l'établissement a un rôle de ce code
 * actif : les rôles sont des DONNÉES (aucun rôle n'est supposé). Les fonctions (président, secrétaire) ne sont JAMAIS proposées.
 */
export interface StaffAssignment {
  readonly staffId: string;
  readonly displayName: string;
  /** Rôle d'affectation de `people` (`HOMEROOM`, `LEAD`, `CO_TEACHER`, `SUBSTITUTE`, `SUPERVISOR`). */
  readonly assignmentRole: string;
  readonly coversAllSubjects?: boolean;
}

export interface ProposedParticipant {
  readonly staffId: string;
  readonly displayName: string;
  readonly roleCode: string | null;
  readonly councilFunction: null;
  readonly source: "HOMEROOM" | "TEACHING";
}

/** Correspondance rôle d'affectation → code de rôle de participant (donnée de structure, adaptable par l'établissement). */
export const DEFAULT_ASSIGNMENT_ROLE_MAP: Readonly<Record<string, string>> = Object.freeze({ HOMEROOM: "HOMEROOM_TEACHER", LEAD: "TEACHER", CO_TEACHER: "TEACHER" });

export function proposeParticipants(assignments: readonly StaffAssignment[], activeRoleCodes: ReadonlySet<string>, roleMap: Readonly<Record<string, string>> = DEFAULT_ASSIGNMENT_ROLE_MAP): ProposedParticipant[] {
  const byStaff = new Map<string, ProposedParticipant>();
  for (const a of assignments) {
    const source = a.assignmentRole === "HOMEROOM" || a.coversAllSubjects === true ? "HOMEROOM" : "TEACHING";
    const mapped = roleMap[a.assignmentRole];
    const roleCode = mapped !== undefined && activeRoleCodes.has(mapped) ? mapped : null;
    const known = byStaff.get(a.staffId);
    // Le professeur principal prime sur une simple affectation d'enseignement.
    if (!known || (source === "HOMEROOM" && known.source !== "HOMEROOM")) byStaff.set(a.staffId, { staffId: a.staffId, displayName: a.displayName, roleCode, councilFunction: null, source });
  }
  return [...byStaff.values()].sort((x, y) => (x.source === y.source ? x.displayName.localeCompare(y.displayName, "fr") : x.source === "HOMEROOM" ? -1 : 1));
}

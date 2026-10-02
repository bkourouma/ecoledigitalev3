/**
 * Quorum d'une séance — MIROIR pur de `councils.check_quorum` (migration 2104). Aucune valeur par défaut « officielle » :
 * `minParticipants = null` et `requiredRoleCodes = []` ne contrôlent rien ; seule exigence structurelle : un président PRÉSENT.
 * C'est la base qui fait foi à l'ouverture ; cette fonction sert à informer l'écran AVANT l'ouverture.
 */
export interface QuorumParticipant {
  readonly roleCode: string;
  readonly councilFunction: string | null;
  readonly presence: string;
  /** `participant_roles.counts_for_quorum` du rôle. */
  readonly countsForQuorum: boolean;
}

export interface QuorumRules {
  readonly minParticipants: number | null;
  readonly requiredRoleCodes: readonly string[];
}

export interface QuorumResult {
  readonly met: boolean;
  readonly presentCount: number;
  readonly requiredMin: number | null;
  readonly missingRoles: readonly string[];
  readonly presidentPresent: boolean;
}

export function evaluateQuorum(participants: readonly QuorumParticipant[], rules: QuorumRules): QuorumResult {
  const presentCount = participants.filter((p) => p.presence === "PRESENT" && p.countsForQuorum).length;
  const missingRoles = [...rules.requiredRoleCodes].sort().filter((role) => !participants.some((p) => p.roleCode === role && p.presence === "PRESENT"));
  const presidentPresent = participants.some((p) => p.councilFunction === "PRESIDENT" && p.presence === "PRESENT");
  const met = (rules.minParticipants === null || presentCount >= rules.minParticipants) && missingRoles.length === 0;
  return { met, presentCount, requiredMin: rules.minParticipants, missingRoles, presidentPresent };
}

/** Signataires exigés (miroir de `councils.required_signers`) : participants PRÉSENTS dont la fonction ou le rôle est listé. */
export function requiredSigners<T extends { presence: string; councilFunction: string | null; roleCode: string }>(participants: readonly T[], rules: { signerFunctions: readonly string[]; signerRoleCodes: readonly string[] }): T[] {
  return participants.filter((p) => p.presence === "PRESENT" && ((p.councilFunction !== null && rules.signerFunctions.includes(p.councilFunction)) || rules.signerRoleCodes.includes(p.roleCode)));
}

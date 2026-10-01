/**
 * Règle de domaine « cet utilisateur est bien le tuteur de cet élève » (fonctions PURES).
 *
 * C'est LA règle appliquée par tous les modules qui exposent des permissions `*.child.*` (notes, présences, paiements,
 * communications…). Elle n'est pas un périmètre RBAC : le RBAC dit « peut consulter les données d'un enfant », ce
 * module dit « de CET enfant-là ». La version SQL (`infrastructure/guardians-repo.ts#isGuardianOfStudent`) applique
 * exactement les mêmes conditions ; un test de cohérence les confronte sur la matrice complète.
 */
export interface GuardianshipFacts {
  /** La personne portant l'identité courante existe-t-elle et est-elle un tuteur ? */
  readonly personHasIdentity: boolean;
  readonly personStatus: "ACTIVE" | "ARCHIVED";
  readonly guardianStatus: "ACTIVE" | "ARCHIVED";
  /** Lien vivant : `valid_to IS NULL` (un lien clos ne donne plus aucun accès). */
  readonly linkAlive: boolean;
  /** Drapeau `portal_access` du lien. */
  readonly portalAccess: boolean;
  /** Nature du type de lien : seule `GUARDIAN` ouvre l'accès (un contact d'urgence, jamais). */
  readonly relationshipKind: "GUARDIAN" | "EMERGENCY" | "OTHER";
}

export function isGuardianOfStudentRule(f: GuardianshipFacts): boolean {
  return f.personHasIdentity && f.personStatus === "ACTIVE" && f.guardianStatus === "ACTIVE" && f.linkAlive && f.portalAccess && f.relationshipKind === "GUARDIAN";
}

/** Drapeaux d'un lien avec les valeurs par défaut PRUDENTES (le legacy autorisait le retrait par défaut). */
export interface LinkFlags {
  readonly isPrimaryContact: boolean;
  readonly isEmergencyContact: boolean;
  readonly isFinancialResponsible: boolean;
  readonly hasLegalCustody: boolean;
  readonly canPickup: boolean;
  readonly portalAccess: boolean;
  readonly priority: number;
}

export const DEFAULT_LINK_FLAGS: LinkFlags = Object.freeze({
  isPrimaryContact: false,
  isEmergencyContact: false,
  isFinancialResponsible: false,
  hasLegalCustody: false,
  canPickup: false,
  portalAccess: true,
  priority: 100,
});

/**
 * Les drapeaux d'un lien, valeurs par défaut comprises. Pour un type de lien qui n'est pas une tutelle (contact d'urgence,
 * « autre »), l'accès au portail est FERMÉ par défaut.
 */
export function resolveLinkFlags(input: Partial<LinkFlags>, kind: "GUARDIAN" | "EMERGENCY" | "OTHER" = "GUARDIAN"): LinkFlags {
  const out: Record<string, unknown> = { ...DEFAULT_LINK_FLAGS, ...(kind === "GUARDIAN" ? {} : { portalAccess: false }) };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out as unknown as LinkFlags;
}

/**
 * Un type de lien qui n'est pas de nature `GUARDIAN` ne peut ni porter l'autorité parentale, ni ouvrir l'accès au
 * portail (le contact d'urgence, l'oncle « autre » ne sont pas des tuteurs). Renvoie la liste des drapeaux interdits.
 */
export function forbiddenFlagsForKind(kind: "GUARDIAN" | "EMERGENCY" | "OTHER", flags: Pick<LinkFlags, "hasLegalCustody" | "portalAccess">): string[] {
  if (kind === "GUARDIAN") return [];
  const bad: string[] = [];
  if (flags.hasLegalCustody) bad.push("hasLegalCustody");
  if (flags.portalAccess) bad.push("portalAccess");
  return bad;
}

/**
 * Permissions qui ouvrent chaque section du pack Primary. Source unique pour les gardes SERVEUR (`layout.tsx`, `requireAnyPermission`)
 * et la navigation de section (`PrimaryNav`, masque les entrées non permises). L'API reste la barrière réelle sur les données.
 * Module sans « use client » : importable depuis un composant serveur.
 */
export const PRIMARY_GUARDS = {
  classe: ["primary.competency.read", "primary.competency.record", "primary.council.read", "primary.council.prepare", "primary.class.read_all"],
  competences: ["primary.competency.read", "primary.competency.record"],
  appreciations: ["primary.phrase.read", "primary.phrase.manage"],
  conseil: ["primary.council.read", "primary.council.prepare", "primary.council.manage"],
  direction: ["primary.report.read"],
  bilans: ["primary.bilan.read", "primary.bilan.prepare"],
  archives: ["primary.archive.prepare", "primary.archive.freeze", "primary.bilan.read"],
  etats: ["primary.report.read"],
  parametres: ["primary.settings.manage"],
  "mon-enfant": ["primary.bilan.child.read", "primary.bilan.self.read", "primary.competency.child.read", "primary.competency.self.read"],
} as const;

export type PrimarySection = keyof typeof PRIMARY_GUARDS;

/** Toute permission du pack : garde de l'habillage commun. */
export const PRIMARY_ANY_PERMISSION: readonly string[] = [...new Set(Object.values(PRIMARY_GUARDS).flat())];

/** Descriptions des comptes de démonstration : « rôle -> ce qu'il peut tester » (affichées par `demo:up` et dans credentials.md). */

export const TENANTS = [
  { slug: "demo-secondaire", pack: "SECONDARY", label: "Collège Le Baobab (démonstration) : Secondaire, collège et lycée" },
  { slug: "demo-primaire", pack: "PRIMARY", label: "École Les Palmiers (démonstration) : Primaire, maternelle et primaire" },
  { slug: "demo-superieur", pack: "HIGHER", label: "Université Horizon (démonstration) : Supérieur, LMD" },
];

/** Clé = rôle tel qu'écrit dans credentials.json. `mfa` suit `mfaRecommended` des modèles de rôles (rôles à permission sensible). */
export const ROLE_GUIDE = {
  proprietaire: { label: "Propriétaire (owner)", mfa: true, tests: "Tout l'établissement : paramètres, rôles, abonnement, tableaux de bord de direction, finance." },
  directeur: { label: "Directeur", mfa: true, tests: "Direction : validations (appels, notes), résultats, conseils, alertes et tableaux de bord." },
  directeur_etudes: { label: "Directeur des études", mfa: true, tests: "Pédagogie : programmes, emplois du temps, résultats, bulletins, conseils de classe." },
  responsable_pedagogique: { label: "Responsable pédagogique", mfa: true, tests: "Relecture et approbation des évaluations, suivi pédagogique." },
  secretariat: { label: "Secrétariat", mfa: true, tests: "Dossiers élèves, inscriptions, tuteurs, imports de masse, courriers." },
  econome: { label: "Économe", mfa: true, tests: "Finance : factures, règlements, paiement en ligne SANDBOX, rapprochement, relances." },
  enseignant: { label: "Enseignant", mfa: false, tests: "Appel, saisie des notes, emploi du temps, portail enseignant (y compris hors ligne)." },
  instituteur: { label: "Instituteur (titulaire de classe)", mfa: false, tests: "Appel journalier, compétences, conseil des maîtres, bilan annuel (primaire)." },
  educateur: { label: "Éducateur (vie scolaire)", mfa: false, tests: "Incidents, sanctions, retards et absences, convocations (secondaire)." },
  responsable_examens: { label: "Responsable des examens", mfa: false, tests: "Sessions d'examen, candidats, examen blanc, résultats d'examen." },
  admissions_officer: { label: "Chargé d'admissions", mfa: false, tests: "Campagnes, candidatures, entretiens, offres, pièces, passage à l'inscription." },
  instituteur_maternelle: { label: "Instituteur de la maternelle (GS-A)", mfa: false, tests: "Maternelle : appel journalier, compétences sans note, conseil des maîtres, bilans annuels (primaire)." },
  parent: { label: "Parent (tuteur)", mfa: false, tests: "Portail famille : enfants, notes, bulletins, factures, paiement SANDBOX, messages." },
  eleve: { label: "Élève", mfa: false, tests: "Portail élève : emploi du temps, notes, bulletins, devoirs." },
};

export const ROLE_ORDER = Object.keys(ROLE_GUIDE);

export const PLATFORM_GUIDE = { label: "Opérateur de la plateforme (super-admin)", tests: "Console /v2/platform/login : organisations, abonnements, fonctionnalités, impersonation." };

/**
 * RuleSets de départ du catalogue national. Aucune règle réglementaire ivoirienne officielle n'est inventée
 * (MGA, CEPE, BEPC, BAC… : questions métier, voir regulatory-sources-needed.md) : ce sont des PORTAGES de formules
 * déjà en production. `source.kind = "platform"`, `reference` = le fichier legacy porté.
 *
 * Phase 4-5 : trois jeux FICTIFS (`CI-PRIMARY-PLACEHOLDER`, `CI-SECONDARY-PLACEHOLDER`, `CI-EXAM-PLACEHOLDER`,
 * `source.kind = "placeholder"`) servent à exercer le mécanisme des packs Primaire, Secondaire et Examens ; ils ne contiennent
 * AUCUNE valeur officielle, tout résultat qui en dérive porte le filigrane « règles de démonstration » et leur liaison en
 * production est refusée sans accusé explicite (`rules.placeholder_requires_ack`).
 */
import { COEF_PERIOD_ID } from "../contracts/coef-period";
import { COEF_SEMESTER_ID } from "../contracts/coef-semester";
import { COMPETENCY_PERIOD_ID } from "../contracts/competency-period";
import { CREDIT_SEMESTER_ID } from "../contracts/credit-semester";
import { EXAM_NATIONAL_ID } from "../contracts/exam-national";
import { SECONDARY_ANNUAL_ID } from "../contracts/secondary-annual";
import { coefSemesterRules } from "./coef-semester-rules";
import { creditSemesterRules } from "./credit-semester-rules";
import { examPlaceholderRules } from "./exam-placeholder-rules";
import { coefPeriodPlaceholderRules, coefPeriodPlaceholderRulesV3, competencyPeriodPlaceholderRules } from "./primary-placeholder-rules";
import { secondaryAnnualPlaceholderRules, secondaryCoefSemesterPlaceholderRules } from "./secondary-placeholder-rules";
import type { SeedRuleSet } from "./types";

/** Premier jour d'application de la version 1 (date de la fixture du moteur : golden tests). */
export const SEED_EFFECTIVE_FROM = "2024-09-01";

/** Identité « système » apposée aux actes de chargement des données de départ. */
export const SEED_ACTOR_ID = "00000000-0000-7000-8000-000000000001";
export const SEED_ACTOR_NAME = "Chargement des données de départ";

/** Premier jour d'application des jeux fictifs (date de démonstration des specs 005, 006 et 018). */
export const PLACEHOLDER_EFFECTIVE_FROM = "2026-09-01";

export const PLACEHOLDER_RULE_SET_CODES = Object.freeze(["CI-PRIMARY-PLACEHOLDER", "CI-SECONDARY-PLACEHOLDER", "CI-EXAM-PLACEHOLDER"] as const);

export const SEED_RULE_SETS: readonly SeedRuleSet[] = Object.freeze([
  {
    code: "CI-HIGHER-LMD",
    name: "Supérieur à crédits (LMD) — UE / ECUE",
    countryCode: "CI",
    educationSystem: "HIGHER",
    versions: [
      {
        versionNo: 1,
        contractId: CREDIT_SEMESTER_ID,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        source: {
          kind: "platform",
          reference: "apps/api/src/services/bulletin-calc.ts",
          description:
            "Portage des formules du module Professionnel (bulletin-calc.ts, professional-bulletin.service.ts, professional-results.service.ts). " +
            "Décisions métier du 2026-10-01 : rattrapage = REPLACE ; semestre validé = toutes les UE validées.",
        },
        notes: "Version de départ de la plateforme ; modifiable uniquement par une nouvelle version.",
        rules: creditSemesterRules,
      },
    ],
  },
  {
    code: "CI-HIGHER-BTS",
    name: "BTS — matières à coefficients",
    countryCode: "CI",
    educationSystem: "HIGHER",
    level: "BTS",
    versions: [
      {
        versionNo: 1,
        contractId: COEF_SEMESTER_ID,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        source: {
          kind: "platform",
          reference: "apps/api/src/routes/semester-averages.ts",
          description: "Copie de CI-CLASSIC-SEMESTRE v1 : en 2ᵉ année de BTS, la décision de fin d'année est renvoyée à l'examen terminal (question métier Q-15 à confirmer).",
        },
        notes: "Copie (pas un héritage) du jeu classique, pour évoluer indépendamment (examen national, admissibilité).",
        rules: coefSemesterRules,
      },
    ],
  },
  {
    code: "CI-CLASSIC-SEMESTRE",
    name: "Pile classique — moyennes pondérées, mentions, décisions",
    countryCode: "CI",
    educationSystem: "CLASSIC",
    versions: [
      {
        versionNo: 1,
        contractId: COEF_SEMESTER_ID,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        source: {
          kind: "platform",
          reference: "apps/api/src/routes/semester-averages.ts",
          description: "Portage des formules du bulletin classique (moyennes pondérées, (S1 + 2·S2) / 3, mentions, décisions, distinctions, classement).",
        },
        notes: "Version de départ de la plateforme ; modifiable uniquement par une nouvelle version.",
        rules: coefSemesterRules,
      },
    ],
  },
  {
    code: "CI-PRIMARY-PLACEHOLDER",
    name: "Primaire — jeu de démonstration (fictif)",
    countryCode: "CI",
    educationSystem: "PRIMARY",
    versions: [
      {
        versionNo: 1,
        contractId: COEF_PERIOD_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration 005-primary — aucune valeur officielle",
          description: "Jeu FICTIF qui exerce le mécanisme (N périodes pondérées, moyenne générale annuelle, décision en quatre codes, quorum). Aucune formule ni aucun seuil officiel.",
        },
        notes: "Règles de démonstration : tout résultat qui en dérive est marqué « document sans valeur officielle ».",
        rules: coefPeriodPlaceholderRules,
      },
      {
        versionNo: 2,
        contractId: COMPETENCY_PERIOD_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration 005-primary — aucune valeur officielle",
          description: "Jeu FICTIF de la maternelle (évaluation par compétences, sans note).",
        },
        notes: "Règles de démonstration : la règle ne décide jamais seule, le conseil décide.",
        rules: competencyPeriodPlaceholderRules,
      },
      {
        versionNo: 3,
        contractId: COEF_PERIOD_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        supersedes: 1,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration 005-primary — aucune valeur officielle",
          description:
            "Jeu FICTIF qui exerce le mécanisme. Remplace la version 1 : ajoute les mentions de période par seuils de moyenne RÉGLABLES (décision Q-P05) ; " +
            "le rang de compétition (1, 1, 3) est calculé et affiché par défaut (décision Q-P04). Seuils de départ non officiels.",
        },
        notes: "Règles de démonstration : seuils de mention fictifs, à régler par l'établissement (variante) ; règle de mention optionnelle donc désactivable.",
        rules: coefPeriodPlaceholderRulesV3,
      },
    ],
  },
  {
    code: "CI-SECONDARY-PLACEHOLDER",
    name: "Secondaire — jeu de démonstration (fictif)",
    countryCode: "CI",
    educationSystem: "SECONDARY",
    versions: [
      {
        versionNo: 1,
        contractId: COEF_SEMESTER_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration du pack Secondary — non réglementaire",
          description: "Copie de démonstration de CI-CLASSIC-SEMESTRE v1 (deux périodes), à titre d'exemple fonctionnel uniquement ; aucune règle d'orientation.",
        },
        notes: "Règles de démonstration : tout PV, résultat de classe et bulletin issu de ce jeu porte la mention « jeu de démonstration, non réglementaire ».",
        rules: secondaryCoefSemesterPlaceholderRules,
      },
      {
        versionNo: 2,
        contractId: SECONDARY_ANNUAL_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration du pack Secondary — non réglementaire",
          description: "Même pipeline pour un nombre quelconque de périodes (trimestres ou semestres) pondérées.",
        },
        notes: "Règles de démonstration : valeurs copiées de CI-CLASSIC-SEMESTRE v1, sans valeur officielle.",
        rules: secondaryAnnualPlaceholderRules,
      },
    ],
  },
  {
    code: "CI-EXAM-PLACEHOLDER",
    name: "Examens nationaux — jeu de démonstration (fictif)",
    countryCode: "CI",
    educationSystem: "EXAM",
    versions: [
      {
        versionNo: 1,
        contractId: EXAM_NATIONAL_ID,
        effectiveFrom: PLACEHOLDER_EFFECTIVE_FROM,
        source: {
          kind: "placeholder",
          reference: "Jeu de démonstration 018-examinations — aucune valeur officielle",
          description: "Jeu FICTIF pour les démonstrations, les tests et les examens blancs ; l'admission officielle est prononcée par l'autorité, jamais calculée.",
        },
        notes: "Règles de démonstration : les documents officiels n'utilisent jamais un résultat calculé avec ce jeu.",
        rules: examPlaceholderRules,
      },
    ],
  },
]);

export function seedRuleSet(code: string): SeedRuleSet | undefined {
  return SEED_RULE_SETS.find((s) => s.code === code);
}

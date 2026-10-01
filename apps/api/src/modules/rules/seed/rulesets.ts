/**
 * RuleSets de départ du catalogue national. Aucune règle réglementaire ivoirienne officielle n'est inventée
 * (MGA, CEPE, BEPC, BAC… : questions métier, voir regulatory-sources-needed.md) : ce sont des PORTAGES de formules
 * déjà en production. `source.kind = "platform"`, `reference` = le fichier legacy porté.
 */
import { COEF_SEMESTER_ID } from "../contracts/coef-semester";
import { CREDIT_SEMESTER_ID } from "../contracts/credit-semester";
import { coefSemesterRules } from "./coef-semester-rules";
import { creditSemesterRules } from "./credit-semester-rules";
import type { SeedRuleSet } from "./types";

/** Premier jour d'application de la version 1 (date de la fixture du moteur : golden tests). */
export const SEED_EFFECTIVE_FROM = "2024-09-01";

/** Identité « système » apposée aux actes de chargement des données de départ. */
export const SEED_ACTOR_ID = "00000000-0000-7000-8000-000000000001";
export const SEED_ACTOR_NAME = "Chargement des données de départ";

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
]);

export function seedRuleSet(code: string): SeedRuleSet | undefined {
  return SEED_RULE_SETS.find((s) => s.code === code);
}

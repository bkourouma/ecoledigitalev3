/**
 * Tables GLOBALES du schéma "primary_school" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : les 17 tables du schéma portent `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` et la RLS forcée
 * (kernel.enable_tenant_rls) — échelles et niveaux d'appréciation, référentiels de compétences (structure, niveaux d'application),
 * appréciations et révisions, verrous de période, banque de phrases, dossiers et présence du conseil, procès-verbaux, bilans
 * annuels, archives, paramètres, applications du modèle. Même les référentiels de DÉMONSTRATION sont instanciés PAR tenant : un
 * référentiel est une donnée de l'établissement (versionnée, immuable une fois publiée), jamais un catalogue commun.
 *
 * Valeurs imposées pour fabriquer une ligne de test dans les tables à CHECK de format (codes, empreintes, énumérations).
 * Les tables à clé étrangère COMPOSITE obligatoire (niveaux, référentiels, compétences, appréciations, révisions) restent contrôlées
 * en structure par le test générique ; leur isolation comportementale est prouvée par les tests d'intégration du module (RLS A/B).
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;

const hex = (n: number): string => "a".repeat(n);

export const fixtures = {
  "primary_school.rating_scales": { code: (n: number) => `ISO_${n}`, label: "Isolation" },
  "primary_school.appreciation_phrases": { code: (n: number) => `ISO_${n}`, scope: "PERIOD", body: "Isolation" },
  "primary_school.period_locks": { status: "OPEN" },
  "primary_school.template_applications": { template_version: 1 },
  "primary_school.council_attendance": { role_code: "OTHER" },
  "primary_school.annual_reviews": { grade_level_code: "CE1" },
  "primary_school.council_minutes": { content: "{}", content_hash: hex(64), version: 1 },
} as const;

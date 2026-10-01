# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: Every feature starts as a standalone library; Libraries must be self-contained, independently testable, documented; Clear purpose required - no organizational-only libraries -->

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: Every library exposes functionality via CLI; Text in/out protocol: stdin/args → stdout, errors → stderr; Support JSON + human-readable formats -->

### [PRINCIPLE_3_NAME]
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: TDD mandatory: Tests written → User approved → Tests fail → Then implement; Red-Green-Refactor cycle strictly enforced -->

### [PRINCIPLE_4_NAME]
<!-- Example: IV. Integration Testing -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Focus areas requiring integration tests: New library contract tests, Contract changes, Inter-service communication, Shared schemas -->

### [PRINCIPLE_5_NAME]
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
[PRINCIPLE_5_DESCRIPTION]
<!-- Example: Text I/O ensures debuggability; Structured logging required; Or: MAJOR.MINOR.BUILD format; Or: Start simple, YAGNI principles -->

## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Principes EcoleDigitale SaaS

<!-- Ajout du 2026-10-01 (amendement 1.1.0) : plateforme SaaS v2. Source : docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md §3.1 et §7 ; PRD §66. Les specs v2 vivent dans `specs/v2/` (`specs/001..031` est l'historique). -->

Ces principes s'appliquent à toute spec de `specs/v2/`. Chacun est accompagné d'un **garde-fou automatisé** : un principe sans garde-fou en CI n'est pas considéré comme respecté. Les garde-fous sont bloquants (plan §7) ; ils sont mis en place par la spec `000-platform-foundation`.

| # | Principe | Règle | Garde-fou automatisé |
|---|----------|-------|----------------------|
| 1 | Multi-tenant dès le premier jour | Toute table de données a `tenant_id NOT NULL` et un RLS forcé, sauf liste blanche explicite de tables globales. L'API se connecte avec un rôle sans `BYPASSRLS` et n'accède à la base que par `TenantDb`. | Test CI : toute table hors liste blanche a `tenant_id NOT NULL` + RLS forcé ; test d'isolation tenant A/B |
| 2 | Aucune règle académique codée en dur | Seuils, coefficients, arrondis, mentions, décisions de passage et formules vivent dans un RuleSet versionné du Rules Engine, jamais dans le code des modules, ni dans le web. | Lint : interdiction de constantes de seuils dans `modules/**` hors `rules-engine` |
| 3 | Modular monolith | Un module n'importe que l'`index.ts` public d'un autre module ; route → use case → repository ; aucune requête SQL dans une route ; un schéma Postgres par module. | `dependency-cruiser` en CI |
| 4 | API first | Le contrat Zod est écrit dans `packages/contracts` avant toute route ; le client typé en est généré ; aucune logique métier (moyenne, rang, mention) dans le web. | Test : toute route référence un contrat de `packages/contracts` |
| 5 | Audit des opérations sensibles | Notes, finance, rôles et permissions passent par un use case ou décorateur d'audit (qui, quoi, avant/après, `request_id`). Une note publiée est immuable ; toute correction crée une révision. | Test qui échoue si une opération sensible n'écrit pas dans `audit_log` |
| 6 | Tests obligatoires sur les calculs | Tout calcul académique ou financier a des tests unitaires et des golden tests ; les montants sont des entiers. | Seuil de couverture sur `rules-engine` et `finance` ; golden tests bloquants |
| 7 | Feature flags / entitlements | Toute fonctionnalité de pack est livrée derrière un entitlement. | Toute route de pack est gardée par `requireFeature(...)` (test) |

Principes complémentaires issus du PRD §66 : configuration avant personnalisation spécifique ; mobile first ; l'IA assiste mais ne remplace pas les décisions réglementaires humaines.

Règles transverses : UUID partout ; horodatages en UTC (affichage `Africa/Abidjan`) ; aucun secret dans le dépôt et démarrage refusé sans secrets obligatoires ; un mode sandbox explicite pour les services externes, jamais un repli silencieux en simulation.

**Version de la section** : 1.1.0 | **Ajoutée** : 2026-10-01

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->

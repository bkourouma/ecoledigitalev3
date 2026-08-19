# Specification Quality Checklist: Rémunération des enseignants — Module Professionnel

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-18
**Feature**: [Link to spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Décisions tranchées en amont** (voir Assumptions du spec et research.md) :
  un seul bulletin par enseignant et par période toutes origines confondues ;
  heures supplémentaires appréciées sur le cumul ; durée déduite des horaires ;
  statut de réalisation posé manuellement ; aucun paiement rétroactif par
  migration ; devise unique par établissement.

- **Quelques noms techniques** (`teachers`, `professional_ecue_seances`,
  `payment_hour_details`) apparaissent dans le spec. Ils servent d'**ancrage de
  traçabilité** vers l'existant analysé en Phase 0 — notamment pour FR-040 à
  FR-042, qui décrivent la régularisation de défauts constatés dans le schéma
  actuel et ne seraient pas identifiables sans nommer l'objet concerné. Le
  détail technique reste renvoyé au plan et au data-model.

- **Point d'attention pour la revue métier** : FR-040 à FR-042 corrigent des
  défauts **préexistants**, hors du périmètre nominal de la feature. La
  justification est tracée dans le Complexity Tracking du plan — ils se trouvent
  exactement sur le chemin étendu, et la feature ne pourrait pas satisfaire
  SC-001 sans eux. La conséquence visible (les montants académiques peuvent
  changer après la migration) est signalée dans le quickstart et fait l'objet
  d'une tâche de comparaison avant/après (T050).

- **Hors périmètre explicite** : les intervenants gérés comme `formateurs`
  (module formations courtes, features 016/019) ne sont pas couverts. Ils ne
  partagent pas l'identité `teachers` et relèveraient d'une 3ᵉ source d'heures —
  que l'abstraction retenue rendra ajoutable sans refonte.

# Module `academic`

Cœur académique unique des quatre packs (PRIMARY, SECONDARY, HIGHER, VIRTUAL) : années et périodes typées, programmes
et séries, curriculum polymorphe versionné, classes et offres, inscriptions qui historisent (financement, placements,
confirmation à deux niveaux), sélections de cours, registre des numéros d'inscription, reconduction annuelle. Schéma
Postgres `academic`, migrations `0700-0799`. Spec : `specs/v2/004-academic-core/` (extensions : spec §16).

Aucune constante réglementaire : niveaux, types de périodes, grammaire du curriculum, financements et issues sont des
**données** instanciées par `instantiatePackReferenceData` depuis `templates/<système>/<pack>.json`.

## Cumul de financements d'une inscription (O-04, migration 0710)

Décision du propriétaire : une inscription peut être financée par plusieurs sources à la fois (bourse + État + famille). `enrollments.funding_type` reste le type **principal** (lu tel quel par people, analytics, admissions, finance) ; la table `enrollment_fundings` porte les **parts** : pourcentage (points de base, 1 à 10 000) ou montant entier ; le reste est à la charge de la famille (« privé » n'est jamais une part).

* Contrôles imposés par la base : somme des parts en pourcentage vivantes ≤ 100 %, devise unique pour les montants, une part vivante par (type, financeur, référence), parts terminées immuables, jamais de `DELETE`.
* Cas d'usage : `setEnrollmentFundings` (remplacement atomique du cumul, historique `FUNDING`, événement `academic.enrollment.funding_changed` enrichi du champ additif `fundings`) ; `upsertEnrollmentFundingShare` (pose une part sans toucher aux autres — utilisé par `stateassign` à la vérification d'un dossier) ; `listEnrollmentFundings`. Principal : déduit de la plus grande part (ou conservé s'il est déjà non privé quand on ajoute une part). Cumul vide = famille seule.
* Routes : `GET|PUT /enrollments/:id/fundings` (permissions existantes `academic.enrollment.read` / `academic.enrollment.funding.update`). L'ancienne route `PATCH /enrollments/:id/funding` est inchangée.
* Audit sensible `academic.enrollment.fundings_changed` dès qu'un type exigeant une référence d'affectation est concerné.

## API publique

Seul `index.ts` est importable par les autres modules. Les cas d'usage sont des fonctions
`(deps, ctx, input) => Promise<Result<T, AppError>>` ; les ports (`application/ports.ts`) ont tous un **repli sûr**.

| Port | Implémenté par | Repli sans câblage |
|---|---|---|
| `StudentDirectory` | people | refus (`student_not_found`) |
| `PeriodClosureGuard` | assess, results | aucun refus |
| `CurriculumUsageGuard` | assess, results | « utilisé » (aucun amendement structurel) |
| `OfferingReadinessGuard` | people | aucun refus |
| `ClassroomActivationGuard` | people, primary_school | **aucun refus** |
| `CompletionLookup`, `ScheduleConflictChecker`, `TemplateProvider`, `InstitutionDirectory`, `RegistrationFeeProbe`, `InvoiceFactsReader`, `GuardianshipPort`, `PromotionDecisionPort` | voir `ports.ts` | voir `ports.ts` |

Branchement : `registerAcademicPorts(app, ports)` (API), `setAcademicWorkerPorts(ports)` (worker),
`createAcademicDeps({ ports })` (tests).

## Extensions pour les modules de packs (Phase 4-5)

| Besoin | Export | Notes |
|---|---|---|
| Garde d'activation d'une classe (005) | `ClassroomActivationGuard`, `activateClassroom`, `neverBlockActivation` | Appelé après les contrôles du cœur ; le refus porte **le code du garde** (409). |
| Annuler une inscription en attente (007) | `cancelEnrollment`, route `POST /enrollments/:id/cancel-pending` | Idempotent ; `academic.enrollment_not_pending` si l'inscription n'est pas `PENDING` (une confirmée se retire). Événement `academic.enrollment.cancelled`. |
| Faits d'éligibilité (018) | `getEligibilityFacts`, route `GET /enrollments/:id/eligibility-facts` | Niveau, cycle, `terminalExamRequired` (informatif), redoublements ; aucune donnée d'identité. |
| Redoublements du cycle (005) | `countRepeatsInCycle`, `countRepeatYears` | Entrée de la règle `cas_deja_redoublant`. |
| Inscription issue d'une admission (007) | `enrollStudent({ sourceKind: "ADMISSION", sourceRef })` | `academic.enrollment.confirmed` porte `enrollmentId` et `studentId`. |
| Financement affecté (006) | `changeEnrollmentFunding` | Permission `enrollment.funding.update`, audit sensible. |
| Changement de série en cours d'année (006) | `transferEnrollment` | Toute classe du même établissement et de la même année. |

## Modèles de pack

`templates/CI/{primary,secondary,higher,virtual}.json`, validés par `AcademicPackTemplateSchema` (strict) et chargés
par `defaultAcademicTemplates()`. Le test `test/unit/templates.test.ts` garantit la cohérence inter-packs : mêmes
définitions de types de nœud, de période, de financement, d'issue et de plan de périodes.

| Cycle | Contrat de calcul | Remarque |
|---|---|---|
| `PRESCHOOL` | `competency-period@1` | évaluation par compétences, sans moyenne |
| `PRIMARY` | `coef-period@1` | N périodes pondérées par les poids du plan de périodes |
| `LOWER_SECONDARY`, `UPPER_SECONDARY` | `secondary-annual@1` | nombre quelconque de périodes ; **`coef-semester@1` reste utilisable** (par programme ou par cycle) pour un établissement à deux périodes |
| `LICENCE`, `MASTER` / `BTS` | `credit-semester@1` / `coef-semester@1` | inchangé |

- `terminalExamRequired` : informatif (jamais décisionnel), `true` seulement pour `3E` et `TLE` (à confirmer, Q6-27) ; `CM2` reste faux (Q-P09).
- Plans `THREE_TERMS` (`TRIMESTER`) et `TWO_SEMESTERS` (`SEMESTER`) : `slots[].weight = 1` (neutre).
- **Provenance** : `sourceKind` ∈ `neutral` | `placeholder` | `regulation` (+ `sourceReference`, `sourceNote`) sur les cycles,
  niveaux et plans ; toute valeur non sourcée doit être marquée (test de cohérence). Aucun modèle livré n'est `regulation`.
- Séries, options, langues : **jamais livrées** (données du tenant : `createProgram`, sélections de cours).
- Sections d'autres modules : `tenancy.getPackTemplateSection(pack, educationSystem, section)` (clé facultative
  `sections` du modèle de pack, contenu opaque pour le noyau).

## Tests

```
node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/academic      # unitaires + intégration (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/academic
```

# Plan d'implémentation — 004-academic-core

**Entrées** : `spec.md`, `data-model.md` (DDL testé), `parity.md`, `open-questions.md`. **Phase du plan** : 2, tranches 2.0 (caractérisation), 2.1 (calendrier, programmes, curriculum, classes) et 2.2 (inscriptions). **Taille globale** : XL (≈ 40 j·agent, dont ≈ 60 % parallélisables). Module : `apps/api/src/modules/academic/` ; contrats : `packages/contracts/src/v2/academic.ts` ; migrations **0700-0704** (plage à inscrire dans `docs/architecture/module-conventions.md` : academic 0700-0799, people 0800-0899, attendance 0900-0999, scheduling 1000-1099).

## 1. Ordre global des quatre modules de cette lot (004, 008/009, 010, 017)

```
Vague 0  (préalables, 3 j)  Tranche 2.0 : tests de caractérisation du legacy (jeux déterministes)
                            Contrats Zod + gabarit de module + extension du schéma de modèle de pack (spec 003)
Vague 1  (parallèle)        004-T1..T6 calendrier/référentiels/curriculum   ║  008 persons/students (0800-0801)
                            017-T1..T3 salles, équipements, calendrier       ║  009 staff (0802)
Vague 2  (parallèle)        004-T7 classes/offres/inscriptions               ║  009 affectations (0803,0805)
                            008 projection d'inscriptions (consomme 004)     ║  017 patrons + génération
Vague 3                     010 appel/justificatifs (consomme roster, occurrences)  ║  017 occurrences, conflits
Vague 4  (intégration)      attendance.submitted → HELD ; payable_hours/lockHours (avec 032) ; finance (014) ; tenancy (003)
Vague 5                     Écrans web (033), rollover, suppression du legacy par tranche
```

Chemin critique : **0700-0703 → API publique `getRoster`/`listNodesForEnrollment` → 011 (notes)**. 004 doit livrer ses lectures dès la fin de la vague 2 pour ne pas bloquer 011/013.

## 2. Découpage en tâches (004)

Légende : **S** ≤ 2 j·agent, **M** 3-5, **L** 6-10. « // » = parallélisable avec les tâches de même vague.

| ID | Tâche | Livrables | Dépend de | Taille |
|---|---|---|---|---|
| 004-T0 | Caractérisation (tranche 2.0) : rejouer l'ancien code sur jeux déterministes et figer les sorties JSON | `characterization/academic/*.json` : éligibilité (ordre des codes), capacité (`complet↔ouvert`), prérequis (ET, validé), garde de clôture, porte d'entrée ; seed minimal par pack | — | M |
| 004-T1 | Migrations 0700-0704 | Fichiers SQL **identiques** à `data-model.md` ; test de conformité colonnes↔types de ligne (ADR-005) ; allowlist d'isolation vide ; test d'application de zéro | — | S |
| 004-T2 | Contrats Zod | `contracts/v2/academic.ts` : DTO de toutes les entrées/sorties, énumérations, payloads d'événements `{ v: 1 }`, `EnrollmentRefDto` conforme au port finance ; export par `v2/index.ts` | — | M // |
| 004-T3 | Domaine pur | `domain/` : machines d'états (année, période, classe, offre, inscription, sélection), éligibilité (ordre figé), plan de périodes, validation de curriculum (grammaire + rapport), générateur de numéro d'inscription, planificateur de reconduction, constructeur de `RuleContext`, résolution de prérequis | — | L // |
| 004-T4 | Repositories | `infrastructure/` : un repository par agrégat (calendrier, référentiels, programmes/matières, curriculum, classes/offres, inscriptions), requêtes qualifiées par schéma, mappers `bigint`/`numeric` → chaînes décimales, types de ligne `@table` | T1 | L // |
| 004-T5 | Use cases calendrier + référentiels + modèle de pack | `createAcademicYear`…, `applyPeriodPlan`, cycle des périodes (avec `PeriodClosureGuard`), clôture par classe, `instantiatePackReferenceData` idempotent, réglages d'établissement | T3, T4 | M |
| 004-T6 | Use cases curriculum | création/clonage (lignées conservées), édition d'arbre, prérequis, `validateCurriculum`, `publish`, `amendPublishedCurriculum` (réglage `academic.structural_change` + `CurriculumUsageGuard`), `lockCurriculumVersion`, lectures (`getCurriculumTree`, `listNodesForClassroom|Enrollment`, `getRuleContext`, `getNodePrerequisiteStatus`) | T3, T4 | L |
| 004-T7 | Use cases classes, offres, inscriptions | classes, `openOfferingsForPeriod`, éligibilité, réservations avec expiration, `enrollStudent`/bulk (idempotent par `externalRef`), confirmation selon politique, `transferEnrollment`, financement, sélections, issue, historique, `getRoster`, `selfEnrollToOffering`, registre des numéros d'inscription | T3, T4, port `StudentDirectory` | L |
| 004-T8 | Jobs et consommateurs d'événements | worker : `expirePendingHolds`, `finalizeEndedOfferings`, `rolloverAcademicYear` (par lots) ; consommateurs idempotents : `tenancy.*` (instanciation), `finance.invoice.paid`, `people.student.status_changed` | T5-T7, 000 (worker) | M |
| 004-T9 | HTTP, manifeste, permissions | `http/plugin.ts` (≈ 75 routes de `spec.md` §8), `manifest.ts` (permissions, features, menus, événements), gardes `requirePermission`/`requireFeature`, présentateurs DTO | T2, T5-T7 | M |
| 004-T10 | Modèles de pack | `tenancy/templates/academic/CI/{primary,secondary,higher,virtual}.json` + `AcademicPackTemplateSchema` + test de cohérence inter-packs (mêmes définitions de types de nœud) ; **aucun coefficient officiel inventé** | T2 | S // |
| 004-T11 | Adaptateurs et ports | `createEnrollmentDirectory` (test de conformité contre le port finance), ports par défaut sûrs (§spec 7.3), documentation de câblage | T7 | S |
| 004-T12 | Tests | unitaires (domaine), intégration (38 comportements SQL + concurrence 200/100 + rollover idempotent), contrat, golden de caractérisation (T0), performance, e2e API | toutes | L |
| 004-T13 | Écrans web | années/périodes, éditeur de curriculum, classes, offres (ouvrir un semestre), inscriptions, catalogue à la carte, reconduction, paramètres (voir spec 033) | T9 | L |
| 004-T14 | Suppression du legacy (par tranche) | tranche 2.1 : `cycles`, `filieres`, `programmes`, `classes`, `academic_years`, `academic_year_periods`, `courses`, `class_courses`, `professional_ue*`, `professional_ecue*`, `professional_semestre*` ; tranche 2.2 : `student_enrollments`, `professional_enrollments`, `professional_classe_noms` ; routes et services associés ; mise à jour de l'inventaire | T12 vert, 011/013 branchés sur la nouvelle API | M |

Parallélisme : T2, T3, T4, T10 démarrent ensemble (contrats figés par la spec §7) ; T5/T6/T7 sont indépendants entre eux une fois T3/T4 livrés (trois agents).

## 3. Jalons et critères de fin

| Jalon | Contenu | Critère |
|---|---|---|
| J1 | T1 + T2 + T3 + T4 | `pnpm --filter … test` vert ; isolation générique verte sur 25 tables ; 100 % des règles de grammaire testées |
| J2 | T5 + T6 + T10 | Un tenant provisionné par pack reçoit ses référentiels ; curriculum Primary et Higher publiés par le même code ; `getRuleContext` couvert |
| J3 | T7 + T11 | Inscription de bout en bout (classe et à la carte) ; concurrence 200/100 ; `EnrollmentDirectory` conforme |
| J4 | T8 + T9 | Jobs verts ; API complète derrière `requirePermission` ; événements publiés et consommés |
| J5 | T12 + T13 | Golden de caractérisation verts ; parcours e2e ; revue sécurité |
| J6 | T14 | Ancien code supprimé ; inventaire régénéré (`node scripts/inventory/run-all.mjs --check`) |

## 4. Interfaces à figer le jour 1 (pour ne pas bloquer 011, 013, 019, 014, 032)

1. `packages/contracts/src/v2/academic.ts` : DTO `EnrollmentView`, `EnrollmentNodeView`, `PeriodView`, `RuleContext`, événements.
2. Signatures de `index.ts` de la spec §7.2 (fonctions + ports) — un fichier `index.ts` avec **stubs typés** est publié dès J1 ; 011/013 compilent contre ces stubs.
3. Identifiants et codes d'erreur `academic.*`.
4. Jeux de données de démonstration : `seed/academic.demo.ts` (un tenant par pack) dont dépendent les e2e des autres specs.

## 5. Câblage (composition root, hors périmètre du module)

- `createAcademicDeps({ db, clock, audit, ports: { students, closureGuards, usageGuards, readinessGuards, completion, scheduleConflicts, templates } })` ; `academicPlugin` enregistré avec `requirePermission` (échec fermé sans garde : 403 `academic.permission_guard_missing`).
- `finance` : adaptateur `EnrollmentDirectory` = `createEnrollmentDirectory(deps)`.
- `people` : `createStudentDirectory` → `StudentDirectory` ; `createOfferingReadinessGuard` → `OfferingReadinessGuard`.
- Worker : jobs répétables `academic.expire-holds` (toutes les minutes), `academic.finalize-offerings` (quotidien, 01:00 locale), `academic.rollover` (à la demande).

## 6. Demandes de changement vers d'autres specs et documents

| Cible | Changement |
|---|---|
| `docs/architecture/module-conventions.md` | Inscrire les plages 0700-0799 (academic), 0800-0899 (people), 0900-0999 (attendance), 1000-1099 (scheduling) |
| 003-organization-campus / `tenancy` | `PackTemplateSchema` accepte des **sections par module** (`academic`, `people`, `attendance`, `scheduling`) ; fonction publique `getPackTemplateSection(pack, educationSystem, section)` ; modèles par système éducatif (`templates/<section>/CI/…`) ; événements `tenancy.tenant.provisioned` et `tenancy.institution.created` ; `levels`/`periods` actuellement « réservés » deviennent obsolètes |
| 014-finance | `EnrollmentRef` : `fundingType?`, `fundingReference?`, `registrationNumber?` ; `finance.invoice.paid` : `sourceRefs[]` et indicateur de frais d'inscription ; dimension « nœud (lignée) » d'un barème (prix d'une UE) |
| 002-auth-rbac | Permissions `enrollment.override`, `enrollment.self.create`, `academic.period.reopen`, `curriculum.amend`… marquées sensibles ; modèles de rôle (`student.class.read` pour l'enseignant) ; `iam` consomme `people.student.status_changed` |
| 011 / 013 / 019 | Implémenter `PeriodClosureGuard`, `CurriculumUsageGuard`, `CompletionLookup` ; appeler `recordEnrollmentOutcome`, `completeEnrollmentCourse` |
| 033-web-foundation | Menus générés ; route group `(admin)` ; client typé |
| 012-rules-engine | Les types de règle `credit_validation`, `compensation` consomment `RuleContext` (aucun traitement de nom) |

## 7. Risques

| Risque | Gravité | Mitigation |
|---|---|---|
| L'unification (D2) casse des comportements que seul le code legacy encode (règles implicites : éligibilité, porte d'entrée, clôture) | Haute | Tranche 2.0 d'abord ; golden tests ; `parity.md` §3 revu par le propriétaire ; 4 divergences assumées documentées |
| Grammaire de curriculum trop souple/rigide pour un pack futur | Moyenne | Grammaire en données + déclencheur testé ; types ajoutables sans migration ; test de cohérence inter-packs |
| Volume des arbres (3 000 nœuds) et CTE récursives | Moyenne | Index, limite de profondeur 16, test de performance, mise en cache applicative du `getCurriculumTree` invalidée par `academic.curriculum.*` |
| Verrous de capacité sous forte concurrence (ouverture des inscriptions) | Moyenne | Verrou de ligne court, test 200/100, file d'attente applicative si besoin (hors v1) |
| Dépendance à des textes réglementaires non fournis pour les modèles de pack | Haute (valeur) / Faible (technique) | Modèles sans coefficients officiels ; questions O-02/O-03 au propriétaire ; les packs sont des données ajustables sans déploiement |
| Dérive entre `data-model.md` et migrations réelles | Moyenne | Les migrations sont **copiées** du document ; test de conformité colonnes↔types ; revue qui compare les checksums |
| Câblage des ports oublié (garde silencieusement absent) | Moyenne | Comportements de repli **sûrs** documentés ; test d'architecture qui échoue si un port requis n'est pas câblé en `production` |
| Reconduction annuelle incorrecte (volumétrie, financements) | Moyenne | `previewRollover` obligatoire avant `rollover`, idempotence testée, rapport d'anomalies |

## 8. Garde-fous CI spécifiques

Lint : aucun littéral de période/niveau/seuil dans `modules/academic/**` ; pas de SQL hors `infrastructure/` ; pas de `new Date()` ; `dependency-cruiser` : seuls `rbac`/`tenancy` sont importables (via `index.ts`), jamais `people`/`finance`/`scheduling` (ports). Tests : isolation générique, contrat `EnrollmentDirectory`, schémas d'événements, couverture domaine ≥ 90 %.

## 9. Définition de terminé (module)

Les critères de sortie de `spec.md` §15 sont tous verts en CI ; `parity.md` n'a plus aucune ligne « à reproduire » non couverte ; l'inventaire d'impact (tranches 2.1 et 2.2) est régénéré sans référence aux tables supprimées ; la documentation de câblage et les demandes de changement du §6 sont traitées ou tracées.

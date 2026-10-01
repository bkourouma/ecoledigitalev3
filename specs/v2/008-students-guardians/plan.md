# Plan d'implémentation — 008-students-guardians

**Entrées** : `spec.md`, `data-model.md`, `parity.md`, `specs/v2/004-academic-core/open-questions.md`. **Phase du plan** : 2, tranche 2.2. **Taille globale** : L (≈ 22 j·agent). Module partagé avec 009 : `apps/api/src/modules/people/` ; contrats : `packages/contracts/src/v2/people.ts` ; migrations **0800, 0801, 0804** (plage 0800-0899). L'ordre global des quatre modules est décrit dans `specs/v2/004-academic-core/plan.md` §1.

> Le manifeste `people` est créé par **008-T0** et complété par 009 (permissions `staff.*`, `teaching.*`). 008 et 009 se partagent `persons`, `settings`, `number_sequences`, `forbid_mutation` : les migrations 0800 et 0804 sont des **prérequis** de 009.

## 1. Tâches

| ID | Tâche | Livrables | Dépend de | Taille |
|---|---|---|---|---|
| 008-T0 | Squelette du module `people` | arborescence `modules/people/` générée par le script de la spec 000, `manifest.ts` (clé, packs `CORE`, `dependsOn: ["rbac"]`, permissions/menus 008), `index.ts` avec stubs typés, `vitest.config.ts` | 000 | S |
| 008-T1 | Migrations 0800, 0801, 0804 | SQL identique à `data-model.md` ; test de conformité colonnes↔types ; isolation générique verte | T0 | S |
| 008-T2 | Contrats Zod | `contracts/v2/people.ts` (étudiant, tuteur, lien, contacts d'urgence, historique scolaire, projection, événements `{ v: 1 }`, `LearnerRefDto`, `StudentSummary`) | — | M // |
| 008-T3 | Domaine pur | machine d'états du statut ; motif de numéro (jetons `{SEQ:n}`, `{YYYY}`, `{YY}`, `{PREFIX}`) ; normalisation de noms/téléphones (E.164) ; détection de doublons (score, permutations) ; règles de liens (principal unique, drapeaux) ; `isGuardianOfStudentRule` | — | M // |
| 008-T4 | Repositories | `persons`, `students`, `guardians`, liens, contacts, historique scolaire, projection ; recherche trigramme ; types de ligne `@table` | T1 | M // |
| 008-T5 | Use cases dossier | `createStudent` (atomique, idempotent par `externalRef`, `validateOnly`, `acknowledgeDuplicate`), `updateStudent`, `changeStudentStatus` (motif, historique, événement), `findDuplicateStudents`, `searchStudents`, `listStudents`, `getStudent(sByIds)`, historique scolaire, contacts d'urgence, `exportStudents`, `anonymizeStudent` | T3, T4 | L |
| 008-T6 | Use cases tuteurs et portail | `createGuardian`, `linkGuardian` / `updateGuardianLink` / `unlinkGuardian` (clôture), `listGuardiansOfStudent`, `listChildrenOfIdentity`, `isGuardianOfStudent`, `resolveStudentForIdentity`, `updateMyContact`, `provisionPortalAccount` (port `AccountProvisioner`) | T3, T4 | M |
| 008-T7 | Projection d'inscriptions | consommateur idempotent `academic.enrollment.*` → `student_enrollment_summaries` ; `rebuildEnrollmentProjection` (job, port `AcademicQuery`) ; `first_enrolled_on`/`left_on` | T4, 004 (événements) | M |
| 008-T8 | Annuaires | `createLearnerDirectory` (conforme au port finance), `createStudentDirectory` (conforme au port academic), `getStudentsByIds` ; tests de contrat | T5 | S |
| 008-T9 | Photos et pièces | `uploadStudentPhoto` via `StoragePort`, contrôle des octets magiques, URL signées, taille configurable | `StoragePort` | S |
| 008-T10 | HTTP + permissions | plugin `/api/v1/people/students|guardians|persons|me|children|reference|settings` ; `requirePermission` ; matrice de sécurité parent/élève ; alias PRD §60 | T5-T8 | M |
| 008-T11 | Modèle de pack `people` + paramètres | JSON (`relationshipTypes`, `staffCategories`, `contractTypes`, `settings`) + schéma Zod `PeoplePackTemplateSchema` ; `instantiate` idempotent | 004-T10 (schéma de section) | S // |
| 008-T12 | Tests | unitaires, intégration (17 comportements SQL, atomicité, 50 créations concurrentes), sécurité (matrice, aucune PII dans les listes/journaux), contrat, charge (recherche 20 000), e2e | toutes | L |
| 008-T13 | Écrans web | liste, dossier, création en assistant, tuteurs, « mes enfants », « mon dossier » | T10 | L |
| 008-T14 | Suppression du legacy (tranche 2.2) | `student_profiles`, `student_parents`, `emergency_contacts`, `student_status_history`, `professional_student_matricules`, `registration_requests` (côté élève), routes `students.ts`, `parents.ts`, `enrollments.ts` (côté élève), `registration-requests.ts` (reporté à 007) | T12 vert, 004 branché | M |

## 2. Jalons

| Jalon | Contenu | Critère |
|---|---|---|
| J1 | T0-T4 | Migrations + domaine + repositories verts ; isolation générique |
| J2 | T5-T8 | `createStudent`/tuteurs/projection/annuaires verts ; tests de contrat finance/academic |
| J3 | T9-T11 | HTTP complet, matrice de sécurité à 100 %, modèle de pack appliqué |
| J4 | T12-T13 | E2E « secrétariat → parent » ; recherche sous 200 ms |
| J5 | T14 | Legacy supprimé |

## 3. Interfaces à figer le jour 1

`people/index.ts` (stubs typés de la spec §7), `packages/contracts/src/v2/people.ts`, les codes d'erreur `people.*`, le motif de numéro et l'API `next_number`. 004, 007, 010, 011, 013, 014 et 016 compilent contre ces stubs.

## 4. Câblage

`createPeopleDeps({ db, clock, audit, ports: { accounts: AccountProvisioner(iam), storage, academicQuery, numberFormat } })` ; `peoplePlugin` ; adaptateurs `createLearnerDirectory` (finance) et `createStudentDirectory` (academic) ; worker : consommateurs `academic.enrollment.*`, `iam.membership.*`.

## 5. Demandes de changement vers d'autres specs

| Cible | Changement |
|---|---|
| 002 / `iam` | Port `AccountProvisioner.invite` (invitation à définir son mot de passe, jeton à usage unique, pas de mot de passe en clair) ; consommer `people.student.status_changed` pour suspendre l'accès ; permission `student.class.read` dans le rôle `enseignant` à la place de `student.read`/`student.list` |
| 004 | Événements `academic.enrollment.*` portant `studentId`, `classroomId`, `status`, `fundingType`, `registrationNumber` ; fonction `listEnrollmentsByStudent` pour la reconstruction |
| 007-admissions | Appelle `createStudent` puis `enrollStudent` à `ENROLLED` ; les demandes d'inscription publiques (`registration_requests`) y migrent |
| 024-documents | Remplacer `attachment_object_key`/`photo_object_key` par des `document_ref` |
| 031-imports | Utiliser `createStudent` (`validateOnly`, `externalRef`) pour l'import d'élèves et de tuteurs |
| 014-finance | Lire `listGuardiansOfStudent` pour le répondant financier ; `LearnerDirectory` branché |

## 6. Risques

| Risque | Gravité | Mitigation |
|---|---|---|
| Fuites de données personnelles (PII) dans listes, journaux, événements | Haute | Types de sortie sans champs sensibles par construction ; test automatisé sur tous les endpoints ; revue de sécurité ; audit des lectures sensibles |
| Contrôle « enfant » oublié dans un autre module | Haute | `isGuardianOfStudent` unique ; test d'architecture : tout endpoint déclarant `*.child.*` l'appelle ; matrice partagée de tests |
| Collisions de numérotation sous concurrence | Moyenne | `next_number` gapless, 50 créations concurrentes testées, motif validé à la configuration |
| Doublons de personnes (famille, jumeaux) | Moyenne | Avertissement humain avec motif ; pas de fusion en v1 (question O-07) |
| Projection en retard ou incohérente | Moyenne | Idempotence, `rebuild`, supervision du retard (alerte > 60 s), chemin de repli par `AcademicQuery` |
| Dérive du manifeste partagé avec 009 | Faible | Un seul propriétaire par vague (008 crée, 009 étend) ; test de manifeste valide |

## 7. Garde-fous CI spécifiques

Lint : aucun SQL hors `infrastructure/`, aucun `new Date()`, aucune valeur par défaut de sexe ; test d'architecture « aucune réponse de liste ne contient `birth_certificate`, `national_student_id`, `attributes` » ; test que `GET` n'écrit jamais (instrumentation `updated_at`) ; scan de secrets (aucun mot de passe en clair).

## 8. Définition de terminé

Critères `spec.md` §15 verts ; parité `parity.md` sans ligne à reproduire non couverte ; seeds de démonstration créés par les cas d'usage ; documentation du port `AccountProvisioner` publiée avec 002.

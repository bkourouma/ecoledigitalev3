# Plan d'implémentation — 009-teachers-staff

**Entrées** : `spec.md`, `data-model.md`, `parity.md`, `specs/v2/004-academic-core/open-questions.md`. **Phase du plan** : 2, tranche 2.2 (affectations, personnel) puis 2.7 (la paie lit les nouveaux modèles). **Taille globale** : M-L (≈ 16 j·agent). Module partagé avec 008 : `apps/api/src/modules/people/` ; migrations **0802, 0803, 0805** (prérequis : 0800 et 0804 de 008). Ordre global : `specs/v2/004-academic-core/plan.md` §1.

## 1. Tâches

| ID | Tâche | Livrables | Dépend de | Taille |
|---|---|---|---|---|
| 009-T1 | Migrations 0802, 0803, 0805 | SQL identique à `data-model.md` ; conformité colonnes↔types ; isolation ; test d'application après 0800/0804 | 008-T1 | S |
| 009-T2 | Contrats Zod | `contracts/v2/people.ts` (staff, contrats, qualifications, compétences, disponibilités, affectations, charge, événements) | 008-T2 | M // |
| 009-T3 | Domaine pur | machine d'états du personnel ; règles de rôle d'affectation (LEAD/CO_TEACHER/HOMEROOM/SUBSTITUTE/SUPERVISOR, généraliste) ; résolveur `getResponsibleForNode` ; charge ; sélection des qualifications expirantes ; fusion des disponibilités | — | M // |
| 009-T4 | Repositories | personnel, affiliations, contrats, qualifications, compétences, disponibilités, affectations (+ historique) ; types de ligne | T1 | M // |
| 009-T5 | Use cases personnel | `createStaff` (atomique, doublons, numéro gapless), `updateStaff`, `changeStaffStatus` (clôt les affectations à `LEFT`), affiliations, contrats, qualifications, compétences, disponibilités, `provisionStaffAccount`, `getStaffByIds`, `resolveStaffForIdentity` | T3, T4 | M |
| 009-T6 | Use cases affectations | `createTeachingAssignment` (vérifie via `AcademicQuery` : classe, nœud du curriculum, **non transversal**, période de l'année), `endTeachingAssignment`, `replaceTeachingAssignment` (atomique), `listAssignmentsFor…`, `isStaffAssignedToClassroom`, `getTeachingLoad`, `listUnstaffedNodes`, `createOfferingReadinessGuard` | T3, T4, port `AcademicQuery` | M |
| 009-T7 | Job d'alerte des qualifications | `emitExpiringQualifications` (une alerte par franchissement de seuil, idempotente) ; réglage `expiry_alert_days` | T5 | S |
| 009-T8 | Consommateurs | `academic.classroom.cancelled|completed`, `academic.year.closed` (terminer les affectations), `iam.membership.*` | T6 | S |
| 009-T9 | HTTP + permissions | routes `/staff`, `/teaching-assignments`, `/me/staff|classes|assignments`, référentiels ; manifeste complété (`staff.*`, `teaching.*`, `staff.own.*`) ; gardes | T5, T6 | M |
| 009-T10 | Modèle de pack | `staffCategories` / `contractTypes` / réglages (partagé avec 008-T11) | 008-T11 | S // |
| 009-T11 | Tests | unitaires, intégration (LEAD unique, catégorie sans droit d'enseigner, contrats sans chevauchement, `LEFT` clôt les affectations, remplacement atomique), contrat (garde d'offre contre academic ; disponibilités contre scheduling), sécurité (auto-modification interdite), charge, e2e | toutes | M |
| 009-T12 | Écrans web | liste/fiche du personnel, matrice d'affectations (classe × matière × période), remplacement, « mes classes », disponibilités, paramètres | T9 | M |
| 009-T13 | Branchement de la paie et suppression du legacy | 032 lit `people.getStaffByIds`, `listContracts` ; suppression de `teachers`, `teacher_assignments(_audit)`, `professional_session_ecue_teachers`, `course_assignments`, `teaching_hours`, routes associées (tranche 2.2) ; collecteurs d'heures supprimés en tranche 2.7 | T11 vert, 017 + 032 | M |

## 2. Jalons

| Jalon | Contenu | Critère |
|---|---|---|
| J1 | T1-T4 | Migrations/domaine/repositories verts |
| J2 | T5-T7 | Personnel, affectations, job d'alerte ; garde d'offre testée contre un simulacre d'academic |
| J3 | T8-T10 | API complète ; modèle de pack ; consommateurs |
| J4 | T11-T12 | E2E « directeur affecte, remplace, enseignant voit ses classes » |
| J5 | T13 | Legacy supprimé ; paie sur la nouvelle donnée |

## 3. Interfaces à figer le jour 1

Fonctions de la spec §7 (stubs typés), DTO `StaffView`, `AssignmentView`, `AvailabilityView`, codes `people.*`, port `AcademicQuery` minimal (`getClassroom`, `getCurriculumNode`, `getAcademicPeriod`, `listNodesForClassroom`) que 004 s'engage à publier avant la vague 2.

## 4. Câblage

Même `createPeopleDeps` que 008 ; `createOfferingReadinessGuard` branché dans `createAcademicDeps` ; worker : job quotidien `people.expiring-qualifications` ; `people.staff.status_changed` consommé par `iam` (révocation des accès) et `scheduling`.

## 5. Demandes de changement vers d'autres specs

| Cible | Changement |
|---|---|
| 004 | Publier `AcademicQuery` ; `OfferingReadinessGuard` branché ; `isTransversal` dans `getCurriculumNode` |
| 017 | Lire `listAvailabilities`, `listCompetencies`, `isStaffAssignedToClassroom`, `getStaffByIds` ; vérifier le statut du personnel à l'ajout d'un intervenant |
| 032 | Rattacher les configurations de paie à `staff_id` ; lire `listContracts` ; ne plus lire `teachers` ; décider de l'éligibilité d'un membre `SUSPENDED`/`LEFT` (sans exclusion silencieuse) |
| 011 / 010 | Utiliser `isStaffAssignedToClassroom` pour limiter la saisie de notes et l'appel |
| 002 | Permissions `staff.contract.manage` et `staff.status.update` sensibles ; `staff.own.update` ; suppression de tout mot de passe technique |
| 024 | `document_ref` pour contrats et qualifications |

## 6. Risques

| Risque | Gravité | Mitigation |
|---|---|---|
| Confusion affectation ↔ bénéficiaire de la paie | Haute | Documenté dans les deux specs ; 032 ne lit jamais `teaching_assignments` ; test de contrat « la paie ignore les affectations » |
| Migration conceptuelle `class_courses` (classe × cours) → (classe × nœud) incomplète | Moyenne | Pas de reprise de données (D8) ; création d'affectations par import (031) à partir des nœuds de l'année |
| Une catégorie `can_teach` retirée alors que des affectations existent | Faible | Interdit par le cas d'usage (message explicite) |
| Doublons de personnes (enseignant = parent) | Moyenne | Personne unique, avertissement de doublon, cloisonnement des listes |
| Dépendance cyclique people ↔ academic | Moyenne | Ports injectés, jamais de `dependsOn` mutuel ; test `dependency-cruiser` |
| Données RH sensibles | Haute | Permissions séparées (`staff.contract.read/manage`), audit, aucune donnée RH dans les événements |

## 7. Garde-fous CI spécifiques

Pas de SQL hors `infrastructure/` ; test d'architecture : aucun endpoint de contrat sans permission sensible ; test qu'un enseignant ne peut modifier ni statut ni contrat (`403`) ; `X-User-Id` ignoré (test) ; scan de secrets (plus de mot de passe de test en dur).

## 8. Définition de terminé

Critères `spec.md` §15 verts ; `parity.md` sans ligne à reproduire non couverte ; paie (032) lisant les nouvelles sources ; legacy supprimé.

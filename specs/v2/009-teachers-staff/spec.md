# Feature Specification: Enseignants et personnel (009-teachers-staff)

**Feature Branch**: `009-teachers-staff`

**Created**: 2026-10-01

**Status**: Rédigée — prête pour `/speckit.plan`. Module backend `people` (schéma `people`), partagé avec la spec 008. DDL : `data-model.md` (migrations 0802, 0803, 0805 ; 0800, 0801, 0804 sont décrites en 008).

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §7.7-7.8, §33, §37, §40, §43, §50 ; plan §3.6, §4 (tranches 2.2, 2.7) ; ADR-001, 002, 004, 006, 007, 008 ; `docs/architecture/module-conventions.md` ; `rbac/templates/system-roles.ts` (`staff.*`, `teaching.*`, `*.own.*`) ; `docs/workflow-paie-enseignants.md`, `docs/module-remuneration-portage-nouvelle-stack.md` ; legacy : `teachers`, `teacher_assignments`, `professional_session_ecue_teachers`, `teaching_hours`, routes `teachers.ts`, `teacher-assignments.ts`, `teaching-hours*.ts`, `professional-teacher.service.ts` (inventaire : `parity.md`).

> Cette spec fournit le **personnel** (identifiant stable `people.staff.id`) et les **affectations d'enseignement** (qui est responsable de quoi). Elle ne calcule aucune rémunération et ne désigne **pas** le bénéficiaire de la paie : celui-ci est l'intervenant réel d'une séance (`scheduling.occurrence_staff`, spec 017). Le legacy confondait les deux (cause d'incohérences : séance affichée avec un enseignant mais impayable).

## 1. Objectifs

1. **Une seule entité `staff`** pour enseignants, éducateurs, administratifs, direction et personnel d'appui (le legacy n'avait que `teachers`, rien pour le non-enseignant), fondée sur la même `persons` que les élèves et tuteurs.
2. **Affectations d'enseignement** unifiées : titulaire de classe (instituteur du primaire, professeur principal), responsable d'une matière/ECUE dans une classe et une période, co-enseignants, remplaçants de longue durée, surveillants — en remplacement de `teacher_assignments`, `professional_session_ecue_teachers` et des quatre colonnes « enseignant » concurrentes.
3. **RH utile** (PRD §40) : contrats datés, qualifications avec expiration et alertes, compétences d'enseignement, disponibilités hebdomadaires, charge horaire, documents (références vers la GED 024), historique de statut.
4. **Données pour les consommateurs** : planification (disponibilités, compétences, charge), paie 032 (personnel, catégories, types de contrat), évaluations 011 (qui peut noter quoi), présences 010 (qui peut faire l'appel), annuaire `OfferingReadinessGuard` pour academic.
5. **Sécurité et traçabilité** : plus de suppression physique en cascade, plus d'identité par en-tête client, plus de mot de passe par défaut ni de validateur codé en dur.

## 2. Périmètre

### Inclus

- `staff`, catégories (`staff_categories`), types de contrat, affiliations (établissements/campus), contrats, qualifications, compétences, disponibilités, historique de statut.
- Affectations d'enseignement et leur historique ; remplacement ; fin d'affectation ; charge d'enseignement.
- Garde d'ouverture d'offre (« chaque nœud obligatoire non transversal a un responsable ») fournie à academic.
- Portail enseignant : mon profil, mes classes, mes affectations (lecture).
- Job d'alerte des qualifications qui expirent ; événements.
- Comptes de personnel : invitation via `iam` (même port `AccountProvisioner` que 008).
- API `/api/v1/people/staff|teaching-assignments|…`, écrans, permissions, événements.

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Taux horaires, configurations de paie, bulletins de paie, heures supplémentaires, collecteurs d'heures | 032 (paie) ; legacy 031-remuneration-professionnelle |
| Séances, intervenant réel, remplacement ponctuel, heures payables, validation | 017 |
| Présence/absence du personnel, congés | 010 |
| Notes, évaluations d'un enseignant | 011 |
| Documents RH (contrats signés, diplômes) | 024 (références `document_ref`) |
| Recrutement, évaluation de performance, formation continue | hors plan |
| Authentification, rôles, permissions | 002 / `iam` / `rbac` |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Directeur / directeur des études | Affecte les enseignants, gère le personnel |
| Responsable pédagogique | Propose/valide les affectations d'une filière, consulte la charge |
| Secrétariat / RH | Crée les fiches, contrats, qualifications |
| Enseignant / personnel | Consulte ses affectations, déclare ses disponibilités, consulte ses propres contrats (`staff.own.read`) |
| Économe / paie | Lit le personnel, les catégories, les types de contrat (032) |
| Modules consommateurs | 004 (garde d'offre), 010, 011, 017, 025, 032 |

## 4. User Stories et critères d'acceptation

### US1 — Fiche du personnel (P1)

- **AC1.1** `createStaff` crée atomiquement la personne (ou réutilise une `persons` existante, par exemple un tuteur), la fiche, le numéro gapless (`staff_number`, motif du tenant), la ligne d'historique, l'affiliation principale et l'événement `people.staff.created`. 30 créations concurrentes = numéros contigus sans doublon.
- **AC1.2** La catégorie (`staff_categories`) est une donnée : `can_teach` et `can_supervise` pilotent les droits d'affectation ; un membre `ADMIN` ne peut recevoir aucune affectation d'enseignement (refus par déclencheur, `people.assignment_category_forbidden`).
- **AC1.3** Statuts `ACTIVE`, `ON_LEAVE`, `SUSPENDED`, `LEFT` ; passer à `LEFT` exige `left_on` et un motif, **clôt** les affectations actives dans la même transaction (`ended` + événements) et publie `people.staff.status_changed` ; un membre `LEFT` ne reçoit plus d'affectation.
- **AC1.4** Aucune suppression physique : `DELETE /staff/:id` n'existe pas ; le déclencheur refuse toute suppression (le legacy `DELETE /teachers/:id` effaçait en cascade évaluations, affectations, bulletins et tarifs).
- **AC1.6** La création détecte les **doublons** (e-mail identique, ou nom normalisé + date de naissance, ou téléphone) parmi les personnes du tenant, élèves et tuteurs compris, et renvoie `409 people.possible_duplicate` avec les candidats sauf `acknowledgeDuplicate` + motif (le legacy refusait un e-mail d'enseignant déjà pris, sans autre contrôle). Le statut `ON_LEAVE` n'est **jamais** posé automatiquement par un congé (décision explicite, pour les congés de longue durée) ; l'approbation d'un congé (010) ne fait que publier l'événement.
- **AC1.5** Un membre du personnel qui est aussi tuteur d'un élève n'a qu'**une** personne ; `listStaff` n'expose pas la qualité de tuteur (cloisonnement), mais l'UI d'inscription propose `STAFF_CHILD` (suggestion).

### US2 — Affectations d'enseignement (P1)

En tant que directeur des études, je veux savoir qui est responsable de chaque matière de chaque classe.

- **AC2.1** `createTeachingAssignment` crée une affectation (staff, classe, année, nœud, période optionnelle, rôle, dates) après vérification via academic que la classe et le nœud existent, que le nœud appartient au curriculum de la classe, que le nœud n'est **pas transversal** (la conduite n'a jamais d'enseignant) et que la période appartient à l'année.
- **AC2.2** Au plus **un `LEAD` actif** par (classe, nœud, période) — règle « un enseignant par (cohorte, ECUE) » du legacy, imposée par index unique — les `CO_TEACHER` sont libres ; au plus un `HOMEROOM` actif par classe ; pas de doublon strict (même personne, même objet, même rôle).
- **AC2.3** `covers_all_subjects` (instituteur généraliste du primaire) rend l'affectation valable pour tous les nœuds **non transversaux** de la classe ; le résolveur `getResponsibleForNode(classroom, node, period)` applique : `LEAD` explicite > généraliste > titulaire (`HOMEROOM`) ; pour un nœud transversal il renvoie « aucun responsable » (la conduite n'a jamais d'enseignant). Un `LEAD` s'applique à une **classe** et un nœud : la « cohorte » du legacy (classe × UE) est exactement ce couple, donc un seul `LEAD` par cohorte.
- **AC2.3b** `listUnstaffedNodes(ctx, {yearId, classroomId?, programId?})` liste les nœuds obligatoires non transversaux sans responsable (rapport « matières sans enseignant » du tableau de bord propriétaire, T-132/T-133 du legacy) — donnée brute, sans seuil.
- **AC2.4** `replaceTeachingAssignment(assignmentId, newStaffId, effectiveOn, reason)` termine l'ancienne affectation et crée la nouvelle dans **une** transaction, journalise `teaching_assignment_history` (`REPLACED`) et publie `people.teaching_assignment.replaced` ; les séances **passées** gardent leurs intervenants réels (spec 017) ; les séances futures sont signalées `replacement_needed` à scheduling.
- **AC2.5** `createOfferingReadinessGuard` renvoie, pour une offre, la liste des nœuds obligatoires non transversaux sans `LEAD` actif (`missing[]`) ; academic refuse l'ouverture tant que la liste n'est pas vide (parité : `SESSION_ECUE_TEACHERS_MISSING`).
- **AC2.6** Un chevauchement de dates entre deux affectations `LEAD` du même objet est impossible ; deux affectations du même enseignant sur des classes simultanées sont **permises** (la détection de conflit d'horaire relève de scheduling, pas des affectations — le legacy autorisait les chevauchements sans contrainte).
- **AC2.7** Les affectations sont historisées (création, mise à jour, fin, remplacement) avec auteur et motif ; une affectation terminée ne se réactive pas (on en crée une nouvelle).

### US3 — Contrats, qualifications, compétences, disponibilités (P1)

- **AC3.1** `addContract` : type de contrat (donnée), dates, volume horaire contractuel (par semaine ou par an), statut ; deux contrats actifs du **même type** ne se chevauchent pas (contrainte d'exclusion) ; la consultation exige `staff.contract.read` ; la modification est sensible (`staff.contract.manage`, MFA, audit).
- **AC3.2** `addQualification` (diplôme, certification, habilitation, autre) avec `expires_on` optionnel et référence documentaire ; le job quotidien `emitExpiringQualifications` publie `people.staff_qualification.expiring` **une fois par franchissement de seuil** (idempotent), le seuil étant `settings.expiry_alert_days` (donnée de pack, modifiable) — aucune durée en dur.
- **AC3.3** `setCompetencies` déclare les matières (catalogue academic) et niveaux enseignables ; l'affectation d'un enseignant sans compétence correspondante produit un **avertissement** (non bloquant) dans la réponse.
- **AC3.4** `setAvailabilities` enregistre des créneaux `AVAILABLE`/`UNAVAILABLE` par jour ISO (1-7), heures, campus et validité ; `UNAVAILABLE` l'emporte ; `listAvailabilities(staffIds, from, to)` est la source des contraintes de scheduling (mode d'établissement `OPEN`/`CLOSED`).
- **AC3.5** Un enseignant gère ses propres disponibilités (`staff.availability.manage` avec règle « propres données ») ; la modification d'un créneau déjà couvert par une séance planifiée produit un avertissement vers scheduling (`conflict` informatif).

### US4 — Charge d'enseignement (P2)

- **AC4.1** `getTeachingLoad(staffId, yearId)` renvoie le **prévu** et le **contractuel** : heures affectées (Σ `planned_hours` des affectations actives, par période et par classe) et volume contractuel converti à l'année (selon `committed_hours_unit`) ; aucun seuil, aucune alerte. Les heures **planifiées / réalisées** viennent de `scheduling.getStaffWeeklyLoad` (017) : people ne dépend pas de scheduling (qui lit déjà people), le rapprochement des trois chiffres est fait par l'UI et par 025 (PRD §43 « charge > seuil » = configuration côté 025).
- **AC4.2** La liste des enseignants peut se trier par charge ; p95 < 300 ms pour 300 enseignants.

### US5 — Portail enseignant et comptes (P1)

- **AC5.1** `GET /me/staff` renvoie la fiche de l'identité courante ; `GET /me/classes` renvoie les classes **à affectation active à la date du jour** (le legacy laissait visibles classes et élèves après la fin de l'affectation) ; aucune confiance dans `X-User-Id`.
- **AC5.2** `provisionStaffAccount` crée/lie l'identité `iam` et envoie une invitation (jeton) ; aucun mot de passe par défaut, aucun compte technique `testpassword123`, aucun validateur codé en dur.
- **AC5.3** Un enseignant ne peut **modifier ni son statut, ni ses contrats, ni sa rémunération** (le legacy l'autorisait via `PATCH /teacher/courses/:id` et `PUT /teachers/:id`) ; il lit ses propres contrats (`staff.own.read`).

### US6 — Annuaires pour les consommateurs (P1)

- **AC6.1** `getStaffByIds(ctx, ids≤500)` renvoie `{staffId, displayName, categoryCode, status, staffNumber, email, phone}` pour scheduling, attendance, paie et évaluations.
- **AC6.2** `listAssignmentsForClassroom(ctx, classroomId, {onDate})` et `listAssignmentsForStaff(ctx, staffId, {yearId, onDate})` servent 011 (qui peut saisir les notes d'une classe) et 010 (qui peut faire l'appel) ; la règle d'autorisation « cet enseignant est bien affecté à cette classe » est une règle de domaine de ce module (`isStaffAssignedToClassroom`).
- **AC6.3** `resolveStaffForIdentity(ctx, identityId)` → `staffId | null`.

## 5. Règles métier

- R1 Un membre du personnel = une personne + une catégorie ; pas de rôle déduit de l'existence de lignes (le legacy inférait `teacher` si une ligne existait) : les rôles se donnent par `rbac`.
- R2 `staff_number` : gapless, immuable, motif du tenant ; pas de réutilisation.
- R3 Les affectations visent des **objets academic par UUID** ; l'intégrité est vérifiée par l'API publique d'academic, pas par FK (ADR-006).
- R4 Une affectation n'est jamais l'autorisation de paie. La rémunération d'une heure suit l'occurrence (017).
- R5 La « conduite » (nœud transversal) n'a ni offre ni affectation.
- R6 Le titulaire (`HOMEROOM`) est unique par classe ; le généraliste (`covers_all_subjects`) n'a pas de nœud.
- R7 Un `SUBSTITUTE` d'affectation est un remplacement de **longue durée** (congé maternité) avec dates ; il désigne obligatoirement l'affectation remplacée (`replaces_assignment_id`, contrainte) et coexiste avec elle ; le remplacement d'**une séance** est dans 017 (`occurrence_staff`, rôle `SUBSTITUTE` avec `replaces_staff_id`) — deux notions distinctes, l'une administrative, l'autre opérationnelle.
- R8 Les disponibilités sont des préférences/contraintes de planification, pas des permissions.
- R9 Les contrats ne portent ni tarif ni salaire (032).
- R10 Un membre `LEFT` : affectations terminées, accès portail à révoquer (événement consommé par `iam`), aucune donnée supprimée.
- R11 Le périmètre de lecture suit les affiliations (établissement/campus) du contexte, en plus de la RLS tenant.
- R12 Toute opération sensible (contrat, statut `LEFT`/`SUSPENDED`, remplacement) écrit l'audit dans la même transaction.

## 6. Modèle de données

Voir `data-model.md` : `staff_categories`, `contract_types`, `staff`, `staff_affiliations`, `staff_contracts`, `staff_qualifications`, `staff_competencies`, `staff_availabilities`, `staff_status_history`, `teaching_assignments`, `teaching_assignment_history` (+ `persons`, `number_sequences` partagées avec 008, `settings`). Migrations **0802** (personnel), **0803** (affectations), **0805** (invariants) ; prérequis : 0800 et 0804 (spec 008).

## 7. Interfaces publiées (`people/index.ts`)

| Fonction | Usage |
|---|---|
| `getStaff(ctx, staffId)` · `getStaffByIds(ctx, ids)` · `listStaff(ctx, filters)` · `resolveStaffForIdentity(ctx, identityId)` | tous (010, 011, 017, 032) |
| `createStaff` · `updateStaff` · `changeStaffStatus` · `setAffiliations` | UI |
| `addContract` · `updateContract` · `endContract` · `listContracts` | UI, 032 (lecture) |
| `addQualification` · `updateQualification` · `removeQualification` · `listExpiringQualifications(ctx, {asOf, withinDays})` · `emitExpiringQualifications` (job) | UI, 025 |
| `setCompetencies` · `listCompetencies` | UI, 017 |
| `setAvailabilities` · `listAvailabilities(ctx, {staffIds, from, to})` | UI, **017** |
| `createTeachingAssignment` · `endTeachingAssignment` · `replaceTeachingAssignment` · `listAssignmentsForClassroom` · `listAssignmentsForStaff` · `getResponsibleForNode(ctx, {classroomId, nodeId, periodId?, onDate?})` · `isStaffAssignedToClassroom(ctx, {staffId, classroomId, nodeId?, onDate?})` | 004, 010, 011, 013, 017 |
| `getTeachingLoad(ctx, staffId, yearId)` (prévu + contractuel ; le réalisé vient de 017) · `listUnstaffedNodes(ctx, filters)` · `listContracts` · `listCompetencies` | UI, 025 |
| `createOfferingReadinessGuard(deps)` → conforme au port `OfferingReadinessGuard` d'academic | câblage |
| `provisionStaffAccount(ctx, {staffId, channel})` | UI |

Ports consommés : `AcademicQuery` (`getClassroom`, `getCurriculumNode`, `getAcademicPeriod`, `listNodesForClassroom` — vérification des affectations), `AccountProvisioner` (iam), `StoragePort`. Repli si non câblé : `AcademicQuery` absent ⇒ création d'affectation refusée (`people.academic_unavailable`).

## 8. Endpoints (`/api/v1/people`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET/POST | `/staff` | Lister / créer | `staff.list` / `staff.create` |
| GET/PATCH | `/staff/:id` | Lire / modifier | `staff.read` / `staff.update` |
| POST | `/staff/:id/status` | Changer le statut (motif) | `staff.status.update` |
| PUT | `/staff/:id/affiliations` | Établissements/campus | `staff.update` |
| GET/POST/PATCH | `/staff/:id/contracts[/:cid]` ; POST `/staff/:id/contracts/:cid/end` | Contrats | `staff.contract.read` / `staff.contract.manage` |
| GET/POST/PATCH/DELETE | `/staff/:id/qualifications[/:qid]` | Qualifications | `staff.read` / `staff.qualification.manage` |
| GET/PUT | `/staff/:id/competencies` | Compétences | `staff.read` / `staff.update` |
| GET/PUT | `/staff/:id/availabilities` | Disponibilités | `staff.read` / `staff.availability.manage` |
| GET | `/staff/:id/assignments`, `/staff/:id/load?yearId` | Affectations / charge (prévue, contractuelle) | `teaching.read` |
| GET | `/teaching-assignments/unstaffed?yearId&classroomId` | Nœuds obligatoires sans responsable | `teaching.read` |
| PATCH | `/me/staff` | Mes coordonnées et disponibilités | `staff.own.update` |
| GET | `/staff/expiring-qualifications?withinDays` | Alertes | `staff.read` |
| GET/POST | `/teaching-assignments`, `/classrooms/:id/assignments` | Lister / affecter | `teaching.read` / `teaching.assign` |
| PATCH | `/teaching-assignments/:id` | Heures prévues, dates, note | `teaching.assign` |
| POST | `/teaching-assignments/:id/end`, `/teaching-assignments/:id/replace` | Terminer / remplacer | `teaching.assign` |
| GET | `/me/staff`, `/me/classes`, `/me/assignments` | Portail enseignant | `staff.own.read` |
| POST | `/staff/:id/portal-invitation` | Inviter | `staff.update` |
| GET/PUT | `/reference/{staff-categories,contract-types}` | Référentiels | `staff.read` / `people.settings.manage` |

## 9. Écrans

| Écran | Contenu | Rôles |
|---|---|---|
| Liste du personnel | Filtres catégorie/statut/établissement, charge, alertes d'expiration | RH, direction |
| Fiche personnel | Identité, affiliations, contrats, qualifications, compétences, disponibilités, historique | RH, direction |
| Affectations | Vue par classe (matrice matière × période → responsable) et par enseignant ; remplacement ; indicateur « matières sans responsable » | Directeur des études |
| Mes classes (enseignant) | Classes et matières affectées, prochaines séances (17), accès rapide appel/notes | Enseignant |
| Mes disponibilités | Grille hebdomadaire | Enseignant |
| Paramètres | Catégories, types de contrat, seuil d'alerte d'expiration | Direction |

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `staff.list` / `staff.read` | Lister / consulter le personnel | |
| `staff.create` / `staff.update` | Créer / modifier | |
| `staff.status.update` | Changer le statut | oui (sorties) |
| `staff.contract.read` / `staff.contract.manage` | Contrats | `manage` : oui |
| `staff.qualification.manage` / `staff.availability.manage` | Qualifications / disponibilités | |
| `staff.own.read` | Mes données (fiche, contrats, affectations) | |
| `staff.own.update` | Mettre à jour mes coordonnées et mes disponibilités (jamais statut, contrats, rémunération) | |
| `teaching.read` / `teaching.assign` | Affectations | |

Alignement : directeur des études `teaching.*`, `staff.read` ; responsable pédagogique `teaching.read`, `staff.read` ; économe `staff.read` ; enseignant `staff.own.*`, `payroll.own.*`.

## 11. Événements

| Événement | Producteur | Consommateurs |
|---|---|---|
| `people.staff.created` / `updated` / `status_changed` | fiche | 002 (accès), 010, 017, 032, 025 |
| `people.staff_contract.created` / `ended` | contrats | 032 |
| `people.staff_qualification.expiring` | job | 016 (alerte RH), 025 |
| `people.teaching_assignment.created` / `ended` / `replaced` | affectations | 017 (signale `replacement_needed`), 011, 010 |

Consommés : `academic.classroom.cancelled|completed`, `academic.year.closed` (terminer les affectations de l'année), `iam.membership.*`, `tenancy.tenant.provisioned` (catégories, types de contrat). Payloads `{ v: 1, staffId, … }` sans données personnelles.

## 12. Tests

- **Unitaires** : résolution du responsable d'un nœud, règles de rôle, charge, répartition de qualifications qui expirent, motifs de numéro.
- **Intégration** : comportements de `data-model.md` (LEAD unique, catégorie sans droit d'enseigner, contrats sans chevauchement, qualifications qui expirent, RLS) ; `status_changed → LEFT` clôt les affectations ; `replaceTeachingAssignment` atomique ; garde d'ouverture d'offre.
- **Contrat** : l'adaptateur de garde est compilé contre `OfferingReadinessGuard` ; `getAvailabilities` consommable par scheduling.
- **Sécurité** : un enseignant ne modifie ni ses contrats ni son statut ; `X-User-Id` ignoré ; aucune réponse n'expose un contrat à un tiers sans `staff.contract.read`.
- **Charge** : liste de 300 enseignants p95 < 300 ms.
- **E2E** : « directeur affecte un enseignant à trois matières, ouvre l'offre, remplace l'enseignant en cours d'année, l'enseignant voit ses classes ».

## 13. Cas limites

- Enseignant dans deux établissements (deux affiliations, affectations dans les deux) ; vacataire sans contrat actif (affectation permise avec avertissement, la paie décide).
- Affectation à une classe dont le curriculum est encore `DRAFT` : refusée (pas de nœud stable).
- Fin d'affectation en cours de période : les séances postérieures sont signalées ; les notes déjà saisies restent attribuées.
- Deux `LEAD` demandés sur le même objet : le second est refusé avec le nom du premier (suggestion `CO_TEACHER`).
- Retour d'un membre `LEFT` (réembauche) : même numéro, statut `ACTIVE`, nouveau contrat.
- Enseignant qui est aussi tuteur (personne unique), qui change de nom : mise à jour unique.
- Qualification sans date d'obtention ; expiration dépassée (alerte immédiate à la création).
- Disponibilité qui chevauche minuit : refusée (créneaux d'une même journée ; créer deux créneaux).
- Annulation d'une classe : les affectations sont terminées par événement `academic.classroom.cancelled`.

## 14. Dépendances

- **En amont** : 000, 001-003, 002 (`iam`, `rbac`), 004 (classes, nœuds, périodes, via port), 008 (`persons`, numérotation, comptes), 030 (audit), 024 (références documentaires, ultérieur).
- **En aval** : 010, 011, 013, 017, 025, 032 (paie).
- **Technique** : PostgreSQL 14+ (`btree_gist`), Zod, worker (job d'expiration).
- **Manifeste** : même module `people` que 008 ; le manifeste est créé par 008 et complété par 009 (permissions `staff.*`, `teaching.*`, menus du portail enseignant).

## 15. Critères de sortie (mesurables)

1. Migrations 0802, 0803, 0805 appliquées (après 0800, 0801, 0804) ; isolation générique verte ; allowlist vide.
2. Création d'un enseignant, d'un contrat, de deux qualifications dont une expirante, de disponibilités et de trois affectations (dont un `HOMEROOM`) ; remplacement et fin de statut `LEFT` clôturent proprement ; événements reçus par un simulacre de scheduling.
3. `createOfferingReadinessGuard` empêche l'ouverture d'une offre dont un nœud obligatoire n'a pas de `LEAD` et l'autorise sinon (test de contrat avec academic).
4. Aucune suppression physique de personnel ; aucune lecture de contrat sans permission ; aucune identité par en-tête client.
5. `listAvailabilities` et `getStaffByIds` consommés par un test de contrat de scheduling ; `getTeachingLoad` cohérent avec les données de test.
6. Les tables et routes legacy remplacées (`teachers`, `teacher_assignments`, `professional_session_ecue_teachers`, `teaching_hours`, `course_assignments`, routes `teachers`, `teacher-assignments`, `teaching-hours*`) sont supprimées dans la tranche 2.2 ; la paie (032) lit `scheduling.listPayableHours` et `people.getStaffByIds`, jamais ces tables.

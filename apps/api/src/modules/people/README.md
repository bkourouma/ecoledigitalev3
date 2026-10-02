# Module `people` — élèves, tuteurs, personnel, affectations d'enseignement

Socle (pack `CORE`). Schéma Postgres `people`, migrations **0800-0899** (0800-0806 livrées). Specs 008 (élèves et tuteurs) et 009
(personnel et enseignants) ; conventions : `docs/architecture/module-conventions.md`. `dependsOn: ["rbac"]` ; les ports vers
`iam`, `academic`, le stockage et `tenancy` sont **injectés**.

## Ce que le module sait faire

| Domaine | Fonctions |
|---|---|
| Dossier permanent | personne (état civil commun), élève (matricule gapless **immuable**, n° d'ordre figé, n° national facultatif, contacts, adresse, nationalité, photo en référence), historique de statut avec auteur et motif (création comprise), contacts d'urgence, antécédents scolaires, détection de doublons (avertissement), recherche normalisée (sans accents, trigrammes), export CSV audité (≤ 5 000 lignes), anonymisation |
| Pièces de l'élève | dépôt / consultation / remplacement (versions) / retrait / expiration de pièces (pièce d'identité, acte de naissance, certificats…) via `StoragePort` ; **type réel par octets magiques** (PDF, JPEG, PNG, WebP), taille ≤ `config.documentMaxBytes` (8 Mo), clé de stockage opaque, **URL signée** à durée courte, **chaque lecture auditée** (`notice`), contenu immuable en base, historique des versions, état d'échéance dérivé + alerte `people.student_document.expiring` (job 06:40). Routes `GET\|PUT /students/:id/documents`, `PUT\|PATCH /students/:id/documents/:docId`, `POST …/remove`, `GET …/url` : lecture `student.sensitive.read` (MFA), écriture `student.update` ; anonymisation : pièces retirées et fichiers supprimés |
| Tuteurs | un tuteur est une **personne** (sans compte obligatoire) ; liens élève-tuteur avec drapeaux (principal unique, urgence, répondant financier, autorité, retrait, accès portail) ; un parent suit plusieurs enfants (plusieurs établissements du tenant) ; un lien se **clôt**, il ne se supprime pas |
| Personnel | fiche unique pour enseignants / éducateurs / administratifs (catégories en données), statuts, affiliations, contrats datés (**ni tarif ni salaire**), qualifications avec alerte d'expiration, compétences, disponibilités, charge prévue/contractuelle |
| Affectations | `LEAD` (un seul actif par classe × nœud × période), `CO_TEACHER`, `HOMEROOM` (un par classe), `SUBSTITUTE` (suppléance longue durée), `SUPERVISOR`, généraliste (`covers_all_subjects`), remplacement atomique, historique, garde d'ouverture d'offre, matières sans responsable |
| Portails | « mon dossier » (élève), « mes enfants » (parent), « mon profil / mes classes / mes contrats » (personnel) |

## Contrôle d'accès fin (le cœur de la sécurité)

Le RBAC dit *quel type* de données ; le module décide *lesquelles* :

| Acteur | Règle | Réponse hors périmètre |
|---|---|---|
| Secrétariat / direction (`student.read`, `student.list`) | tous les élèves du tenant, hors champs sensibles | — |
| Enseignant (`student.class.read`) | élèves des classes où il est **affecté aujourd'hui** (`teaching_assignments` × annuaire d'inscriptions), fiche réduite (`access: CLASS` : pas d'adresse, lieu de naissance, e-mail ni téléphone de l'élève) | 404 |
| Parent (`student.child.read`) | **ses** enfants : `isGuardianOfStudent` (lien vivant, accès portail, type de nature `GUARDIAN`, tuteur et personne actifs) | 404 |
| Élève (`student.self.read`) | son propre dossier (`persons.identity_id = ctx.userId`), jamais « la fiche la plus récente » | 404 |
| Champs sensibles (`student.sensitive.read`, MFA) | identifiant national, état civil, `attributes`, n° de diplôme : seulement `GET /students/:id/sensitive` ; **chaque lecture est auditée** | 403 |

* **Garde-fou enseignant.** Le modèle de rôle système `enseignant` d'rbac accorde encore `student.read` + `student.list` (tous les élèves,
  comme le legacy). Tant qu'il n'est pas remplacé par `student.class.read`, le module restreint **de lui-même** tout membre du personnel
  dont la catégorie peut enseigner à ses classes, sauf s'il détient `student.update` (administration). Un membre `LEFT` reste restreint
  (aucune classe ⇒ aucun élève). Les lectures « tous les élèves » (historique, inscriptions, antécédents) lui sont refusées.
* L'identité vient **exclusivement** de `request.ctx` ; aucun en-tête client (`X-User-Id`…) n'est lu.
* Un tuteur ne modifie jamais ses drapeaux de lien (`guardian.manage` seulement) ; il met à jour ses coordonnées (`PATCH /me/guardian`) et
  les contacts d'urgence de ses enfants (`PATCH /children/:id/emergency-contacts/:cid`), champs limités, audité.
* Réponses `Cache-Control: no-store` ; erreurs `people.*` stables (`contracts/v2/people.ts`), sans message interne.

## API publique (`index.ts`) — noms figés pour 004, 007, 010, 011, 013, 014, 016, 017, 025, 031, 032

Les cas d'usage sont `(deps, ctx, input) => Promise<Result<T, AppError>>` ; `deps = createPeopleDeps({ db, clock, audit, accounts?, storage?, academic?, enrollments?, country? })`.

* Noms par lots : `lookupStudents`, `lookupStaff`, `getDisplayNamesOfStudents`, `getDisplayNamesOfStaff` (voir « Résolution de noms par lots »).
* Élèves : `getStudent`, `getStudentsByIds` (≤ 500), `listStudents`/`searchStudents`, `findDuplicateStudents`, `createStudent` (idempotent par `externalRef`, `validateOnly`, `acknowledgeDuplicate`), `updateStudent`, `changeStudentStatus`, `getStudentSensitive`, `exportStudents`, `anonymizeStudent`, photo, contacts d'urgence, antécédents.
* Tuteurs : `createGuardian`, `linkGuardian`, `updateGuardianLink`, `unlinkGuardian`, `listGuardiansOfStudent`, `listChildrenOfIdentity`, **`isGuardianOfStudent`** (à appeler par tout endpoint `*.child.*`), `resolveStudentForIdentity`, `updateMyContact`, `provisionPortalAccount`, `linkPersonToIdentity`.
* Personnel : `getStaff`, `getStaffByIds`, `listStaff`, `resolveStaffForIdentity`, `createStaff`, `updateStaff`, `changeStaffStatus`, `setAffiliations`, contrats, qualifications, `emitExpiringQualifications` (job), `setCompetencies`, `setAvailabilities`, `listAvailabilities`, `getTeachingLoad`.
* Affectations : `createTeachingAssignment`, `endTeachingAssignment`, `replaceTeachingAssignment`, `listAssignmentsForClassroom`, `listAssignmentsForStaff`, `getResponsibleForNode`, **`isStaffAssignedToClassroom`**, `listUnstaffedNodes`, **`createOfferingReadinessGuard`** (port `OfferingReadinessGuard` d'academic).
* Annuaires : **`createLearnerDirectory`** (conforme au port `LearnerDirectory` de finance, vérifié à la compilation) et **`createStudentDirectory`** (port `StudentDirectory` d'academic).

### Ports consommés (injectés ; repli sûr si absents)

| Port | Fournisseur | Repli |
|---|---|---|
| `AccountProvisioner` (`invite`, `grantRole`) | adaptateur `createIamAccountProvisioner` (câblé automatiquement si `app.iam` existe : `iam.provisionMember` + `rbac.assignSystemRoleUseCase`) | `501 people.account_provisioning_unavailable` |
| `StoragePort` (`put`, `delete`, `signedUrl`) | **aucun fournisseur dans la plateforme actuelle** | `people.storage_unavailable` (aucun upload) |
| `AcademicQuery` (`getClassroom`, `getCurriculumNode`, `getAcademicPeriod`, `listNodesForClassroom` ; facultatifs `getOffering`, `listClassrooms`, `listEnrollmentsByStudent`) | **aucun fournisseur** (academic n'existe pas encore) | toute création d'affectation refusée (`people.academic_unavailable`, échec fermé) |
| `EnrollmentDirectory` | défaut : la projection `student_enrollment_summaries` du module | — |
| `CountryProfileProvider` | **aucun fournisseur** | pas de nationalité par défaut ; téléphones nettoyés mais non convertis en E.164 |

## Événements

Publiés (payload `{ v: 1, … }`, **jamais** de donnée personnelle ni de texte libre) : `people.student.created|updated|status_changed|anonymized|guardian_changed`, `people.guardian.created|linked|link_changed|unlinked`, `people.person.identity_linked`, `people.staff.created|updated|status_changed|deactivated`, `people.staff_contract.created|ended`, `people.staff_qualification.expiring`, `people.teaching_assignment.created|ended|replaced`.

Consommés (`subscribers.ts`, idempotents, insensibles à l'ordre) :

| Abonné | Motif | Effet |
|---|---|---|
| `people.project-enrollment` | `academic.enrollment.*` | projection des inscriptions, `first_enrolled_on` |
| `people.project-membership` | `iam.membership.created\|changed` | projection des accès (`identity_memberships`) |
| `people.instantiate-reference-data` | `tenancy.tenant.provisioned` | types de liens, catégories, types de contrat (sans écraser) |
| `people.end-assignments-on-classroom-closed` | `academic.classroom.cancelled\|completed` | termine les affectations de la classe |
| `people.end-assignments-on-year-closed` | `academic.year.closed` | termine les affectations de l'année |

Job : `people.emit-expiring-qualifications` (06:30, par tenant) — une alerte par franchissement de seuil (`expiry_alerted_for`), préavis = `settings.expiry_alert_days`.

### Liaison identité IAM <-> personne (précisément)

Les événements `iam.membership.*` portent `identityId`, `membershipId`, `roles`, `status` — **pas d'e-mail** (donnée personnelle) : on ne rapproche donc jamais une personne d'une identité par e-mail. La liaison est **explicite** (`persons.identity_id`, unique par tenant) :
1. `provisionPortalAccount` : `AccountProvisioner.invite` (hors transaction : iam/rbac ouvrent les leurs) puis, en une transaction, liaison + projection + événement + audit. Aucun mot de passe : invitation par jeton à usage unique ; une personne qui a déjà une identité (parent **et** enseignant) reçoit un rôle de plus (`grantRole`), jamais un second compte.
2. `linkPersonToIdentity` : pour un accès créé directement dans iam ; refusé si l'identité n'a aucun accès dans le tenant (projection).
3. L'abonné `people.project-membership` tient la projection (statut `active`/`suspended`… affiché comme `portalAccount`). Si la liaison échoue après la création de l'accès : relancer répond `people.account_exists` ; lier à la main.

## Écarts avec les specs 008 / 009 (corrigés dans les specs)

* Permissions ajoutées : `student.child.update`, `student.self.update` (écrire exige un droit d'écriture ; `*.child.*` / `*.self.*` les attribuent aux rôles parent / élève).
* `GET /staff` : `staff.read` suffit (modèles économe et directeur des études).
* `student_guardians` : l'unicité `(student, guardian)` porte sur les liens **vivants** (le rétablissement d'un lien clos était impossible).
* `student_enrollment_summaries` : libellés/références facultatifs (payloads minimaux), `source_occurred_at`.
* `settings.student_retention_days` (O-15) : sans valeur, **l'anonymisation est refusée** (aucune durée légale codée). Autres colonnes : `persons.anonymized_at`, `staff_qualifications.expiry_alerted_for`, table `identity_memberships` (0806).
* `getTeachingLoad` : `PER_WEEK` converti en année seulement si `weeksPerYear` est fourni.
* Rôles d'affectation : la garde d'offre / `listUnstaffedNodes` exigent un `LEAD` (explicite ou généraliste) ; `SUBSTITUTE` actif prend la place de l'affectation remplacée.

## Résolution de noms par lots (`lookup`)

Pour les écrans qui affichent des listes d'identifiants (finance, présences, résultats, paie…) : **une requête**, pas N.

| Route | Permissions (la plus large applicable gagne, les périmètres d'une même personne se cumulent) | Périmètre |
|---|---|---|
| `GET /students/lookup?ids=a,b,c` | `student.list` / `student.read` | tous les élèves du tenant (hors enseignant restreint par le garde-fou) |
| | `student.class.read` | élèves de SES classes (affectation active aujourd'hui × projection d'inscriptions) |
| | `student.child.read` | SES enfants (lien vivant, accès portail) |
| | `student.self.read` | son propre dossier |
| `GET /staff/lookup?ids=a,b,c` | `staff.list` / `staff.read` | tout le personnel du tenant (comme `GET /staff/:id`) |
| | `staff.own.read` seul | sa propre fiche |

Réponse `{ items: [{ id, displayName, studentNumber|staffNumber, status }], missing: [id] }` — **minimale** (jamais naissance, contact, photo, inscription, identifiant national, compte lié, contrat). `items` suit l'ordre des ids demandés ; `ids` : UUID séparés par des virgules (ou paramètre répété), **dédoublonnés**, **≤ 100 distincts** (`PEOPLE_LOOKUP_MAX_IDS`, bornée par la longueur d'URL ; 400 au-delà, 400 pour un UUID mal formé ou un segment vide). `missing` = demandés et non restitués : **inconnus, d'un autre tenant (la RLS les rend invisibles) ou hors du périmètre — volontairement indiscernables** (jamais 403/404 par identifiant, aucune fuite d'existence). Aucune permission applicable : 403.

API publique (`index.ts`) : `lookupStudents(deps, ctx, ids, { scope? })` et `lookupStaff(...)` → `Result<{ items, missing }>` (plafond **500**, `scope: { kind: "IDS", ids }` pour restreindre AVANT la lecture ; `resolveStudentLookupScope` / `resolveStaffLookupScope` calculent le périmètre d'un appelant) ; `getDisplayNamesOfStudents(deps, ctx, ids)` et `getDisplayNamesOfStaff(...)` → `Promise<Map<id, « NOM Prénom »>>` pour les modules et adaptateurs (découpe en lots de 500, ignore inconnus et UUID invalides, ne lève pas sur la taille ; **sans contrôle de périmètre** : l'appelant a déjà autorisé SA route).

**Consommer depuis un autre module** (finance, attendance, results — DTO non modifiés ici) : dans l'adaptateur de `platform/adapters`, collecter les `studentId` d'une page de résultats, appeler UNE fois `getDisplayNamesOfStudents(peopleDeps, ctx, ids)` puis fixer `studentName = names.get(id) ?? null` (un nom absent = élève inconnu, anonymisé ou d'un autre tenant : afficher un libellé de repli, ne jamais échouer). Côté web, `GET /api/v1/people/students/lookup?ids=…` par paquets de 100 pour résoudre les noms d'une liste d'un portail.

## Demandes de changement vers les autres modules (non faites ici)

1. **rbac** (`templates/system-roles.ts`) : `enseignant` → remplacer `student.read`/`student.list` par `student.class.read`, ajouter `staff.own.*` ; `econome`/`directeur_etudes` : ajouter `staff.list` (facultatif).
2. **iam** : consommer `people.student.status_changed` (suspendre l'accès d'un élève `WITHDRAWN|EXCLUDED|TRANSFERRED_OUT|ARCHIVED`) et `people.staff.deactivated`.
3. **academic** : événements `academic.enrollment.*` portant `studentId`, `classroomId`, `institutionId`, `academicYearId`, `status` ; port `AcademicQuery` (dont `getOffering`, `listEnrollmentsByStudent`) ; consommer `people.student.status_changed` ; brancher `createStudentDirectory` et `createOfferingReadinessGuard`.
4. **platform / tenancy** : fournir `StoragePort`, `CountryProfileProvider`, `AcademicQuery` au `ModuleRuntime` (aujourd'hui seuls `iam`/`rbac`/`audit` sont câblés) ; section `people` du modèle de pack (D-21).
5. **worker** : reconstruire le bundle (`pnpm --filter @ecoledigitale/worker build`) — un nouveau module impose de reconstruire.

## Tests

```bash
# unitaires (sans base)
pnpm exec vitest run --config apps/api/src/modules/people/vitest.config.ts test/unit
# unitaires + intégration (Postgres éphémère dans Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/people/vitest.config.ts
# assemblage réel dans la plateforme (Postgres + Redis + worker)
cd apps/api && ED_PG_IMAGE=postgres:17-alpine node ../worker/scripts/with-infra.mjs src/modules/people/test/platform
```

Couverture d'intégration : 50 créations concurrentes = numéros 1…50 ; atomicité ; RLS A/B (`assertTenantIsolation` + vraies données dans chaque table) ; invariants de la base (transitions 8×8, compteurs, DELETE refusé, FK composites) ; matrice d'autorisation parent / élève / enseignant / éducateur / directeur des études / économe / direction / secrétariat par HTTP (`app.inject`) avec les **vrais** modèles de rôles ; parent avec enfants dans deux établissements ; personne parent + enseignant (une `persons`, deux rôles) ; projection d'inscriptions rejouée / désordonnée / reconstruite à l'identique ; anonymisation ; abonnés et job.

## Limites connues

* « Aujourd'hui » est la date **UTC** de l'horloge injectée (le fuseau de l'établissement, D-24, n'est pas disponible dans ce module).
* `StoragePort`, `AcademicQuery`, `CountryProfileProvider` n'ont pas de fournisseur dans la plateforme : les fonctions correspondantes répondent par un refus explicite jusqu'à leur câblage.
* Pas de fusion de dossiers en double (O-07), pas de données de santé (O-08), aucune reprise de données de production.

## Assemblage : ports et lectures publiées

- ports `academic` (affectations, ouverture d'offre) et `storage` : registre `registerPeoplePorts` (`app.peoplePorts`, API) et `setPeopleWorkerPorts` (worker), branchés par `platform/adapters` ;
- `getDisplayNamesOfIdentities` (nom d'affichage par identité de compte) et `StaffBrief.identityId` (compte lié, résolu par `persons.identity_id`, jamais par e-mail) servent les annuaires des autres modules.

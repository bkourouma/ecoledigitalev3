# Feature Specification: Élèves, étudiants et tuteurs (008-students-guardians)

**Feature Branch**: `008-students-guardians`

**Created**: 2026-10-01

**Status**: Rédigée — prête pour `/speckit.plan`. Module backend `people` (schéma Postgres `people`), partagé avec la spec 009 (personnel). DDL de référence : `data-model.md` (migrations 0800, 0801, 0804 ; 0802-0803 relèvent de 009).

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §10, §20, §36, §47, §50, §57 ; plan §3.4, §3.6, §3.7, §4 (tranche 2.2) ; ADR-001, 002, 004, 006, 007, 008 ; `docs/architecture/module-conventions.md` ; `apps/api/src/modules/finance/README.md` (port `LearnerDirectory`) ; `rbac/templates/system-roles.ts` (permissions `student.*`, `guardian.*`, `*.child.*`, `*.self.*`) ; legacy : `student_profiles`, `student_parents`, `emergency_contacts`, `registration_requests`, `student_status_history`, `professional_student_matricules`, routes `students.ts`, `parents.ts`, `registration-requests.ts`, `enrollments.ts` (inventaire : `parity.md`).

> Principe cardinal (PRD §10) : **un changement de classe ou d'année ne crée jamais un nouvel élève.** Le dossier permanent est ici ; l'historique des inscriptions est dans `academic.enrollments` (spec 004). Les identifiants stables publiés sont `people.students.id` et `people.persons.id`.

> **Erratum d'implémentation (module livré, voir `apps/api/src/modules/people/README.md` §Écarts)** : permissions ajoutées `student.child.update` et `student.self.update` (modifier des coordonnées exige un droit d'écriture, pas `*.read`) ; `GET /staff` accepte `staff.read` ; les routes `PATCH /me/guardian`, `PATCH /me/student`, `PATCH /me/contact` remplacent `PATCH /me/contact` seul ; un enseignant dont la catégorie peut enseigner est limité à ses classes même si son rôle accorde `student.read` (garde-fou tant que rbac n'a pas remplacé le modèle) ; l'anonymisation exige `settings.student_retention_days` (donnée du tenant, question O-15) ; un lien clos puis rétabli crée une nouvelle ligne ; la liaison identité <-> personne est explicite (aucun rapprochement par e-mail : les événements iam n'en portent pas) et s'appuie sur une projection des accès (`identity_memberships`, migration 0806).

## 1. Objectifs

1. **Dossier permanent unique** de l'apprenant (identité, naissance, nationalité, matricules, contacts, adresse, historique scolaire, documents, contacts d'urgence), indépendant de toute année.
2. **Tuteurs sans compte obligatoire** : un tuteur est une personne ; il peut avoir un accès au portail (identité `iam` globale, ADR-008) mais n'en a pas besoin pour exister, et un même tuteur suit plusieurs enfants, y compris dans plusieurs établissements du tenant.
3. **Un seul générateur de matricule**, immuable, au motif configurable, remplaçant les six numérotations du legacy (numéro 10001+ réécrit à chaque lecture, matricule saisi, `sequence_number`, IPAM, DSPS, `STU<année>NNN`).
4. **Contrôle d'accès « enfant »** : la règle « cet élève est bien l'enfant de ce parent » est une règle de domaine de ce module (`isGuardianOfStudent`), appliquée par tous les modules qui exposent `*.child.*`.
5. **Historisation** : statut de l'élève avec motif et auteur (création comprise), aucune suppression physique.
6. **Annuaires pour les autres modules** : `LearnerDirectory` (finance, spec 014), `StudentDirectory` (academic, spec 004), lecture par lots (`getStudentsByIds`) pour les modules qui n'ont pas le droit de jointure SQL.
7. **Sécurité des données personnelles** (PRD §47) : permissions fines, champs sensibles séparés, pas de mot de passe en clair, stockage objet des pièces, audit des opérations sensibles.

## 2. Périmètre

### Inclus

- Personnes (`persons`), élèves (`students`), tuteurs (`guardians`), liens élève-tuteur (`student_guardians`), contacts d'urgence, historique scolaire d'entrée (`student_prior_education`), historique de statut.
- Détection de doublons à la création ; recherche normalisée (sans accents, tolérante aux fautes de frappe via trigrammes).
- Numérotation gapless configurable (`next_number`), photo (stockage objet), identifiant national éventuel.
- Projection de lecture `student_enrollment_summaries` (alimentée par `academic.enrollment.*`).
- Comptes de portail : création/liaison d'identité via le port `AccountProvisioner` (module `iam`), invitation par jeton (aucun mot de passe en clair stocké ni renvoyé).
- Portails : « mon dossier » (élève), « mes enfants » (parent) : lectures filtrées par `isGuardianOfStudent`.
- Annuaires `LearnerDirectory`, `StudentDirectory` ; événements ; API HTTP `/api/v1/people/students|guardians|…` ; écrans d'administration et portails.
- Support des imports (idempotence par `external_ref`, mode validation sans écriture) pour la spec 031.

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Inscription annuelle, classe, financement, redoublement, option (LV2), origine, transfert | 004 (`academic.enrollments`) |
| Candidatures, admissions, demandes d'inscription publiques (`registration_requests`) | 007 (admissions) |
| Personnel, enseignants, affectations | 009 |
| Présences, justificatifs | 010 |
| Notes, bulletins | 011-013 |
| Factures, soldes, reçus, commissions de prospection, provenance commerciale | 014/015 (la provenance commerciale n'est pas portée par le dossier permanent) |
| Authentification, sessions, MFA, réinitialisation de mot de passe | 002 / module `iam` |
| Documents (GED : actes de naissance, diplômes, certificats) | 024 (références `document_ref`) |
| Messagerie parents-établissement | 016 |
| Fusion de dossiers en double | hors v1 (question O-07) |
| Santé (allergies, vaccinations) | non exprimé par le PRD (question O-08) |

## 3. Acteurs

| Acteur | Rôle vis-à-vis de cette spec |
|---|---|
| Secrétariat | Crée et met à jour les dossiers, lie les tuteurs, gère les statuts |
| Directeur / directeur des études | Consulte, change les statuts sensibles (exclusion, retrait) |
| Éducateur / enseignant | Consulte la fiche utile (contacts, photo) de ses classes (`student.read`) |
| Parent / tuteur | Consulte et met à jour ses propres coordonnées et celles de contact d'urgence de ses enfants (champs autorisés) |
| Élève / étudiant | Consulte son dossier ; met à jour ses coordonnées (champs autorisés) |
| Module consommateur | 004 (valide l'apprenant), 007 (crée l'élève à l'admission), 010/011/013/014/016 (lisent par lots) |
| Super-admin | Opérations de support auditées ; jamais de lecture de dossier hors impersonation tracée |

## 4. User Stories et critères d'acceptation

### US1 — Créer un dossier sans doublon (P1)

En tant que secrétariat, je veux créer le dossier permanent d'un apprenant et être alerté d'un possible doublon.

- **AC1.1** `createStudent` crée atomiquement la personne, le dossier, le numéro, la ligne d'historique `from NULL → ACTIVE` et l'événement `people.student.created` ; si une étape échoue, rien n'est écrit (test d'atomicité).
- **AC1.2** 50 créations concurrentes produisent des numéros d'ordre **contigus 1…50 sans doublon** (même technique que `finance.next_number`) ; une création annulée rend son numéro à la suivante.
- **AC1.3** Le matricule (`student_number`) est généré par le motif du tenant (`{SEQ:5}` par défaut ; jetons `{PREFIX}`, `{YYYY}`, `{YY}`, `{SEQ:n}`), est **immuable** (déclencheur) et jamais recalculé : lire 100 fois la liste ne modifie aucune ligne (`updated_at` inchangés — le legacy réécrivait tous les matricules à chaque `GET /students`).
- **AC1.4** À la création, si une personne de même nom normalisé (sans accents, insensible à la casse, permutation nom/prénom admise) et même date de naissance existe, la réponse est `409 people.possible_duplicate` avec les candidats ; la création n'aboutit que si `acknowledgeDuplicate: true` + motif (tracé). Le contrôle est désactivable par `settings.duplicate_check_enabled`.
- **AC1.5** Le sexe est obligatoire pour un élève et n'a **aucune valeur par défaut** (le legacy défaut « masculin » était une donnée fausse) ; la date de naissance doit être plausible ; la nationalité est un code pays ISO 3166 (défaut : pays du `CountryProfile`).
- **AC1.6** `createStudent` est **idempotent** par `externalRef` (rejeu = le même `studentId`, pas de doublon) et accepte le mode `validateOnly` qui renvoie les erreurs par champ sans écrire (support des imports 031).

### US2 — Tuteurs et accès « enfant » (P1)

En tant que parent, je veux suivre mes enfants et eux seuls, quel que soit leur établissement.

- **AC2.1** Un tuteur est une `persons` + `guardians` ; `linkGuardian(student, guardian, relationship, flags)` pose les drapeaux `is_primary_contact`, `is_emergency_contact`, `is_financial_responsible`, `has_legal_custody`, `can_pickup`, `portal_access`. Un **seul** contact principal vivant par élève (contrainte) ; changer de principal est atomique. `unlinkGuardian` **clôt** le lien (`valid_to`) et ne le supprime jamais (la base refuse le `DELETE`) : l'historique des tuteurs successifs est conservé. Les drapeaux sensibles ont des valeurs par défaut prudentes (`can_pickup = false`, `has_legal_custody = false` ; le legacy autorisait le retrait par défaut).
- **AC2.2** Seul `guardian.manage` modifie les drapeaux ; un tuteur ne peut **pas** modifier lui-même `can_pickup` ni `relationship` (le legacy l'autorisait) ; il peut mettre à jour ses coordonnées (`persons`) via `student.child.write`-équivalent restreint (champs : téléphone, e-mail, adresse).
- **AC2.3** `isGuardianOfStudent(ctx, identityId, studentId)` vrai ssi un lien vivant (`valid_to IS NULL`) avec `portal_access = true` existe entre une personne portant cette identité et l'élève **et** que le type de lien est de nature `GUARDIAN` (un simple contact d'urgence — nature `EMERGENCY` ou `OTHER` — ne donne jamais accès au portail) ; tous les endpoints `*.child.*` des modules (010, 011, 013, 014, 017) l'utilisent. Matrice de tests : 100 % des cas (lien vivant, expiré, sans accès, autre élève, autre tenant) donnent la décision attendue.
- **AC2.4** Un parent dont les enfants sont dans deux établissements du tenant les voit dans une seule liste (`listChildrenOfIdentity`), triés par nom ; dans deux **tenants**, il change de tenant par `switch-tenant` (ADR-008) et ne voit que les enfants du tenant courant.
- **AC2.5** Une même personne peut être tuteur d'un élève et membre du personnel (spec 009) : un seul enregistrement `persons`, deux rôles ; le type de financement `STAFF_CHILD` peut être proposé quand le tuteur est du personnel (suggestion, jamais automatique).
- **AC2.6** Un tuteur sans compte reste joignable par les communications (téléphone/e-mail) ; `provisionPortalAccount` crée l'identité et le rattachement via `iam` et envoie une **invitation à définir son mot de passe** (jeton à usage unique) — aucun mot de passe en clair n'est généré, stocké (`initial_password`) ni renvoyé par l'API.

### US3 — Statut et historique (P1)

En tant que directeur, je veux changer le statut d'un élève avec motif et retrouver l'historique.

- **AC3.1** Les transitions d'état sont imposées par la base (voir `data-model.md`) ; `changeStudentStatus` exige un motif pour `EXCLUDED`, `WITHDRAWN`, `TRANSFERRED_OUT` et pour tout retour vers `ACTIVE` depuis un statut final ; chaque changement écrit `student_status_history` (auteur, motif, date d'effet) et publie `people.student.status_changed`.
- **AC3.2** Un statut final (`WITHDRAWN`, `EXCLUDED`, `TRANSFERRED_OUT`) déclenche, côté academic (consommateur), le retrait des inscriptions vivantes ; le statut de l'élève et celui de ses inscriptions ne divergent plus silencieusement (le legacy les découplait).
- **AC3.3** Aucune suppression physique : `DELETE` sur `students`, `persons`, `guardians` est refusé par la base ; `ARCHIVED` masque le dossier des listes par défaut. Le legacy supprimait en cascade notes, présences, paiements et échéances avec la fiche.
- **AC3.4** `GET /students/:id/history` restitue 100 % des changements avec auteur et motif.
- **AC3.5** Un statut `WITHDRAWN`, `EXCLUDED`, `TRANSFERRED_OUT`, `ARCHIVED` publie `people.student.status_changed` que `iam` consomme pour **suspendre l'accès** de l'élève (le legacy n'empêchait pas la connexion d'un élève `dropped`) ; le retour à `ACTIVE` ne rétablit l'accès que par une action explicite.
- **AC3.6** **Anonymisation** (droit à l'effacement, PRD §47) : `anonymizeStudent(studentId, reason)` (permission **sensible** `student.anonymize`, MFA, audit) n'est possible que pour un dossier `ARCHIVED` dont le délai de conservation (donnée du tenant) est écoulé ; elle remplace les données personnelles de la personne et des pièces par des valeurs neutres, conserve le matricule, les faits académiques et financiers (agrégats) et publie `people.student.anonymized`. L'inverse (restauration) n'existe pas.

### US4 — Recherche et listes performantes (P1)

En tant que secrétariat, je veux retrouver un élève par nom, matricule, classe ou statut.

- **AC4.1** `searchStudents(q)` cherche sur nom/prénom normalisés (trigrammes), `student_number`, `national_student_id`, numéro d'inscription (projection), téléphone d'un tuteur ; p95 < 200 ms sur 20 000 élèves.
- **AC4.2** Le filtre par classe/année/programme/statut d'inscription passe par la projection `student_enrollment_summaries` ; après `academic.enrollment.created`, l'élève apparaît dans la liste de la classe en < 5 s ; `rebuildEnrollmentProjection` reconstruit la projection à l'identique (test de comparaison).
- **AC4.3** Les listes ne renvoient jamais les champs sensibles (§Permissions) ; la pagination plafonne à 200 lignes (le legacy permettait 1 000).

### US5 — Portail élève/parent (P1)

- **AC5.1** `GET /me/student` renvoie le dossier de l'identité courante (ou 404) ; aucun repli silencieux sur « la fiche la plus récente » (legacy S-010) ; aucune confiance dans un en-tête client (`x-user-id`).
- **AC5.2** `GET /children` renvoie les enfants du parent (nom, photo, classe courante via projection) ; `GET /children/:studentId` refuse (404) tout élève hors lien vivant.
- **AC5.3** Les tuteurs modifient leurs coordonnées et les contacts d'urgence de leurs enfants ; chaque modification est auditée.

### US6 — Annuaires pour les autres modules (P1)

- **AC6.1** `createLearnerDirectory(deps)` renvoie `{ getLearner(ctx, learnerId) → { learnerId, displayName, registrationNumber } | null }` conforme au port `LearnerDirectory` de finance ; `displayName` = « NOM Prénom » ; `registrationNumber` = `student_number`.
- **AC6.2** `createStudentDirectory(deps)` renvoie `{ getStudent(ctx, studentId) → { studentId, status, displayName, studentNumber, sequenceNumber } }` conforme au port `StudentDirectory` de academic.
- **AC6.3** `getStudentsByIds(ctx, ids[≤500])` renvoie les dossiers résumés en une requête (pour 010/011/013/014/016) ; ids inconnus ignorés, ordre non garanti.

### US7 — Données sensibles et conformité (P1)

- **AC7.1** Les champs sensibles (`birth_certificate_*`, `national_student_id`, `civil_registry_office`, `attributes.*` sensibles, pièces) ne sont lus qu'avec `student.sensitive.read` ; toute lecture sensible et tout export sont audités (`severity=notice`).
- **AC7.2** Le téléchargement d'une pièce passe par une URL signée à durée courte après contrôle de permission (jamais un chemin disque) ; le type réel est contrôlé par octets magiques (images ≤ taille configurable) ; le legacy servait les diplômes sans contrôle de rôle.
- **AC7.3** Les journaux et événements ne contiennent ni date de naissance ni téléphone (identifiants et libellés seulement).
- **AC7.4** Un export de la liste est limité à 5 000 lignes, journalisé, et exige `student.export` (via `report.export`).

## 5. Règles métier

- R1 Un élève = une personne ; une personne a au plus un dossier élève, un dossier tuteur, un dossier personnel dans un tenant (`UNIQUE (tenant_id, person_id)` par rôle).
- R2 `student_number` : motif du tenant, gapless, immuable ; `sequence_number` : numéro d'ordre figé du tenant (utilisé par le numéro d'inscription d'academic) ; pas de réutilisation après archivage.
- R3 Statuts : `ACTIVE`, `INACTIVE` (entre deux années), `SUSPENDED` (suspension temporaire, ex-`suspended` du legacy ; la sanction disciplinaire détaillée relève de 006), `GRADUATED`, `WITHDRAWN`, `TRANSFERRED_OUT`, `EXCLUDED`, `ARCHIVED` ; transitions §data-model ; motif obligatoire pour les sorties ; date d'effet explicite. Le statut du dossier est **toujours** une action explicite (jamais déduit des inscriptions) ; l'obtention d'un diplôme (019/013) appelle `changeStudentStatus(GRADUATED)`.
- R4 `first_enrolled_on` et `left_on` sont posés par la projection d'inscriptions et les changements de statut, non saisis librement.
- R5 Le dossier ne porte aucune donnée d'année (niveau, classe, redoublement, LV2, boursier, origine, transfert, décision d'affectation) : elles sont sur l'inscription (004). Le legacy dupliquait dix de ces champs entre la fiche et l'inscription.
- R6 Un tuteur peut être lié à plusieurs élèves ; un élève a ≥ 0 tuteurs ; un seul principal ; un `valid_to` non nul clôt le lien (historique conservé) ; la responsabilité financière est une information pour la facturation (014), pas un droit d'accès.
- R7 `portal_access = false` coupe toute lecture « enfant » même si le lien existe (garde d'un parent déchu de l'autorité).
- R8 Les contacts d'urgence appartiennent à l'**élève** (plus au parent) et sont distincts des tuteurs (un voisin, un oncle).
- R9 Les téléphones sont stockés en format E.164 quand le pays est connu (normalisation à l'écriture) ; longueur ≤ 40 (le legacy limitait à 20 et plantait à l'approbation).
- R10 Les e-mails ne sont pas uniques dans `persons` (famille partageant une adresse) ; l'unicité de connexion relève d'`iam` (identité globale).
- R11 La détection de doublon est un avertissement humain, pas une contrainte ; la fusion est hors v1.
- R12 Les valeurs CI spécifiques (sous-préfecture, centre d'état civil, matricule DSPS…) vivent dans `attributes` validé par un schéma Zod par système éducatif (modèle de pack), pas dans des colonnes dédiées.
- R13 Photos : stockage objet (clé `tenants/{tenantId}/people/students/{studentId}/photo`), ≤ 2 Mo par défaut (configuration), JPEG/PNG/WebP vérifiés par octets magiques.
- R14 Aucune règle de seuil (âge minimal, nombre de redoublements) n'est codée ici ; elles relèvent des RuleSets via les faits d'inscription.

## 6. Modèle de données

Voir `data-model.md` : `relationship_types`, `settings`, `number_sequences` (+ fonction `next_number`), `persons`, `students`, `student_status_history`, `student_prior_education`, `guardians`, `student_guardians`, `student_emergency_contacts`, `student_enrollment_summaries`. Migrations **0800** (référentiels, personnes), **0801** (élèves, tuteurs), **0804** (invariants) ; plage 0800-0899.

## 7. Interfaces publiées (`apps/api/src/modules/people/index.ts`)

| Fonction | Usage |
|---|---|
| `getStudent(ctx, studentId)` → `StudentView` (identité, matricule, statut, photo, tuteur principal ; **sans** champs sensibles) | tous |
| `getStudentsByIds(ctx, ids)` → `StudentSummary[]` | 010, 011, 013, 014, 016, 017 |
| `listStudents(ctx, filters)`, `searchStudents(ctx, q, filters)` | UI, 007 |
| `findDuplicateStudents(ctx, draft)` → candidats | 007, UI |
| `createStudent(ctx, input)` (appelé aussi par 007 à `ENROLLED`) · `updateStudent` · `changeStudentStatus` | UI, 007, 031 |
| `listGuardiansOfStudent(ctx, studentId)` → tuteurs avec drapeaux (contacts de notification : téléphone/e-mail) | 016 (communications), 014 (répondant financier) |
| `listChildrenOfIdentity(ctx, identityId)` → `StudentSummary[]` | portails |
| `isGuardianOfStudent(ctx, identityId, studentId)` → boolean | **tous les modules `*.child.*`** |
| `resolveStudentForIdentity(ctx, identityId)` → `studentId \| null` | portails `*.self.*` |
| `linkGuardian`, `updateGuardianLink`, `unlinkGuardian` (clôture), `createGuardian`, `updateGuardian`, `listGuardians`, `getGuardian`, `updateMyContact` (`/me/guardian`) | UI, portail parent |
| `exportStudents(ctx, filters)` (CSV ≤ 5 000 lignes, audité) · `anonymizeStudent` | UI |
| `upsertEmergencyContact`, `removeEmergencyContact`, `addPriorEducation`, `updatePriorEducation`, `removePriorEducation` | UI |
| `provisionPortalAccount(ctx, {personId, role, channel})` (via `AccountProvisioner`) | UI, 007 |
| `uploadStudentPhoto(ctx, studentId, file)` (via `StoragePort`) | UI |
| `rebuildEnrollmentProjection(ctx, {yearId?})` (job) | exploitation |
| `createLearnerDirectory(deps)` → conforme à `LearnerDirectory` (finance) ; `createStudentDirectory(deps)` → conforme à `StudentDirectory` (academic) | câblage |

DTO dans `packages/contracts/src/v2/people.ts`. Les noms ci-dessus sont figés pour 004, 007, 010, 011, 013, 014, 016, 017.

### Ports consommés

| Port | Fourni par | Repli si non câblé |
|---|---|---|
| `AccountProvisioner.invite(ctx, {personId, email/phone, role})` | `iam` (`provisionMember`, invitation) | `501 people.account_provisioning_unavailable` (aucun compte créé) |
| `StoragePort` | `packages/` stockage S3/MinIO | refus des uploads |
| `AcademicQuery.listEnrollmentsByStudent` | academic (pour `rebuildEnrollmentProjection`) | projection reconstruite par rejeu d'événements seulement |
| `NumberFormatProvider` (pays) | tenancy `CountryProfile` | motif par défaut `{SEQ:5}` |

## 8. Endpoints (`/api/v1/people`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET | `/students` | Liste filtrée (q, classe, année, programme, statut, tuteur) | `student.list` |
| POST | `/students` | Créer (option `validateOnly`, `acknowledgeDuplicate`) | `student.create` |
| GET/PATCH | `/students/:id` | Lire / modifier | `student.read` / `student.update` |
| GET | `/students/:id/sensitive` | Champs sensibles | `student.sensitive.read` |
| POST | `/students/:id/status` | Changer le statut (motif) | `student.status.update` |
| GET | `/students/:id/history` | Historique de statut | `student.read` |
| PUT/DELETE | `/students/:id/photo` | Photo | `student.update` |
| GET/POST/PATCH/DELETE | `/students/:id/prior-education[/:eid]` | Historique scolaire d'entrée | `student.read` / `student.update` |
| GET/POST/PATCH/DELETE | `/students/:id/emergency-contacts[/:cid]` | Contacts d'urgence | `student.read` / `student.update` |
| GET | `/students/:id/enrollments` | Inscriptions (projection) | `student.read` |
| GET/POST/PATCH/DELETE | `/students/:id/guardians[/:linkId]` | Liens tuteurs | `guardian.read` / `guardian.manage` |
| GET | `/students/duplicates?lastName&firstName&birthDate` | Candidats doublons | `student.create` |
| GET/POST/PATCH | `/guardians`, `/guardians/:id` | Tuteurs | `guardian.read` / `guardian.manage` |
| GET | `/students/export` | Export CSV (≤ 5 000 lignes, audité) | `student.export` |
| POST | `/students/:id/anonymize` | Anonymisation d'un dossier archivé | `student.anonymize` |
| PATCH | `/me/guardian` | Un tuteur met à jour ses propres coordonnées | `student.child.read` + règle de champs |
| POST | `/persons/:id/portal-invitation` | Inviter au portail | `guardian.manage` / `student.update` |
| GET | `/me/student` | Mon dossier | `student.self.read` |
| GET | `/children`, `/children/:studentId` | Mes enfants | `student.child.read` |
| PATCH | `/children/:studentId/emergency-contacts/:cid` ; PATCH `/me/contact` | Coordonnées autorisées | `student.child.read` + règle de champs |
| GET/PUT | `/reference/relationship-types` | Types de liens | `student.read` / `people.settings.manage` |
| GET/PUT | `/settings` | Motifs de numéros, doublons | `people.settings.manage` |
| POST | `/admin/rebuild-enrollment-projection` | Reconstruction | `people.settings.manage` |

Conventions : voir spec 004 (erreurs `people.*`, entrées `strict`, pagination ≤ 200). Les endpoints PRD §60 (`/students`, `/teachers`) peuvent être exposés en alias de routage vers le préfixe du module.

## 9. Écrans

| Écran | Contenu | Rôles |
|---|---|---|
| Liste des élèves | Recherche, filtres (classe, année, statut), indicateurs, export | Secrétariat, direction |
| Dossier élève | Onglets : identité, coordonnées, tuteurs, contacts d'urgence, historique scolaire, inscriptions, historique de statut, pièces ; champs sensibles masqués par défaut | Secrétariat, direction |
| Création d'un élève | Assistant : identité → tuteurs → alerte de doublon → numéro attribué ; création en lot par import (031) | Secrétariat |
| Tuteurs | Fiche tuteur (enfants liés, accès portail, invitation) | Secrétariat |
| Mes enfants (parent) | Liste, accès rapide aux modules (résultats, absences, paiements) | Parent |
| Mon dossier (élève) | Lecture + coordonnées modifiables | Élève |
| Paramètres des personnes | Motif de numéro, types de liens, contrôle de doublons | Direction |

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `student.list` / `student.read` | Lister / consulter un élève | |
| `student.create` / `student.update` | Créer / modifier | |
| `student.status.update` | Changer le statut | oui (sorties) |
| `student.sensitive.read` | Lire les champs sensibles et les pièces | oui |
| `student.export` | Exporter | oui |
| `student.class.read` | Consulter les élèves **des classes où l'on est affecté** (règle de domaine : `people.isStaffAssignedToClassroom` + projection d'inscriptions) | |
| `student.anonymize` | Anonymiser un dossier archivé | oui |
| `student.self.read` / `student.child.read` | Mon dossier / celui de mes enfants | |
| `guardian.read` / `guardian.manage` | Tuteurs et liens | |
| `people.settings.manage` | Paramètres et référentiels du module | |

Alignement avec les rôles système : secrétariat `student.*`, `guardian.*` ; éducateur `student.read`, `guardian.read` ; parent `*.child.*` ; élève `*.self.*`. **Changement demandé à la spec 002** : le modèle de rôle `enseignant` reçoit `student.class.read` à la place de `student.read` / `student.list` (qui ouvrent tous les élèves du tenant, comme dans le legacy où tout utilisateur authentifié lisait toutes les fiches) ; les listes de classe d'un enseignant passent par `student.class.read`.

## 11. Événements

| Événement | Producteur | Consommateurs |
|---|---|---|
| `people.student.created` / `updated` | création / modification | 004, 007, 010, 014, 016, 025 |
| `people.student.status_changed` | `changeStudentStatus` | 004 (retrait des inscriptions), **002/iam (suspension de l'accès)**, 010, 014, 016 |
| `people.student.anonymized` | `anonymizeStudent` | 024 (purge des pièces), 025 |
| `people.guardian.created` / `linked` / `link_changed` / `unlinked` | tuteurs | 016, 014, 025 |

Consommés : `academic.enrollment.*` (projection `student_enrollment_summaries`, `first_enrolled_on`), `tenancy.tenant.provisioned` (instanciation des types de liens, motifs par défaut), `iam.membership.created|changed` (rattachement d'identité). Payloads versionnés `{ v: 1, studentId, … }` **sans donnée personnelle sensible**.

## 12. Tests

- **Unitaires** : générateur de motif de numéro (jetons, bornes), normalisation de noms, détection de doublons (permutations, accents, homonymes), machine d'états, `isGuardianOfStudent`, normalisation de téléphone.
- **Intégration** (Postgres) : les 17 comportements de `data-model.md` (numérotation gapless sous 50 concurrents, immuabilité du matricule, contact principal unique, RLS) ; atomicité de `createStudent` ; projection d'inscriptions par événements rejoués ; `rebuild` identique.
- **Isolation générique** : tables de `people` (008) soumises au test bloquant ; allowlist vide.
- **Sécurité** : matrice parent/élève × endpoints (aucun accès à un autre enfant ; 404 et non 403) ; aucune donnée sensible dans les listes ; aucun secret/mot de passe dans les réponses ni les journaux ; contrôle octets magiques.
- **Contrat** : conformité des adaptateurs `LearnerDirectory` et `StudentDirectory` à leurs ports.
- **Charge** : recherche p95 < 200 ms (20 000 élèves) ; création 100/s soutenue.
- **E2E** : « secrétariat crée un élève et ses deux tuteurs → invitation portail → le parent voit son enfant, pas un autre ».

## 13. Cas limites

- Élève sans tuteur (majeur) ; tuteur sans e-mail ni téléphone (alerte non bloquante) ; deux tuteurs principaux demandés (le second échoue, bascule explicite) ; lien expiré puis ré-établi (nouvelle ligne via `valid_to`).
- Jumeaux (même nom, même naissance) : doublon signalé, confirmation par motif.
- Même e-mail pour tous les enfants d'une famille ; même téléphone pour plusieurs tuteurs.
- Nom à particules/accents/tirets, apostrophes typographiques : normalisation de recherche, conservation à l'affichage.
- Date de naissance inconnue (admise avec indicateur) ; nationalité inconnue.
- Parent présent dans deux tenants avec la même e-mail : une identité `iam`, deux rattachements (ADR-008) ; aucune fusion de personnes entre tenants.
- Changement de pays du tenant : le pays de la nationalité par défaut change, pas les valeurs existantes.
- Élève `ARCHIVED` réinscrit : retour `ACTIVE` explicite avec motif ; même numéro.
- Photo corrompue, trop grande, faux type MIME : refusée avec message clair.
- Import de 5 000 élèves : lots de 200 en transaction, rapport d'erreurs par ligne, reprise sûre grâce à `externalRef`.
- Restauration/rejeu d'événements `academic.enrollment.*` : projection idempotente par `source_event_id`.

## 14. Dépendances

- **En amont** : 000 (kernel, DB, outbox), 001-003 (tenant, `CountryProfile`, modèles de pack), 002 (RBAC, `iam` : identité et invitation), 004 (événements d'inscription), 024 (documents, ultérieur ; interim `StoragePort`), 030 (audit).
- **En aval** : 004, 007, 010, 011, 013, 014, 016, 017, 025, 031.
- **Technique** : PostgreSQL 14+ (`pg_trgm`, `unaccent`), Zod, S3/MinIO, worker pour la reconstruction de projection.
- **Manifeste** : `key: "people"`, `packs: ["CORE"]`, `dependsOn: ["rbac"]` (les ports `AccountProvisioner`, `StoragePort` et `AcademicQuery` sont injectés, pas déclarés en dépendance de manifeste pour éviter les cycles avec academic).

## 15. Critères de sortie (mesurables)

1. Migrations 0800, 0801, 0804 appliquées de zéro ; isolation générique verte sur les tables concernées (deux tenants, zéro fuite).
2. Création d'un élève avec deux tuteurs, numéro gapless, historique de statut, événement outbox — le tout atomique ; 50 créations concurrentes = numéros contigus.
3. Matrice « parent / élève × endpoints » à 100 % ; aucune réponse n'expose champ sensible, mot de passe ou secret ; lecture sensible auditée.
4. `LearnerDirectory` (finance) et `StudentDirectory` (academic) branchés et vérifiés par test de contrat.
5. Projection d'inscriptions cohérente et reconstructible ; liste par classe < 5 s après événement.
6. Aucune suppression physique possible ; aucun `GET` n'écrit ; plus aucune autre numérotation que `people.next_number`.
7. Les tables legacy `student_profiles`, `student_parents`, `emergency_contacts`, `student_status_history`, `professional_student_matricules`, `registration_requests` (côté élève) et leurs routes sont supprimées dans la même tranche (2.2), sans lecture web de calcul métier.

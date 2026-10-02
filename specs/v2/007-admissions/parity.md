# Parité legacy — 007-admissions

**Périmètre** : tout ce que le legacy fait en matière de demandes d'inscription et de recrutement, avec son sort en v2 : **reproduit** (conservé), **amélioré** (même fond, défaut corrigé), **abandonné** (justifié), **hors module → NNN**, **nouveau** (sans équivalent).

**Constat.** Le legacy n'a **pas** de module d'admissions. Il a une table `registration_requests` (demandes **de comptes** élève ou parent déposées depuis le site public, approuvées ou rejetées par un administrateur), des analyses de recrutement pour le propriétaire et une prospection commerciale (provenance, commerciaux, commissions). Aucune capacité, aucune liste d'attente, aucune pièce justificative, aucun entretien, aucune décision tracée, aucun lien avec la facturation des frais d'inscription. Le workflow du PRD §9 est donc **nouveau** ; la parité porte sur les fonctions existantes et sur leurs défauts.

Références : `MIG` = `infra/scripts/migrations`, `RT` = `apps/api/src/routes`, `SVC` = `apps/api/src/services`. `S-*` renvoie à `specs/v2/008-students-guardians/parity.md` (lignes marquées « hors module → 007 »), `P-*`/`A-*` aux autres parités.

## 1. Tables

| ID | Table (réf.) | Sort | Cible v2 | Remarque |
|---|---|---|---|---|
| AD-01 | `registration_requests` (`MIG/0060_registration_requests.sql:12-64`) : `account_type` (`student`/`parent`), identité, `details` JSON, `status` (`pending`/`approved`/`rejected`), `review_notes`, `rejection_reason`, `reviewed_by/at`, `created_user_id` | **Amélioré** (éclatée) | `applications`, `application_guardians`, `consents`, `decisions`, `transitions` | La demande d'**un compte** devient la candidature d'**un enfant** ; le `JSON` libre est remplacé par des colonnes typées + `extra` validé ; statut en 8 statuts canoniques |
| AD-02 | Index « une demande `pending` par e-mail et tenant » (`uq_registration_requests_pending_email`) | **Remplacé** | Index « une candidature vivante par enfant et campagne » (`applications_one_live_per_child`) ; un seul prospect actif par e-mail | L'e-mail identifiait la demande (un parent = un e-mail) ; l'**enfant** est la bonne clé (fratrie sous un même e-mail) |
| AD-03 | `student_provenances` (`MIG/0120`, `0124`) : une provenance par étudiant | **Amélioré** | `applications.source_channel`, `referrer_label` ; `prospects.source_channel` | Donnée commerciale attachée à la **candidature**, pas au dossier permanent (008, S-102) |
| AD-04 | `commerciaux`, `commissions_versements` (`MIG/0120`) : commissions recalculées sur la scolarité encaissée × taux figé | **Abandonné** (hors plan) | — | Question Q-A17. Le **canal** est conservé ; les commissions (finance) ne sont pas reprises |

## 2. Fonctions et routes

| ID | Fonction legacy (réf.) | Comportement | Sort | Cible v2 | Remarque |
|---|---|---|---|---|---|
| AD-10 | Dépôt public `POST /auth/register-request` (`RT/auth.ts:192-354`) — S-002 | Schéma Zod ; tenant lu dans `request.tenantId` ; **`setRlsContext({ isSuperAdmin: true })`** ; refus 409 si un compte existe pour l'e-mail ; refus 409 si une demande est en attente ; refus si un e-mail d'enfant existe ; famille = 1 parent + N enfants dans `details.children` ; **aucun limiteur de débit ni CAPTCHA** ; erreurs 500 avec `error.message` brut | **Amélioré** | Formulaire public `POST /public/admissions/forms/:slug/applications` | Défauts **corrigés** : tenant résolu par jeton opaque ; contexte tenant normal (RLS **non** contournée) ; réponses **neutres** (les 409 révélaient l'existence d'un compte ou d'une demande : énumération) ; six couches anti-spam ; erreurs sans détail interne |
| AD-11 | Famille (parent + enfants) | Une seule demande « parent » portant les enfants en JSON ; l'administrateur valide la famille en bloc | **Amélioré** | **Une candidature par enfant**, tuteurs communs (`application_guardians`), décisions **par enfant** | Un enfant peut être admis, un autre en liste d'attente |
| AD-12 | Liste des demandes `GET /registration-requests` (`RT/registration-requests.ts:231-302`) — S-050 | Filtre par statut, pagination | **Conservé** | `GET /applications` | Filtres : campagne, statut canonique, étape, niveau, recherche ; permission `admission.read` (le legacy testait `admin`/`owner`/`super_admin` **y compris dans `availableRoles`**, escalade possible : S-052/008) |
| AD-13 | Détail `GET /registration-requests/:id` (`:305-322`) — S-051 | | **Conservé** | `GET /applications/:id` | + pièces, entretiens, décisions, historique |
| AD-14 | Approbation `POST /:id/approve` (`:325-576`) — S-052 | Crée l'utilisateur, le rôle, `student_profiles`, **matricule 5 chiffres `MAX+1` depuis 10001** ; mot de passe aléatoire (`Math.random`) **stocké en clair** (`initial_password`) et envoyé par e-mail ; élève parent/enfant ; lien « parent seul » par `childMatricule` **ignoré sans erreur** ; `relationship`/`profession` **perdus** ; `phone` > 20 caractères faisait échouer toute l'approbation ; sexe par défaut `masculin` | **Amélioré** | Décision `ACCEPT` → offre → **saga d'inscription** (spec §7) | Défauts **corrigés** : matricule par `people` (compteur transactionnel sans trou, 008) ; **aucun compte** créé à l'approbation, **aucun mot de passe** en clair ; relation et profession **conservées** (`application_guardians`) ; sexe réel ; téléphone validé au dépôt ; l'élève est créé **à l'acceptation de l'offre**, pas à l'approbation |
| AD-15 | Rejet `POST /:id/reject` (`:579-626`) — S-053 | Motif **libre** | **Amélioré** | Décision `REJECT` avec **motif codé** (`decision_reasons`) + texte interne | Le motif communiqué à la famille est le libellé neutre du code |
| AD-16 | Comptes éligibles `GET /accounts` (`:629-693`) — S-054 | Détourné de son nom | **Hors module → 008** | Filtre `portalAccount` des listes de `people` | |
| AD-17 | Envoi groupé d'identifiants `POST /send-credentials` (`:696-812`) — S-055 | Réinitialise en silence les mots de passe et les envoie **en clair** | **Abandonné** | `iam` : invitations (008 `provisionPortalAccount`) | Aucun mot de passe transmis ; action explicite |
| AD-18 | Création d'une demande avec **compte déjà existant** : 409 | Révèle l'existence d'un compte | **Abandonné** | Réponse neutre ; rapprochement **interne** de doublons | |
| AD-19 | Capacité de classe au moment de l'inscription (refus au-delà, `programmes.capacity`) — T-02 | Contrôle au moment de l'inscription d'un élève | **Conservé** (côté `academic`) | `academic.classrooms.capacity` + **nouvelle** capacité d'admission par niveau (`intake_capacities`) | Deux niveaux distincts : places **de campagne** (admission) et **de classe** (inscription) |

## 3. Analyses de recrutement (`SVC/owner-recrutement.service.ts`)

| ID | Indicateur legacy (ligne) | Sort | Cible v2 |
|---|---|---|---|
| AD-30 | Demandes reçues, traitées, approuvées (`:97-113`) | **Conservé** | Entonnoir par statut canonique et campagne |
| AD-31 | Délai moyen de traitement (`reviewed_at − created_at`, `:111`) | **Amélioré** | Délais par **étape** (`transitions`), SLA par étape |
| AD-32 | Série hebdomadaire des demandes (`:142-145`) | **Conservé** | `reports/funnel?by=week` |
| AD-33 | Répartition par statut (`:157-158`) | **Conservé** | Entonnoir |
| AD-34 | Tranches de délai `<24 h`, `1-3 j`, `3-7 j`, `>7 j` (`:171-186`) | **Conservé** | `reports/sla` (mêmes tranches, paramétrables) |
| AD-35 | Principaux motifs de refus, `TRIM(rejection_reason)` (`:196`) | **Amélioré** | `reports/rejections` par **motif codé** (le texte libre n'est plus agrégé) |
| AD-36 | Répartition par niveau demandé (`details->>'currentYear'`, `:214`) | **Amélioré** | Par `desired_grade_level_code` (code, pas texte libre) |
| AD-37 | Hypothèse implicite : le niveau actuel de l'élève (`current_year`) = niveau demandé | **Abandonné** | `previous_grade_level_code` et `desired_grade_level_code` distincts | |

## 4. Données d'inscription portées par le legacy et reprises par d'autres specs

| ID | Donnée legacy | Sort | Cible |
|---|---|---|---|
| AD-40 | `student_profiles.establishment_matricule` (5 chiffres, 10001+) | **Hors module → 008** | `people.students.student_number` (motif configurable, compteur sans trou) |
| AD-41 | `student_enrollments.affectation_status`, `affectation_decision`, `cepe_code` | **Hors module → 004 / 018** | `enrollments.funding_type` + `assignment_reference` ; `examinations.candidate_identifiers` |
| AD-42 | Frais d'inscription et paiement (`orders` / paiements legacy) | **Hors module → 014** | `finance` : ligne `REGISTRATION` ; confirmation par `academic` après paiement |

## 5. Fonctions NOUVELLES (sans équivalent legacy)

| ID | Fonction |
|---|---|
| N-01 | Workflow personnalisable, versionné, validé à la publication (étapes + 8 statuts canoniques) |
| N-02 | Campagnes d'admission, capacités par niveau, politique HARD/SOFT/NONE, concurrence maîtrisée |
| N-03 | Pièces justificatives exigées par niveau et financement, relecture, état des manques |
| N-04 | Tests et entretiens (résultat saisi, sans seuil) |
| N-05 | Décision formelle journalisée (type, motif codé, identité figée) et journal des transitions en ajout seul |
| N-06 | Liste d'attente à classes de priorité, plafond, promotion manuelle ou automatique |
| N-07 | Offre à lien à usage unique, expiration, acceptation par délégation avec pièce |
| N-08 | Saga d'inscription (élève, tuteurs, inscription, facture) et confirmation automatique après paiement |
| N-09 | Détection de doublons (candidatures, élèves, prospects) |
| N-10 | Consentement parental versionné et prouvable |
| N-11 | Notifications idempotentes sans simulation |
| N-12 | Anonymisation des dossiers clos, droit d'accès |
| N-13 | Prospects et conversion |

## 6. Défauts du legacy explicitement NON reproduits

1. **Compte et dossier élève créés à l'approbation** avec mot de passe aléatoire non cryptographique (`Math.random`) **stocké en clair** et **envoyé par e-mail** (AD-14, AD-17).
2. **Matricule `MAX + 1` non transactionnel** (deux approbations simultanées → doublon) (AD-14).
3. **Contexte RLS super-administrateur** sur une route **publique** ; tenant lu sans vérification (AD-10).
4. **Énumération** : 409 « un compte existe », « une demande est en cours » (AD-10, AD-18).
5. **Aucun limiteur de débit, aucun CAPTCHA** sur le dépôt public ; erreurs 500 avec message brut (AD-10).
6. **Perte de données** : `relationship`, `profession` ignorées ; lien par `childMatricule` ignoré sans retour d'erreur (AD-14).
7. **Échec global** pour un téléphone trop long ; sexe par défaut inventé (AD-14).
8. **Motif de refus libre** agrégé par texte (AD-15, AD-35).
9. **Aucun consentement tracé**, aucune durée de conservation, demandes jamais purgées (008, parity §données personnelles).
10. **Contrôle d'accès par rôles lus dans `availableRoles`** (escalade possible) (AD-12).

## 7. Synthèse

| Statut | Nombre | IDs |
|---|---|---|
| Conservé | 7 | AD-12, AD-13, AD-19 (côté `academic`), AD-30, AD-32, AD-33, AD-34 |
| Amélioré | 9 | AD-01, AD-03, AD-10, AD-11, AD-14, AD-15, AD-31, AD-35, AD-36 |
| Remplacé | 1 | AD-02 |
| Abandonné | 4 | AD-04, AD-17, AD-18, AD-37 |
| Hors module | 4 | AD-16, AD-40, AD-41, AD-42 |
| Nouveau | 13 | N-01 à N-13 |

Total : 25 lignes d'inventaire + 13 fonctions nouvelles ; les défauts non reproduits sont récapitulés au §6.

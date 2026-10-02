# Feature Specification: Admissions (007-admissions)

**Feature Branch**: `007-admissions`

**Created**: 2026-10-02

**Status**: Rédigée — DDL de référence exécuté et testé (174 tests de comportement dont essais de concurrence réels, `ddl/`), prête pour `/speckit.plan`

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §9 (admissions), §10, §20, §47, §57 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.4, §3.10, §3.11, §4 (Phase 4), §8 ; `specs/v2/DECISIONS-METIER.md` (confirmation d'une inscription **automatique après paiement des frais d'inscription**, 2026-10-01) ; `docs/architecture/module-conventions.md` ; specs `004` (`enrollStudent`, `checkOfferingEligibility`, politique de confirmation), `008` (`createStudent`, `findDuplicateStudents`, `createGuardian`, `linkGuardian`, `provisionPortalAccount`), `014` (frais d'inscription, `finance.invoice.paid`), `016` (messagerie), `005`, `018` ; legacy `registration_requests` (`MIG/0060`, `RT/registration-requests.ts`, `RT/auth.ts`), `owner-recrutement.service.ts`, prospection (`MIG/0120`).

> **Aucune règle réglementaire n'est inventée.** Capacités, priorités de la liste d'attente, durée de validité d'une offre, pièces exigées, durée de conservation des dossiers refusés, âge minimal d'un niveau sont des **données ou des politiques d'établissement**, jamais des constantes. Les questions d'ordre légal ou administratif sont dans `open-questions.md`.

## 1. Rôle du module : orchestrer, ne pas dupliquer

`admissions` possède **le dossier de candidature et ses décisions** — et rien d'autre. Il **orchestre** les briques existantes à l'étape qui les concerne :

| Étape du parcours (PRD §9) | Propriétaire | Appel |
|---|---|---|
| Prospect → candidature → dossier | **admissions** | tables `prospects`, `applications`, `application_guardians` |
| Pièces justificatives | **admissions** (états) ; stockage = port `DocumentStore` (spec 024 `documents`, repli `StoragePort`) | `application_documents` |
| Étude, test, entretien | **admissions** | `interviews`, workflow |
| Décision (admis, refusé, liste d'attente) | **admissions** | `decisions` (journal), `workflow_transitions` |
| Doublons | `people.findDuplicateStudents` + **admissions** (candidatures) | `duplicate_candidates` |
| Offre et acceptation par la famille | **admissions** | `offers` (lien à usage unique) |
| Création du dossier permanent de l'élève et matricule | `people.createStudent`, `createGuardian`, `linkGuardian` (008) | à l'**acceptation de l'offre** (voir §7) |
| Inscription dans une classe | `academic.enrollStudent` (004) → inscription `PENDING` | idem |
| Frais d'inscription | `finance` (014) : facture, paiement ; événement `finance.invoice.paid` | idem |
| Confirmation de l'inscription | `academic` (politique `ON_REGISTRATION_FEE_PAID`, décision métier du 2026-10-01) | événement `academic.enrollment.confirmed` |
| Passage au statut `ENROLLED` | **admissions** (consomme la confirmation) | transition système |
| Notifications aux familles | port `ApplicantNotifier` (canaux externes, chantier distinct) ; `messaging` pour le personnel et les comptes existants | `notification_log` |
| Classe et appel dès le premier jour | `academic`, `attendance` | via l'inscription |

## 2. Objectifs

1. Un **workflow personnalisable par établissement**, versionné, validé à la publication, dont les **huit statuts du PRD** (DRAFT, SUBMITTED, UNDER_REVIEW, MISSING_DOCUMENT, ACCEPTED, REJECTED, WAITLISTED, ENROLLED) restent le **contrat stable** (événements, statistiques) pendant que chaque école définit ses propres **étapes**.
2. Un **formulaire public** de candidature par établissement, **sans exposer de donnée sensible**, protégé du spam, avec consentement parental tracé.
3. Une **capacité par niveau** respectée même sous concurrence, une **liste d'attente prioritaire**, un **journal de décisions** infalsifiable.
4. Un passage **atomique** de « offre acceptée » à « élève + inscription + facture » (ou rien), et une **confirmation automatique après paiement**.
5. Des **doublons** détectés, des **données personnelles d'enfants** minimisées, conservées selon une durée **configurable**, anonymisables.
6. Parité avec le legacy (`registration_requests`, analyse du recrutement) **sans** ses défauts (comptes créés avant décision, mots de passe en clair, matricule non transactionnel).

## 3. Périmètre

### Inclus

Workflow, campagnes, capacités, prospects, candidatures, tuteurs, consentements (textes versionnés), pièces, tests et entretiens, décisions, offres, liste d'attente, doublons, notifications (journal et port), formulaire public, suivi par code, anonymisation, tableaux de bord de recrutement, orchestration de l'inscription (saga §7), travaux planifiés (expiration des offres, délai de paiement, purge).

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Dossier permanent de l'élève, matricule, tuteurs permanents | 008 |
| Inscription, classe, financement, reconduction annuelle des élèves **déjà inscrits** | 004 |
| Barèmes, factures, paiements, remboursements, remises de fratrie | 014 / 015 |
| Gestion documentaire (versions, antivirus, signatures) | 024 (port prévu ici) |
| Canaux e-mail / SMS / WhatsApp / push | chantier « canaux externes » (016, §3.11 du plan) |
| Import de listes d'affectation ou de candidats | 031 (la candidature `created_via = IMPORT` est prévue) |
| Commissions des apporteurs d'affaires (`commerciaux`, `commissions_versements`) | **hors plan** (question Q-A17) ; le **canal** d'acquisition est conservé |
| Examens (CEPE, BEPC, BAC) | 018 |
| Règles d'âge d'entrée, tests d'entrée **obligatoires** | questions Q-A06, Q-A07 (aucune règle supposée) |

## 4. Acteurs

| Acteur | Rôle |
|---|---|
| Visiteur / famille (anonyme) | Dépose une candidature, suit son dossier par code, dépose des pièces, répond à une offre par lien à usage unique |
| Responsable des admissions / secrétariat | Saisit, étudie, demande des pièces, planifie, propose, gère la liste d'attente |
| Directeur / directrice | Décide (admis, refusé, liste d'attente), autorise un dépassement de capacité, publie le workflow |
| Enseignant / directeur des études | Conduit un test ou un entretien |
| Économe | Voit l'état du paiement des frais d'inscription (via `finance`) |
| Super-administrateur | Fournit les modèles de workflow ; n'intervient pas dans les dossiers |

## 5. User stories et critères d'acceptation

### US1 — Workflow personnalisable (P1)

En tant que directeur, je veux décrire le parcours d'admission de mon établissement.

- **AC1.1** Un workflow est un ensemble d'**étapes** (code, libellé, statut canonique parmi les 8, drapeaux) et de **transitions** (étape de départ, étape d'arrivée, permission requise, motif requis, automatique ou non). Les 8 statuts sont les **seuls** statuts exposés aux événements et statistiques ; une école peut avoir 3 étapes `UNDER_REVIEW` (« Dossier complet », « Entretien », « Commission »).
- **AC1.2** À la **publication**, la base valide (déclencheur) : une et une seule étape initiale (statut `DRAFT`) ; au moins une étape `SUBMITTED`, `ACCEPTED`, `REJECTED`, `ENROLLED` ; **une seule** étape `ENROLLED`, terminale, atteinte **uniquement** depuis l'étape qui crée l'inscription ; **exactement une** étape « crée l'inscription » ; toute étape non terminale a une issue ; aucune sortie d'une étape terminale ; toute étape est atteignable depuis l'initiale ; une étape à décision formelle existe pour `ACCEPTED` et `REJECTED`. Chaque refus a un code `admissions.workflow_*` (testé).
- **AC1.3** Un workflow publié est **figé** (étapes, transitions, libellé) ; modifier = créer la **version suivante** ; les dossiers restent épinglés à la version qui les a créés ; une campagne ne s'ouvre qu'avec un workflow publié et ne change plus de workflow après.
- **AC1.4** Un établissement part d'un **modèle de workflow** livré en donnée (`tenancy.institution.created`) : étapes `DRAFT → SUBMITTED → UNDER_REVIEW ⇄ MISSING_DOCUMENT → ACCEPTED | WAITLISTED | REJECTED`, `ACCEPTED → AWAITING_PAYMENT → ENROLLED`, `WITHDRAWN` (statut canonique `REJECTED`, clôture « retirée par la famille »). Il le modifie par copie.
- **AC1.5** Un seul workflow publié par établissement et par cycle d'enseignement (ou général) ; deux publications concurrentes : l'une est refusée.

### US2 — Campagnes et capacités (P1)

- **AC2.1** Une campagne (établissement, année académique, dates, workflow) a des **capacités par niveau** (et, au choix, par programme) et une limite facultative de liste d'attente ; l'absence de ligne signifie « pas de plafond configuré » (signalé dans les tableaux de bord).
- **AC2.2** La politique de capacité de l'établissement est `HARD` (refus), `SOFT` (dépassement motivé : motif ≥ 10 caractères, décision à `override_capacity`, permission sensible `admission.capacity.override`) ou `NONE`. Une place est occupée par tout dossier dans une étape **qui réserve une place** (`holds_seat`), de l'admission à l'inscription ; un retrait ou une offre expirée la libère.
- **AC2.3** **Concurrence** : 2 dossiers visant la dernière place, traités en parallèle par deux sessions : **exactement un** réussit, l'autre reçoit `admissions.capacity_full` (test à deux sessions réelles).

### US3 — Prospects (P2)

- **AC3.1** Un prospect (contact, niveau d'intérêt, canal, référent) est créé en secrétariat ou par le formulaire de contact ; **un seul prospect actif par e-mail** (insensible à la casse) ; `CONVERTED` exige la candidature créée, `LOST` exige un motif.
- **AC3.2** La conversion d'un prospect crée la candidature pré-remplie, conserve le canal et marque le prospect `CONVERTED` dans la même transaction.

### US4 — Formulaire public de candidature (P1)

En tant que parent, je veux déposer le dossier de mon enfant depuis un lien que l'école m'a donné.

- **AC4.1** **Un lien par établissement** : un jeton opaque de ≥ 96 bits (16 à 40 caractères `a-z0-9`) résolu avant tout contexte tenant (`public_form_index`, table globale sans donnée personnelle, lecture ouverte, écriture limitée au tenant propriétaire). Désactiver le lien (`enabled = false`) ou le paramètre `public_form_enabled` ferme la candidature publique immédiatement.
- **AC4.2** `GET` du formulaire renvoie **uniquement** : nom public de l'établissement, niveaux ouverts (libellés), libellés des pièces attendues, texte et version du consentement, paramètres d'anti-spam. **Jamais** : capacités, effectifs, places restantes, liste d'attente, autres candidats, identifiants internes.
- **AC4.3** **Anti-spam, six couches** : (1) jeton de formulaire à usage unique, empreinte SHA-256 seule stockée, expirant, valable **après** un délai minimal (`minimum_form_seconds`) ; (2) champ leurre (honeypot) ; (3) limiteur de débit par empreinte d'IP (`runtime.rateLimiter`, Redis) **et** comptage en base des tentatives récentes ; (4) CAPTCHA si l'établissement l'exige (`captcha_required`) ; (5) schéma Zod strict (aucune clé inconnue, longueurs, formats, plausibilité des dates) ; (6) une confirmation au plus par contact et par jour (`notification_log`, `dedupe_key`), pour ne pas servir de relais de spam. IP et agent ne sont **jamais** stockés en clair (empreintes HMAC, `ip_hash`, `ua_hash`).
- **AC4.4** La réponse à un dépôt contient **uniquement** un **code de suivi** opaque et un message neutre ; elle ne révèle pas si l'enfant a déjà une candidature (pas d'énumération) ; un doublon exact dans la campagne est signalé en interne seulement.
- **AC4.5** **Consentement parental** : le dépôt exige l'acceptation du texte en vigueur par un tuteur déclaré **habilité** (`can_consent`) ; la ligne de consentement garde la version du texte, la date, la voie (`PUBLIC_FORM`, `STAFF_ON_BEHALF`, `PAPER` avec pièce justificative obligatoire) et les empreintes ; elle ne s'efface jamais, un retrait est une mise à jour unique. Sans consentement valide, la candidature ne quitte pas `DRAFT` (déclencheur).
- **AC4.6** Performances : p95 < 300 ms au dépôt ; 100 dépôts/min par tenant sans perte ; refus du 6ᵉ dépôt d'une même IP en 10 minutes (valeur par défaut, paramétrable).

### US5 — Dossier et pièces justificatives (P1)

- **AC5.1** Les pièces exigées sont des **données** de l'établissement (`document_requirements`) : par niveau, par type de financement (ex. la décision d'affectation pour `STATE_ASSIGNED`), obligatoire ou non, types MIME et taille maximale.
- **AC5.2** `missing_required_documents` (fonction SQL, testée) liste les codes des pièces **obligatoires et applicables** non encore **acceptées** ; une pièce déposée mais non relue reste manquante ; un rejet exige un motif et un relecteur.
- **AC5.3** Le dépôt d'un fichier (famille ou secrétariat) contrôle le **type réel** (octets), la taille, l'empreinte SHA-256 ; il passe par le port `DocumentStore` ; la famille ne voit jamais la pièce d'un autre dossier (accès par code de suivi + hash).
- **AC5.4** À l'inscription, les pièces sont **rattachées** au dossier permanent de l'élève (`DocumentStore.link`) ; aucune copie n'est faite hors de ce port.

### US6 — Étude, pièces manquantes, test et entretien (P1)

- **AC6.1** Passer en `MISSING_DOCUMENT` notifie la famille avec la **liste des libellés** manquants ; revenir en `UNDER_REVIEW` après dépôt est une transition du workflow.
- **AC6.2** Un test ou entretien (`interviews`) a un type, une date, un lieu, un examinateur, un statut et un **résultat saisi** (`PASSED`, `FAILED`, `NOT_APPLICABLE`) ; **aucun seuil** de réussite n'est calculé. Une étape qui exige un entretien terminé (`requires_interview_done`) refuse l'entrée sans lui.
- **AC6.3** Un `SLA` facultatif par étape (`sla_hours`) alimente le rapport de délais ; un dossier hors délai est signalé, jamais bloqué.

### US7 — Décision formelle et journal (P1)

- **AC7.1** Entrer dans une étape à décision (`requires_decision`) exige une ligne de `decisions` **insérée avant, dans la même transaction** (`xid`), dont l'étape de départ est **l'étape courante** du dossier, la transition **existe**, et le **type** (`ACCEPT`, `REJECT`, `WAITLIST`, `WITHDRAW`, `RECONSIDER`) correspond au statut canonique visé. Un refus et un retrait citent un **motif codé** ; un dépassement de capacité cite un motif ≥ 10 caractères.
- **AC7.2** `decisions` et `transitions` sont **en ajout seul** (déclencheurs ; `app_user` n'a aucun droit d'`UPDATE`/`DELETE`). Chaque changement d'étape écrit **automatiquement** une ligne de `transitions` (acteur ou `SYSTEM`), quel que soit le code appelant.
- **AC7.3** L'identité du décideur est **figée** (`decided_by_name`) ; la décision porte la version du workflow par l'étape.
- **AC7.4** Le motif de refus communiqué à la famille est **neutre et validé** (libellé du motif codé) ; le détail interne n'est jamais exposé par le suivi public.

### US8 — Liste d'attente et priorités (P1)

- **AC8.1** L'ordre est : **rang de la classe de priorité** (donnée de l'établissement : fratrie, enfant du personnel, affectation d'État, standard…), puis **date d'entrée**, puis identifiant (`waitlist_order`, testé). Une priorité absente passe après toutes les classes déclarées.
- **AC8.2** Plafond facultatif de liste d'attente par niveau (`waitlist_limit`) ; au-delà : `admissions.waitlist_full`.
- **AC8.3** Quand une place se libère (retrait, offre expirée, délai de paiement dépassé) : `waitlist_promotion = MANUAL` → alerte et bouton « proposer la place » ; `AUTO` → offre proposée au premier de la liste (la candidature repasse `ACCEPTED` avec décision système) ; dans les deux cas **une seule** place est offerte une seule fois (concurrence testée).

### US9 — Offre, acceptation, paiement, confirmation (P1)

- **AC9.1** Une **offre** porte le niveau, la **classe visée**, une échéance (`offer_validity_days`, 14 par défaut, politique d'établissement), des conditions facultatives et un **lien de réponse à usage unique** envoyé au tuteur principal (seule l'**empreinte** est stockée). Une seule offre en attente par candidature ; accepter exige la date, le tuteur répondant et la classe.
- **AC9.2** `acceptOffer` (saga §7) crée, **dans une transaction**, l'élève et ses tuteurs (`people`), l'inscription `PENDING` (`academic`), la facture des frais d'inscription (`finance`), puis place le dossier dans l'étape qui crée l'inscription. Si une étape échoue (ex. `finance` indisponible), **rien** n'est créé et l'offre reste en attente (rejouable, idempotent par offre).
- **AC9.3** L'étape qui crée l'inscription n'est franchie que si : une offre est `ACCEPTED` avec classe, l'élève et l'inscription existent, et — politique `BLOCK` — aucun doublon ouvert.
- **AC9.4** **Confirmation automatique après paiement** (décision du 2026-10-01) : `finance.invoice.paid` (enrichi : `enrollmentId`, `containsRegistrationFee`) fait confirmer l'inscription par `academic` ; l'événement `academic.enrollment.confirmed` est consommé par `admissions`, qui pose `enrollment_confirmed_at`, passe le dossier à `ENROLLED` (acteur `SYSTEM`) et active l'élève ; `ENROLLED` **exige** `enrollment_confirmed_at` (contrainte). Si **aucun** frais d'inscription n'est dû (`isRegistrationFeeDue = false`), la confirmation est immédiate.
- **AC9.5** Délai de paiement (`payment_deadline_days`, **vide** par défaut : question Q-A05) : au-delà, le travail planifié annule l'inscription en attente (`academic`) et la facture (`finance`), clôt le dossier (« offre expirée », décision système) et libère la place ; sans délai configuré, aucune annulation automatique.
- **AC9.6** Une offre expirée n'est plus acceptable (`admissions.offer_expired`) ; le travail planifié `expireOffers` passe les offres `PENDING` échues à `EXPIRED`, clôt le dossier et libère la place.

### US10 — Matricule, classe, premier jour (P1)

- **AC10.1** Le matricule (`student_number`) est attribué **par `people`** à la création de l'élève (compteur transactionnel sans trou, 008) ; le numéro d'inscription par `academic` (registre) ; `admissions` ne génère **aucun** matricule.
- **AC10.2** Le dossier `ENROLLED` ne change plus ; l'identité du candidat est **gelée** une fois l'élève créé (la source de vérité devient `people`) ; la classe est celle de l'offre ; l'élève apparaît dans le registre de classe (`academic.getRoster`) dès la confirmation.
- **AC10.3** Les tuteurs du dossier deviennent des tuteurs permanents avec drapeaux (principal, répondant financier) ; l'invitation à un compte de portail est une action explicite (`provisionPortalAccount`), jamais automatique, **jamais de mot de passe transmis**.

### US11 — Doublons (P1)

- **AC11.1** À la soumission puis avant l'inscription, le module rapproche : (a) autres candidatures (clé normalisée nom + prénom + naissance, accents et casse ignorés) ; (b) élèves existants (`people.findDuplicateStudents`) ; (c) prospects. Les résultats sont des **candidats de doublon** (score, raisons) à trancher (`OPEN`, `CONFIRMED_DUPLICATE`, `DISMISSED` avec relecteur).
- **AC11.2** Le **même enfant** ne peut avoir qu'une candidature vivante par campagne (index unique partiel sur la clé d'identité ; un refus ou un retrait libère le droit de redéposer) ; la politique `BLOCK` empêche l'inscription tant qu'un rapprochement est ouvert ; `WARN` signale ; `OFF` désactive.
- **AC11.3** Un élève **déjà inscrit** à l'établissement qui candidate de nouveau (changement de niveau, retour) est rapproché de son dossier permanent : **aucun nouvel élève** n'est créé (réutilisation de `studentId`).

### US12 — Notifications (P2)

- **AC12.1** Une étape peut porter un gabarit de notification (`notify_template_code`) ; chaque envoi est une ligne de `notification_log` **idempotente** (`dedupe_key`) : canal, gabarit, statut `QUEUED/SENT/FAILED/SKIPPED`, référence fournisseur. L'adresse du destinataire n'est **pas** stockée (résolue à l'envoi depuis le tuteur).
- **AC12.2** Aucun canal externe n'existant encore, un envoi sans canal est `SKIPPED` avec `error_code = CHANNEL_UNAVAILABLE` et un indicateur « à contacter par téléphone » dans l'écran : **aucune simulation** d'envoi en production (plan §3.11).
- **AC12.3** Le personnel est prévenu par `messaging` (annonce ciblée par rôle « admissions ») à chaque nouvelle candidature et à chaque offre expirée.

### US13 — Données personnelles et conservation (P1)

- **AC13.1** Les données d'identité du candidat et les contacts des tuteurs ne figurent **jamais** dans un événement, un journal d'audit, un message système ni un log (identifiants et codes seulement).
- **AC13.2** Un dossier **clos sans inscription** (refusé, retiré, offre expirée) est **anonymisé** à l'échéance de `rejected_retention_months` (**vide** par défaut : question Q-A04 ; aucune purge tant qu'il est vide) ou sur demande motivée (`admission.anonymize`, sensible, MFA, audit) : nom, naissance (ramenée à l'année), tuteurs, pièces, champs libres sont neutralisés ; décisions, dates et compteurs (sans nom) sont conservés ; un dossier inscrit n'est **jamais** anonymisé ici (voir 008 `anonymizeStudent`). L'anonymisation est atomique et idempotente (fonction SQL testée).
- **AC13.3** Droit d'accès : export du dossier d'un candidat (identité, tuteurs, consentements, pièces, décisions, historique) pour la direction ; la famille consulte son dossier par le suivi (statut, pièces) ; aucune information sur d'autres candidats.

### US14 — Élèves affectés par l'État à l'admission (P2)

- **AC14.1** Une candidature peut déclarer `funding_type_requested = STATE_ASSIGNED` ; la **référence d'affectation** est alors obligatoire (contrainte) et la pièce « décision d'affectation » devient exigée si l'établissement l'a déclarée (donnée). La fonction `academic.state-assigned` doit être active pour le tenant (`requireFeature`).
- **AC14.2** À l'inscription, le type de financement et la référence sont portés par `academic.enrollments` (004) ; **aucun montant** État/parent n'est saisi ici (014).
- **AC14.3** La classe de priorité « affectation d'État » est une **donnée** de l'établissement ; une admission hors capacité d'un élève affecté suit la politique de capacité (`SOFT` + motif) — l'obligation éventuelle d'accueil est une question (Q-A12), pas une règle supposée.

### US15 — Tableaux de bord de recrutement (P2)

- **AC15.1** Entonnoir par campagne et niveau : effectifs par **statut canonique**, taux de passage entre statuts, délais moyens par étape (`transitions`), répartition par canal d'acquisition, motifs de refus, places restantes (`seats_left`), longueur de la liste d'attente.
- **AC15.2** Ces rapports **reproduisent** ceux du legacy (`owner-recrutement.service.ts` : reçues, traitées, délai moyen de traitement, séries hebdomadaires, tranches de délai `<24 h`, `1-3 j`, `3-7 j`, `>7 j`, principaux motifs de refus, répartition par niveau) et s'y ajoutent ; ils ne contiennent aucun nom.

## 6. Statuts canoniques et workflow de départ

```
DRAFT ─► SUBMITTED ─► UNDER_REVIEW ◄─► MISSING_DOCUMENT
                           │
          ┌────────────────┼───────────────────┐
          ▼                ▼                   ▼
      ACCEPTED        WAITLISTED          REJECTED (terminal : « refusée par l'école »)
          │  ▲              │
          │  └──────────────┘ (promotion)
          ▼
   AWAITING_PAYMENT  (statut canonique ACCEPTED, crée l'élève et l'inscription)
          │            └──► WITHDRAWN (statut canonique REJECTED, « retirée par la famille » / offre expirée)
          ▼
      ENROLLED (terminal, exige la confirmation de l'inscription)
```

| Étape (modèle) | Statut canonique | Drapeaux |
|---|---|---|
| `DRAFT` | DRAFT | initiale |
| `SUBMITTED` | SUBMITTED | exige le consentement |
| `UNDER_REVIEW`, `MISSING_DOCUMENT` | UNDER_REVIEW, MISSING_DOCUMENT | — |
| `ACCEPTED` | ACCEPTED | décision formelle, pièces complètes, **réserve une place** |
| `AWAITING_PAYMENT` | ACCEPTED | réserve une place, **crée l'inscription** |
| `WAITLISTED` | WAITLISTED | décision formelle |
| `REJECTED` | REJECTED | décision formelle, terminale (`REJECTED_BY_SCHOOL`) |
| `WITHDRAWN` | REJECTED | décision formelle, terminale (`WITHDRAWN_BY_FAMILY`, `OFFER_EXPIRED`, `NO_SHOW`, `DUPLICATE`) |
| `ENROLLED` | ENROLLED | terminale, réserve une place |

La séparation « statut canonique » (8, contrat) et « étape » (donnée) permet à une école d'ajouter « Commission d'admission » ou « Test d'entrée » sans changer un seul événement ni une statistique ; elle rend aussi lisible la distinction **refus** / **retrait** / **offre expirée** (même statut canonique `REJECTED`, `closure_kind` distinct).

## 7. Orchestration de l'inscription (saga)

**`acceptOffer(offerId, via)`** — une seule transaction `TenantDb`, appels aux ports **séquentiels sur la même connexion**, clé d'idempotence = identifiant de l'offre.

1. Verrouiller l'offre et le dossier ; vérifier : offre `PENDING` non expirée, dossier à l'étape `ACCEPTED`, consentement valide, pièces acceptées, classe visée présente.
2. **Doublons** : `people.findDuplicateStudents` (+ candidatures) ; politique `BLOCK` et rapprochement ouvert → arrêt (`admissions.duplicates_pending`).
3. `people.createStudent` (statut **INACTIVE** jusqu'à la confirmation — demande 008) **ou** réutilisation d'un `studentId` existant ; `createGuardian` + `linkGuardian` pour chaque tuteur (relation, principal, répondant financier).
4. `academic.enrollStudent({ studentId, classroomId, fundingType, assignmentReference, source: ADMISSION })` → inscription `PENDING` (capacité de **classe** vérifiée par `academic`, distincte de la capacité de **campagne**).
5. `finance` : `getRegistrationFeeStatus` ; si des frais d'inscription sont dus → facture (`issueInvoiceFromSchedule`, ligne de catégorie `REGISTRATION`) → `invoice_id` ; sinon aucune facture.
6. Offre `ACCEPTED` (tuteur répondant, date, classe) ; dossier → étape `AWAITING_PAYMENT` avec `student_id`, `enrollment_id`, `invoice_id` ; événements `admissions.offer.accepted`.
7. **Si aucun frais n'est dû** : `academic` confirme immédiatement (politique) → étape 9.
8. **À la réception de `finance.invoice.paid`** → `academic` confirme (politique `ON_REGISTRATION_FEE_PAID`).
9. **À la réception de `academic.enrollment.confirmed`** : dossier → `ENROLLED` (SYSTEM), `enrollment_confirmed_at` ; `people.changeStudentStatus(ACTIVE)` ; pièces rattachées au dossier de l'élève ; notification « inscription confirmée ».

**Échec** à n'importe quelle étape 1 à 6 : transaction annulée, aucun élève, aucune inscription, aucune facture, offre inchangée ; erreur renvoyée avec code stable ; l'appel est rejouable. **Échec après 6** : les consommateurs d'événements sont idempotents (`event.id`) ; la confirmation tardive ou en double ne produit qu'un seul passage à `ENROLLED`.

**Compensation** (délai de paiement dépassé, retrait de la famille avant paiement) : `academic.cancelEnrollment` (PENDING → CANCELLED), `finance.cancelInvoice`, élève laissé `ARCHIVED` (jamais supprimé : son matricule reste consommé), dossier clos par une décision `WITHDRAW` système ; **aucun numéro n'est réutilisé**.

## 8. Modèle de données

Voir `data-model.md` (DDL de référence **exécuté et testé** sur PostgreSQL 17, 174 tests dont concurrence réelle à plusieurs sessions). Schéma `admissions`, migrations `1900`–`1902` (plage `1900–1999`).

| Table | Rôle |
|---|---|
| `settings`, `priority_classes`, `decision_reasons`, `consent_texts` | Paramètres et données d'établissement ; textes de consentement versionnés (preuve) |
| `workflows`, `workflow_stages`, `workflow_transitions` | Workflow versionné, validé à la publication |
| `campaigns`, `intake_capacities`, `document_requirements` | Campagnes, capacités par niveau, pièces exigées |
| `prospects`, `applications`, `application_guardians`, `consents` | Candidatures et personnes |
| `application_documents`, `interviews`, `offers` | Pièces, tests/entretiens, offres |
| `decisions`, `transitions` | Journaux en ajout seul |
| `duplicate_candidates`, `notification_log`, `number_sequences` | Doublons, notifications idempotentes, numérotation sans trou |
| `public_form_index` (**seule table globale**), `public_form_sessions`, `submission_attempts` | Formulaire public |

Toutes les tables de tenant portent `tenant_id` + RLS forcée. **Allowlist d'isolation : `admissions.public_form_index`** (justification : aucune donnée personnelle, jeton opaque non énumérable, écriture limitée au tenant propriétaire).

## 9. Endpoints

Schémas Zod dans `packages/contracts/src/v2/admissions.ts`. Erreurs `admissions.*` stables.

### 9.1 Personnel (`/api/v1/admissions`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET/PUT | `/settings` | Paramètres de l'établissement | `admission.settings.manage` |
| GET/POST | `/workflows`, `/workflows/:id` ; PUT `/workflows/:id/stages`, `/workflows/:id/transitions` | Éditer un brouillon | `admission.workflow.manage` |
| POST | `/workflows/:id/publish` ; `/workflows/:id/new-version` | Publication (validation §AC1.2) ; copie | `admission.workflow.publish` (**sensible**) |
| GET/POST/PATCH | `/campaigns` ; POST `/campaigns/:id/open`, `/close` ; PUT `/campaigns/:id/capacities` | Campagnes et capacités | `admission.campaign.manage` |
| GET/PUT | `/document-requirements`, `/priority-classes`, `/decision-reasons`, `/consent-texts` | Données d'établissement | `admission.settings.manage` |
| GET/POST/PATCH | `/prospects` ; POST `/prospects/:id/convert` | Prospects | `admission.prospect.manage` |
| GET | `/applications?campaignId&status&stage&grade&q&page` | Liste filtrée | `admission.read` |
| POST | `/applications` | Création par le personnel | `admission.create` |
| GET/PATCH | `/applications/:id` | Dossier | `admission.read` / `admission.update` |
| POST | `/applications/:id/transition` | Changement d'étape (hors décision) | permission portée par la transition |
| POST | `/applications/:id/decisions` | Décision formelle (+ transition atomique) | `admission.decide` |
| POST | `/applications/:id/documents` ; `/applications/:id/documents/:reqId/review` | Dépôt ; relecture | `admission.document.upload` / `admission.document.review` |
| POST/PATCH | `/applications/:id/interviews[/:iid]` | Tests et entretiens | `admission.interview.manage` |
| POST | `/applications/:id/offers` ; `/offers/:id/withdraw` ; `/offers/:id/accept-on-behalf` | Offre ; retrait ; acceptation par délégation (pièce justificative) | `admission.offer.manage` |
| GET/POST | `/applications/:id/duplicates` ; `/duplicates/:id/resolve` | Doublons | `admission.duplicate.resolve` |
| GET | `/applications/:id/history` | Transitions + décisions | `admission.read` |
| POST | `/applications/:id/anonymize` | Anonymisation | `admission.anonymize` (**sensible**) |
| GET | `/applications/:id/export` | Dossier (droit d'accès) | `admission.export` |
| GET/POST | `/waitlist?campaignId&grade` ; `/waitlist/promote` | Ordre ; proposer la place | `admission.waitlist.manage` |
| GET | `/reports/{funnel,capacity,sla,sources,rejections}` | Tableaux de bord | `admission.report.read` |

### 9.2 Public (`/api/v1/public/admissions`, `config: { public: true }`, 30 req/min/IP par défaut)

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/forms/:slug` | Formulaire (§AC4.2) + jeton à usage unique |
| POST | `/forms/:slug/applications` | Dépôt ; renvoie `{ trackingCode }` |
| POST | `/track` | Statut grossier + libellés des pièces manquantes (le code est dans le **corps**, jamais dans l'URL) |
| POST | `/track/documents` | Dépôt d'une pièce (multipart, type réel vérifié) |
| POST | `/offers/respond` | Réponse à une offre par lien à usage unique (`{ token, accept }`) |

## 10. Écrans

**Direction / secrétariat** : « Admissions » (entonnoir de la campagne, colonnes = étapes du workflow, filtres), fiche dossier (identité, tuteurs, consentements, pièces avec relecture, entretiens, doublons, historique, décisions), « Décider » (motif codé, dépassement de capacité motivé), liste d'attente (ordre, priorité, « proposer la place »), éditeur de workflow (étapes, transitions, validation à la publication avec liste des défauts), campagnes et capacités, paramètres, textes de consentement, tableaux de bord. **Public** : formulaire (mobile d'abord, pièces par appareil photo), page de suivi, page de réponse à l'offre. Aucune donnée nominative dans les listes publiques.

## 11. Permissions (déclarées dans `manifest.ts`)

`admission.read`, `admission.create`, `admission.update`, `admission.decide`, `admission.capacity.override` (**sensible**), `admission.workflow.manage`, `admission.workflow.publish` (**sensible**), `admission.campaign.manage`, `admission.settings.manage`, `admission.prospect.manage`, `admission.document.upload|review`, `admission.interview.manage`, `admission.offer.manage`, `admission.duplicate.resolve`, `admission.waitlist.manage`, `admission.enroll` (transition vers la création d'inscription), `admission.anonymize` (**sensible**, MFA), `admission.export`, `admission.report.read`. Features : `admissions.core`, `admissions.public-form`, `admissions.waitlist`, `admissions.interviews`. Modèles de rôles : `admissions_officer` (secrétariat), `directeur` (tout) ; le **parent** n'a aucune permission ici (accès par jeton). Une transition de workflow cite sa permission (`permission_key`) ; l'API vérifie `requirePermission(permission_key)` — aucun rôle en dur.

## 12. Événements (outbox, `{ v: 1, … }`, **sans donnée personnelle**)

| Événement | Producteur | Consommateurs |
|---|---|---|
| `admissions.application.submitted` | dépôt | 016 (annonce au personnel), 025 |
| `admissions.application.status_changed` (`fromStatus`, `toStatus`, `stageCode`, ids) | transition | 025, 016 |
| `admissions.decision.recorded` (`kind`, `reasonCode`) | décision | 025, 016 |
| `admissions.offer.issued` / `.accepted` / `.declined` / `.expired` / `.withdrawn` | offres | 016, 025 |
| `admissions.application.enrolled` (`studentId`, `enrollmentId`) | passage `ENROLLED` | 005, 025 |
| `admissions.waitlist.promoted` | promotion | 016 |
| `admissions.prospect.converted` | conversion | 025 |
| `admissions.application.anonymized` | anonymisation | audit |

**Consommés** : `tenancy.institution.created` (workflow, paramètres, motifs, classes de priorité par défaut), `academic.enrollment.confirmed` / `.cancelled` / `.withdrawn`, `finance.invoice.paid` (information : l'inscription est confirmée par `academic`, pas par ce module), `people.student.status_changed`. Consommateurs idempotents par `event.id`.

## 13. Ports consommés

| Port | Fourni par | Repli si non câblé |
|---|---|---|
| `StudentRegistry` (`createStudent`, `findDuplicateStudents`, `changeStudentStatus`, `createGuardian`, `linkGuardian`) | people (008) | `501 admissions.people_unavailable` : aucune acceptation d'offre |
| `EnrollmentService` (`enrollStudent`, `cancelEnrollment`, `getRoster`) | academic (004) | idem |
| `RegistrationFeeService` (`getRegistrationFeeStatus`, `issueInvoiceFromSchedule`, `cancelInvoice`) | finance (014) | **échec fermé** : pas d'acceptation sans facturation |
| `DocumentStore` (`store`, `link`, `signedUrl`) | documents (024) ; repli `StoragePort` | refus des dépôts si aucun stockage |
| `ApplicantNotifier` | canaux externes (chantier distinct) | `SKIPPED` + `CHANNEL_UNAVAILABLE` (jamais de simulation) |
| `Captcha` | prestataire (à choisir) | si `captcha_required` et port absent : formulaire fermé (échec fermé) |
| `IdentityProvisioner` (`provisionPortalAccount`) | iam via people | action désactivée |

## 14. Tests

- **DDL** (livrés) : 174 tests de comportement dont **concurrence réelle** (4 sessions Postgres) : un seul jeton consommé, une seule admission sur la dernière place, 100 numéros sans trou ni doublon.
- **Unitaires** : schémas Zod (public strict), normalisation d'identité, classes de priorité, mappage relations ↔ `people`, formats de lien et de jeton.
- **Intégration** : saga complète avec `people`, `academic`, `finance` réels (succès, échec à chaque étape, rejeu, confirmation tardive/doublée) ; politique de capacité HARD/SOFT/NONE ; liste d'attente et promotion ; anonymisation ; isolation A/B ; publication concurrente de deux workflows.
- **Sécurité** : formulaire public — réponse sans donnée sensible (contrat) ; pas d'énumération (même réponse pour un doublon) ; limiteur ; jeton rejoué/expiré/trop rapide ; type de fichier falsifié ; tentative d'accès au dossier d'un autre par code ; aucune donnée personnelle dans événements/audit/logs.
- **E2E** (Playwright) : « de la candidature publique à l'élève inscrit et à sa classe », avec paiement en sandbox.

## 15. Cas limites

- **Jumeaux** (même naissance, prénoms différents) : clés d'identité distinctes ; frères et sœurs : plusieurs candidatures par famille (tuteur commun, priorité « fratrie » par donnée).
- **Famille avec enfants dans plusieurs niveaux** : une candidature par enfant ; consentement par tuteur et par candidature.
- **Offre acceptée après expiration** ou **après retrait** : refusée ; offre déjà acceptée : idempotent.
- **Classe visée pleine à l'acceptation** : `academic` refuse (`classroom_full`) → transaction annulée, offre inchangée, alerte au secrétariat.
- **Workflow modifié pendant la campagne** : impossible (publié figé) ; nouvelle version pour la campagne suivante ; une campagne ouverte garde son workflow.
- **Lien public désactivé pendant un dépôt** : dépôt refusé, aucune ligne écrite.
- **Famille sans e-mail ni téléphone** : refusé (un moyen de contact au moins).
- **Candidat déjà élève** (réinscription, changement de niveau) : réutilisation du `studentId`, aucun doublon d'élève.
- **Affecté par l'État hors capacité** : politique `SOFT` + motif ; obligation d'accueil = question Q-A12.
- **Paiement partiel** : l'inscription reste `PENDING` ; la confirmation exige la facture d'inscription **soldée** (décision métier) ; le solde de la scolarité est suivi séparément.
- **Événement de confirmation reçu avant le commit de la saga** : impossible (événement posté dans la même transaction) ; reçu en double : un seul passage à `ENROLLED`.
- **Retrait de la famille après paiement** : remboursement = politique de `finance` ; le dossier passe `WITHDRAWN` (statut canonique `REJECTED`) **et** l'inscription est retirée (`academic`).
- **Anonymisation d'un dossier ayant des doublons ou un prospect lié** : les liens sont conservés sans nom.
- **Changement de classe de priorité après entrée en liste d'attente** : l'ordre se recalcule (donnée), historique en `transitions`/audit.

## 16. Dépendances et demandes de changement

**En amont** : 000, 001–003 (tenants, établissements, modèle de pack), 004, 008, 014, 016 ; 024 (port) ; 031 (imports, facultatif).
**En aval** : 005 (arrivée en PS/CP1…), 006, 025 (entonnoir direction).

| Spec | Demande (additive) |
|---|---|
| 008 | `createStudent` accepte `initialStatus ∈ {ACTIVE, INACTIVE}` (défaut `ACTIVE`) et un `id` fourni ; `changeStudentStatus` autorise `INACTIVE → ACTIVE` ; `findDuplicateStudents` renvoie un score et des raisons |
| 004 | `enrollStudent` accepte `source: ADMISSION` + `sourceRef = applicationId` (déjà prévu : `source_kind`) ; `cancelEnrollment` pour une inscription `PENDING` ; événement `academic.enrollment.confirmed` porte `enrollmentId` et `studentId` (déjà prévu) |
| 014 | `getRegistrationFeeStatus` / `isRegistrationFeeDue` utilisables **avant** facturation ; `issueInvoiceFromSchedule` idempotent par clé (offre) ; `cancelInvoice` sur facture sans paiement |
| 024 | Port `DocumentStore.link` (rattacher une pièce à un autre propriétaire) |
| 003 | Modèle de workflow d'admission (section `admissions`) dans le modèle de pack ; `tenancy.institution.created` |
| `module-conventions.md` | Plage `1900–1999` pour `admissions` (la ligne ouverte devient `2000+`) |
| isolation | Allowlist : `admissions.public_form_index` avec sa justification |

## 17. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Les migrations `1900`–`1902` s'appliquent sur base vide, les **174** tests de comportement passent, la seule exception à l'isolation est `public_form_index` et le test d'isolation générique passe avec deux tenants.
2. Une candidature publique devient, **sans intervention manuelle hors décision**, un élève avec matricule, une inscription confirmée après paiement en sandbox et une place en classe (E2E).
3. Deux sessions concurrentes sur la dernière place : une seule réussit ; 100 numéros de candidature concurrents sans trou ni doublon.
4. Aucune donnée personnelle dans un événement, un audit, un log ou une réponse publique (tests de contrat).
5. Aucune constante de capacité, de priorité, de délai ou d'âge dans le code du module ; lint R2 vert.
6. Les demandes de changement du §16 sont acceptées ou refusées par écrit ; les questions Q-A01 à Q-A18 sont transmises au propriétaire du produit.

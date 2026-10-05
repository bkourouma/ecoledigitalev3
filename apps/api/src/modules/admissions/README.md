# Module `admissions` — du prospect à l'élève inscrit

Spec : `specs/v2/007-admissions/` (spec, data-model, plan, parity, open-questions, `ddl/` testé). Plage de migrations : **1900-1999** (`1900`-`1903` livrées, `1903` = résultat d'examen reçu (Q-E18) ; copie EXACTE du DDL de référence testé : `node specs/v2/007-admissions/ddl/run.mjs --check-doc`). Schéma Postgres : `admissions`.

Le module possède le **dossier de candidature et ses décisions**, et **orchestre** `people`, `academic`, `finance`, `documents` et le canal de notification par des **ports** et des événements — jamais par le schéma SQL d'un autre module.

## Ce que fait le module

| Besoin | Mécanisme |
|---|---|
| Workflow **personnalisable** par établissement | **étapes** (donnée) rattachées aux **8 statuts canoniques** (`DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `MISSING_DOCUMENT`, `ACCEPTED`, `REJECTED`, `WAITLISTED`, `ENROLLED` : contrat stable des événements et statistiques) ; le statut d'un dossier est **dérivé** de son étape (déclencheur) ; modèle livré en donnée (`domain/default-workflow.ts`, instancié par `tenancy.institution.created` ou à la première visite) |
| Publication | validation à la publication (déclencheur `workflows_guard` + miroir `validateWorkflow` qui liste **tous** les défauts) puis workflow **figé** ; modifier = **version suivante** ; un seul publié par (établissement, cycle) ; publications **sérialisées** (verrou consultatif), une version plus ancienne ne remplace jamais une plus récente (`admissions.workflow_conflict`) ; dossiers épinglés à la version qui les a créés |
| Campagnes et capacités | capacités par niveau (verrou de ligne : **une seule admission sur la dernière place**, testé à deux sessions), politique `HARD` / `SOFT` (motif ≥ 10 caractères, permission sensible) / `NONE`, plafond de liste d'attente ; absence de ligne = pas de plafond (signalé) |
| Décision formelle | ligne de `decisions` insérée **avant** et dans la **même transaction** que le changement d'étape (`xid`), étape de départ = étape **courante** ; journaux `decisions` et `transitions` en **ajout seul** (aucun droit `UPDATE`/`DELETE` pour `app_user`) ; identité du décideur **figée** |
| Pièces | exigences = données de l'établissement ; type **réel** par les octets (port `DocumentStore`), taille, SHA-256, antivirus ; une pièce non relue reste « manquante » |
| Offre et **saga d'inscription** | lien de réponse à **usage unique** (empreinte seule stockée, jeton dans le **fragment** de l'URL) ; `acceptOffer` = **UNE transaction** : élève **INACTIF** + tuteurs (`people`), inscription **PENDING** (`academic`), facture des frais d'inscription (`finance`) ; échec à n'importe quelle étape = rien n'est créé, offre inchangée, rejouable, idempotent par offre |
| `ENROLLED` | **dérivé** de `academic.enrollment.confirmed` (décision métier 2026-10-01 : confirmation **automatique** après paiement des frais d'inscription, par `academic`) ; jamais posé à la main (contrainte `enrollment_confirmed_at`) ; un événement en double ne produit qu'un passage |
| Liste d'attente | ordre = rang de la classe de priorité (donnée), ancienneté, identifiant ; promotion `MANUAL` (« proposer la place ») ou `AUTO` (décision **système**) ; une place n'est offerte qu'**une** fois (testé) |
| Formulaire **public** | un lien par établissement (`public_form_index`, **seule table globale**, slug opaque ≥ 96 bits), sans compte créé, réponses **neutres** (aucune énumération, aucune capacité, aucun effectif), jeton à usage unique + délai minimal + leurre (honeypot) + limiteur (Redis **et** base) + CAPTCHA optionnel (échec fermé), consentement parental **versionné** (formulaire fermé sans texte publié), suivi par code (POST, jamais dans l'URL), dépôt de pièces, réponse à une offre |
| Doublons | clé d'identité normalisée (colonne générée, miroir TS testé) + `people.findDuplicateStudents` (score, raisons) + prospects ; `BLOCK` / `WARN` / `OFF` ; un candidat déjà élève réutilise son dossier (aucun nouvel élève) |
| Données personnelles | aucune donnée nominative dans un événement, un audit ou un log (testé) ; IP/agent en **HMAC** tronqué ; anonymisation d'un dossier clos **sans** inscription (fichiers purgés **avant** la fonction SQL ; job d'échéance inactif tant que `rejected_retention_months` est vide) ; export (droit d'accès) audité |
| Notifications | ligne `notification_log` **idempotente** dans la transaction, envoi **après** commit, `SKIPPED` / `CHANNEL_UNAVAILABLE` sans canal (**aucune simulation**), une confirmation par contact et par jour |

Aucune règle réglementaire n'est codée : capacités, priorités, durée d'une offre (14 j par défaut = **réglage**), pièces, délai de paiement (vide), conservation (vide), âge d'entrée (aucun contrôle) sont des **données** ou politiques d'établissement (test « aucune constante »).

## Arborescence

```
manifest.ts   index.ts (API publique)   jobs.ts   subscribers.ts   worker.ts (deps du worker)
migrations/   1900 paramètres, lien public, priorités, motifs, consentements, workflow, campagnes, capacités, pièces exigées
              1901 prospects, candidatures, tuteurs, consentements, pièces, entretiens, offres, décisions, transitions, doublons, notifications, numérotation, gardes SQL
              1902 jetons de formulaire et journal de tentatives
domain/       events · errors · identity · number · workflow (validation) · default-workflow · waitlist · tokens · tracking
application/  deps · ports · port-registry · support · notifications · transitions (moveStage) · applications · decisions (+ promotion) · offer-core · offers (saga) ·
              duplicates · documents · interviews · prospects · waitlist · reference · workflows · campaigns · defaults · enrollment-events · public-form · anonymize · reports · jobs
infrastructure/ sql · db-errors · reference/workflow/application/case/public/reports-repository · audit-adapter · in-memory-ports
http/         plugin.ts (`setup` + `default (app, runtime)` ; routes publiques sous /api/v1/public/admissions)
test/         unit (domaine, contrats Zod, hygiène, registre) · integration (base réelle : workflow, applications, offres/saga, formulaire public, HTTP, isolation)
```

## Routes

Personnel (`/api/v1/admissions`, `requirePermission` du manifeste ; la permission d'une **transition** est celle du workflow) :
`/lookups` · `/settings` (GET/PUT), `/settings/public-link`, `/settings/initialize` · `/priority-classes`, `/decision-reasons`, `/document-requirements`, `/consent-texts[/retire]` · `/workflows` (GET/POST), `/workflows/:id` (GET/PATCH/DELETE), `/stages`, `/transitions`, `/publish`, `/new-version` · `/campaigns` (+ `/open`, `/close`, `/capacities`) · `/prospects` (+ `/convert`) · `/applications` (liste, `/board`, création, dossier, `PATCH`, `/history`, `/transition`, `/decisions`, `/documents[/:reqId/review|url]`, `/consents[/withdraw]`, `/interviews`, `/offers`, `/duplicates[/detect|:id/resolve]`, `/anonymize`, `/export`) · `/offers/:id/{withdraw,classroom,accept-on-behalf}` · `/waitlist[/promote]` · `/reports/{funnel,capacity,sla,sources,rejections}`.

Public (`/api/v1/public/admissions`, `config: { public: true }`, `no-store`, `noindex`) : `GET /forms/:slug` · `POST /forms/:slug/applications` · `POST /track` · `POST /track/documents` (multipart) · `POST /offers/view` · `POST /offers/respond`. Toute erreur est neutre (404 « introuvable » identique, 400 générique, 429, 503).

## Résultat d'examen et moyenne reçus d'`examinations` (décision métier Q-E18)

| Sujet | Mécanisme |
|---|---|
| Réception | abonné `admissions.record-exam-result` → `admissions.exam_results` (migration **1903**) : une ligne par résultat source, remplacée seulement par une **version plus grande** (correction approuvée), rejeu et événement tardif sans effet ; charge hors contrat refusée (avertissement, pas de rejeu infini) |
| Rattachement | un dossier ne voit que les résultats de **son élève** (`applications.student_id`) ou d'un rapprochement **confirmé** (`duplicate_candidates.status = CONFIRMED_DUPLICATE`) : un rapprochement seulement ouvert ne montre jamais la moyenne d'un autre enfant |
| Lecture | `GET /applications/:id/exam-results` (`admission.read`) : « admis / non admis » ; la **MOYENNE** seulement avec `admission.exam_result.read` (à attribuer au personnel d'admission habilité), lecture **tracée** (`admissions.exam_result.read_average`, sans la valeur) ; sans elle `average: null, averageHidden: true` |
| Écran | encart « Résultat d'examen » du dossier (`DossierExamResults`) ; aucune décision d'admission n'en est tirée : la décision reste formelle (workflow) |

## Permissions, features, événements, jobs

Permissions (`manifest.ts`) : `admission.read|create|update|decide|workflow.manage|campaign.manage|settings.manage|prospect.manage|document.upload|document.review|document.attach|interview.manage|offer.manage|duplicate.resolve|waitlist.manage|enroll|export|report.read` ; **sensibles (MFA, audit)** : `admission.capacity.override`, `admission.workflow.publish`, `admission.anonymize`. Features : `admissions.core`, `admissions.public-form`, `admissions.waitlist`, `admissions.interviews`.

Événements publiés (`{ v: 1, … }`, schémas dans `packages/contracts/src/v2/admissions.ts`) : `admissions.application.submitted|status_changed|enrolled|anonymized`, `admissions.decision.recorded`, `admissions.offer.issued|accepted|declined|expired|withdrawn`, `admissions.waitlist.promoted`, `admissions.prospect.converted`, `admissions.interview.scheduled|rescheduled|cancelled` (voir « Entretiens »). Consommés : `academic.enrollment.confirmed|cancelled|withdrawn`, `tenancy.institution.created`, `examinations.result.transmitted` (**Q-E18** : résultat « admis / non admis » ET moyenne d'un élève, CEPE vers l'admission en 6e). Jobs : voir `docs/architecture/platform-assembly.md` §7.

## Ports (adaptateurs `apps/api/src/platform/adapters/admissions-*.ts`) et INTERFACES ATTENDUES des modules voisins

Un port non branché échoue **fermé** (`admissions.port_unavailable`, 503) ; l'acceptation d'une offre est alors impossible mais rien n'est créé. Les modules voisins n'ont **pas** été modifiés ; les adaptateurs tiennent avec ce qui existe et échouent fermé si un point attendu manque :

| Port | Fourni par | Utilisé aujourd'hui | Interface ATTENDUE (extension demandée par la spec 007 §16) |
|---|---|---|---|
| `StudentRegistry` | people | `createStudent` + `changeStudentStatus(INACTIVE)` dans la même transaction (la fiche n'est jamais visible `ACTIVE`), `createGuardian`, `linkGuardian`, `findDuplicateStudents`, `getStudent` | `createStudent({ initialStatus: "INACTIVE", id? })` ; `findDuplicateStudents` avec **score et raisons** (aujourd'hui `match` → score fixe par type). Si le statut final n'est pas `INACTIVE` : échec fermé |
| `EnrollmentService` | academic | `enrollStudent({ sourceKind: "ADMISSION", sourceRef: applicationId })`, `transitionEnrollment(…, "cancel", motif)` ; liste des statuts d'élève inscriptibles étendue à `INACTIVE` **dans les dépendances du flux** (`createAdmissionsWriteEnv`) | `enrollStudent` acceptant un élève `INACTIVE` pour `source: ADMISSION` ; `cancelEnrollment` d'une inscription `PENDING` |
| `RegistrationFeeService` | finance | `isRegistrationFeeDue` (barème absent = pas de facture, `academic` confirme d'emblée), `listFeeCatalog(REGISTRATION)`, `issueInvoiceFromSchedule` idempotent par `idempotencyKey = admissions-offer-<offerId>`, `cancelInvoice` | rien de plus (déjà livré) ; une facture partiellement payée ne s'annule pas (le job de délai de paiement laisse alors le dossier et le journalise) |
| `InstitutionCatalog` | tenancy, academic, people | `listInstitutions`/`getInstitution`, niveaux, classes (`getClassroom` + `getClassroomFacts`), types de lien de parenté | — |
| `DocumentStore` | stockage / documents | stockage d'objets de la plateforme + `detectFileType` + antivirus ; clé `admissions/<tenant>/<candidature>/<pièce>/<sha256>` | **Rattachement à la GED : DIFFÉRÉ ET CONFIRMÉ PAR UN HUMAIN** (arbitrage 2026-10-02, voir « Rattachement des pièces à la GED »). `link` (abonné système `derive-enrolled`) renvoie toujours `linked: false` ; `attachToStudentFile` (optionnel, branché par la plateforme sur `documents.createDocument`) est appelé par `POST /applications/:id/documents/attach-to-student-file` |
| `ApplicantNotifier` | **notifications** (`enqueueInTx`, adaptateur `admissions-notifier.ts`) | **branché** (phase 3) : mise EN FILE (e-mail, puis SMS, puis WhatsApp : le premier canal dont le tuteur a la coordonnée et qui accepte une remise gagne ; le worker envoie). Le tuteur d'une candidature n'a ni compte ni fiche `people` : destinataire construit de ses coordonnées (clé de consentement `person:<tuteur>`), consentements et liste de suppression de `notifications` appliqués. Gabarit livré `announcement` (le catalogue est fermé) avec un texte NEUTRE par code d'admission (jamais un motif de refus). Aucune coordonnée joignable : échec fermé `admissions.channel_unavailable` -> `SKIPPED` / `CHANNEL_UNAVAILABLE`. Le lien de réponse à une offre figure dans le message de l'offre, donc dans le contenu mis en file du journal de `notifications` (purgé par son ménage) : point à arbitrer |
| `Captcha` | prestataire (non choisi) | absent : si l'établissement exige un CAPTCHA, le formulaire reste **fermé** | `verify(token, ip) -> boolean` |
| `ActorDirectory` | people | nom d'affichage figé dans la décision (repli : `Utilisateur <8 premiers caractères>`) | — |

Autres points à brancher ailleurs (hors périmètre) : rôles système (**faits** : `admissions_officer` et `secretariat` portent le traitement d'un dossier, jamais `decide`, `capacity.override`, `workflow.*`, `campaign.manage`, `settings.manage`, `anonymize`, `export` ; `owner`/`directeur` ont `*`, voir `rbac/README.md`) ; consommateurs `messaging` (annonce au personnel sur `admissions.application.submitted` / `offer.expired`) ; `analytics` (entonnoir direction) ; **`people` : `INACTIVE → ARCHIVED`** n'est pas permis aujourd'hui, un élève dont l'inscription est annulée au délai de paiement reste donc `INACTIVE` (jamais supprimé, matricule consommé).

## Variables d'environnement

`ADMISSIONS_FINGERPRINT_SECRET` (HMAC des empreintes d'IP et d'agent, ≥ 16 car. ; **à fixer en production** : sans lui un secret par processus est tiré), `ADMISSIONS_PUBLIC_BASE_URL` (repli `V2_APP_BASE_URL`), `ADMISSIONS_MAX_FILE_BYTES` (15 Mio, plafond 50). Stockage et antivirus : `STORAGE_*`, `DOCUMENTS_SCANNER` (voir `documents`).

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/admissions                 # unitaires (sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/admissions   # + intégration réelle
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/admissions-saga   # saga avec people, academic, finance RÉELS
node specs/v2/007-admissions/ddl/run.mjs                                                  # 174 tests de comportement du DDL (conteneur éphémère)
```

Couverture : manifeste, domaine et contrats Zod stricts ; hygiène (aucun `Math.random`, `new Date()`, constante de capacité) ; RLS A/B ; concurrence (dernière place, publication, jeton à usage unique, promotion) ; saga (succès, échec à **chaque** étape avec annulation totale, rejeu, ports absents, délégation, doublons, ENROLLED dérivé une seule fois) ; formulaire public (aucune fuite, neutralité, limiteur, leurre, jeton, consentement) ; matrice de permissions HTTP ; aucune donnée personnelle dans événements et audit.

## Écrans web

Personnel (`apps/web/src/app/v2/admissions/*`, garde serveur `requireSession` + permission par page, `usePermission` / `useFeature` pour masquer) : pipeline kanban (déplacement par bouton, accessible au clavier), liste filtrée, saisie et dossier (décisions journalisées, pièces, entretiens, offres, doublons, historique, export, anonymisation), listes d'attente, prospects, campagnes et capacités, rapports, paramètres (politiques, lien public, textes de consentement, pièces, motifs, priorités) et éditeur de workflow. Public (`apps/web/src/app/v2/apply/[school]`, sans authentification, non indexé, sans `Referer`) : formulaire, suivi par code (dans le corps), réponse à une offre (jeton dans le fragment de l'adresse). Client typé : `apps/web/src/platform/v2/admissions.ts` ; messages `v2Admissions*` de `fr-CI.json` ; tests Vitest + RTL (`Admissions.test.tsx`, `Public.test.tsx`, `admissions-coverage.test.ts`).

## Limites connues

- Les capacités ne se suppriment pas (aucun `DELETE` accordé) : une ligne se met à jour ; l'absence de ligne = pas de plafond.
- Le modèle livré ajoute deux clôtures à la spec : `OFFER_EXPIRED` et `DUPLICATE` (le motif de clôture est porté par l'étape).
- Un workflow personnalisé qui n'a pas d'étape `closure_kind = OFFER_EXPIRED` / `WITHDRAWN_BY_FAMILY` atteignable depuis une étape qui retient une place ne peut pas être clos automatiquement (expiration, refus de la famille) : l'offre passe `EXPIRED` / `DECLINED` mais le dossier reste à son étape (journalisé).
- L'inscription multi-établissements d'un même enfant n'est pas rapprochée (hors V1, R8 du plan).

## Entretiens : événements publiés

`createInterview` publie `admissions.interview.scheduled` ; `updateInterview` publie `admissions.interview.cancelled` (passage à `CANCELLED`), `admissions.interview.rescheduled` (l'instant change alors que l'entretien reste `SCHEDULED` ; porte `previousScheduledAt`) ou `admissions.interview.scheduled` (retour de `CANCELLED` à `SCHEDULED`). Saisir un résultat, un lieu ou une note ne publie rien. Charge `{ v: 1, applicationId, campaignId, institutionId, gradeLevelCode, interviewId, kind, scheduledAt, conductedByStaffId }` : **aucun nom, lieu, note ni résultat** (schémas `admissionsInterview*EventSchema`, test de non-fuite `apps/api/test/events-contracts/admissions.test.ts`).

**Pas de double envoi** : le module n'envoie AUCUNE convocation d'entretien par `ApplicantNotifier` (il n'y en a jamais eu), et les règles de `notifications` restent désactivées. Une convocation aux familles se fera en ajoutant une règle `notifications` sur `admissions.interview.scheduled|rescheduled|cancelled` (audience `APPLICANT_GUARDIANS`), sans toucher à `ApplicantNotifier`.

## Rattachement des pièces à la GED (arbitrage 2026-10-02)

Problème : `documents.createDocument` exige un déposant humain (`created_by` NOT NULL, droits relus à chaque appel) alors que `admissions.derive-enrolled` agit en système. Options écartées : un « acteur système » dans la GED (faux déposant dans l'historique, droits de dépôt contournés, nouveau chemin d'écriture sans humain). **Choix : rattachement différé confirmé par un humain.**

* `derive-enrolled` ne rattache rien : il laisse une trace d'audit `admissions.document.attach_pending` (nombre de pièces en attente).
* `POST /applications/:id/documents/attach-to-student-file` `{ categoryId }` : permission `admission.document.attach` ET `documents.upload`. Réservé aux dossiers `ENROLLED` ; reprend les pièces **ACCEPTÉES** stockées et non encore rattachées ; la personne qui confirme devient le **déposant** dans la GED, qui applique ses règles (catégorie, propriétaire = l'élève, quota, antivirus, doublons). Les droits GED RÉELS de la personne (niveau de la catégorie) sont relus par la route et transmis tels quels : admissions n'élargit rien.
* Idempotent : `application_documents.document_ref` est posé à chaque pièce rattachée (une pièce déjà rattachée n'est pas reprise) ; un doublon connu de la GED est reconnu (`ALREADY_PRESENT`) ; un échec sur une pièce n'arrête pas les autres (code stable dans le compte rendu). Audité (`admissions.document.attach_to_student_file`).
* La copie du stockage d'admissions est conservée (rétention propre au module) ; la copie de la GED vit sa vie (versions, expiration, purge).
* Port non branché ou sans stockage : échec fermé `admissions.port_unavailable`.

* **Écran web** : dans un dossier `ENROLLED`, la section « Dossier permanent de l'élève » (`DossierAttach`) propose « Rattacher les pièces acceptées au dossier de l'élève » : choix d'une catégorie GED (catégories d'élèves actives où l'on peut déposer), confirmation humaine explicite, puis rapport rattachées / déjà présentes (ignorées) / en échec. Rôle : `secretariat` porte `admission.document.attach` ; la route exige aussi `documents.upload`.

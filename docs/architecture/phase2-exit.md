# Test de sortie de phase 2 — une année scolaire simulée

Preuve exécutable : `apps/api/test/phase2/school-year.integration.test.ts` (+ `support/`), lancée par `pnpm test:phase2` (Postgres 17 et
Redis 7 jetables dans Docker) et, en CI, par le job **bloquant** `phase2` de `.github/workflows/ci.yml` (services Postgres + Redis ; il est
aussi exigé par `ci-ok`). Le job `v2-modules` l'exclut (`--exclude "test/phase2/**"`) pour ne pas le jouer deux fois.

```bash
pnpm test:phase2                                    # Docker requis (with-infra.mjs : Postgres + Redis éphémères, supprimés à la fin)
# ou, sur des services JETABLES déjà démarrés :
TEST_DATABASE_URL=postgres://… REDIS_URL=redis://… pnpm --filter @ecoledigitale/api exec vitest run test/phase2
```

Sans `TEST_DATABASE_URL` / `REDIS_URL` le test s'ignore proprement (comme celui de la phase 1) : il ne tourne que là où l'infrastructure
jetable existe. Durée : environ une minute (une trentaine de secondes de démarrage, dont les migrations, puis le scénario).

## Ce que le test est

Un scénario unique, **par HTTP** (`app.inject`), sur la plateforme **assemblée comme `src/index.ts` le fait** : vrais plugins legacy et v2,
migrations réelles, rôle `app_user` soumis à la RLS, **vrais adaptateurs inter-modules** (`platform/adapters`, aucun port en mémoire) et
**vrai worker en processus** (relais d'outbox, abonnés et jobs découverts sur disque), Postgres + Redis réels. Il réutilise le harnais de la
phase 1 (`test/phase1/support`, non modifié) et y ajoute (`test/phase2/support/platform.ts`) ce que la phase 2 exige : stockage d'objets
(repli disque partagé API/worker), clé de signature des bulletins (Ed25519 jetable), rendu PDF, journal du worker capturé.

**Acteurs : de vrais comptes IAM** (invitation, mot de passe, MFA TOTP) portant les **rôles système** de `rbac` — `owner` (provisionné par la
console), `directeur`, `responsable_pedagogique` (MFA : permissions sensibles), `enseignant` et `parent` créés par l'**invitation de portail**
de `people` (liaison compte ↔ fiche), `eleve`. Aucun contexte forgé, aucun contournement des permissions.

**Rendu PDF** : réel si un Chrome est trouvé (variables `REPORTCARDS_CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH`, installations
usuelles, cache Puppeteer) — le test vérifie alors `%PDF-` sur le fichier servi par l'URL signée ; sinon rendu **déterministe** (`FakePdfRenderer`
du module reportcards) injecté dans le worker : jamais de faux succès silencieux.

## Étapes couvertes

| # | Étape | Preuves principales |
|---|---|---|
| 1 | Console : tenant HIGHER, abonnement PROFESSIONAL + HIGHER (décision du 2026-10-01), propriétaire (MFA), direction, pédagogie | provisionnement par `POST /platform/tenants`, comptes réels |
| 2 | Année, périodes, programme, matières, curriculum L1 > S1 > 2 UE × 2 ECUE **publié**, classe | référentiels du pack instanciés par l'événement `tenancy.institution.created` ; validation puis publication du curriculum |
| 3 | Élèves, tuteur lié, comptes de portail, enseignant affecté | invitation `people` -> `iam` -> `rbac` ; liaison `persons.identity_id` |
| 4 | Inscription ; frais d'inscription facturés puis **payés en sandbox (webhook signé)** | inscription `PENDING` jusqu'au paiement, puis **`ACTIVE` par l'événement `finance.invoice.paid`** (abonné `academic.confirm-on-invoice-paid`) ; pas de confirmation « en bloc » ; idempotence des factures ; 5 webhooks simultanés = 1 reçu |
| 5 | Emploi du temps : patron récurrent, génération d'occurrences, **conflit refusé** | génération idempotente ; chevauchement classe/enseignant = `409` (patron et séance isolée) |
| 6 | Appels | ouverture, pointage, soumission, validation par la direction (l'enseignant ne le peut pas) ; séance passée à `HELD` par l'événement ; **rejeu hors-ligne idempotent**, même `clientId` + autre contenu refusé, **double envoi simultané**, **conflit** sur appel validé (file de conflits, jamais écrit en silence) |
| 7 | Évaluations, notes en lot, circuit `DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED` | séparation des tâches (enseignant ne publie pas, pédagogie ne saisit pas), saisie idempotente, note publiée immuable |
| 8 | **Clôture de période** : résultats `rules` `CI-HIGHER-LMD` | semestre validé = **toutes les UE** (étudiant 2 : moyenne 13,5, UE2 non validée => non validé) ; rattrapage : la **session 2 REMPLACE** la session 1 même plus basse (9 -> 5) ; crédits capitalisés par `higher` par lignée (événement `results.period.closed`) |
| 9 | Bulletins | lot idempotent, snapshot `reportcard/1` signé Ed25519, version de règle et assiduité réelles, **PDF rendu par le worker** (événement `reportcards.snapshot.created`), publication, **vérification publique** sans donnée personnelle, signature vérifiée hors ligne avec la clé de `/.well-known` |
| 10 | Diplôme et attestation (`higher`) | exigences = UE du cycle par lignée, octroi à l'étudiant éligible, refus sinon, signataires datés, documents émis, publiés, révocation |
| 11 | Paie de l'enseignant | séances validées -> 240 min × 5 000 XOF/h = 20 000 XOF ; **séparation des tâches** (qui calcule n'arrête pas), approuvé puis payé par une autre personne, heures gelées, « une heure ne se paie qu'une fois » |
| 12 | Audit | chaîne HMAC valide (aussi en fin d'année, après les écritures concurrentes directes et par événements), actes de chaque module, aucun secret, append-only |
| 13 | Second tenant | 21 lectures croisées et 11 écritures croisées refusées, RLS vérifiée table par table, l'abonnement gouverne les fonctions (STARTER sans pack : `entitlements.feature_not_available`) |
| 14 | Accès parent / étudiant / enseignant | l'enfant lié seulement, jamais un autre, jamais l'administration ; bulletin retiré/republié ; périmètre de l'enseignant ; **congé** -> séances « à remplacer » par l'événement -> remplaçant ; **départ d'un étudiant** -> inscription `TRANSFERRED_OUT` par l'événement ; suspension d'un accès coupée sur tous les modules ; **tous les jobs planifiés** déclenchés à la main ; **clôture de l'année** (emploi du temps archivé, affectations terminées, paie close, curriculum verrouillé) |
| 15 | Santé asynchrone | outbox entièrement relayée, file de lettres mortes vide, **aucune ligne d'erreur dans le journal du worker**, abonnés effectivement exécutés |

## Journal des défauts

Règle : un défaut se corrige DANS le module ou l'adaptateur fautif, avec un test de non-régression ciblé ; un défaut qui relève d'une
fonctionnalité à construire est consigné, contourné proprement et **marqué `it.todo`** (jamais masqué).

| Réf. | Défaut | Cause | Correctif | Fichier(s) |
|---|---|---|---|---|
| D-P2-10 | Un diplôme ou une attestation émis par `higher` n'est **ni scellé (signature Ed25519), ni rendu en PDF, ni vérifiable publiquement** : `GET /api/v1/public/verify/:code` répond `UNKNOWN` pour le code d'un document `higher`. | Aucun adaptateur ne relie `higher.issueAwardDocument` / `issueSuccessAttestation` à `reportcards.sealDocument` / `registerVerificationFor` / `renderDocumentPdf` ; `reportcards` ne sait résoudre que `REPORT_CARD` et `TRANSCRIPT` (limite documentée dans son README). Le code de vérification est généré par `higher` alors que `sealDocument` en génère un autre : il faut un port de scellement (signature d'un code **donné**), l'inscription dans l'index public dans la transaction d'émission, et un résolveur de statut (émis / révoqué / remplacé) fourni par `higher`. | **Non corrigé** : c'est une fonctionnalité (port + adaptateur + résolveur + rendu), pas un câblage oublié. Contourné : le test couvre l'émission, la numérotation, la publication et la révocation ; `it.todo("diplôme et attestation : scellement …")` garde le trou visible. | `modules/higher/application/documents.ts`, `modules/reportcards/application/{documents,verify}.ts`, `platform/adapters/reportcards-higher.ts` ; test : `school-year.integration.test.ts` (chapitre 10) |

Aucun autre défaut de production n'a été révélé par le scénario : les ports sont branchés (API **et** worker), les événements se
correspondent (noms et charges), les permissions des rôles système suffisent au parcours, les contrats sont cohérents, les migrations sont
complètes. Ce résultat est lui-même une preuve : le test échouerait sur un port manquant, un événement mal nommé, une permission absente.

### Pièges d'assemblage rencontrés (comportements corrects, à connaître)

Ce ne sont pas des défauts, mais ils ont fait échouer les premières versions du scénario ; ils sont consignés pour qui écrira les écrans et les
imports (tranche 031).

- **Une inscription est datée.** L'effectif d'un appel est celui **à la date de la séance** : une inscription créée aujourd'hui n'est pas dans
  la liste d'appel d'une séance de la semaine dernière (`attendance.student_not_in_roster`). Les imports et rattrapages d'inscriptions passent
  `enrolledOn` (début d'année).
- **`higher` raisonne par lignée**, pas par identifiant de nœud : les candidats au rattrapage, les exigences d'un diplôme et le registre de
  crédits désignent les UE/ECUE par leur `lineageId` (stable d'une année à l'autre malgré le clonage du curriculum).
- **Le rattrapage exige des données** : `resitAllowed` sur les ECUE du curriculum (donnée du nœud), type d'évaluation autorisant la session 2,
  feature `assess.session2` ; sans `resitAllowed`, un semestre non validé est `ADJOURNED` (et non `RESIT`).
- **Un départ vers un autre établissement se note `TRANSFERRED_OUT`** (statut d'inscription), pas `WITHDRAWN`.
- **La suspension d'un accès révoque ses sessions** : la réactivation exige une nouvelle connexion (l'ancien jeton reste refusé).
- **Les espèces exigent une session de caisse** (`finance.cash_session_required`) : les encaissements du scénario passent par virement ou
  paiement en ligne.
- **Les permissions sensibles exigent une session MFA** : une session ouverte avant le défi TOTP n'ouvre pas `grade.validate`, la publication
  ou les actes de direction ; le harnais enrôle puis se reconnecte avec le défi.
- **Un congé est `REQUESTED`** avant décision ; les séances à remplacer sont signalées **par l'événement** (asynchrone) : on attend, on ne
  suppose pas.

## Limites connues du test

- **Diplômes non scellés** : voir D-P2-10 (`it.todo`).
- **Parents et finance** : `rbac` ne définit aucune permission `finance.child.*` (limite déjà consignée dans le modèle du rôle `parent`) : le
  tuteur n'a pas encore de vue des factures de son enfant ; le test vérifie seulement qu'il n'accède pas à la finance de l'établissement (`403`).
- **Totaux des bulletins** : `weighted` / `totalCoefficient` restent `null` (limite documentée de `platform-assembly.md` §10).
- **Horloge réelle** : le scénario s'appuie sur la date du jour (année contenant aujourd'hui, séances passées et à venir déduites du jour de la
  semaine) ; il ne dépend pas de l'heure de lancement, mais il n'avance pas le temps (pas de simulation de plusieurs mois : les jobs sont
  déclenchés à la main, sur l'état réel).
- **Rendu PDF** : réel avec Chrome (poste de développement, runner `ubuntu-latest`), déterministe sinon ; le rendu n'est pas comparé image à
  image (dépendant des polices).
- **Hors périmètre** : `PRIMARY` / `SECONDARY` (règles officielles à fournir, phases 4 et 5), classes virtuelles, notifications sortantes,
  écrans web, import de l'existant.

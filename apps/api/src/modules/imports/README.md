# Module `imports` — imports Excel / ODS / CSV en sept étapes

Socle (pack `CORE`). Schéma Postgres `imports`, migrations **2400-2499** (`2400_imports_init.sql`). Spec : `specs/v2/031-imports/` (`spec.md`, `data-model.md`, `plan.md`, `parity.md`, `open-questions.md`). Conventions : `docs/architecture/module-conventions.md`. `dependsOn: []` : le module n'importe aucun autre module ; il **n'écrit jamais** dans un autre schéma.

## Ce que fait le module

Un **cadre générique** — Upload, Mapping, Validation, Erreurs, Preview, Import, Rapport — et neuf **importeurs** : `students`, `guardians`, `staff`, `classrooms`, `curriculum`, `enrollments` (O-13), `grades`, `grades_own` (O-02), `opening_balances`. Chaque importeur est une DESCRIPTION (colonnes + alias, schéma Zod, règles, clé naturelle, options, permissions, lignes d'exemple) dans `importers/<clé>.ts`, enregistrée par `importers/registry.ts`. L'**écriture** est portée par un port (`ImportTargetPort`) que `apps/api/src/platform/adapters/imports-*.ts` branche sur l'**API publique** (`index.ts`) de `people`, `academic`, `assess` et `finance` : leurs règles, leur audit, leurs événements et leurs unicités s'appliquent à chaque ligne.

| Importeur | Module cible (API publique) | Permissions en plus de `imports.import.<clé>` | Idempotence |
|---|---|---|---|
| `students` | `people.createStudent` / `updateStudent`, `academic.enrollStudent` | `student.create` (+ `student.update`, + `enrollment.create` si « Classe ») | `externalRef` (matricule d'origine, sinon empreinte de la clé naturelle) |
| `guardians` | `people.createGuardian` / `linkGuardian` / `updateGuardian*` | `guardian.manage` | `entity_refs` + `link_exists` |
| `staff` | `people.createStaff` / `updateStaff` | `staff.create` (+ `staff.update`) | `externalRef` |
| `classrooms` | `academic.createClassroom` / `updateClassroom` | `academic.classroom.manage` | code unique + `entity_refs` |
| `curriculum` | `academic.createSubject` / `addCurriculumNode` / `updateCurriculumNode` | `curriculum.manage` (+ `academic.program.manage`) | code + `entity_refs` |
| `enrollments` (O-13) | `academic.enrollStudent` (`sourceKind: IMPORT`) ; résolution des élèves par `people.resolveStudentRefs` | `enrollment.create` | une inscription vivante dans la même classe = ligne ignorée ; aucune fiche élève créée ni modifiée ; pas de politique « mettre à jour » |
| `grades` | `assess.saveGrades` (codes ABS = `ABSENT_UNEXCUSED`, ABJ = `ABSENT_EXCUSED`, DISP = `EXEMPT`) | `grade.enter`, `assessment.manage` | upsert par inscription ; note identique = ignorée |
| `grades_own` (O-02) | idem `grades`, **sans capacité étendue** | `grade.enter` (SANS `assessment.manage`) | idem `grades` |
| `opening_balances` | `finance.createInvoice` (émise) / `issueCreditNote` | `finance.invoice.create` ; **MFA** | `idempotencyKey` de la facture + `entity_refs` |

## Inscriptions (O-13)

Fichier : matricule de l'élève (d'origine, de la plateforme ou numéro d'inscription), code de classe, financement, référence d'affectation, date d'inscription ; option obligatoire **année scolaire** (l'année courante ou celle qui s'ouvre : `DRAFT` / `OPEN`, les autres sont refusées dès le mapping). La **validation est en lecture seule** (aucun cas d'usage d'écriture, même annulé) : élève et classe résolus, dossier élève inscriptible, classe ouverte, financement connu, inscription déjà vivante dans la même classe (ligne **ignorée**, rejeu sans doublon) ou dans une autre classe de l'année (**refus** `academic.class_enrollment_exists` : un changement de classe n'est pas un import), effectif prévisible (avertissement). Doublons du fichier : même élève deux fois = `imports.duplicate_in_file`. L'import écrit par `enrollStudent` : capacité dure, financement, confirmation selon la politique de l'établissement, événement `academic.enrollment.created`. Plafond de lignes, rapport d'erreurs (CSV / XLSX), `VALID_ONLY` ou `ALL_OR_NOTHING`, modèles CSV / XLSX générés : ceux du cadre. Écran : l'assistant `/v2/imports` (descripteur `enrollments`).

## Notes par les enseignants (O-02)

`grades_own` est le MÊME importeur que `grades` (mêmes colonnes, mêmes règles, mêmes clés naturelles) avec un autre périmètre de droits : `imports.import.grades_own` + `grade.enter`, jamais `assessment.manage`. Le périmètre est vérifié **côté serveur par l'affectation d'enseignement** : le port travaille sans capacité étendue, donc `assess` n'ouvre que les évaluations dont l'auteur est l'enseignant **et** encore affecté à la matière dans la classe (`assess.not_assigned` sinon), à chaque lecture (choix, mapping, validation) et à chaque écriture, sous l'identité de l'auteur (le worker rejoue sous son identité, jamais sous celle du système). Une évaluation inconnue, d'un collègue ou d'un autre tenant reçoit la **même réponse** (`imports.options_invalid`) ; un matricule d'une autre classe est indiscernable d'un matricule inconnu (pas d'énumération d'élèves). L'écran ne propose qu'un des deux importeurs de notes : « Notes » si l'utilisateur peut l'utiliser, sinon « Notes de mes classes ».

## Fichiers .xls et .ods : convertisseur isolé (O-11)

Cadrage du 2026-10-05 : « conversion `.xls` / `.ods` par un convertisseur isolé (processus séparé, limites de taille et de durée, sans réseau) ». Code : `infrastructure/files/legacy/` (`convert.ts` côté parent, `child-source.ts` programme de l'enfant, `open.ts` lecteur). Format interne de sortie : IDENTIQUE à `.xlsx` / `.csv` (`TableReader` : en-têtes, lignes de texte, numéros de ligne) ; le type d'origine (`XLS` / `ODS`) est conservé dans `imports.jobs.file_kind` (migration `2401`), et le fichier d'origine est stocké tel quel.

| Mesure | Détail |
|---|---|
| Détection par le contenu | `.xls` : en-tête OLE2 (`D0CF11E0A1B11AE1`) ET flux « Workbook » / « Book » (sinon c'est un autre document Office : refusé) ; `.ods` : archive ZIP dont la partie `mimetype` est `application/vnd.oasis.opendocument.spreadsheet` (un `.odt` est refusé). Le nom et le `Content-Type` ne servent qu'à repérer une incohérence (`imports.file_type_mismatch`). L'enfant revérifie les octets magiques. |
| Processus séparé | `child_process.spawn(process.execPath, …)` jetable par fichier. La bibliothèque `xlsx` n'est jamais chargée dans l'API ni le worker. Le fichier passe par l'entrée standard, le résultat revient en JSON sur la sortie standard : aucun fichier temporaire. |
| Sans variables sensibles | environnement de l'enfant VIDE (`env: {}`), y compris `NODE_OPTIONS`. Sous Windows, le système y ajoute lui-même quelques variables par défaut (`PATH`, `TEMP`, `USERPROFILE`…), sans rapport avec le parent ; le test vérifie qu'aucune variable du parent n'y figure. |
| Sans réseau | l'enfant refuse de charger `net`, `tls`, `dns`, `dgram`, `http(s)`, `http2`, `child_process`, `worker_threads`, `vm`, `inspector`, les addons natifs (`process.dlopen`), et ne contient aucun code réseau ; liens et formules ne sont jamais suivis (testé avec un serveur local : 0 requête). **Limite honnête** : Node ne sait pas couper le réseau d'un processus ; la garantie « dure » est celle du conteneur (pas de sortie réseau superflue) ou d'un espace de noms réseau dédié en production. |
| Modèle de permissions de Node | `--permission` (ou `--experimental-permission` sur Node 20) quand disponible : aucune écriture disque, lecture limitée au dossier `node_modules`, ni processus, ni thread, ni addon. Sans ce modèle (Node trop ancien), seuls les autres garde-fous s'appliquent. |
| Plafonds | taille du fichier (celle de l'import), lignes, colonnes, caractères par cellule (comme `.xlsx`) ; feuilles (`maxSheets` 20) ; tas de l'enfant (`maxHeapMb` 256, `--max-old-space-size`) ; sortie normalisée (`maxOutputBytes` 32 Mio) ; **délai** (`timeoutMs` 15 s, `SIGKILL`) ; 2 conversions simultanées par processus (`maxConcurrent`). Surchargeables par `FileLimits.legacy`. Une seule feuille est lue, plafonnée en lignes (`sheetRows`). |
| Bombe de décompression (`.ods`) | archive inspectée AVANT l'enfant avec les contrôles du `.xlsx` (entrées, noms, tailles déclarées, rapport de compression) PUIS décompression réellement comptée de chaque entrée (une taille déclarée peut mentir) : `imports.file_unsafe`. |
| Rien n'est exécuté | formules : valeur enregistrée lue, jamais recalculée (signalées : `imports.formulas_ignored`) ; liens : ignorés et comptés (`imports.links_ignored`) ; macros (`Basic/`, `Scripts/`, projet VBA) : signalées (`imports.macros_ignored`), jamais lues ; entités XML externes : jamais résolues. |
| Erreurs claires | `imports.file_type_unsupported` / `file_type_mismatch` (type), `file_corrupt` (illisible, protégé par mot de passe), `file_unsafe` (bombe, délai, mémoire, sortie), `too_many_rows` / `too_many_columns`, `sheet_unknown`. Un convertisseur impossible à démarrer donne `imports.conversion_unavailable` (erreur de service, 500), pas un refus du fichier. |
| Isolation entre tenants | le convertisseur est sans état (aucun disque, aucun cache) : un enfant par fichier, jamais réutilisé ; le reste du parcours est celui du cadre (RLS, 404 hors tenant), éprouvé par les tests A/B. |

Dépendance : `xlsx` `^0.18.5`, déjà présente dans le dépôt (`apps/web`, même version dans `pnpm-lock.yaml`) ; ajoutée à `apps/api/package.json` car l'API (et non le worker, dont l'image ne contient que `dist/`) la charge dans l'enfant. Aucun téléchargement : lockfile identique pour cette version. Ses avis publics connus (pollution de prototype, ReDoS, voir `docs/architecture/security-review-v2.md`) sans version corrigée sont la raison de l'isolation ; l'enfant est lancé avec `--disable-proto=delete`. Paquet **non chargé** hors de l'enfant.

Tests : `test/unit/legacy.test.ts` (sans base : lecture, parité avec `.xlsx`, faux `.xls`, `.ods` piégés, bombe, liens, XXE, délai, mémoire, sortie, environnement, permissions, conversions simultanées) et `test/integration/http.integration.test.ts` (parcours HTTP `.xls` / `.ods`, isolation A/B, refus 400).

## Parcours

1. **Upload** `POST /jobs?importer=…&fileName=…` (corps BRUT) : type réel (octets : `.xlsx`, `.csv`, `.xls`, `.ods`), taille, ZIP inspecté puis décompression comptée, DTD refusées, plafonds de lignes / colonnes / cellule, stockage (`StoragePort`), lignes brutes mises en table par lots (flux), empreinte SHA-256, proposition de mapping (modèle enregistré >= 80 % sinon détection par en-têtes).
2. **Mapping** `PUT /jobs/:id/mapping` : champs <-> colonnes, options de l'importeur, politique « existant » (`SKIP` / `UPDATE`).
3. **Validation** `POST /jobs/:id/validate` -> événement -> abonné `imports.validate` (worker) : mapping + coercion + Zod + règles + clé naturelle ; doublons dans le fichier ; **plan** contre l'existant par le port (transaction TOUJOURS annulée).
4. **Erreurs** `GET /jobs/:id/rows?onlyProblems=…&column=…&code=…` ; rapport téléchargeable `GET /jobs/:id/report?format=csv|xlsx&kind=errors|full` (valeurs neutralisées).
5. **Preview** `GET /jobs/:id/preview` : à créer / mettre à jour / ignorer / refuser, sans écriture.
6. **Import** `POST /jobs/:id/run { runMode, onExisting, confirm: true }` -> abonné `imports.run` (worker) : lots transactionnels (`VALID_ONLY`) ou une transaction (`ALL_OR_NOTHING`), bail + battement de coeur, reprise, annulation (`POST /jobs/:id/cancel`).
7. **Rapport** `GET /jobs/:id/summary` : créés, mis à jour, ignorés, en erreur, durée, auteur ; `GET /jobs` historique.

Autres routes : `GET /importers` (descripteurs + `canUse` / `canRun` selon les droits de l'appelant), `GET /importers/:key/template?format=csv|xlsx`, `GET /importers/:key/options/:option/choices`, `GET|POST|PUT|DELETE /templates` (modèles de mapping), `GET|PUT /settings`, `DELETE /jobs/:id` (brouillon sans écriture).

## Permissions (manifeste)

`imports.read`, `imports.create` (téléverser, mapper, valider, prévisualiser : aucune écriture), `imports.import.<importeur>` (lancer ; `opening_balances` est **sensible** : MFA ; `imports.import.grades_own` = notes de SES évaluations ; `imports.import.enrollments` = inscriptions), `imports.cancel`, `imports.template.manage`, `imports.manage` (imports des autres, plafonds). Un importeur exige AUSSI les permissions de son module cible (vérifiées à l'upload, au mapping, à la validation et au lancement). Un import n'est visible que par son auteur ou par `imports.manage` (404 sinon). Attribution côté `rbac` : `secretariat` (élèves, tuteurs, **inscriptions**), `directeur_etudes` (classes, curriculum), `enseignant` / `instituteur` (**notes de leurs classes** : `imports.read`, `imports.create`, `imports.import.grades_own`, `imports.cancel`), `econome` (préparation seulement : `imports.read` et `imports.create`) ; le reste (personnel, notes de toutes les évaluations, soldes d'ouverture, modèles, `imports.manage`) est à la direction (`*`).

## Sécurité des fichiers (INV-S1 à S8, `spec.md` §4.1)

Type réel sur les octets (PDF, images, exécutables, archives non tableur, documents OLE2 non Excel refusés ; incohérence nom / contenu / type annoncé refusée) ; zip-bomb (nombre d'entrées, taille déclarée, rapport de compression, **comptage de la décompression réelle**) ; XML en flux sans DTD ni entité ; formules lues par leur valeur en cache (jamais évaluées), macros ignorées ; plafonds ; **injection de formule neutralisée** dans les CSV / XLSX de rapport (apostrophe, cellules XLSX en texte) ; aucune donnée de ligne dans les événements ni les journaux ; valeurs brutes purgées après `retention_days`. Quotas par tenant (imports actifs, par 24 h), limiteur de débit par utilisateur.

## Événements et jobs

Publiés : `imports.job.created|validation_requested|validated`, `imports.run.requested|started|completed|failed|cancelled` (payload `{ v: 1, … }`, aucune donnée personnelle). Consommé par `tenancy` : `imports.run.completed` complète `STUDENT_IMPORT` (élèves) et `TEACHERS` (personnel).

Abonnés (`subscribers.ts`) : `imports.validate`, `imports.run` (sans `idempotent()` : l'idempotence vient du bail et de l'état). Jobs (`jobs.ts`) : `imports.resume-stalled` (toutes les 30 s : republie les imports dont l'exécutant est mort), `imports.purge` (04:25 : brouillons abandonnés annulés, valeurs brutes et fichiers purgés). **Reconstruire le bundle du worker** après toute modification (`pnpm --filter @ecoledigitale/worker build`).

Variables du worker (facultatives) : `IMPORTS_LEASE_SECONDS` (45), `IMPORTS_HEARTBEAT_MS` (5000), `IMPORTS_MAX_RUN_ATTEMPTS` (5), `IMPORTS_STALE_AFTER_SECONDS` (90). Stockage d'objets requis (`STORAGE_S3_*` ; repli disque de développement).

## Extensions additives des modules cibles

`people.resolveStudentRefs(deps, ctx, refs)` (matricule d'origine ou de la plateforme -> identifiant d'élève, par lots de 500) — nécessaire aux importeurs de tuteurs, de notes et de soldes ; testée (`people/test/integration/student-refs.integration.test.ts`). `tenancy` : abonné `tenancy.onboarding-on-import-completed` (`application/onboarding-events.ts`).

## Performance mesurée

Postgres 17 dans Docker sous Windows (latence d'aller-retour élevée), vrais adaptateurs, élèves sans inscription : upload de 5 000 lignes ~1 s ; validation (plan par `createStudent` à blanc) ~130 s ; import ~9 à 20 lignes/s (22 requêtes par élève dans `people`) ; **mémoire bornée** : pic de tas ~47 Mo en validation et ~42 Mo en import pour 5 000 lignes (≈ 2 fois celui de 200 lignes). Le rejeu d'un fichier déjà importé n'appelle aucun cas d'usage cible (toutes lignes ignorées, aucun doublon, aucun événement `people.student.created` de plus). Mesures et reprise après `SIGKILL` : `apps/api/test/imports/`.

## Tests

```bash
# unitaires (sans base) : domaine, fichiers hostiles (zip-bomb, DOCTYPE, formules, macros, corrompu, mauvais type), registre
pnpm --filter @ecoledigitale/api exec vitest run src/modules/imports/test/unit
# moteur, HTTP, isolation A/B sur Postgres éphémère (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/imports/test/integration
# adaptateurs sur les VRAIS modules cibles ; performance (5 000 lignes, IMPORTS_PERF_ROWS pour réduire)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/imports.integration.test.ts test/imports/performance.integration.test.ts
# vrai worker (bundle) : reprise après SIGKILL, rejeu, annulation (Postgres + Redis éphémères)
cd apps/api && ED_PG_IMAGE=postgres:17-alpine node ../worker/scripts/with-infra.mjs test/imports/worker.integration.test.ts
# écrans
cd apps/web && pnpm exec vitest run src/app/v2/imports
```

Fichiers d'exemple FICTIFS : `test/support/files.ts` (aucune donnée réelle) ; modèles téléchargeables : `GET /importers/:key/template`.

## Limites connues

Voir `specs/v2/031-imports/open-questions.md` (O-01 à O-15) : transaction unique du mode « tout ou rien » (verrous des modules cibles), notes réservées à `assessment.manage`, tuteurs sans `externalRef` (idempotence par table de références), débit borné par les cas d'usage des modules cibles, `.xlsb` et `.fods` non pris en charge ; `.xls` / `.ods` pris en charge par le convertisseur isolé (O-11, ci-dessous).

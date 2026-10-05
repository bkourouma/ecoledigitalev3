# Module `documents` — GED légère multi-tenant

Spec : `specs/v2/024-documents/` (spec, data-model, plan, parity, open-questions). Plage de migrations : **2500-2599** (`2500`-`2504` livrées). Schéma Postgres : `documents`.

Pièces administratives des élèves, du personnel et de l'établissement : **catégories configurables par tenant**, **versions immuables**, **expiration et alertes**, **permissions fines**, **stockage objet** (`StoragePort`), **téléchargement par URL signée courte**, **prévisualisation sûre**, **contrôle des uploads** (octets magiques, liste blanche, taille, nom assaini, SHA-256, antivirus pluggable fail-closed, quarantaine), **audit** de chaque lecture, **purge de rétention**. Les documents **officiels** immuables (bulletins, relevés, diplômes, reçus, bulletins de paie) restent dans `reportcards` / `higher` / `finance` / `payroll` : ce module ne les duplique pas.

## Ce que fait le module

| Besoin | Mécanisme |
|---|---|
| Cinq types (PRD §39) | `STUDENT`, `TEACHER`, `INSTITUTION`, `ACADEMIC`, `FINANCIAL` portés par la **catégorie** ; jeu de départ de 17 catégories créé à la première lecture du tenant (idempotent), modifiable |
| Versions | `versions` immuable (déclencheur SQL `ENABLE ALWAYS` : aucune modification du contenu, aucun `DELETE`, aucun `TRUNCATE`) ; remplacer = version `n+1` ; version identique refusée ; `baseVersion` détecte un dépôt concurrent ; une **clé de stockage par version** |
| Accès | `domain/policy.ts` (pur) : **gestion**, **déposant**, **partage explicite**, **droit de catégorie**, **niveau** (`read` < `read.restricted` < `read.confidential`), **propriétaire** (élève, personnel), **parent = enfants liés** (lien relu à chaque requête) ; visibilité `INHERIT` / `STAFF_ONLY` / `PRIVATE` par document ; invisible = **404 identique** à inexistant ; la **liste SQL applique les mêmes règles** (test de non-divergence acteur x document) |
| Upload | taille (flux borné) → nom (`sanitizeFileName`) → **type réel** (`detectFileType` : PDF, JPEG, PNG, WebP, GIF, TIFF, docx / xlsx / pptx sans macro, doc / xls / ppt, OpenDocument, texte strict) → cohérence extension / type → liste blanche de la catégorie → quota → doublon → **antivirus hors transaction** → objet puis lignes (compensation si échec) |
| Antivirus | port `MalwareScanner` ; adaptateur ClamAV `clamav-tcp` / `clamav-socket` / `clamav-http` ; politique `ScanPolicy` : **fail-closed par défaut en production** ; infecté → **quarantaine** (jamais servi) ; double de test `FakeScanner` (EICAR) |
| Téléchargement | `GET …/download-url` : contrôle, historique, audit, URL signée ≤ 5 min (60 s par défaut), `attachment` |
| Prévisualisation | `GET …/preview` : octets servis par l'API (type réel, `nosniff`, CSP `sandbox` pour image et texte, `no-store`) ; images, PDF, texte ; **Office : port `DocumentConverter`, désactivé par défaut** (feature `documents.office-preview` + `DOCUMENTS_OFFICE_CONVERTER=libreoffice`) ; SHA-256 recalculé (écart = `409 documents.integrity_failed` + événement) |
| Expiration | `expires_on`, seuils document > catégorie > établissement (`30, 7, 1`), job `documents.expiry-sweep` → `documents.document.expiring` (une fois par seuil) puis `documents.document.expired` ; réarmé par un changement d'échéance |
| Archivage | supprimer = archiver (motif obligatoire) ; restauration par la gestion ; purge par rétention (job `documents.housekeeping`) : objets supprimés D'ABORD, contenu descriptif effacé, historique et empreintes conservés. **Q-03 : par défaut, les pièces ne sont JAMAIS purgées** (`archive_retention_days` = 0 = jamais, migration `2503` ; un délai ne s'applique que si l'établissement le choisit, ou par catégorie) |
| Quarantaine | liste, libération motivée (rejoue le dépôt demandé, sans nouvelle analyse, MFA, audit) ou destruction ; rétention de 30 jours |
| Quotas | **Q-05 : 5 Gio (base) / 50 Gio (`documents.storage.extended`) / 250 Gio (`documents.storage.large`)** selon les features accordées par le plan (`domain/quota.ts`), réglage plus strict par établissement, jauge `STORAGE_BYTES` vers `entitlements` ; rattachement recommandé : STARTER = base, PROFESSIONAL = étendu, ENTERPRISE = large (console des entitlements) |
| Recherche dans le texte des PDF (Q-14) | texte extrait **hors de l'API** par le job `documents.text-index` du worker, dans un **processus fils isolé** (taille, pages, durée, mémoire bornées, sans réseau), indexé en `tsvector` (`documents.fr_search` : français sans accents) dans `documents.text_index` ; PDF sans texte (scan) = « sans texte », **pas d'OCR** ; `GET /search` applique **exactement** les droits de la liste (même prédicat SQL + contrôle de la politique du domaine), extraits surlignés, pagination par curseur ; voir la section dédiée plus bas |
| Audit et historique | `runtime.auditPort` (même transaction, en dernier) + `document_events` append-only ; **jamais de titre ni de nom de fichier** dans un événement, une métadonnée d'audit |

## Arborescence

```
manifest.ts   index.ts (API publique)   jobs.ts (alertes, entretien, indexation du texte)   subscribers.ts (aucun)
migrations/   2500 paramètres, catégories, droits de catégorie · 2501 documents, versions, partages, historique, quarantaine · 2502 gardes d'immuabilité · 2503 rétention « jamais » (Q-03) · 2504 index du texte des PDF (Q-14)
domain/       types · policy (accès) · file-policy (nom, octets magiques, taille) · expiry · descriptors · default-categories · events · errors
application/  deps · ports · port-registry · support · uploads · documents · shares · quarantine · categories · housekeeping · text-search
infrastructure/  documents-repository · settings-repository · shares-repository · text-index-repository · clamav-scanner · office-converter · pdf-text-extractor · audit-adapter · in-memory-ports
http/         plugin.ts (`setup` + `default (app, runtime)`) · guards.ts
test/         unit (domaine, adaptateurs, module chargé par le registre) · integration (base réelle : RLS A/B, matrice, versions, uploads, quarantaine, cycle de vie, HTTP)
```

## Tables

Toutes les tables sont **de tenant** (RLS forcée, `isolation-allowlist.documents.ts` vide) et **sans `DELETE` accordé** : `settings`, `categories`, `category_grants`, `documents`, `versions`, `shares`, `document_events`, `quarantine`. Seule exception, justifiée : `text_index` (copie **dérivée** du contenu des PDF, recalculable) reçoit `DELETE`, pour être supprimée avec le document à la purge. Références vers élèves, personnel, comptes : **UUID sans clé étrangère** (port `OwnerDirectory`). Voir `specs/v2/024-documents/data-model.md`.

## Routes (préfixe `/api/v1/documents`, appliqué par le registre)

| Méthode | Chemin | Permission |
|---|---|---|
| GET | `/me/context` · `/categories` | toute permission du module |
| POST / PATCH | `/categories`, `/categories/:id` · POST `/categories/:id/archive\|restore` | `documents.category.manage` |
| GET / POST / DELETE | `/categories/:id/grants[/:grantId]` | `documents.category.manage` |
| GET / PUT | `/settings` (lecture : aussi `manage`) · GET `/usage` | `documents.settings.manage` |
| GET | `/summary` · `/documents` · `/documents/:id` (lecture auditée) | une permission de lecture |
| GET | `/search?q=&categoryId=&kind=&cursor=&limit=` (recherche dans le texte des PDF) | une permission de lecture ; le droit sur chaque document est décidé dans la requête |
| GET / POST | `/search/status` · `/search/reindex` (`{ scope: FAILED \| ALL }`) | `documents.manage` (sensible, MFA) |
| POST | `/documents` (multipart : champs + `file`) | une permission de dépôt (le dépôt réel est décidé par la catégorie et les liens) |
| PATCH | `/documents/:id` | lecture ou dépôt, puis droit d'écriture **sur ce document** |
| POST | `/documents/:id/versions` (multipart) | idem |
| GET | `/documents/:id[/versions/:no]/download-url`, `/preview` · `/documents/:id/history` | lecture ; historique : `documents.history.read` ou déposant |
| POST | `/documents/:id/archive` · `/restore` | `documents.archive` (+ écriture) · `documents.manage` |
| GET / POST / DELETE | `/documents/:id/shares[/:shareId]` | `documents.share` (+ écriture sur le document) |
| GET | `/people?kind=USER\|STUDENT\|STAFF` · `/students/:id/guardians` | `share`, `upload`, `manage` ou `category.manage` |
| GET / POST / DELETE | `/quarantine`, `/quarantine/:id/release`, `/quarantine/:id` | `documents.quarantine.manage` (sensible) |

Statuts spécifiques : `413` (taille, quota), `415` (type), `422` (malware, macro), `410` (objet absent), `409` (doublon, version, archivé, intégrité), `503` (antivirus injoignable en fail-closed, port absent), `429` + `Retry-After`.

Permissions sensibles (MFA) : `documents.read.confidential`, `documents.manage`, `documents.quarantine.manage`. Features : `documents.storage.extended`, `documents.storage.large`, `documents.office-preview`.

## Événements (payload `{ v: 1, … }`, schémas dans `packages/contracts/src/v2/documents.ts`)

`documents.document.created`, `.version_added`, `.updated`, `.shared`, `.unshared`, `.archived`, `.restored`, `.purged`, `.expiring`, `.expired` ; `documents.upload.quarantined` ; `documents.quarantine.released` ; `documents.integrity.mismatch`. **Aucun consommé.** `documents.document.expiring` / `expired` portent `createdBy`, `ownerType`, `ownerId`, `expiresOn`, `daysLeft`, `threshold` : le chantier notifications décide des destinataires.

## Ports (fournis par `apps/api/src/platform/adapters`)

`StoragePort` (`asDocumentsStorage` : S3 / MinIO, repli disque), `OwnerDirectory` (`people-documents` : people + iam), `MalwareScanner` / `ScanPolicy` (`scanPolicyFromEnv`), `DocumentConverter` (`officeConverterFromEnv`), `UsageReporter` (`entitlements-documents`), quota du plan (palier selon les features, calculé par le plugin). Un port non branché fait échouer **fermé** (`documents.port_unavailable`, `503`). Enveloppe `storage-scan` : l'antivirus de la plateforme s'applique aussi aux pièces de `messaging`, aux photos de `people` et aux justificatifs d'`attendance` (sans modifier ces modules).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `STORAGE_*` | — | stockage d'objets partagé (voir `platform-assembly.md` §8) |
| `DOCUMENTS_SCANNER` | `none` | `none`, `clamav-tcp`, `clamav-socket`, `clamav-http` |
| `DOCUMENTS_CLAMAV_HOST`, `_PORT` (3310), `_SOCKET`, `_URL`, `_TIMEOUT_MS` (30000) | — | joignabilité de l'antivirus ; `StreamMaxLength` de clamd ≥ `DOCUMENTS_HARD_MAX_BYTES` |
| `DOCUMENTS_SCAN_FAIL_CLOSED` | vrai en production | antivirus injoignable : refuser (`503`) ou stocker `UNSCANNED` |
| `DOCUMENTS_HARD_MAX_BYTES` | 52 428 800 (50 Mio, plafond 100 Mio) | taille maximale absolue d'un fichier |
| `DOCUMENTS_SIGNED_URL_TTL_SECONDS` | 60 (≤ 300) | durée des URL de téléchargement |
| `DOCUMENTS_QUOTA_BASE_BYTES`, `_EXTENDED_BYTES`, `_LARGE_BYTES` | 5 / 50 / 250 Gio | quota du plan selon les features (entier positif en octets, sinon défaut) |
| `DOCUMENTS_OFFICE_CONVERTER` | `off` | `off` ou `libreoffice` (conteneur isolé sans réseau uniquement) |
| `DOCUMENTS_SOFFICE_PATH`, `DOCUMENTS_OFFICE_TIMEOUT_MS` | `soffice`, 60000 | LibreOffice |
| `DOCUMENTS_PDF_PARSER_PATH` | résolu depuis `node_modules` | chemin de `pdf-parse/lib/pdf-parse.js` ; **obligatoire** quand le worker est un bundle sans `node_modules` (sinon la file d'indexation attend, voir « Déploiement ») |
| `DOCUMENTS_PDF_MAX_BYTES`, `_MAX_PAGES`, `_MAX_CHARS` | 20 Mio, 200, 500 000 | limites d'une extraction (au-delà : refus, ou texte tronqué et marqué `truncated`) |
| `DOCUMENTS_PDF_TIMEOUT_MS`, `_MAX_MEMORY_MB` | 20000, 256 | durée (puis `SIGKILL`) et mémoire du processus fils |
| `DOCUMENTS_PDF_SANDBOX` | `permission` | `permission` (modèle de permissions de Node : lecture limitée à `node_modules`, ni écriture, ni processus, ni worker) ou `none` (Node trop ancien) |

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/documents                 # unitaires (sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/documents   # + intégration
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/documents-ged   # adaptateurs réels
```

Recherche dans le texte des PDF : `unit/pdf-text-extractor.test.ts` (vrais processus fils : texte, accents, pages, caractères, scan, corrompu, taille, **PDF piégé** contre un serveur local, bombe de décompression, environnement vide), `integration/text-search.integration.test.ts` (extraction réelle + index : file, **RLS A/B**, matrice d'acteurs identique à la liste avec absence de toute fuite d'extrait, partage / visibilité / lien de tuteur, versions, course, purge, réindexation, audit) et `integration/text-search.http.integration.test.ts` (permissions, validation, contrats, limiteur).

Unitaires : politique d'accès (matrice R1..R7), octets magiques, nom assaini, expiration, ClamAV (clamd et passerelle simulés), convertisseur, registre. Intégration : RLS A/B, matrice parent / enseignant / élève / personnel / gestion croisée avec la liste SQL, versions et immuabilité (même propriétaire de la base), URL signées expirées, EICAR / quarantaine / fail-closed, quotas, archivage / purge, alertes d'expiration idempotentes, HTTP complet (multipart, statuts, limiteur).

## Recherche dans le texte des PDF (Q-14)

**Chaîne** : dépôt d'un PDF (ou d'une version) → la même transaction crée / réinitialise sa ligne `text_index` (`PENDING`, ancien texte effacé) → le job `documents.text-index` (chaque minute, par tenant) réserve un lot avec un bail, lit l'objet, appelle le port `PdfTextExtractor` **hors transaction**, puis écrit le résultat et l'audit dans une transaction (résultat ignoré si une version plus récente est arrivée entre-temps). Statuts : `PENDING`, `INDEXED`, `NO_TEXT` (PDF sans couche de texte, **pas d'OCR** ; moins de 12 caractères alphanumériques), `FAILED` (code : `corrupt`, `encrypted`, `too_large`, `timeout`, `memory`, `crashed`, `object_missing`, `index_error`). Un échec réessayable (délai, plantage) est repris 3 fois avec attente croissante ; un extracteur absent laisse la file en attente sans consommer d'essai.

**Extraction isolée** (`infrastructure/pdf-text-extractor.ts`) : processus Node fils lancé sans shell, code passé en chaîne (`node -e`, rien à déployer à côté du bundle), environnement vide (aucune variable de l'application), PDF par l'entrée standard, JSON en sortie. Limites : 20 Mio, 200 pages, 500 000 caractères, 20 s (puis `SIGKILL`), 256 Mio de mémoire, `--disallow-code-generation-from-strings` (ni `eval` ni `new Function`), modèle de permissions de Node (`--permission` : lecture limitée au dossier `node_modules` de l'analyseur, aucune écriture, aucun processus enfant, aucun worker). Analyseur : `pdf-parse` (pdf.js), **déjà présent dans `apps/api`** (aucune dépendance ajoutée). Le fils remplace en outre `net`, `dns`, `dgram`, `child_process`, `worker_threads` par des fonctions qui refusent (HTTP, HTTPS, TLS, `fetch` passent par `net.Socket.connect`) : un PDF piégé (URI, JavaScript, lancement de programme, actions automatiques) est lu pour son texte seulement et n'ouvre aucune connexion (testé contre un serveur local).

**Droits** : la requête de recherche joint l'index au prédicat de visibilité de la liste (`visibilityPredicate`, mêmes règles R1..R7 : gestion, déposant, partage, droit de catégorie, niveau, propriétaire, tuteur lié relu à chaque requête, `STAFF_ONLY`, `PRIVATE`), n'accepte que les documents `ACTIVE` dont la version indexée est la version **courante**, puis chaque ligne est revérifiée par `resolveAccess` du domaine. Aucun total, aucun message distinguant « illisible » de « sans résultat ». Les extraits sont calculés **après** le filtrage, sur la page demandée seulement. Le texte brut n'est jamais renvoyé : l'extrait est une liste de segments `{ text, match }` en **texte brut** (jamais du HTML ; le web les rend sans `dangerouslySetInnerHTML`). Un extrait d'un document confidentiel est une lecture : événement `VIEWED` (`via: text_search`) dans l'historique du document et audit sensible `documents.search.executed` (identifiants des documents confidentiels, longueur et empreinte courte de la requête, **jamais** son texte).

**Index** : configuration `documents.fr_search` = `french` + dictionnaire `unaccent` (extension contrib déjà créée par 2500) quand il existe, `french` seul sinon ; syntaxe `websearch_to_tsquery` (mots requis, « expression exacte », `-exclu`, `OR`), classement `ts_rank_cd`, pagination par curseur `(pertinence, identifiant)`. `text_index` : RLS forcée, GIN sur `tsv`. Aucun OCR, aucune extension système.

**Cycle de vie** : nouvelle version → ancien texte effacé immédiatement (jamais de texte périmé) ; version non-PDF → ligne supprimée ; archivage → hors recherche, texte conservé (restauration sans réextraction) ; purge de rétention → ligne supprimée avec le document ; **réindexation de l'existant** : la migration 2504 met en file tous les PDF déjà déposés, et `POST /search/reindex` (`FAILED` ou `ALL`, gestion + MFA, auditée) relance les échecs ou reconstruit tout (y compris les PDF sans ligne ; pendant la reconstruction la recherche dans le contenu est incomplète).

**Audit** : `documents.search.executed` (recherche), `documents.text_index.indexed` / `.failed` (par document, codes seulement, jamais d'extrait), `documents.text_index.reindex_requested` (sensible).

**Déploiement (à lire)** : l'image du worker de production ne contient que `dist/` (bundle esbuild) : `pdf-parse` n'y est pas résoluble. Il faut soit y copier `node_modules/pdf-parse` et ses dépendances et poser `DOCUMENTS_PDF_PARSER_PATH`, soit étendre le build du worker. Sans cela, le job journalise « extracteur de texte PDF indisponible » et la file attend (rien n'est perdu ni marqué en échec). La garde réseau du fils est une défense en profondeur : l'**isolation réseau réelle** doit venir du conteneur du worker (pas de sortie réseau pour le processus qui extrait, comme pour le convertisseur Office).

## Limites connues

- Pas de re-scan des fichiers existants ; **pas d'OCR** (un PDF scanné est marqué « sans texte »), la recherche dans le contenu ne couvre que les PDF (pas Office, pas texte brut) ; pas de partage externe ; pas de circuit de validation d'un dépôt de parent (voir `open-questions.md`).
- Les pièces déjà stockées par `people` (`attachment_object_key`), `attendance` et `messaging` ne sont pas migrées (voir `parity.md` §3).
- La prévisualisation passe par l'API puis un objet blob : une origine dédiée sans cookie reste recommandée (Q-08).

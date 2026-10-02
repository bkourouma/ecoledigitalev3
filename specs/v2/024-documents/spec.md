# Feature Specification: Gestion documentaire (024-documents)

**Feature Branch**: `024-documents`

**Created**: 2026-10-02

**Status**: Rédigée et implémentée (module backend `documents`, schéma Postgres `documents`, migrations `1800`-`1899`). DDL et choix de modélisation : `data-model.md` ; plan et lots : `plan.md` ; inventaire du legacy : `parity.md` ; décisions à arbitrer : `open-questions.md`.

**Sources** : `docs/PRD_EcoleDigitale_SaaS.md` §39 (« GED légère intégrée », cinq types, catégories, versions, expiration, permissions, historique, stockage objet, prévisualisation, téléchargement contrôlé) ; plan `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.10 (`StoragePort` S3/MinIO, table `documents`, contrôle du type réel, hook antivirus) et §4 phase 3 ; ADR-001, 002, 004, 006, 007 ; `docs/architecture/{module-conventions,new-module-guide,platform-assembly}.md` ; `apps/api/src/modules/reportcards/README.md` (documents officiels immuables : **hors périmètre**, voir §2).

> Le legacy n'a **pas** de GED : des fichiers servis depuis le disque (`routes/files.ts`), des supports de cours (`routes/materials.ts`), des PDF générés à la volée et des chemins locaux dans des colonnes `minio_key`. Aucun contrôle du type réel, aucune version, aucune expiration, aucune permission au document, aucun journal de lecture. Cette spec les remplace, pour les **pièces administratives**, par un modèle unique (inventaire : `parity.md`).

## 1. Objectifs

1. **Une GED légère multi-tenant** pour les pièces de l'établissement : dossiers d'élèves (pièces d'identité, certificats médicaux, bulletins antérieurs), dossiers du personnel (contrats, diplômes, habilitations), documents de l'établissement (règlement intérieur, agréments, assurances), documents académiques (programmes, circulaires), documents financiers (justificatifs, pièces comptables).
2. **Cinq types** : `STUDENT` (StudentDocument), `TEACHER` (TeacherDocument), `INSTITUTION`, `ACADEMIC`, `FINANCIAL` — **catégories configurables par tenant** (jeu de départ fourni, modifiable ; liste blanche d'extensions, taille maximale, niveau de confidentialité, audiences, expiration obligatoire, rétention par catégorie).
3. **Versions immuables** : remplacer un fichier crée une version `n+1` ; l'historique complet reste consultable ; aucune version n'est modifiée ni supprimée (la purge de rétention retire l'**objet**, pas la trace).
4. **Expiration et alertes** : date d'expiration par document, seuils d'alerte configurables, événements `documents.document.expiring` / `documents.document.expired` consommés par le chantier notifications.
5. **Permissions fines**, évaluées côté serveur, sans rôle codé en dur : permissions RBAC (niveaux de lecture), **héritage de catégorie**, **propriétaire** (l'élève, le membre du personnel concerné), **parent = enfants liés** (lien revérifié à chaque appel), **partage explicite** (personne, durée, lecture ou dépôt de versions), droits de catégorie par personne, visibilité par document ; **jamais de fuite entre tenants** (RLS + clés composites).
6. **Stockage objet** par `StoragePort` (adaptateur S3/MinIO existant, repli disque en développement) ; **téléchargement contrôlé** par URL signée courte ; **prévisualisation** sûre (PDF, images, texte ; Office par conversion PDF optionnelle derrière un port, **désactivée par défaut**).
7. **Contrôle des uploads** : type réel par octets magiques, liste blanche d'extensions par catégorie, taille maximale configurable, nom assaini, SHA-256 (dédoublonnage, intégrité), port `MalwareScanner` pluggable (ClamAV par socket ou HTTP), **fail-closed en production** si activé, **quarantaine**.
8. **Audit** de chaque lecture, téléchargement, partage et suppression logique ; **suppression = archivage** ; **purge** par rétention configurable (job).
9. **Recherche** : nom, titre, catégorie, propriétaire, métadonnées, étiquettes.
10. **Intégrations** : `DocumentPicker` réutilisable pour les autres écrans ; adaptateurs d'analyse antivirus pour les pièces de `messaging`, `people` et `attendance` ; compteur d'usage de stockage vers `entitlements` ; quotas par plan.

## 2. Périmètre

### Inclus

- Catégories (CRUD, archivage), droits de catégorie par personne, paramètres d'établissement.
- Documents : dépôt (fichier + métadonnées), nouvelles versions, métadonnées (titre, description, étiquettes, métadonnées libres bornées), propriétaire (élève, personnel, ou aucun), visibilité, expiration, archivage / restauration, partages, historique.
- Téléchargement par URL signée, prévisualisation, recherche paginée par curseur, filtres (catégorie, type, propriétaire, statut, expiration).
- Contrôle d'upload complet, quarantaine (consultation, libération motivée, destruction), quotas de stockage.
- Jobs : alertes d'expiration (quotidien), entretien (purge de rétention, purge de quarantaine).
- API `/api/v1/documents/*`, contrats Zod, événements `documents.*`, écrans `/v2/documents/*`, `DocumentPicker`.

### Exclu (renvoyé)

| Sujet | Renvoi |
|---|---|
| Documents **officiels** immuables, signés, vérifiables par QR (bulletins, relevés, diplômes, reçus, bulletins de paie) | `reportcards` (013) et `higher` (019) ; `documents` n'en expose que **l'intégration** : une catégorie peut référencer un document officiel par `metadata.officialDocumentId` (lecture seule, le contrôle d'accès reste celui du module propriétaire) — voir §10 |
| Modèles de documents générés (attestations simples, conventions) | `reportcards` (gabarits) / `higher` |
| Envoi des alertes (e-mail, SMS, WhatsApp, push, in-app) | chantier notifications : il consomme `documents.document.expiring` |
| Signature électronique, OCR, extraction de texte, indexation plein texte du **contenu** | hors V1 (`open-questions.md`) |
| Antivirus embarqué | un scanner externe (ClamAV) est branché par configuration ; sans scanner, les fichiers sont marqués `UNSCANNED` |
| Chiffrement applicatif par locataire (clés par tenant) | chiffrement au repos du stockage (SSE) ; clés par tenant hors V1 |
| Dossiers et arborescences libres | l'explorateur navigue par catégorie, type et propriétaire (pas de dossiers arbitraires : moins de permissions à héritage ambigu) |
| Partage par lien public ou externe | hors V1 ; seules des personnes du tenant reçoivent un partage |
| Remplacement des colonnes `attachment_object_key` / `photo_object_key` de `people`, des justificatifs de `attendance`, des pièces de `messaging` | consigné dans `parity.md` : adaptateurs d'analyse livrés, migration des données hors de ce lot |

## 3. Acteurs et permissions

Permissions déclarées dans `manifest.ts` (conventions de portée : `.child.*` parent, `.self.*` élève, `.own.*` personnel). Les rôles système (module `rbac`, `templates/system-roles.ts`) les reçoivent comme indiqué ; aucun rôle n'est codé en dur dans le module.

| Permission | Qui (rôles système) | Effet |
|---|---|---|
| `documents.read` | personnel (direction des études, secrétariat, économat, enseignants, éducateurs, responsables pédagogiques) | lire les documents de niveau **INTERNAL** (règlement, programmes, circulaires) |
| `documents.read.restricted` | direction des études, secrétariat, économat | + niveau **RESTRICTED** (dossiers d'élèves, pièces financières) |
| `documents.read.confidential` (**sensible**, MFA) | direction (`*`) | + niveau **CONFIDENTIAL** (dossiers médicaux, contrats, comptabilité) |
| `documents.upload` | direction des études, secrétariat, économat | déposer des documents et de nouvelles versions |
| `documents.share` | direction des études, secrétariat | partager un document (ou retirer un partage) |
| `documents.archive` | direction des études | archiver (suppression logique) |
| `documents.manage` (**sensible**) | direction (`*`) | tous les documents, tous niveaux, y compris archivés : corriger, restaurer, partager |
| `documents.history.read` | direction des études, secrétariat | consulter l'historique d'un document (lectures, téléchargements, partages) |
| `documents.category.manage` | direction (`*`) | catégories et droits de catégorie par personne |
| `documents.settings.manage` | direction (`*`) | taille maximale, quota, seuils d'alerte, rétention |
| `documents.quarantine.manage` (**sensible**) | direction (`*`) | lister, libérer (motif obligatoire) ou détruire les fichiers en quarantaine |
| `documents.child.read` / `documents.child.upload` | parent | lire / déposer des pièces concernant ses enfants **liés**, dans les catégories qui l'autorisent |
| `documents.self.read` / `documents.self.upload` | élève | idem pour ses propres pièces |
| `documents.own.read` / `documents.own.upload` | personnel (tous rôles) | idem pour ses propres documents de personnel (contrat, diplômes) |

## 4. Règles d'accès (cœur de la spec — `domain/policy.ts`, pur, éprouvé par une matrice)

Les droits RBAC disent **quel niveau** d'action ; le module décide **sur quel document**. Les liens de l'acteur (fiche élève de son compte, enfants dont il est tuteur, fiche de personnel) sont résolus par le port `OwnerDirectory` (people) à **chaque appel** (jamais lus d'un jeton ni d'un en-tête client). Un compte sans fiche liée n'a aucun droit « propriétaire » ni « parent » (échec fermé).

### 4.1 Voir (métadonnées, historique des versions, prévisualisation, téléchargement)

Un document est visible si **au moins une** règle s'applique ; un document archivé n'est visible que par `documents.manage` :

| Règle | Condition |
|---|---|
| R1 gestion | `documents.manage` |
| R2 déposant | l'acteur a déposé le document **et** (détient `documents.upload` **ou** son lien propriétaire / parent est toujours valide) |
| R3 partage explicite | partage actif (non révoqué, non expiré) à son nom |
| R4 droit de catégorie | droit de catégorie actif à son nom |
| R5 niveau | visibilité ≠ `PRIVATE` **et** l'acteur détient la permission du niveau de la catégorie (`read` < `read.restricted` < `read.confidential`, chaque niveau inclut les précédents) |
| R6 propriétaire | visibilité `INHERIT`, catégorie « audience propriétaire », document sur **lui-même** (élève : `documents.self.read` + fiche liée ; personnel : `documents.own.read` + fiche liée) |
| R7 parent | visibilité `INHERIT`, catégorie « audience tuteurs », document d'un élève dont il est **tuteur lié** (`documents.child.read`) |

Visibilité d'un document : `INHERIT` (règles de la catégorie), `STAFF_ONLY` (R6 et R7 désactivées : note de vie scolaire, mention interne), `PRIVATE` (R5, R6 et R7 désactivées : seuls la gestion, le déposant et les partages explicites voient). Un document inexistant, d'un autre tenant, ou non visible répond **404 identique** (aucune fuite d'existence).

### 4.2 Écrire (nouvelle version, métadonnées, archivage)

Droit d'écriture = R1, ou R2 (déposant avec droit de dépôt), ou partage `WRITE`, ou droit de catégorie `WRITE`, ou **personnel autorisé** : `documents.upload` **et** accès par R5. Un parent, un élève ou un membre du personnel ne dépose que sur lui-même / ses enfants liés, **dans une catégorie « dépôt par le propriétaire »**. `documents.archive` est exigée en plus pour archiver ; la restauration est réservée à `documents.manage`.

Créer dans une catégorie : `documents.upload` **et** la permission du niveau de la catégorie (un enseignant ne dépose pas dans une catégorie CONFIDENTIAL), ou droit de catégorie `WRITE`, ou dépôt par le propriétaire (§ci-dessus). Un document `STUDENT` exige un élève existant du tenant ; `TEACHER`, un membre du personnel existant ; les trois autres types : propriétaire facultatif.

### 4.3 Partager

`documents.share` **et** droit d'écriture sur le document. Cible : une personne du tenant (identité IAM), niveau `READ` ou `WRITE`, date de fin facultative (jamais dans le passé), note. Partager à soi-même est refusé. Retirer un partage est tracé (jamais effacé). Un partage ne donne jamais accès à un document archivé.

### 4.4 Droits de catégorie par personne

`documents.category.manage` accorde (ou retire, avec date de fin facultative) à une personne un droit `READ` ou `WRITE` sur **toute** une catégorie : « le médecin scolaire lit les certificats médicaux ». Révocation tracée.

## 5. Versions

- `POST /documents/:id/versions` crée la version `n+1` ; la version courante est celle de plus grand numéro. Les versions antérieures restent téléchargeables par qui voit le document (historique complet).
- Un fichier **identique à la version courante** (même SHA-256) est refusé (`documents.version_identical`). Plafond `max_versions` (50 par défaut, paramétrable).
- Une version est **immuable** (déclencheur SQL) : ni modification du contenu, ni suppression. Seuls changent : l'état (`ACTIVE` → `PURGED` par la rétention), la rendition de prévisualisation (dérivée).
- Le nom de fichier est celui de la version (assaini) ; le titre du document est stable.
- Catégorie à **expiration obligatoire** : une nouvelle version après échéance (ou sans échéance connue) **doit** fournir une nouvelle date d'expiration.

## 6. Expiration et alertes

- `expires_on` (date calendaire, fuseau de l'établissement non requis), seuils d'alerte en jours : document > catégorie > paramètres d'établissement (`30, 7, 1` par défaut).
- Job quotidien `documents.expiry-sweep` : pour chaque document actif dont l'échéance franchit un seuil non encore notifié, publie **une** fois `documents.document.expiring` (`{ v: 1, documentId, categoryId, kind, ownerType, ownerId, createdBy, expiresOn, daysLeft, threshold }`, **aucun titre ni nom de fichier**) et enregistre les seuils émis ; une fois l'échéance passée, `documents.document.expired`. Changer la date d'expiration (ou déposer une version avec une nouvelle date) **réarme** les alertes. Idempotent (seuils persistés dans la même transaction que l'événement).
- Écran « Expirations » : à échoir sous N jours, échus, sans date alors que la catégorie l'exige.

## 7. Contrôle des uploads (domaine pur + ports)

Ordre des contrôles (les moins coûteux d'abord, le scanner en dernier) :

1. **Taille** : > 0 et ≤ `min(max de la catégorie ?? max de l'établissement, plafond plateforme)` ; la lecture est **bornée en flux** (jamais plus de `max + 1` octets en mémoire).
2. **Nom assaini** : composante finale seulement (aucun chemin), normalisation Unicode NFC, caractères de contrôle et marques bidirectionnelles supprimés, caractères réservés (`<>:"/\|?*`) remplacés, noms réservés Windows et points / espaces finaux traités, 120 caractères conservant l'extension, **extension intermédiaire dangereuse refusée** (`facture.exe.pdf`).
3. **Type réel par octets magiques** : PDF, JPEG, PNG, WebP, GIF, TIFF, documents Office OOXML (docx, xlsx, pptx — **macros refusées** : `vbaProject.bin`), Office 97 (doc, xls, ppt : en-tête OLE + extension cohérente), OpenDocument (odt, ods, odp), texte (txt, csv : UTF-8 valide, aucun octet nul, pas de balisage HTML / XML / SVG). Le type déclaré par le client n'est **jamais** cru.
4. **Cohérence extension / type** (`.pdf` portant du JPEG est refusé) puis **liste blanche d'extensions de la catégorie**.
5. **Quota de stockage** du tenant (usage + taille ≤ quota) ; **dédoublonnage** : même SHA-256 sur un document actif, même catégorie, même propriétaire **que l'acteur voit** → `409 documents.duplicate` (avec l'identifiant) ; aucune information sur des documents que l'acteur ne voit pas.
6. **Antivirus** (port `MalwareScanner`) hors transaction. `INFECTED` → fichier conservé en **quarantaine** (clé dédiée, jamais servi), upload refusé (`422 documents.malware_detected`), événement et audit. Scanner injoignable : **fail-closed** (`503 documents.scan_unavailable`, rien n'est stocké) si la politique l'exige (par défaut en production dès qu'un scanner est configuré) ; sinon le fichier est stocké `UNSCANNED`.
7. Écriture : objet (clé propre à la version) puis ligne, événements, historique et audit dans **une** transaction ; échec → l'objet est supprimé (compensation).

**Quarantaine** : la libération (`documents.quarantine.manage`, MFA, motif obligatoire) crée le document ou la version initialement demandée, **sans nouveau scan automatique** (décision humaine tracée) ; la destruction supprime l'objet ; la rétention de quarantaine (30 jours) détruit les objets non traités.

**Téléchargement** : `GET …/download-url` contrôle l'accès, journalise, puis émet une **URL signée de ≤ 5 min** (60 s par défaut) avec `Content-Disposition: attachment` et le type détecté ; jamais de chemin disque. **Prévisualisation** : `GET …/preview` sert les octets **par l'API** après contrôle d'accès, avec `Content-Type` détecté, `X-Content-Type-Options: nosniff`, `Content-Security-Policy` restrictive, `Cache-Control: no-store` ; types : images, PDF, texte ; Office via `DocumentConverter` (feature `documents.office-preview` **et** configuration), sinon `415 documents.preview_unavailable`. Le SHA-256 est recalculé à la prévisualisation : un écart (objet altéré) répond `500 documents.integrity_failed` et est journalisé.

## 8. Archivage, rétention, purge

- **Supprimer = archiver** (`POST /documents/:id/archive`, motif) : le document disparaît des listes, reste lisible par la gestion, restaurable (`POST /documents/:id/restore`). La date de purge = date d'archivage + rétention (catégorie > établissement ; `0` = jamais).
- Job `documents.housekeeping` (quotidien) : purge les documents archivés échus (objets supprimés, versions `PURGED` avec nom de fichier masqué, titre / description / étiquettes / métadonnées effacés ; l'historique et les empreintes restent) ; détruit les fichiers de quarantaine échus. L'objet n'est retiré que **si** la suppression de stockage réussit (échec → la ligne reste, le job réessaie).

## 9. Audit, historique, événements

- **Audit** (`runtime.auditPort`, même transaction, en dernier) : `documents.document.created|version_added|updated|read|previewed|downloaded|shared|unshared|archived|restored|purged`, `documents.category.*`, `documents.settings.updated`, `documents.quarantine.*`. Lecture d'un niveau CONFIDENTIAL : gravité `notice`.
- **Historique du document** (`document_events`, append-only) : mêmes faits, avec l'acteur et l'instant ; consultable avec `documents.history.read` (ou par la gestion, ou le déposant).
- **Événements** (`{ v: 1, … }`, identifiants seulement) : `documents.document.created`, `.version_added`, `.updated`, `.shared`, `.unshared`, `.archived`, `.restored`, `.purged`, `.expiring`, `.expired`, `documents.upload.quarantined`, `documents.quarantine.released`, `documents.integrity.mismatch`.

## 10. Intégrations

| Avec | Intégration |
|---|---|
| `entitlements` | features `documents.storage.extended` / `documents.storage.large` (paliers de quota), `documents.office-preview` ; mesure `STORAGE_BYTES` (jauge) mise à jour après chaque dépôt / purge via l'adaptateur `entitlements-documents` |
| `people` | adaptateur `people-documents` : élève / personnel existants, noms d'affichage, liens de l'acteur (fiche élève, enfants, fiche de personnel), identités des tuteurs d'un élève (partage rapide). Les colonnes `document_ref` de `people.student_prior_education` et `people.staff_contracts` référencent déjà `documents.documents.id` |
| `messaging`, `people` (photos), `attendance` (justificatifs) | adaptateur `storage-scan` : `put` analysé par le `MalwareScanner` de la plateforme (fail-closed selon la politique) sans modifier ces modules |
| `reportcards`, `higher`, `finance`, `payroll` | aucun doublon : leurs documents officiels restent chez eux ; l'explorateur peut afficher une **référence** (lien) |
| notifications | consomme `documents.document.expiring` / `expired` |
| web | `DocumentPicker` (sélection ou dépôt d'un document depuis un autre écran), `OwnerDocumentsPanel` |

## 11. Écrans (`/v2/documents/*`)

Explorateur (par catégorie, type, propriétaire, recherche, filtres d'état et d'expiration) · dépôt par **glisser-déposer ET sélecteur de fichier accessible au clavier** (zone focalisable, `Entrée` / `Espace`, annonce vocale du résultat) · détail (métadonnées, versions, prévisualisation, téléchargement, partages, historique) · expirations · catégories · quarantaine · paramètres et usage de stockage. Mobile-first, accessibles (rôles ARIA, focus visible, libellés, états d'erreur annoncés), libellés fr-CI `v2Documents*`, client typé `platform/v2/documents.ts`, `usePermission` / `useFeature` pour l'affichage (la barrière réelle reste l'API).

## 12. Critères d'acceptation (extraits vérifiés par les tests)

| ID | Critère |
|---|---|
| AC-1 | Un fichier dont le contenu ne correspond pas à son extension (`.pdf` contenant du JPEG, exécutable renommé) est refusé ; le `Content-Type` déclaré est ignoré |
| AC-2 | `facture.exe.pdf`, `..\..\x.pdf`, nom à marque bidirectionnelle : nom assaini ou refusé, jamais de chemin |
| AC-3 | Remplacer un document crée la version 2 ; la version 1 reste téléchargeable ; aucune version ne peut être modifiée ni supprimée (même par le propriétaire de la base) |
| AC-4 | Parent : voit les pièces **autorisées par la catégorie** de ses enfants liés, jamais celles d'un élève non lié, jamais `PRIVATE`/`STAFF_ONLY` ; le lien est revérifié (un lien retiré coupe l'accès à la requête suivante) |
| AC-5 | Enseignant : lit INTERNAL, jamais RESTRICTED / CONFIDENTIAL sans permission, ne dépose pas dans une catégorie de niveau supérieur |
| AC-6 | Tenant A ne voit, ne télécharge, ne partage jamais un document du tenant B (RLS, 404 identique) |
| AC-7 | URL signée expirée refusée ; URL émise ≤ 5 min ; chaque téléchargement est audité |
| AC-8 | EICAR : upload refusé (`422`), objet en quarantaine, jamais téléchargeable ; scanner HS en mode fail-closed : `503`, rien stocké |
| AC-9 | `documents.document.expiring` publié une fois par seuil franchi, réarmé par un changement de date |
| AC-10 | Archiver masque, restaurer rend ; la purge supprime l'objet et efface le contenu descriptif, garde la trace |
| AC-11 | Le quota de stockage bloque un dépôt qui le dépasserait (`413 documents.quota_exceeded`) ; l'usage est reporté à `entitlements` |
| AC-12 | Dépôt possible **au clavier seul** (sélecteur accessible), résultat annoncé |

## 13. Cas limites

Document dont la fiche élève est anonymisée (le document reste, le propriétaire est affiché « élève supprimé ») · élève dont le tuteur est délié (accès coupé, dépôts conservés) · catégorie archivée (documents conservés lisibles, plus de dépôt) · changement de niveau d'une catégorie (effet immédiat : héritage) · changement de catégorie d'un document (même type seulement ; recontrôle des extensions et de la taille) · version dont l'objet a disparu (`410 documents.object_missing`, événement) · dépôt concurrent de deux versions (numéro attribué sous verrou du document ; l'autre reçoit `409 documents.version_conflict` si `baseVersion` fourni) · gros fichier (rejeté avant lecture complète) · nom de fichier unicode (conservé en NFC, `filename*` à l'émission) · tenant sans stockage configuré (`documents.port_unavailable`, jamais de disque silencieux en production).

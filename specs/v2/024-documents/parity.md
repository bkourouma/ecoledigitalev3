# Parité legacy -> v2 — Gestion documentaire (spec 024)

## 0. En-tête

**Objet.** Inventaire de ce que le legacy EcoleDigitale fait en matière de fichiers et de documents, et, pour chaque élément, son sort dans la v2 : **conservé**, **amélioré**, **abandonné** (justifié) ou **hors module** (chantier porteur). Le legacy n'a pas de GED : ses « documents » sont des fichiers servis depuis le disque, des supports de cours et des PDF générés.

**Sources lues.** `apps/api/src/routes/{files,materials,parent-documents}.ts`, `services/{fileStorage,owner-documents.service}.ts`, `infra/scripts/migrations/0041_documents_export_jobs.sql`, `docs/PRD_EcoleDigitale_SaaS.md` §39. (`services/document-generation.service.ts` et `jobs/document-automation.job.ts` cités par la demande n'existent plus dans l'arbre : la génération documentaire est déjà portée par `reportcards` — PDF unique par Puppeteer — et `higher`.)

**Légende.** conservé = règle reproduite ; amélioré = reproduite avec correction ; abandonné = non reprise (justifiée) ; hors module -> chantier = portée ailleurs.

## 1. Tables et stockage

| ID | Legacy | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| T-01 | `documents` (0041 : `convention`, `attestation_presence`, `attestation_reussite`, `devis`, `facture`, `facture_groupee`) | hors module -> `reportcards` / `higher` / `finance` | documents officiels générés (gabarits, scellement, QR) | ce sont des documents **générés**, pas des pièces déposées ; la GED n'en expose que des références |
| T-02 | `export_jobs` | hors module -> imports/exports (031) | — | exports de données, pas de documents |
| T-03 | Colonnes `minio_key` contenant des chemins disque | amélioré | `versions.storage_key` + `StoragePort` (S3/MinIO, repli disque dev) | fin du stockage disque en production |
| T-04 | Fichiers du disque `FileStorageService` (`baseDirectory/tenant/course/…`, extensions libres, 100 Mio) | amélioré | stockage objet, clé par version, liste blanche, plafond configurable | assainissement par remplacement de caractères seulement, aucun contrôle du type réel, horodatage dans le nom |
| T-05 | Supports de cours (`materials`, types déclarés `SUPPORTED_FILE_TYPES`) | hors module -> `lms` (022, après V1) | — | le contenu pédagogique n'est pas de la GED administrative |
| T-06 | Rendus d'étudiants (`submissions`) | hors module -> `lms` | — | idem |

## 2. Fonctions et endpoints

| ID | Legacy | Statut | v2 |
|---|---|---|---|
| F-01 | `POST /files/upload` : type **déclaré** `application/pdf`, pas d'autre contrôle | amélioré | octets magiques + liste blanche par catégorie + taille + nom assaini + SHA-256 + scanner |
| F-02 | `GET /files/serve-file`, `/download/:tenantId/:courseId/:filename` : chemin construit depuis l'URL | amélioré | `GET /documents/:id/versions/:n/download-url` (URL signée ≤ 5 min, accès contrôlé par document) ; plus aucun chemin client |
| F-03 | `GET /files/:tenantId/report-cards/:filename`, `/transcripts/:filename`, `/receipts/:filename` | hors module -> `reportcards` (PDF des bulletins, relevés, reçus) | — |
| F-04 | `GET /files/:tenantId/:courseId/:filename` (lecture avec `Range` pour audio / vidéo) | hors module -> `lms` | streaming de média pédagogique |
| F-05 | `GET /parent/documents/report-cards\|transcripts\|attendance-reports\|payment-receipts` | hors module -> `reportcards` (routes famille) / `finance` / `attendance` | la vue « documents » du parent est composée par ces modules ; **les pièces administratives de l'enfant** (CNI, certificats) sont nouvelles et servies par `GET /documents?scope=child` |
| F-06 | `fetchOwnerDocuments` : « documents officiels » du propriétaire (diplômes, signataires, complétude des dossiers) | hors module -> `higher` / `analytics` | indicateurs de diplomation, pas de pièces |
| F-07 | Suppression d'un support (`DELETE /materials/:id`, suppression physique du fichier) | amélioré | archivage (suppression logique), restauration, purge par rétention ; l'historique reste |
| F-08 | Remplacement d'un fichier (réécriture) | amélioré | version `n+1` immuable, historique complet |
| F-09 | Contrôle d'accès par rôle (`students` voient leurs rendus, `teacher` ses cours) codé en dur | amélioré | permissions RBAC + niveau de catégorie + propriétaire + tuteur lié + partages |
| F-10 | Journal de lecture / téléchargement | amélioré | historique par document + audit chaîné |
| F-11 | Dates d'expiration (qualifications du personnel de `people`) | conservé côté `people` | `people.staff_qualification.expiring` reste ; la GED ajoute l'expiration **des pièces** (`documents.document.expiring`) |
| F-12 | Antivirus | amélioré (nouveau) | port `MalwareScanner`, ClamAV socket / HTTP, quarantaine |
| F-13 | Quotas de stockage | amélioré (nouveau) | quota par plan, jauge `STORAGE_BYTES` dans `entitlements` |

## 3. Usages ad hoc de pièces dans les modules v2

| Module | Usage actuel | Décision de ce lot | Reste à faire |
|---|---|---|---|
| `messaging` (pièces jointes) | `attachments` + `StoragePort` propres, type réel PDF / JPEG / PNG / WebP, expiration à 24 h si non liées | **adaptateur** `storage-scan` : chaque `put` est analysé par le `MalwareScanner` de la plateforme (fail-closed selon la politique) ; aucune ligne de `messaging` modifiée | migrer les pièces vers `documents` n'a pas de sens (cycle de vie différent : pièces liées à un message) ; l'analyse suffit |
| `people` (photo d'élève) | `photo_object_key` + `StoragePort` | adaptateur `storage-scan` (images analysées) | rien : une photo n'est pas un document administratif |
| `people` (pièces d'élève : antécédents `attachment_object_key`, `document_ref`) | colonnes prévues pour 024, **aucune route** n'y écrit | les pièces d'élève sont des documents `STUDENT` ; `document_ref` reste disponible pour un lien ; le panneau « pièces » de la fiche élève peut utiliser `DocumentPicker` | brancher l'écran de la fiche élève sur le sélecteur et renseigner `document_ref` (modification de `people` : hors périmètre, à planifier) |
| `people` (contrats, qualifications : `document_ref`) | idem | idem (type `TEACHER`) | idem |
| `attendance` (justificatifs d'absence : `documentRef`, `StoragePort` propre) | stockage direct | adaptateur `storage-scan` ; `documentRef` peut référencer un document `STUDENT` | migration vers `DocumentPicker` à planifier avec la spec 010 |
| `reportcards` / `higher` / `finance` / `payroll` | documents officiels immuables | **inchangés** (ne pas dupliquer) | référence par `metadata.officialDocumentId` si l'explorateur doit les lister |

## 4. Ce que la v2 ne reprend pas

| ID | Élément | Justification |
|---|---|---|
| A-01 | Chemins de fichier dans l'URL (`/:tenantId/:courseId/:filename`) | traversée de répertoire, identifiants de tenant client |
| A-02 | Type MIME déclaré par le client comme preuve | remplacé par la détection sur les octets |
| A-03 | Nom d'objet horodaté et nom d'origine remplacé caractère par caractère | clé de stockage par version, nom d'affichage assaini séparé |
| A-04 | Service de fichiers qui lit tout le fichier en mémoire sans plafond | lecture bornée, plafond de plateforme |
| A-05 | Types vidéo / audio | hors périmètre administratif (LMS) |

# Feature Specification: Bulletins, relevés et rendu PDF serveur (013-report-cards)

**Feature Branch**: `013-report-cards`

**Created**: 2026-10-01

**Status**: Rédigée — à relire avec le propriétaire du produit (questions : `../012-rules-engine/open-questions.md` §B, Q-13, Q-21, Q-31, Q-32, Q-33, Q-34) avant `/speckit.plan`

**Implémentation** : module `apps/api/src/modules/reportcards` (migrations 1300-1303, README du module) — révisée le 2026-10-01. Les incohérences relevées à l'implémentation sont corrigées dans ce document et listées en **§16**.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §18, §39, §46, §50, §63 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7 (« bulletins = snapshots immuables »), §3.10 (un seul générateur PDF, gabarits versionnés, branding par tenant), §4 (tranche 2.6) ; `docs/adr/ADR-002/003/004/006/007` ; `docs/inventory/legacy-dependents-by-slice.md` (tranche 2.6) ; legacy : `apps/api/src/routes/semester-averages.ts` (`/report-cards/pdf`), `report-cards.ts`, `transcripts.ts`, `services/report-card-template.service.ts`, `services/professional-bulletin.service.ts`, `apps/web/src/lib/{bulletin-format,bulletin-pdf,bulletin-pdf-bts}.ts`, `components/professional/BulletinView.tsx`. Gabarit : `specs/v2/000-platform-foundation/spec.md`.

> **Principe** : un bulletin est un **instantané immuable** de résultats déjà calculés et clôturés (spec 011). Il porte l'identifiant de la **version de règle**, un **hash**, la **trace d'explicabilité** et une **signature** ; le PDF est rendu **côté serveur, dans le worker, depuis le snapshot seul** (jamais depuis des données vivantes), stocké via `StoragePort`, et vérifiable par QR code. Les gabarits (par pack) et l'identité de l'établissement (branding, signataires) sont des **données versionnées par tenant**, jamais du code.

## 1. Objectifs

1. **Snapshot immuable** : valeurs, version de règle, hash, trace ; aucune modification possible après émission (trigger SQL + application) ; correction = nouvelle version qui remplace l'ancienne sans l'effacer.
2. **Un seul générateur PDF** : Puppeteer dans le worker, depuis le snapshot ; fin des PDF jsPDF côté web (5 générateurs, ≈ 2 400 lignes) et du mélange API/web.
3. **Authenticité** : code de vérification opaque, QR code, signature Ed25519 du hash du snapshot, page publique de vérification (« document authentique », « remplacé », « révoqué »).
4. **Gabarits par pack comme données versionnées** : primaire, secondaire, supérieur (crédits / coefficients), relevé cumulé ; options par tenant validées (rubriques, signataires, langue, mise en page).
5. **Identité par tenant** : logo, emblème, mentions légales, signataires, sans aucun nom d'établissement ni de personne codé en dur (le legacy imprime « IPAM » ou « IMHOTEP ACADEMY (EXASP CI) » pour tous les tenants).
6. **Contrôle d'accès strict** : un élève ou un tuteur ne lit que les bulletins **publiés** qui le concernent ; la gestion lit tout ; le téléchargement passe par une URL signée à durée courte.

## 2. Périmètre

### Inclus

- Module backend `reportcards` (schéma `reportcards`) : génération de snapshots depuis les résultats `FINAL`, rendu PDF, publication, remplacement, révocation, vérification publique.
- Types de documents : `REPORT_CARD` (bulletin/relevé de période ou d'année), `TRANSCRIPT` (relevé cumulé). Le module expose aussi un **port de rendu générique** (`DocumentRenderer`) utilisé par 019 pour les diplômes et attestations (mêmes gabarits, branding, signataires, signature, QR).
- Gabarits plateforme (par pack) et configuration par tenant ; aperçu sur données fictives.
- Identité (branding) et registre des signataires.
- Lots de génération par classe, suivi, reprise sur échec, PDF combiné de classe.
- Accès familles (élève/tuteur) en lecture, avec option de blocage par impayés (Q-13).
- Journal des vérifications.

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Calcul des moyennes, rangs, décisions | 011 / 012 |
| Diplômes, attestations de réussite et d'authenticité (données, éligibilité, numérotation) | 019 (qui utilise le rendu de cette spec) |
| Attestations d'assiduité, certificats de scolarité, GED, versions de documents, antivirus | 024-documents, 010 |
| Notification (e-mail/SMS/WhatsApp) de mise à disposition | 016-communications |
| Conseil de classe : PV | 005/006 |
| Édition libre du HTML d'un gabarit par un tenant | hors V1 (Q-32) |
| Bulletin de paie des enseignants | 032 (utilise le même moteur de rendu via le port) |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Direction / directeur des études | Génère, publie, remplace, révoque ; configure identité et gabarits |
| Secrétariat | Génère et imprime ; ne révoque pas |
| Enseignant principal | Consulte les bulletins de sa classe (lecture) |
| Élève / tuteur | Consulte et télécharge les bulletins publiés |
| Tiers (employeur, administration) | Vérifie un document par QR / code |
| Worker | Crée les snapshots en lot, rend les PDF, signe, stocke |
| Super-admin | Gère les gabarits plateforme et les clés de signature |

## 4. User Stories et critères d'acceptation

### US1 — Émettre les bulletins d'une classe (P1)

En tant que directeur, une fois la période clôturée, j'émets les bulletins de toute la classe en une action.

- **AC1.1** Le contrôle préalable vérifie : période `CLOSED` pour la classe (résultats `FINAL`), délibération `HELD` si requise (Q-34), branding complet, signataires renseignés pour tous les emplacements obligatoires du gabarit, gabarit configuré ; chaque manque est listé avec le lien de correction. **Aucune génération** si un point bloquant subsiste.
- **AC1.2** La génération crée **un snapshot par inscription** (`UNIQUE (enrollment, period, kind, version)`) ; relancer le lot ne crée aucun doublon (idempotence par clé de lot).
- **AC1.3** Une inscription en erreur de calcul (`ERROR`) ou sans résultat `FINAL` est **exclue et listée** dans le rapport de lot ; le lot n'échoue pas en bloc.
- **AC1.4** Le snapshot est créé dans une transaction unique avec ses événements ; sa création ≤ **100 ms** par bulletin (objectif) ; 100 snapshots ≤ 10 s.
- **AC1.5** Le rendu PDF d'un lot de 100 bulletins s'exécute en **≤ 120 s** sur un worker de référence 2 vCPU (objectif à valider), avec progression visible ; un rendu en échec est réessayé 3 fois puis marqué `FAILED` avec bouton de reprise, sans bloquer les autres.

### US2 — Un bulletin qui ne bouge plus (P1)

- **AC2.1** Toute tentative d'`UPDATE` (hors champs de rendu/publication) ou de `DELETE` d'un snapshot est refusée par trigger pour tout rôle applicatif (test d'intégration).
- **AC2.2** `snapshot_hash` = SHA-256 de l'enveloppe canonique (snapshot + trace) ; le recalcul du hash depuis la base égale le hash stocké pour 100 % des bulletins (vérification nocturne ; tout écart = alerte `reportcards.integrity.mismatch`).
- **AC2.3** Le snapshot contient **tout** ce qu'il faut pour le rendre : identité de l'élève, libellés de classe/période/matières, valeurs exactes **et** valeurs d'affichage, rangs, mentions, décision, absences, appréciations, branding et signataires **résolus au moment de l'émission**, version de gabarit et options ; **aucun JOIN vivant** au rendu.
- **AC2.3b** Modifier ensuite le nom de l'élève, le logo ou un signataire **ne modifie pas** les bulletins déjà émis.
- **AC2.4** Un rendu ultérieur du même snapshot (reprise, réédition du fichier) produit un PDF **visuellement identique** (test de non-régression) ; le hash du PDF de chaque rendu est conservé (`renders`).

### US3 — Remplacer ou révoquer sans effacer (P1)

- **AC3.1** Si la période est rouverte puis reclôturée (version de résultats `n+1`), les bulletins issus de la version `n` apparaissent dans « à rééditer » ; `reissue` crée un **nouveau snapshot** (`version + 1`, `supersedes_id`) avec motif ; l'ancien passe `SUPERSEDED` et reste téléchargeable par la gestion.
- **AC3.2** La vérification publique d'un code `SUPERSEDED` répond « document remplacé par une version plus récente émise le … » (sans révéler le contenu de la nouvelle version).
- **AC3.3** `revoke` (permission sensible, motif obligatoire) passe le bulletin `REVOKED` ; la vérification répond « document révoqué » ; il disparaît du portail familles ; l'événement est audité.
- **AC3.4** L'élève/tuteur voit toujours la **dernière version publiée** ; l'ancienne n'est plus proposée au téléchargement (sauf à la gestion).

### US4 — Vérifier l'authenticité (P1)

En tant qu'employeur, je scanne le QR code d'un bulletin ou d'un diplôme.

- **AC4.1** Le QR encode une URL de vérification `https://<domaine-vérification>/v/<code>` ; `code` = 128 bits aléatoires (base32, non devinable) ; le code texte est imprimé sous le QR.
- **AC4.2** La page de vérification (non authentifiée) répond selon la politique Q-31 : par défaut **statut, nature du document, établissement, intitulé, date d'émission** ; la **mention** n'est ajoutée que si l'établissement l'a explicitement activée (réglage `verificationShowsMention`, défaut `false` : la mention est une information scolaire d'un mineur) ; **ni notes, ni nom, ni matricule, ni date de naissance, ni adresse**. *(Révisé : la mention figurait dans le défaut ; voir §16.)*
- **AC4.3** La signature Ed25519 de `(snapshot_hash, code, issued_at)` est stockée avec l'identifiant de clé ; l'endpoint `GET /public/verify/:code` renvoie aussi `keyId` et l'empreinte ; la clé publique est publiée (`/.well-known/ecoledigitale-keys.json`) pour vérification hors ligne.
- **AC4.4** Téléverser un PDF (`POST /public/verify/upload`, corps brut `application/pdf`, ≤ 10 Mo ; au-delà 413) compare son SHA-256 aux rendus stockés (index global `file_hash_index`, alimenté au rendu) : « ce fichier est identique à l'original émis le … » (avec le statut : remplacé / révoqué le cas échéant) ou « ce fichier ne correspond à aucun original ».
- **AC4.5** Limitation de débit : 30 requêtes/min/IP (429 au-delà) ; aucun message ne distingue un code inexistant, mal formé, trop long, provisoire ou d'une feature désactivée (même corps, même statut 404) ; journal des vérifications (IP tronquée /24 ou /48, date, résultat) ; le hash du snapshot est recalculé et la signature revérifiée à chaque consultation (écart ⇒ statut `INVALID` + événement `reportcards.integrity.mismatch`).
- **AC4.6** Rotation des clés : deux clés actives possibles ; un document signé par une clé retirée reste vérifiable.

### US5 — Des gabarits par pack, configurés par l'établissement (P1)

- **AC5.1** La plateforme fournit des gabarits versionnés : `primary-bulletin`, `secondary-bulletin`, `higher-bulletin-credits`, `higher-bulletin-coef`, `transcript-credits` (modèles **génériques** : les modèles officiels sont à fournir, `012/regulatory-sources-needed.md` §6).
- **AC5.2** Le tenant choisit un gabarit et règle des **options validées par schéma** (rubriques affichées, rang, moyenne de classe, absences, appréciation générale, colonnes de crédits, langue, orientation, pied de page, filigrane, emplacements de signature) ; chaque enregistrement crée une **version de configuration** ; un bulletin déjà émis conserve la version utilisée.
- **AC5.3** L'**aperçu** génère un PDF sur des données **fictives** (jamais d'élève réel) en ≤ 5 s.
- **AC5.4** Le moteur de gabarit est **sans logique** (substitution de champs, boucles bornées sur listes du snapshot, composants autorisés) ; tout `<script>`, `<iframe>`, `<object>`, URL externe ou `file:` dans un gabarit est refusé à la publication du gabarit plateforme ; le rendu s'exécute **JavaScript désactivé et réseau coupé** (test d'injection).
- **AC5.5** Aucun libellé d'établissement ni de signataire par défaut : sans identité complète, aucun document n'est généré (Q-21).

### US6 — Les familles consultent leurs bulletins (P2)

- **AC6.1** Un élève/tuteur liste uniquement les bulletins `PUBLISHED` (non révoqués) de ses enfants/de lui-même ; le téléchargement renvoie une **URL signée** (≤ 5 min) après vérification de droit.
- **AC6.2** Option d'établissement « bloquer si impayé » (Q-13) : interroge `finance` via le port `LearnerStandingPort` ; le message ne détaille pas la dette, il invite à contacter l'économat.
- **AC6.3** Un tuteur dont le lien à l'élève est retiré perd l'accès immédiatement (vérification du lien à chaque lecture, pas de jeton long).
- **AC6.4** Chaque téléchargement par un tiers non-gestion est journalisé (qui, quand, quoi).

### US7 — Relevé cumulé (P2)

- **AC7.1** `TRANSCRIPT` agrège les résultats `FINAL` de plusieurs périodes/années d'un élève (et les crédits capitalisés lus via l'API publique de 019 si le pack Higher est actif) ; mêmes garanties de snapshot, hash, signature, QR.
- **AC7.2** Un relevé n'est généré que sur demande explicite (élève, secrétariat) ; il porte la date d'émission réelle.

### US8 — Rendu générique pour les autres documents (P2)

- **AC8.1** Le port `DocumentRenderer.render({ kind, snapshot, templateKey })` est utilisable par 019 (diplôme, attestations) et 032 (bulletin de paie) ; chacun fournit son snapshot et son gabarit plateforme ; la signature, le QR, le stockage et la vérification sont communs.
- **AC8.2** Les types de documents inconnus du registre sont refusés.

## 5. Contenu du snapshot (`reportcard/1`)

| Bloc | Contenu |
|---|---|
| `meta` | `schema = "reportcard/1"`, `kind`, `version`, `issuedAt`, `issuedBy` (nom figé), `locale` |
| `student` | identité nécessaire à l'impression : nom, prénoms, matricule, date et lieu de naissance, genre, redoublant (valeur issue des résultats, pas d'un texte) |
| `enrollment` | classe, niveau, programme/série, année scolaire, période, effectif de la classe |
| `institution` | copie du branding (noms, mentions officielles, adresse, contacts, clés d'objets logo/emblème, couleurs) |
| `results` | lignes (niveau, code et libellé du nœud, catégorie, coefficient, crédits, valeur exacte, valeur d'affichage, rang, effectif, état, session d'obtention, mention, appréciation de l'enseignant), synthèse (moyenne, rang, effectif, mention, décision et issue, crédits acquis/requis, distinctions), annuel/cycle si présent |
| `attendance` | absences justifiées / non justifiées (heures), lues via `AttendanceSummaryPort` au moment de l'émission |
| `deliberation` | date réelle, nature (conseil/jury) ou `null` |
| `appreciations` | appréciation générale du conseil |
| `signatories` | pour chaque emplacement : nom, qualité, fonction, image de signature (clé d'objet) |
| `rules` | `ruleSetCode`, `ruleVersionNo`, `ruleVersionId`, `definitionHash`, `contractId`, `engineVersion`, `resultsVersion`, `closureHash` |
| `template` | `templateKey`, `templateVersion`, `configVersion`, options résolues |
| `labels` | table code → libellé (français) pour toutes les mentions/décisions/états utilisés (extraite du `label_map` de la version de règle) |

`explain` (colonne distincte, mais couverte par le hash) : trace des règles de chaque ligne `FINAL` (clé, entrées, sortie, position), reprise de `results.line_results.trace`.

## 6. Règles métier

| # | Règle |
|---|---|
| R-RC-01 | On n'émet un document de période qu'à partir de résultats `FINAL` d'une période `CLOSED`. Une exception « bulletin provisoire » existe sous la forme d'un `REPORT_CARD` marqué `provisional = true` (filigrane obligatoire, jamais publié aux familles, non vérifiable publiquement : pas de QR, pas d'entrée dans l'index public). Un provisoire n'est jamais supprimé (aucun `DELETE` sur `report_cards`) : on le **révoque** pour l'écarter. |
| R-RC-02 | Un snapshot est immuable ; ses seuls champs modifiables sont ceux du rendu (`render_status`, `current_render_id`) et de la visibilité (`published_at`, `withdrawn_at`) et du statut (`ISSUED → PUBLISHED`, `→ SUPERSEDED|REVOKED`). |
| R-RC-03 | Une version supérieure remplace la précédente sans la supprimer ; il n'y a **qu'une** version non remplacée et non révoquée par `(inscription, période, nature)`. |
| R-RC-04 | Le hash et la signature sont calculés **à l'émission**, avant tout rendu ; le PDF n'est jamais source de vérité. |
| R-RC-05 | Le code de vérification est unique (global), aléatoire, jamais réutilisé, jamais dérivé d'une donnée de l'élève. |
| R-RC-06 | Aucune donnée de bulletin n'est lisible sans permission explicite ; la lecture par un élève/tuteur exige le statut `PUBLISHED` et le lien de tutelle vérifié. |
| R-RC-07 | Les gabarits plateforme sont globaux, versionnés, publiés par le super-admin après revue de sécurité ; une version publiée est immuable. |
| R-RC-08 | Le rendu s'effectue sans réseau, sans JavaScript ; les images (logos, signatures) sont lues depuis `StoragePort` et injectées en data URI ; polices embarquées ; la date de création du PDF = `issuedAt` (reproductibilité). |
| R-RC-09 | Le même `snapshot_hash` ne peut être émis deux fois pour la même clé fonctionnelle (idempotence). |
| R-RC-10 | La mise en page « BTS » du legacy (appliquée par regex aux Licences 1-2) n'existe plus : le gabarit est un choix de configuration, indépendant du nom du programme. |
| R-RC-11 | La date de délibération imprimée est la date réelle enregistrée (011), jamais la date du jour d'impression (défaut hérité de `juryIntro`). |
| R-RC-12 | Le rang imprimé est celui du snapshot ; il n'est jamais recalculé au rendu (le legacy le recalculait à chaque consultation, plafonné à 300 étudiants). |

## 7. Modèle de données

Voir `data-model.md`. Schéma `reportcards` (migrations `1300-1399`, plage proposée) :

| Table | Rôle | Famille |
|---|---|---|
| `platform_templates` | Gabarits plateforme versionnés | globale (liste blanche) |
| `signing_keys` | Clés publiques de signature (la clé privée n'est jamais en base) | globale |
| `verification_index` | Code → tenant, document (aucune donnée personnelle) | globale |
| `file_hash_index` | SHA-256 d'un PDF émis → code (comparaison d'un fichier téléversé) | globale |
| `settings` | Réglages du tenant : blocage si impayé, délibération requise, politique de vérification | tenant |
| `branding_versions` | Identité versionnée | tenant |
| `signatories` | Signataires | tenant |
| `template_configs` | Configuration de gabarit versionnée | tenant |
| `report_cards` | Snapshots immuables | tenant |
| `renders` | Rendus PDF (clé de stockage, hash) | tenant |
| `batches`, `batch_items` | Lots de génération | tenant |
| `verification_events` | Journal des vérifications | tenant |
| `access_log` | Téléchargements par tiers non-gestion | tenant |

## 8. Endpoints

Préfixe `/api/v1/reportcards` ; publics sous `/api/v1/public`. Contrats Zod avant routes.

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| POST | `/batches` | Créer un lot `{ classroomId, academicPeriodId, kind, enrollmentIds?, provisional?, reissueReason?, idempotencyKey? }` → 202 (200 si le lot existait : rejeu) ; 409 `reportcards.preflight_failed` + liste des manques | `reportcard.generate` |
| POST | `/publish` | Publication par lot `{ batchId }` ou `{ reportCardIds }` (les bulletins non rendus sont ignorés et listés) | `reportcard.publish` |
| GET / PUT | `/settings` | Réglages du tenant (`blockIfUnpaid` exige la feature `reportcard.block-unpaid`) | `reportcard.read` \| `reportcard.template.manage` / `reportcard.branding.manage` |
| GET | `/me/report-cards` | Bulletins publiés de l'élève connecté ou de tous les enfants du tuteur connecté | `reportcard.self.read` \| `reportcard.child.read` |
| GET | `/batches/:id` | Progression, exclusions, échecs | `reportcard.generate` |
| POST | `/batches/:id/retry` | Reprise des rendus en échec | `reportcard.generate` |
| GET | `/preflight` | Contrôle préalable (période, délibération, identité, signataires, gabarit) | `reportcard.generate` |
| GET | `/report-cards` | Liste filtrée (classe, période, statut, version, `needsReissue`) | `reportcard.read` |
| GET | `/report-cards/:id` | Détail (snapshot sans trace) | `reportcard.read` |
| GET | `/report-cards/:id/explain` | Trace | `reportcard.explain` |
| GET | `/report-cards/:id/pdf` | URL signée de téléchargement (≤ 5 min) | `reportcard.read` (gestion) \| `reportcard.self.read` \| `reportcard.child.read` (famille : lien de tutelle revérifié à chaque appel ; un bulletin qui n'est pas le sien répond 404) |
| GET | `/classrooms/:id/periods/:pid/pdf` | URL signée du PDF combiné de la classe (produit par le worker à `reportcards.batch.completed`) ; 409 tant qu'il n'est pas prêt | `reportcard.read` |
| POST | `/report-cards/:id/publish` \| `/withdraw` | Visibilité aux familles | `reportcard.publish` |
| POST | `/report-cards/:id/reissue` | `{ reason }` → nouvelle version | `reportcard.generate` |
| POST | `/report-cards/:id/revoke` | `{ reason }` | `reportcard.revoke` |
| POST | `/report-cards/:id/render` | Relancer un rendu | `reportcard.generate` |
| POST | `/transcripts` | Relevé cumulé `{ studentId, scope }` | `reportcard.generate` |
| GET / PUT | `/branding` | Identité (version) | `reportcard.branding.manage` |
| POST | `/branding/assets` | URL de dépôt signée `PUT` (logo / emblème / signature, PNG-JPEG-WebP-GIF ≤ 2 Mo) ; le contenu est contrôlé par ses octets à l'enregistrement de l'identité ou du signataire (jamais de SVG) | `reportcard.branding.manage` \| `reportcard.signatory.manage` |
| GET / POST / PATCH | `/signatories` | Signataires | `reportcard.signatory.manage` |
| GET | `/templates` | Gabarits plateforme disponibles | `reportcard.template.manage` |
| GET / PUT | `/template-configs` | Configuration par nature de document | `reportcard.template.manage` |
| POST | `/template-configs/preview` | Aperçu fictif | `reportcard.template.manage` |
| GET | `/me/report-cards`, `/children/:studentId/report-cards` | Bulletins publiés | session élève / tuteur |
| GET | `/api/v1/public/verify/:code` (et `/api/v1/reportcards/public/verify/:code`) | Vérification (sans authentification, 30 req/min/IP) | — |
| POST | `/api/v1/public/verify/upload` (et `/api/v1/reportcards/public/verify/upload`) | Comparaison d'un fichier (corps brut PDF) | — |
| GET | `/api/v1/public/keys`, `/.well-known/ecoledigitale-keys.json` | Clés publiques de signature (actives et retirées) | — |
| POST / GET | `/platform/templates`, `/platform/templates/seed`, `/platform/keys`, `POST /platform/keys/:keyId/retire` | Gabarits globaux et clés (JWT super-admin séparé du JWT tenant) | super-admin |

## 9. Écrans

| Portail | Écran | Contenu |
|---|---|---|
| Admin | **Bulletins — émission** | Assistant : choix classe/période/nature → **contrôle préalable** → génération → suivi du lot (barre de progression, exclus, échecs) → aperçu d'un échantillon → publication |
| Admin | **Bulletins — liste** | Par classe : statut (émis, publié, remplacé, révoqué), version, rendu, « à rééditer » ; actions réémettre, révoquer (motif), retirer des familles, télécharger |
| Admin | **Identité & signataires** | Branding (noms, mentions, logo, emblème, couleurs), signataires, emplacements par gabarit |
| Admin | **Modèles** | Choix du gabarit par nature de document, options, **aperçu fictif**, historique des versions |
| Admin | **Pourquoi ce résultat ?** | Trace d'une ligne (012/011) |
| Élève / tuteur | **Mes bulletins** | Liste des bulletins publiés par période, téléchargement |
| Public | **Vérification d'un document** | Saisie du code / lecture du QR ; résultat ; téléversement d'un fichier |

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `reportcard.read` | Consulter les bulletins et relevés émis | non |
| `reportcard.explain` | Consulter la trace d'un bulletin | non |
| `reportcard.generate` | Émettre, réémettre et rendre des bulletins et relevés | oui |
| `reportcard.publish` | Rendre un bulletin visible aux familles ou le retirer | oui |
| `reportcard.revoke` | Révoquer un document émis | **oui** (MFA) |
| `reportcard.template.manage` | Configurer les gabarits et leurs options | non |
| `reportcard.branding.manage` | Gérer l'identité de l'établissement | oui |
| `reportcard.signatory.manage` | Gérer les signataires | **oui** |
| `reportcard.self.read` | Consulter et télécharger ses propres bulletins publiés (élève) | non |
| `reportcard.child.read` | Consulter et télécharger les bulletins publiés de ses enfants (tuteur) | non |

*(Les deux dernières suivent la convention `*.self.*` / `*.child.*` des modèles de rôles du module rbac : élèves et parents les reçoivent sans modification de rbac.)*

Features : `reportcard.transcript` (relevé cumulé), `reportcard.public-verification`, `reportcard.block-unpaid` (Q-13). Exportable : `report.export` du plan §3.6 = `reportcard.read` pour les exports de liste.

## 11. Événements

Publiés :

| Événement | Payload | Consommateurs |
|---|---|---|
| `reportcards.snapshot.created` *(remplace `report_card.issued`)* | `reportCardId, enrollmentId, studentId, periodId, kind, version, snapshotHash, batchId, provisional` | **worker (rendu PDF)**, audit, 025 |
| `reportcards.report_card.render_requested` | `reportCardId` (reprise explicite d'un rendu ; filet de sécurité périodique) | worker (même abonné) |
| `reportcards.report_card.rendered` | `reportCardId, renderId, pdfHash, sizeBytes, batchId` | notifications de la direction |
| `reportcards.report_card.render_failed` | `reportCardId, renderId, error, batchId` (après 3 tentatives) | direction, exploitation |
| `reportcards.report_card.published` | `reportCardId, studentId, version` | 016 (notification famille selon préférence), 029 |
| `reportcards.report_card.withdrawn` | `reportCardId, studentId, version` | 016 |
| `reportcards.report_card.superseded` | `reportCardId, newReportCardId, studentId, reason` | 016 |
| `reportcards.report_card.revoked` | `reportCardId, studentId, reason` | 016, audit |
| `reportcards.batch.completed` | `batchId, issued, excluded, failed` | notification direction, **worker (PDF combiné de classe)** |
| `reportcards.integrity.mismatch` | `reportCardId, expectedHash, actualHash, reason (HASH \| SIGNATURE)` | exploitation (alerte) |

Consommés en v1 : `tenancy.tenant.provisioned` (publication idempotente des gabarits de plateforme). `results.period.reopened` n'est **pas** consommé : « à rééditer » est calculé à la lecture en comparant la version des résultats du snapshot à la version courante publiée par `results` (`ResultsReadPort.getPeriodState`), ce qui reste exact même si un événement est perdu. `results.period.closed` (notification de la direction) relève de 016. `results.decision.confirmed` et `rules.version.retired` : aucune action.

## 12. Tests

- **Immuabilité (bloquant)** : `UPDATE`/`DELETE` d'un snapshot refusés ; recalcul du hash égal ; modification du nom de l'élève ou du logo sans effet sur un bulletin émis.
- **Signature** : vecteurs de test Ed25519 ; rotation de clés ; vérification hors ligne avec la clé publique publiée.
- **Vérification publique** : minimisation des données (aucune note), uniformité des erreurs, limitation de débit, journal.
- **Sécurité du rendu** : gabarit avec `<script>`, `<iframe>`, `<link href="http://…">`, `url(file:///…)`, `<img src="http://169.254.169.254/…">`, `@import` ⇒ refus à la publication **et** aucune requête sortante au rendu (réseau coupé dans le conteneur, vérifié) ; polices et images embarquées ; échappement de tout texte d'élève (prénom contenant `<b>` ou des guillemets).
- **Rendu** : tests de non-régression visuelle par gabarit (extraction de texte + comparaison d'image avec tolérance), PDF de 1 page pour un bulletin standard, polices embarquées, métadonnées (date = émission), taille ≤ 300 Ko en moyenne.
- **Contrôle d'accès** : matrice (gestion, secrétariat, enseignant, élève, tuteur lié, tuteur non lié, autre tenant) × (liste, détail, trace, PDF) ; URL signée expirée refusée ; lien de tutelle retiré = accès retiré.
- **Lots** : idempotence, reprise, exclusions, concurrence de deux lots sur la même classe, 100 bulletins ≤ 120 s.
- **Remplacement** : réouverture → réémission → ancienne `SUPERSEDED`, vérification publique « remplacé ».
- **Isolation** : test générique spec 000 (tables tenant) ; tables globales en liste blanche (`platform_templates`, `signing_keys`, `verification_index`).
- **Audit (R5)** : `expectAudited` pour émission, publication, remplacement, révocation, changement de signataire/branding.
- **Contrat** : le snapshot validé par schéma Zod `reportcard/1` ; test de compatibilité ascendante (un snapshot v1 reste rendable après l'ajout du schéma v2).

## 13. Cas limites

- **Élève sans résultat** (inscrit tardif, ERROR) : exclu du lot et listé ; jamais de bulletin « vide ».
- **Mutation de classe** : un bulletin par inscription ; l'élève peut en avoir deux pour la même période (Q-39).
- **Logo manquant ou supprimé du stockage** : le snapshot référence une clé d'objet ; si l'objet a disparu, le rendu échoue explicitement (`FAILED`, cause) plutôt que d'imprimer sans logo ; les objets référencés par un snapshot ne sont jamais purgés.
- **Gabarit dont la version est retirée** : les snapshots existants continuent d'être rendables avec leur version (les gabarits ne sont jamais supprimés, seulement `retired`).
- **Très grande classe (> 300)** : plus de plafond ; le lot est découpé en tâches de 25 rendus.
- **Navigateur de rendu en panne / mémoire** : le job est repris ; au bout de 3 échecs `FAILED` ; la file de rendu est limitée par tenant (équité) et globalement.
- **Réémission pendant un lot** : verrou de clé fonctionnelle ; la seconde demande attend ou échoue proprement.
- **Document `provisional`** : filigrane, jamais publié, jamais vérifiable, supprimable ; ne compte pas comme version.
- **Fuseau** : `issuedAt` UTC ; affichage `Africa/Abidjan`.
- **Données personnelles** : le snapshot est une donnée sensible (mineurs) ; chiffrement au repos du stockage objet ; durée de conservation tant que le tenant existe ; export de portabilité par élève.
- **Langue** : français uniquement en V1 (Q-33) ; le snapshot embarque la table de libellés pour un rendu futur multilingue.
- **Tenant résilié** : les PDF restent récupérables pour export pendant la période de grâce (spec 001) ; l'index de vérification reste actif tant que la loi l'impose (à fixer, Q-31).

## 14. Dépendances

- **En amont** : 000, 001, 002, 003 (branding, pays), 011 (résultats `FINAL`, appréciations, délibérations), 012 (version de règle, trace, `label_map`), 010 (absences), 008 (tutelle), 014 (option impayés), 024/000 (`StoragePort` : l'interface minimale `put/get/signedUrl/exists` est supposée disponible ; sinon livrée ici sous forme de port avec adaptateur S3/MinIO), worker.
- **En aval** : 019 (diplômes, attestations via le port de rendu), 032 (bulletin de paie), 016 (notifications), 025.
- **Technique** : Puppeteer + Chromium dans l'image worker, librairie QR, `pdf-lib` (fusion), Ed25519 (`node:crypto`), clé privée en secret d'exploitation (jamais en base ni en dépôt).

## 15. Critères de sortie (mesurables)

1. Les bulletins d'une classe de test sont émis, rendus en PDF par le worker, publiés, téléchargés par un tuteur lié et refusés à un tuteur non lié.
2. Un `UPDATE` direct d'un snapshot est impossible ; le hash recalculé égale le hash stocké pour 100 % des bulletins de test.
3. Après réouverture et reclôture de la période, la réémission remplace la version ; la vérification publique de l'ancien code répond « remplacé ».
4. Le scan d'un QR renvoie « authentique » avec les seules données minimales ; le fichier PDF original est reconnu par comparaison de hash, un fichier modifié ne l'est pas.
5. Le test d'injection de gabarit ne produit aucune requête sortante ni lecture de fichier.
6. Aucune mention « IPAM », « IMHOTEP » ni nom de personne n'existe dans le code ou les gabarits plateforme (grep CI).
7. Les générateurs jsPDF du web, `report-card-template.service.ts`, `report-cards.ts`, `transcripts.ts` et les tables `report_cards`, `transcripts`, `professional_bulletins` sont supprimés dans la même tranche.

## 16. Révisions d'implémentation (2026-10-01)

Corrections apportées à cette spécification et à `data-model.md` lors de l'implémentation du backend (T-RC-DB, T-RC-SNAP-PURE, T-SIGN, T-STORAGE, T-TEMPLATES, T-RC-DOMAIN, T-RENDER, T-RC-HTTP, T-VERIFY). Rien n'a été retiré du périmètre ; les écrans web (T-WEB-*), l'E2E et le nettoyage du legacy (T-CLEAN) restent à faire.

| # | Incohérence ou lacune | Correction |
|---|---|---|
| 1 | `data-model.md` §3.1 : supersession par un déclencheur **AFTER** INSERT, alors que l'index unique des versions vivantes fait échouer l'insertion avant qu'il ne tire | Déclencheur **BEFORE INSERT** (`report_cards_2_supersede`) : il passe l'ancienne version vivante en `SUPERSEDED` (et renseigne `superseded_by_id`) avant l'insertion, sous un réglage de transaction que seul ce déclencheur pose ; un `ISSUED → SUPERSEDED` direct est refusé |
| 2 | `renders_hash_idx` « via SystemDb » pour comparer un fichier téléversé : impossible, `renders` est une table de tenant sous RLS forcée (le système sans tenant n'y voit rien) | Quatrième table **globale** `file_hash_index (pdf_hash → code, tenant_id)`, alimentée au rendu, même politique que `verification_index` (lecture système ou tenant propriétaire, insertion limitée au tenant courant, immuable) |
| 3 | `verification_index` alimenté par une fonction `SECURITY DEFINER` `register_verification` | Politique RLS d'insertion `tenant_id = kernel.current_tenant_id()` + déclencheur de garde (le code doit désigner un document émis, non provisoire, du tenant) : même garantie, sans fonction à privilèges élevés |
| 4 | Événement `reportcards.report_card.issued` : le déclencheur du rendu PDF dans le worker n'était pas nommé | Événement **`reportcards.snapshot.created`** (remplace `issued`) ; ajouts `render_requested` (reprise explicite et filet de sécurité), `render_failed`, `withdrawn` ; `integrity.mismatch` porte `reason` |
| 5 | AC4.2 : la mention était dans le contenu public par défaut (Q-31 encore ouverte) | Défaut **sans mention** ; réglage de tenant `verificationShowsMention` pour l'activer. **À arbitrer avec le propriétaire du produit (Q-31)** |
| 6 | Provisoire « supprimable » alors que R-RC-02 et AC2.1 interdisent tout `DELETE` | Un provisoire se **révoque** (`CHECK (NOT provisional OR status IN ('ISSUED','REVOKED'))`) |
| 7 | Permissions : aucune permission pour les élèves et tuteurs (« session élève / tuteur ») | `reportcard.self.read` et `reportcard.child.read`, déjà couvertes par les motifs `*.self.*` / `*.child.*` des rôles système de rbac |
| 8 | Hash canonique : « nombres exacts en chaînes décimales » sans règle pour les autres nombres | Le snapshot ne contient que chaînes, **entiers sûrs**, booléens et `null` (jamais de flottant) ; refus explicite côté TypeScript (`CanonicalizationError`) **et** SQL (`reportcards.canonical_json`), ordre des clés par octets UTF-8, NFC ; vecteurs partagés rejoués contre la base |
| 9 | R-RC-09 (« le même `snapshot_hash` ne peut être émis deux fois ») sans mécanisme | Index unique `(tenant_id, snapshot_hash)` |
| 10 | Réglages du tenant (délibération requise, blocage si impayé, politique de vérification) sans table | Table `settings` (1 ligne par tenant) |
| 11 | « Consommés : `results.period.reopened` (marque à rééditer) » | « À rééditer » est dérivé à la lecture (version des résultats du snapshot < version courante) ; plus robuste qu'un indicateur écrit sur événement |
| 12 | Journal des vérifications « rétention 24 mois (job) » alors que les journaux sont append-only | Suppression autorisée **uniquement** par le job de purge, sous réglage de transaction dédié, pour les lignes de plus de 24 mois |
| 13 | `POST /branding/assets` « URL de dépôt signée » sans port de stockage correspondant | `StoragePort.signedUploadUrl` (S3 : `PutObject` pré-signé) ; contrôle des octets (PNG, JPEG, GIF, WebP ; jamais de SVG) à l'enregistrement |
| 15 | AC1.2 « relancer le lot ne crée aucun doublon » sans dire ce que devient une inscription qui avait échoué ou n'avait pas encore de résultat | Rejouer le **même lot** (même clé d'idempotence) le **reprend** : seules les inscriptions non encore émises (échecs, exclusions réévaluées, inscrits tardifs) sont retraitées ; un bulletin déjà émis n'est jamais recréé ni modifié ; un rejeu qui ne change rien est neutre (aucune écriture, aucun événement) ; la clé par défaut inclut la version des résultats, le mode provisoire et la présence d'un motif de réémission |
| 14 | Les droits de `report_cards` accordaient `UPDATE` sur toutes les colonnes | Le déclencheur `report_cards_immutable` fige tout sauf statut, publication, retrait, remplacement, révocation et rendu courant ; déclencheurs `ENABLE ALWAYS` (actifs même sous `session_replication_role = replica`) |

**Ports** (le module `results` n'existe pas encore ; les ports sont définis ici, avec implémentations en mémoire exportées par `index.ts`) : `ResultsReadPort` (`getPeriodState`, `listRoster`, `getFinalBundle`, `getCumulativeBundle`), `GuardianshipPort`, `AttendanceSummaryPort` (optionnel), `LearnerStandingPort` (optionnel, échec fermé si le blocage est activé et le port absent), `UserDirectoryPort` (optionnel, nom affiché figé dans le snapshot), `StoragePort`, `PdfRenderer`, `PdfMerger`, `KeyProvider`.

## Addendum d'assemblage (additif)

- Ports consommés, branchés par `apps/api/src/platform/adapters/` : `ResultsReadPort` (results + academic + people + rules), `GuardianshipPort` et `UserDirectoryPort` (people, iam), `AttendanceSummaryPort` (minutes justifiées / non justifiées et retards effectifs), `LearnerStandingPort` (impayé exigible, sans montant), `StoragePort` (S3 / MinIO par `STORAGE_S3_*`, repli `REPORTCARDS_S3_*`, repli disque en développement).
- Le worker reçoit le stockage et les ressources de rendu par `setReportcardsWorkerResources` ; les valeurs décimales sont normalisées (`6`, pas `6.00`) avant d'entrer dans l'instantané signé.

## Extensions Phase 4-5 (additif : packs Primaire, Secondaire, Examens)

Livré dans `apps/api/src/modules/reportcards` (migration `1305_reportcards_pack_documents.sql`) :

- **Natures de document** : `COUNCIL_MINUTES` (PV de conseil : conseil de classe 006, conseil des maîtres 005), `ANNUAL_REVIEW` (bilan annuel du primaire), `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` (018). Elles passent par le service générique des documents officiels (`requestOfficialDocument`, unique par nature et source, idempotent) : snapshot et contexte d'impression fournis par le module propriétaire, scellés (hash recalculé en SQL, code opaque, signature Ed25519), rendus dans le worker, inscrits dans l'index de **vérification publique** (qui les résout désormais).
- **Gabarits de plateforme en données** (publiés avec les autres, sans HTML libre) : `council-minutes`, `annual-review-primary`, `exam-convocation`, `exam-success-certificate`, `exam-transcript` (modèles génériques ; les rubriques officielles s'ajouteront comme nouvelles versions) et `report-primary` (bulletin du primaire et de la maternelle avec le bloc **compétences** : compteurs de niveaux par domaine, jamais de moyenne). `primary-bulletin` et `secondary-bulletin` ne changent pas.
- **Snapshot `reportcard/1`, champs additifs facultatifs** : `rules.sourceKind`, `enrollment.fundingType` et `enrollment.stateAssigned`, `competencies`. Les bulletins déjà émis sont inchangés.
- **« Affecté(e) »** vient du **type de financement de l'inscription** (`stateAssigned`, dérivé par l'adaptateur de `academic`), jamais du texte de la décision ; il s'affiche dans la cellule « Statut » du bloc élève.
- **Règles de démonstration** : quand la version de règle d'un résultat est `placeholder`, le document porte le filigrane `DÉMONSTRATION` (qu'une option de gabarit ne peut pas retirer) et la mention « Règles de démonstration — document sans valeur officielle » (composant `{{> footer}}`) ; le propriétaire d'un document officiel transmet `ruleSourceKind` (scellé dans le snapshot, donc dans l'empreinte) ; la **vérification publique** répond `AUTHENTIC` avec `demonstration: true` et un message qui le dit (réponse inchangée pour un document ordinaire).
- **Décisions de conseil** : le bundle FINAL reflète la décision de fin d'année **confirmée** (décision du conseil) plutôt que la proposition de la règle, et les distinctions décidées par un conseil.

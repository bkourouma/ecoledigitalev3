# Module `reportcards` — bulletins, relevés et rendu PDF serveur

Spec : `specs/v2/013-report-cards/` (révisée au §16 de `spec.md`). Plage de migrations : **1300-1399** (`1300`-`1303` livrées). Schéma Postgres : `reportcards`.

Un bulletin est un **instantané immuable** de résultats déjà calculés et clôturés (module `results`) :
valeurs exactes **et** d'affichage, identifiant de **version de règle**, **hash** SHA-256 du JSON canonique,
**signature Ed25519** (clé de l'environnement, jamais du dépôt), **trace d'explicabilité**, identité de l'établissement et
signataires **résolus à l'émission**. Le PDF est rendu **dans le worker** (Puppeteer, JavaScript désactivé, réseau coupé)
**depuis le snapshot seul**, stocké via `StoragePort`, et vérifiable par **QR code** sur une page publique sans donnée personnelle.

## Ce que fait le module

| Besoin | Mécanisme |
|---|---|
| Émettre les bulletins d'une classe | `GET /preflight` (manques listés avec lien de correction) puis `POST /batches` : un snapshot par inscription, **un SAVEPOINT par inscription** (une erreur n'arrête pas le lot), lot **idempotent** (clé de lot), exclusions listées |
| Immuabilité | Déclencheurs SQL (`1303`) : aucun `UPDATE` du contenu, aucun `DELETE`, transitions de statut légales, hash **recalculé en SQL** à l'insertion ; `ENABLE ALWAYS` (actifs même pour un superutilisateur sous `session_replication_role = replica`) |
| Remplacement / révocation | `reissue` : version `n+1` (`supersedes_id`, motif), l'ancienne passe `SUPERSEDED` dans la même transaction et reste lisible par la gestion ; `revoke` (motif obligatoire, MFA) ; jamais d'effacement |
| Rendu PDF | Abonné `reportcards.render-snapshot` (événement `reportcards.snapshot.created`), 3 tentatives (une ligne `renders` par tentative), puis `FAILED` avec la cause ; reprise par bouton / lot |
| Gabarits | `platform_templates` (versions immuables une fois publiées, validées : liste blanche de balises, aucune URL, aucun script) + `template_configs` par tenant (options validées par le schéma du gabarit, emplacements de signature) ; **aucun HTML libre d'un tenant en v1** |
| Identité & signataires | `branding_versions` (versionnée), `signatories` (registre en données ; aucun nom par défaut) |
| Authenticité | Code opaque 128 bits (base32, 26 car.), QR, signature `Ed25519("ed-rc/v1" \0 hash \0 code \0 issuedAt)`, clés publiques publiées (`/.well-known/ecoledigitale-keys.json`), comparaison d'un PDF téléversé |
| Accès | Gestion = tout ; élève = ses bulletins **publiés** ; tuteur = ceux de ses enfants **liés** (lien revérifié à chaque appel) ; un bulletin qui n'est pas le sien répond **404** comme un bulletin inexistant ; URL signée ≤ 5 min ; téléchargements famille journalisés |
| Délibération | Date **réelle** du conseil/jury lue dans `results` et figée dans le snapshot (jamais la date d'impression) ; réglage `requireDeliberation` |
| Relevé cumulé | `POST /transcripts` (feature `reportcard.transcript`), version `n+1` à chaque nouvelle demande |
| Documents d'autres modules | `sealDocument`, `renderDocumentPdf`, `registerVerificationFor` (diplômes/attestations 019, bulletin de paie 032) ; natures inconnues refusées |

## Arborescence

```
manifest.ts   index.ts (API publique)   subscribers.ts / jobs.ts (worker)   tsconfig.json   vitest.config.ts
migrations/   1300 tables globales · 1301 identité, signataires, configs, réglages · 1302 snapshots, rendus, lots, journaux · 1303 gardes
domain/       canonical (JSON canonique+hash) · signing (Ed25519, codes) · qr (encodeur ISO 18004) · template-engine · template-validation
              options-schema · snapshot (construction pure) · render-context · document-html · lifecycle · events · errors · types
templates/    builtin.ts (5 gabarits génériques) · partials.ts (composants de plateforme)
application/  ports · deps · context · issue · lifecycle · queries · render · verify · integrity · reference · platform · documents
infrastructure/  repositories SQL (Tx de TenantDb) · storage-memory · storage-s3 · key-provider · puppeteer-renderer · pdf-merger
                 in-memory-ports · audit-adapter
http/         plugin.ts (`setup` + `default (app, runtime)`) · guards · presenters
```

## Tables

Tenant (RLS forcée) : `branding_versions`, `signatories`, `template_configs`, `settings`, `report_cards`, `renders`, `batches`, `batch_items`,
`verification_events`, `access_log`. **Globales** (liste blanche d'isolation, `isolation-allowlist.reportcards.ts`) : `platform_templates`,
`signing_keys` (clés **publiques**), `verification_index` (code → tenant, document : aucune donnée personnelle), `file_hash_index`
(empreinte d'un PDF → code). Références vers le cœur (élève, inscription, classe, année, période) : **UUID sans clé étrangère**.

## Routes (préfixe `/api/v1/reportcards`, appliqué par le registre)

| Méthode | Chemin | Permission |
|---|---|---|
| GET | `/preflight` | `reportcard.generate` |
| POST / GET | `/batches`, `/batches/:id` · POST `/batches/:id/retry` | `reportcard.generate` |
| GET | `/report-cards`, `/report-cards/:id` | `reportcard.read` |
| GET | `/report-cards/:id/explain` | `reportcard.explain` (consultation auditée) |
| GET | `/report-cards/:id/pdf` | `reportcard.read` \| `reportcard.self.read` \| `reportcard.child.read` |
| GET | `/classrooms/:id/periods/:pid/pdf` (PDF combiné) | `reportcard.read` |
| POST | `/report-cards/:id/publish` · `/withdraw` · `/publish` (lot) | `reportcard.publish` |
| POST | `/report-cards/:id/reissue` · `/render` · `/transcripts` | `reportcard.generate` (`reportcard.transcript` pour le relevé) |
| POST | `/report-cards/:id/revoke` | `reportcard.revoke` |
| GET / PUT | `/branding` · POST `/branding/assets` | `reportcard.branding.manage` |
| GET / POST / PATCH | `/signatories` | `reportcard.signatory.manage` |
| GET | `/templates` · GET / PUT `/template-configs` · POST `/template-configs/preview` | `reportcard.template.manage` |
| GET / PUT | `/settings` | `reportcard.read`\|`template.manage` / `branding.manage` |
| GET | `/me/report-cards`, `/children/:studentId/report-cards` | `reportcard.self.read` \| `reportcard.child.read` |
| — | `/platform/templates`, `/platform/keys` | JWT super-admin (séparé du JWT tenant) |
| GET / POST | `/api/v1/public/verify/:code`, `/verify/upload`, `/keys` (aussi sous `/api/v1/reportcards/public/…`) et `/.well-known/ecoledigitale-keys.json` | **publiques** (`config.public`), 30 req/min/IP |

Permissions sensibles (MFA) : `generate`, `publish`, `revoke`, `branding.manage`, `signatory.manage`. Features : `reportcard.transcript`,
`reportcard.public-verification`, `reportcard.block-unpaid`.

## Événements

Publiés (payload `{ v: 1, … }`, schémas dans `packages/contracts/src/v2/reportcards.ts`) : `reportcards.snapshot.created` (déclenche le rendu),
`report_card.render_requested`, `.rendered`, `.render_failed`, `.published`, `.withdrawn`, `.superseded`, `.revoked`, `reportcards.batch.completed`,
`reportcards.integrity.mismatch`. Consommé : `tenancy.tenant.provisioned` (publication idempotente des gabarits de plateforme).

## Audit (`runtime.auditPort`, même transaction, en dernier)

`reportcards.batch.generated`, `batch.resumed`, `report_card.reissued`, `.published`, `.withdrawn`, `.revoked`, `.downloaded` (famille : sensible), `.explain_read`,
`report_cards.published` (lot), `transcript.issued`, `branding.updated`, `signatory.created|updated`, `template_config.updated`, `settings.updated`,
`integrity.mismatch` ; journal de plateforme : `template.published|retired`, `signing_key.retired`.

## Ports (le module `results` n'existe pas encore : ports définis ici, implémentations mémoire exportées)

`ResultsReadPort` (`getPeriodState`, `listRoster`, `getFinalBundle`, `getCumulativeBundle`) · `GuardianshipPort` · `AttendanceSummaryPort` (optionnel,
prime sur l'assiduité du bundle) · `LearnerStandingPort` (optionnel ; si « bloquer si impayé » est actif et le port absent : **échec fermé**) ·
`UserDirectoryPort` (optionnel) · `StoragePort` (**défini ici** : S3/MinIO + mémoire) · `PdfRenderer` · `PdfMerger` · `KeyProvider`.
Les modules voisins s'enregistrent par `registerReportcardsPorts(app, ports)` dans leur `setup(app, runtime)` (ordre quelconque).

## Secrets et variables d'environnement (aucune valeur dans le dépôt)

| Variable | Rôle |
|---|---|
| `REPORTCARDS_SIGNING_KEY` / `REPORTCARDS_SIGNING_KEY_FILE` | clé **privée** Ed25519 PKCS#8 (PEM, `\n` échappés acceptés, ou DER base64) / chemin d'un secret monté |
| `REPORTCARDS_SIGNING_KEY_ID` | identifiant (`a-z0-9-`, 6-40) ; défaut `ed-` + 16 hex de l'empreinte de la clé publique |
| `REPORTCARDS_VERIFICATION_BASE_URL` (repli `V2_APP_BASE_URL`) | domaine public de vérification ; le QR encode `<base>/v/<code>` |
| `REPORTCARDS_S3_BUCKET`, `_REGION`, `_ENDPOINT` (MinIO), `_FORCE_PATH_STYLE`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_SSE` (`AES256` défaut, `aws:kms`, `none`), `_KMS_KEY_ID`, `_PREFIX` | stockage objet (API **et** worker) |
| `REPORTCARDS_CHROME_PATH`, `REPORTCARDS_CHROME_NO_SANDBOX=1`, `REPORTCARDS_RENDER_CONCURRENCY` (défaut 2) | moteur de rendu (worker) |

Générer une clé : `node -e "const {generateKeyPairSync:g}=require('crypto');console.log(g('ed25519').privateKey.export({format:'pem',type:'pkcs8'}))"` puis la fournir au gestionnaire de secrets.
**Rotation** : déployer une nouvelle clé avec un nouvel identifiant (elle s'enregistre au premier usage) ; retirer l'ancienne par `POST /platform/keys/:keyId/retire` ;
les documents signés par l'ancienne restent vérifiables (clé publique conservée, statut `RETIRED`). Un `keyId` ne peut jamais désigner deux clés publiques.

## Déploiement du worker

Le bundle du worker embarque le module (S3, `pdf-lib`) mais **pas** Puppeteer : l'image du worker doit installer `puppeteer` (+ Chromium) et lire les mêmes
variables `REPORTCARDS_*` ; conteneur **sans route sortante** (défense en profondeur : le rendu coupe déjà réseau et JavaScript, `--host-resolver-rules` fait échouer toute
résolution DNS). **Reconstruire le worker** après tout changement d'abonné ou de job (`pnpm --filter @ecoledigitale/worker build`). Mesure sur poste Windows (Chrome 148,
concurrence 2) : ≈ 0,76 s par bulletin, soit ≈ 76 s pour 100 bulletins (objectif AC1.5 : ≤ 120 s sur 2 vCPU, à confirmer sur le worker de référence).

## Tests

```bash
pnpm exec vitest run --config apps/api/src/modules/reportcards/vitest.config.ts                       # unitaires purs (+ rendu Chromium réel si Chrome présent)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/reportcards/vitest.config.ts   # + intégration Postgres
```

Unitaires : canonisation/hash, signature, codes, QR (matrices identiques à une implémentation de référence), moteur et validation de gabarits, rendu HTML des 5 gabarits,
stockage. Intégration : gardes SQL (même superutilisateur), parité JSON canonique SQL/TypeScript (400 valeurs aléatoires), émission/lots/réémission, rendu et reprises,
accès (gestion, élève, tuteur lié/non lié, autre tenant), vérification publique, rotation de clés, HTTP complet, abonnés du worker, isolation A/B. **Conditionnels (ignorés avec un message)** :
`pdf-renderer.test.ts` (Chromium réel : injection, déterminisme, débit) et `s3-live.test.ts` (S3/MinIO réel via `REPORTCARDS_TEST_S3_*`).

## Limites connues

- Écrans web, E2E « année simulée » et suppression du legacy (T-WEB-*, T-E2E, T-CLEAN) : hors de ce module.
- Équité du rendu entre tenants (file limitée par tenant, plan §T-RENDER) : non implémentée — le rendu passe par la file BullMQ de l'abonné (concurrence 2 par instance) ; un très gros tenant peut retarder les autres. À traiter avec la capacité réelle du worker.
- Un lot est écrit dans UNE transaction (≈ 12 à 25 ms par bulletin) : au-delà de quelques milliers d'inscriptions, découper par `enrollmentIds`.
- Reprise : rejouer le même lot (même clé) ne retraite que les inscriptions non encore émises (échecs, exclusions réévaluées, inscrits tardifs) ; rien n'est recréé.
- Gabarits **génériques** : les modèles officiels (primaire, secondaire) sont à fournir ; ils s'ajouteront comme nouvelles versions de gabarit sans livraison de code.
- La vérification publique ne sait résoudre que `REPORT_CARD` et `TRANSCRIPT` ; 019 / 032 inscrivent leurs codes avec `registerVerificationFor` et devront fournir leur résolveur de statut.
- Polices : familles génériques (Chromium embarque les glyphes utilisés dans le PDF) ; aucune police propriétaire n'est livrée.
- Non-régression visuelle : comparaison par extraction de texte, pages, métadonnées et octets (rendu reproductible) — pas de comparaison d'images (dépendante des polices du poste).

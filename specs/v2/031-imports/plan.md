# Plan d'implémentation — imports (031-imports)

## Architecture

```
POST /jobs (corps brut)      worker (abonnés BullMQ)                    modules cibles
  │  sniff + zip + limites     imports.validate  (job.validation_requested)
  │  stockage + lignes brutes    passe 1 : mapping + coercion + Zod + règles + clé naturelle
  ▼                              passe 2 : doublons dans le fichier (SQL)
imports.jobs / rows              passe 3 : plan = port.plan(...) dans une transaction TOUJOURS annulée
  │ PUT mapping, POST validate
  │ POST run  ──────────────▶  imports.run  (run.requested)  ──▶ lots :  db.run(ctx auteur)
  ▼                              bail + battement de coeur            ├─ port.apply(ligne) en SAVEPOINT ─▶ people / academic /
GET jobs, rows, preview,         reprise : job `imports.resume-stalled` │                                    assess / finance
report, summary (polling 1,5 s)  fin : imports.run.completed ──▶ tenancy (onboarding)
```

- **Domaine pur** (`domain/`) : coercions, mapping, validation, clés naturelles, neutralisation. **Importeurs** (`importers/`) : description (colonnes, alias, schéma Zod, clé naturelle, options, permissions), un fichier chacun, enregistrés par `registry.ts`.
- **Ports** (`application/ports.ts`) : `ImportTargetPort` par importeur (`plan` lecture seule, `apply` écriture d'une ligne, `applyBatch` facultatif, `choices`, `checkOptions`). **Adaptateurs** (`platform/adapters/imports-*.ts`) : seule couche qui connaît `people`, `academic`, `assess`, `finance`, par leur **API publique** ; dépendances d'ÉCRITURE avec le vrai audit.
- **Fichiers** (`infrastructure/files/`) : `sniff` (type réel), `csv`, `xlsx` (JSZip, flux, décompression comptée), `xml` (lecteur linéaire sans DTD), `write` (CSV / XLSX de sortie neutralisés).

## Lots de livraison

| Lot | Contenu | Preuve |
|---|---|---|
| 1 | Spec, contrats Zod, lecteurs de fichiers sûrs, domaine, importeurs, moteur (validation, exécution), HTTP, abonnés, jobs | tests unitaires (domaine, fichiers hostiles) ; moteur sur Postgres réel avec port factice |
| 2 | Adaptateurs people / academic / assess / finance, `people.resolveStudentRefs` | test d'intégration sur les VRAIS modules (`apps/api/test/adapters/imports.integration.test.ts`) |
| 3 | HTTP sur base réelle, module chargé par le registre, modèles de fichier, réglages d'exploitation | tests HTTP, registre |
| 4 | Onboarding `tenancy` piloté par `imports.run.completed` ; test du VRAI worker (SIGKILL, rejeu, annulation) ; performance 5 000 lignes | `apps/api/test/imports/*` |
| 5 | Écrans `/v2/imports/*`, hooks typés, i18n `v2Imports*`, tests RTL | `apps/web/src/app/v2/imports/_components/Imports.test.tsx` |

## Choix techniques

- **XLSX** : `jszip` (déjà dépendance de l'API) + lecteur XML maison ; pas d'`exceljs` (non installé côté API, lit tout en mémoire). Les formules ne sont jamais évaluées : valeur en cache.
- **Plan dans une transaction annulée** : `plan` peut appeler les cas d'usage RÉELS (doublon probable, unicité, amorçage paresseux de référentiels) sans qu'aucune écriture subsiste ; plus sûr qu'un `READ ONLY` qui ferait échouer des lectures légitimes.
- **Un lot = une transaction** ; `db.run(ctx)` des modules cibles s'imbrique en SAVEPOINT (même connexion, même contexte) : les écritures de `people` / `academic` / `assess` / `finance`, les résultats par ligne, les références d'idempotence et le curseur sont atomiques.
- **Bail + battement de coeur hors transaction** (connexion distincte) ; l'horloge du bail est celle de la base.
- **Appels séquentiels** dans les ports (règle de `platform-assembly.md` §11).
- **Aucun `new Date()` dans le domaine** : horloge injectée (`RuleEnv.today`).

## Exploitation

Variables du worker (facultatives) : `IMPORTS_LEASE_SECONDS` (45), `IMPORTS_HEARTBEAT_MS` (5000), `IMPORTS_MAX_RUN_ATTEMPTS` (5), `IMPORTS_STALE_AFTER_SECONDS` (90). Stockage d'objets obligatoire pour téléverser (`STORAGE_S3_*` ou repli disque de développement). Un nouveau module impose de **reconstruire le bundle du worker** (`pnpm --filter @ecoledigitale/worker build`). Dimensionnement : ~10 à 20 lignes/s pour les élèves sur Postgres dans Docker/Windows (voir README) ; le pool du worker doit offrir deux connexions par import actif (transaction de lot + battement de coeur).

## Gates

`pnpm check:boundaries`, `pnpm check:secrets`, `pnpm test:isolation`, `pnpm --filter @ecoledigitale/api type-check:v2`, tests du module et des adaptateurs, `events-catalog`, build du worker (les abonnés `imports.*` et `tenancy.onboarding-on-import-completed` y figurent), `cd apps/web && pnpm test`.

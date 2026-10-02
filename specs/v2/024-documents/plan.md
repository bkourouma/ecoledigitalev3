# Plan d'implémentation — gestion documentaire (024)

**Spec** : `spec.md` · **Modèle** : `data-model.md` · **Parité** : `parity.md` · **Décisions à arbitrer** : `open-questions.md`

## 1. Résumé

Module backend `documents` (schéma Postgres `documents`, migrations `2500-2599`), contrats `packages/contracts/src/v2/documents.ts`, adaptateurs `platform/adapters/{people-documents,storage (vue documents),storage-scan,entitlements-documents}.ts`, écrans `/v2/documents/*`, composant `DocumentPicker` (`platform/ui`). Packs : PRIMARY, SECONDARY, HIGHER, VIRTUAL. Aucune dépendance de manifeste (`dependsOn: []`) : tout passe par des ports.

## 2. Architecture

```
http/plugin.ts ──▶ application/*.ts ──▶ domain/*.ts (pur)                 infrastructure/*.ts
   gardes RBAC         cas d'usage        policy (accès), file-policy        *-repository.ts (SQL, Tx)
   multipart borné     (deps, ctx, in)    (nom, octets magiques, taille),    clamav-scanner.ts (socket / HTTP)
   limiteur HTTP          │               expiry, metadata, categories        office-converter.ts (LibreOffice, off)
                          │                                                   in-memory-ports.ts (tests)
                          ├── ports.ts : StoragePort · MalwareScanner(+ScanPolicy) · OwnerDirectory ·
                          │              DocumentConverter · UsageReporter · AuditPort
                          └── port-registry.ts : app.documentsPorts (API) · setDocumentsWorkerPorts (worker)

platform/adapters : people-documents.ts · storage.ts (asDocumentsStorage) · storage-scan.ts (messaging / people / attendance)
                    entitlements-documents.ts (usage) · wiring dans adapters/index.ts
jobs.ts : documents.expiry-sweep (quotidien) · documents.housekeeping (purge de rétention, quarantaine)
```

- **Autorisation** : `domain/policy.ts` pur (matrice testée) ; les capacités RBAC sont lues par `http/guards.ts` (`capsFor`) ; les liens (élève, enfants, personnel) viennent du port, relus à chaque requête. La liste applique les **mêmes** règles en SQL (test de non-divergence).
- **Transactions** : lecture et décision dans une transaction, **scan hors transaction**, écriture dans une seconde (objet → lignes → historique → événements → audit en dernier). Un échec métier annule tout (`inTx`) ; l'objet écrit est compensé (supprimé).
- **Appels de ports séquentiels** (une connexion partagée par `TenantDb.run` imbriqué : jamais de `Promise.all`).
- **Aucune FK inter-schémas** ; clés composites ; allowlist d'isolation vide.
- **Pas d'écriture dans un `GET`**, sauf : la première lecture d'un tenant crée ses paramètres et son jeu de catégories (idempotent) ; chaque lecture / prévisualisation / téléchargement d'un document écrit son historique et son audit (exigence de traçabilité, §spec 9).

## 3. Lots

| Lot | Contenu | Preuve |
|---|---|---|
| L0 | Spec, modèle, plan, parité, questions ouvertes | revue |
| L1 | Contrats Zod, migrations `2500`-`2502`, domaine pur (politique d'accès, contrôle de fichier, expiration, métadonnées, catégories de départ), ports et doubles (stockage mémoire, scanner EICAR, annuaire) | `test/unit/*` |
| L2 | Dépôts SQL, cas d'usage (catégories, droits, paramètres, documents, versions, partages, archivage, quarantaine, téléchargement, prévisualisation, expirations, quotas), événements, audit | intégration réelle : RLS A/B, matrice, versions, immuabilité, quarantaine, quotas, atomicité |
| L3 | Plugin HTTP (multipart borné, gardes, erreurs stables, limiteur), manifeste, rôles système rbac, adaptateurs de plateforme, ClamAV, convertisseur Office, URL signées | HTTP réel par rôle, URL signées expirées, adaptateurs (serveur clamd simulé), catalogue d'événements |
| L4 | Jobs (alertes d'expiration, entretien), reconstruction du worker | tests de jobs ; `pnpm --filter @ecoledigitale/worker build` |
| L5 | Client typé, écrans, `DocumentPicker`, i18n `v2Documents*`, dépôt au clavier | Vitest / RTL |
| L6 | README du module, `platform-assembly.md`, gates | `check:boundaries`, `check:secrets`, `test:isolation`, `type-check:v2` |

## 4. Extensions additives des autres modules

| Module | Extension | Raison |
|---|---|---|
| rbac | `templates/system-roles.ts` : permissions `documents.*` accordées aux rôles système (+ justification du motif `documents.*` pour la direction) ; `test/system-roles.test.ts` : oracle et liste des modules | la suite complète refuse un module sans matrice de rôles ; sans cela, seul le propriétaire a accès |
| plateforme | `adapters/index.ts` (ports du module `documents`, route du repli disque inchangée), `adapters/storage.ts` (vue `asDocumentsStorage`), `adapters/people-documents.ts`, `adapters/storage-scan.ts`, `adapters/entitlements-documents.ts` | ports entre modules |
| plateforme | `docs/architecture/module-conventions.md` (plage 2500-2599), `platform-assembly.md` (variables `DOCUMENTS_*`, adaptateurs) | conventions |
| contrats | `packages/contracts/src/v2/index.ts` | export |
| web | `fr-CI.json` (`v2Documents*`), menus du portail | écrans |

## 5. Risques et parades

| Risque | Parade |
|---|---|
| Fichier déguisé (extension trompeuse, polyglotte, macro) | octets magiques, cohérence extension / type, liste blanche par catégorie, macros Office refusées, texte strict, SVG / HTML jamais acceptés, scanner |
| Divulgation d'existence d'un document ou d'un tenant | 404 identique, RLS, clés composites, dédoublonnage restreint aux documents visibles |
| Fuite de contenu via événements / audit / historique | identifiants seulement ; jamais de titre ni de nom de fichier dans les payloads |
| Prévisualisation exécutant du contenu | types restreints, octets servis avec `nosniff` + CSP, jamais d'HTML / SVG ; PDF rendu par le visionneur du navigateur ; Office converti hors processus et désactivé par défaut |
| Scanner indisponible | fail-closed en production (paramétrable) ; état `UNSCANNED` visible |
| Gros fichiers | lecture bornée en flux, plafond de plateforme, quota |
| Objet orphelin après échec | compensation (suppression) ; purge n'efface la ligne que si l'objet est supprimé |
| Divergence liste / accès | même règle en SQL et en TypeScript, test de matrice croisée |
| Lien de tutelle périmé | résolu à chaque appel, jamais mis en cache |

## 6. Déploiement

1. `pnpm db:v2:migrate` (migrations `2500`-`2502` ; extensions `unaccent` / `pg_trgm` déjà requises par people).
2. `pnpm --filter @ecoledigitale/worker build` (jobs embarqués).
3. Variables : `STORAGE_*` (inchangées) ; **nouvelles** `DOCUMENTS_SCANNER` (`none` | `clamav-tcp` | `clamav-socket` | `clamav-http`), `DOCUMENTS_CLAMAV_HOST`, `_PORT`, `_SOCKET`, `_URL`, `_TIMEOUT_MS`, `DOCUMENTS_SCAN_FAIL_CLOSED` (défaut : vrai en production), `DOCUMENTS_HARD_MAX_BYTES` (défaut 50 Mio), `DOCUMENTS_SIGNED_URL_TTL_SECONDS` (défaut 60, ≤ 300), `DOCUMENTS_QUOTA_BASE_BYTES`, `DOCUMENTS_QUOTA_EXTENDED_BYTES`, `DOCUMENTS_QUOTA_LARGE_BYTES`, `DOCUMENTS_OFFICE_CONVERTER` (`off` | `libreoffice`), `DOCUMENTS_SOFFICE_PATH`.
4. Rôles : les modèles système portent déjà `documents.*` ; les établissements existants reçoivent les permissions à la prochaine synchronisation rbac.
5. Web : menus servis par `rbac/me/navigation` ; routes `/v2/documents`.

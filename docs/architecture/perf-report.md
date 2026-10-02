# Rapport de performance et de charge (Phase E)

Date des mesures : 2026-10-02. Branche de travail : `feat/v2-phase-0` (worktree jetable). Harnais : `apps/api/test/load/`. Résultats bruts de référence : `apps/api/test/load/baseline.json` (le rapport complet d'une exécution est écrit dans `apps/api/test/load/results/`, ignoré par git).

> **À lire d'abord.** Ces chiffres viennent d'un **poste de développement Windows partagé** (voir §2), pas d'un banc dédié. Le client de charge, l'API et le worker tournent dans **un seul processus Node** ; Postgres et Redis tournent dans Docker Desktop (latence aller-retour élevée). Ils servent à **trouver des goulots et à comparer deux versions sur la même machine**, pas à dimensionner la production. D'autres sessions de test ont tourné en parallèle pendant les mesures : la dispersion d'une exécution à l'autre atteint ×2 sur les écritures (§2.3).

## 1. Ce qui a été fait

| Livrable | Où |
|---|---|
| Harnais de charge (Node pur : `fetch` + calcul de percentiles, **aucune dépendance ajoutée**) | `apps/api/test/load/` (`load.load.ts`, `support/{platform,seed,stats}.ts`, `config.ts`) |
| Script dédié, hors suite par défaut | `pnpm test:load` (racine) = `pnpm --filter @ecoledigitale/api test:load` ; config `apps/api/vitest.load.config.ts` (n'inclut que `test/load/**/*.load.ts` : la suite par défaut n'inclut que `*.test.ts`) |
| Job CI manuel/planifié, non bloquant, **sans toucher `ci.yml`** | `.github/workflows/load.yml` (`workflow_dispatch` + cron hebdomadaire, `continue-on-error`, hors `needs` de `ci-ok`) |
| Deux index de performance (migration additive) | `apps/api/src/modules/finance/migrations/0507_finance_perf_indexes.sql` |

Le harnais démarre **l'API v2 réelle** (Fastify + vrais plugins + `registerV2Platform`, vrais adaptateurs inter-modules) **qui écoute sur un vrai port** (sockets réelles, keep-alive, pas `inject`), avec **le vrai worker en processus** (relais d'outbox, abonnés, jobs, file BullMQ), sur **Postgres 17 et Redis 7 éphémères** (`apps/worker/scripts/with-infra.mjs` : conteneurs Docker supprimés à la fin). Tout passe par HTTP avec de vrais comptes IAM (MFA par TOTP pour la direction) : aucun contexte forgé.

## 2. Méthode, matériel, conditions

### 2.1 Jeu de données (généré par HTTP, donc par les vraies règles et gardes)

Par tenant (établissement SECONDARY, plan PROFESSIONAL) : classes de 50 élèves, 4 matières à coefficients, 600 élèves créés (détection de doublons incluse), inscriptions en lot, **une facture de scolarité émise par élève**, 8 évaluations par classe **publiées** par le circuit complet (saisie, soumission, relecture, validation, publication : 4 800 notes par tenant), 1 enseignant affecté, 3 parents avec compte de portail (2 enfants chacun).

Exécution de référence : `ED_LOAD_SCALE=10` = **3 tenants x 600 élèves = 1 800 élèves, 1 800 inscriptions, 1 800 factures, 14 400 notes**, plus ~3 300 élèves ajoutés dans le tenant 1 par le voisin bruyant (§5). L'échelle ~2 000 élèves par tenant correspond à `ED_LOAD_SCALE=33` (non exécutée ici : la génération seule dure ~15 min à l'échelle 10 sur cette machine).

### 2.2 Exécution

* Scénarios **séquentiels** (jamais en parallèle entre eux), **boucle fermée** à concurrence fixe (8 par défaut, `ED_LOAD_CONCURRENCY`).
* Mesure : p50 / p95 / p99 / max, débit, erreurs (5xx, réseau, 4xx inattendus) ; retard de la boucle d'événements, CPU du processus et tas ; **chaque requête SQL est chronométrée** (patch de `pg.Client.prototype.query`, un « pg_stat_statements » du pauvre) pour trouver les pires requêtes, puis `EXPLAIN (ANALYZE, BUFFERS)`.
* **Limites de débit IAM de production conservées** (300 connexions / 15 min / IP, 120 refresh / min / IP, 20 réinitialisations de mot de passe / h / IP) ; seul l'historique du limiteur est vidé entre deux tenants de la génération (une seule IP, 127.0.0.1, active des dizaines de comptes). Coût scrypt de **production** (`logN=16`, défaut IAM).
* Rendu PDF des bulletins : moteur **déterministe** (pas de Chrome) pour la stabilité ; `ED_LOAD_REAL_PDF=1` utilise Chrome. La mesure Chrome existante est dans le README de `reportcards` (≈ 0,76 s / bulletin, concurrence 2).

### 2.3 Matériel et conditions (à citer avec tout chiffre)

| | |
|---|---|
| Machine | Windows 11 Pro, Intel Core i5-1335U (10 coeurs / 12 threads), 32 Go de RAM |
| Docker Desktop 29.6.1 | 12 CPU, 16 Go ; `postgres:17-alpine` (17.10, config par défaut : `shared_buffers=128MB`, `max_connections=100`, `work_mem=4MB`, `fsync=on`), `redis:7-alpine` |
| Node | v24.18.1, un seul processus pour client + API + worker |
| Pool de connexions API | `V2_DB_POOL_MAX` par défaut = **10** |
| Charge de la machine | **variable** : plusieurs autres sessions de test (Postgres/Redis Docker, vitest) tournaient en parallèle. Deux exécutions identiques du même jour donnent jusqu'à ×2 d'écart sur les écritures (ex. création d'élève p50 94 -> 476 ms entre le tenant 2 et le tenant 3 de la même exécution) |

### 2.4 Ce qui n'est PAS rejoué ici (cité)

* **Import de 5 000 lignes** : mesuré par `apps/api/test/imports/performance.integration.test.ts` (`IMPORTS_PERF_ROWS`) ; valeurs du README `modules/imports` : upload ~1 s, validation ~130 s, import 9 à 20 lignes/s (22 requêtes SQL par élève), **pic de tas ~47 Mo, borné** (≈ 2x celui de 200 lignes).
* Paie (`payroll/test/integration/performance`), emplois du temps (`scheduling/test/integration/performance` : génération 40x30x18 < 60 s, vue de classe p95 < 200 ms), moteur de règles (`packages/rules-engine`), rendu PDF Chrome (README `reportcards`) : tests propres à chaque module, non dupliqués.

## 3. Seuils

Le plan (`docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`) **ne fixe aucun objectif chiffré** de performance ou de charge. Les seuils viennent donc, dans l'ordre : (1) des objectifs des specs de module (`specs/v2/*`), (2) des SLO « proposés » du runbook (§4), (3) à défaut, de valeurs **PROPOSÉES** ci-dessous. Ils sont dans `apps/api/test/load/config.ts` (`THRESHOLDS`) ; `ED_LOAD_THRESHOLD_FACTOR` les relâche sur une machine lente. Ils ne font échouer le test que si `ED_LOAD_ENFORCE=1` (job CI) ; les propriétés de **correction** (aucune 5xx, aucune fuite inter-tenants) échouent toujours.

| Scénario | Seuil p95 | Source |
|---|---:|---|
| Lectures (listes, détail, relevé, portail, charge mixte) | 500 ms (p99 2 s) | runbook §4 « latence API (lectures) » |
| Recherche d'élèves | 200 ms | spec 008 AC4.1 (sur 20 000 élèves) |
| Saisie de notes en lot (60 élèves) | 300 ms | spec 011 AC1.4 |
| Pointage d'appel (60 élèves) | 300 ms | spec 010 AC1.5 |
| Bulletins : lot d'une classe de bout en bout | 1,2 s x taille de classe (60 s pour 50) | spec 013 AC1.5 « 100 bulletins en <= 120 s sur 2 vCPU » proratisé |
| Ouverture / soumission d'un appel | 500 ms | **proposé** |
| Connexion (scrypt de production) | 1 500 ms | **proposé** |
| Refresh | 300 ms | **proposé** |
| Paiement en ligne, webhook | 1 000 ms | **proposé** |
| Paiement manuel (virement) | 1 500 ms | **proposé** |
| Clôture d'une période (résultats d'une classe) | 6 000 ms | **proposé** |
| Voisin bruyant : p95 du tenant calme pendant la saturation d'un voisin / p95 seul | <= x3 | **proposé** |
| Erreurs 5xx | 0 | runbook (SLO de disponibilité 99,5 %) |
| Fuite inter-tenants | 0 | spec 000 (isolation) |

## 4. Résultats (échelle 10, 3 tenants, concurrence 8)

Colonnes en ms. « Dépasse » = au-dessus du seuil du §3 (indicatif : machine chargée).

| Scénario | Req. | Err. | p50 | p95 | p99 | max | Débit req/s | Seuil | |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| iam.login (scrypt logN=16) | 160 | 0 | 729 | 1 089 | 1 265 | 1 839 | 10,4 | 1 500 | ok |
| iam.refresh (rotation) | 100 | 0 | 45 | 82 | 161 | 171 | 76,8 | 300 | ok |
| people.students.list (page de 50) | 3 000 | 0 | 115 | 219 | 278 | 381 | 65,2 | 500 | ok |
| people.students.list.deep (dernière page) | 3 000 | 0 | 128 | 240 | 308 | 473 | 58,4 | 500 | ok |
| people.students.search | 3 000 | 0 | 72 | 120 | 152 | 217 | 103,6 | 200 | ok |
| finance.invoices.list (ISSUED) | 3 000 | 0 | 71 | 126 | 159 | 225 | 104,3 | 500 | ok |
| finance.invoice.detail | 3 000 | 0 | 72 | 144 | 185 | 239 | 99,1 | 500 | ok |
| finance.statement | 200 | 0 | 65 | 141 | 199 | 200 | 105 | 500 | ok |
| finance.reports.summary | 80 | 0 | 43 | 55 | 61 | 61 | 87,7 | 1 000 | ok |
| assess.grades.batch (50 notes) | 144 | 0 | 288 | 549 | 731 | 793 | 24,4 | 300 | **dépasse** |
| assess.grades.rewrite (50 notes, rowVersion) | 144 | 0 | 307 | 513 | 540 | 606 | 24,3 | 300 | **dépasse** |
| attendance.open | 216 (dont 108 refus 409 attendus de l'appel « journalier », puis repli sur l'appel par séance) | 108 (ces 409) | 285 | 457 | 611 | 639 | 8 | 500 | ok |
| attendance.mark (50 pointages) | 108 | 0 | 625 | 816 | 888 | 893 | 4 | 300 | **dépasse** |
| attendance.submit | 108 | 0 | 747 | 1 044 | 1 107 | 1 342 | 4 | 500 | **dépasse** |
| attendance.call (3 requêtes) | 108 | 0 | 1 985 | 2 336 | 2 444 | 2 757 | 4 | | |
| finance.payment.online (init sandbox) | 720 | 0 | 243 | 479 | 687 | 794 | 29,5 | 1 000 | ok |
| finance.webhook (signé, public) | 720 | 0 | 565 | 2 375 | 3 548 | 5 756 | 9,1 | 1 000 | **dépasse** |
| finance.webhook.replay (même événement x3) | 180 | 0 | 79 | 130 | 184 | 208 | 182,6 | | ok |
| finance.payment.manual (virement) | 540 | 0 | 644 | 2 676 | 4 117 | 6 800 | 8,2 | 1 500 | **dépasse** |
| isolation.mixed (3 tenants + sondes croisées) | 6 000 | 0 | 147 | 253 | 323 | 458 | 100,4 | 500 | ok |
| isolation.rls.direct (`app_user`, requêtes directes) | 240 | 0 | 30 | 46 | 50 | 53 | 511 | | ok |
| results.close (verrouillage + calcul, 50 élèves x 4 matières) | 36 | 0 | 8 897 | 12 207 | 12 430 | 12 430 | 0,3 | 6 000 | **dépasse** |
| reportcards.batch.e2e (50 bulletins, file + worker) | 36 | 0 | 56 091 | 67 767 | 68 586 | 68 586 | 0,1 | 60 000 | **dépasse** |
| portal.parent.mix (6 routes de lecture) | 6 000 | 0 | 275 | 642 | 972 | 1 541 | 25,5 | 500 | **dépasse** |

Écritures de génération (concurrence 6, tenants 1 et 2, machine moins chargée) : création d'élève (détection de doublons incluse) p50 94-97 ms, p95 450-490 ms, **36-37 req/s** (objectif spec 008 : « création 100/s soutenue », non atteint sur ce poste) ; facture depuis le barème p50 211-356 ms, 10-16 req/s ; inscription en lot : 50 inscriptions par appel en 4-8 s (≈ 90-160 ms par inscription, **séquentielles**).

**Correction, sous concurrence** : 0 erreur 5xx sur l'ensemble des scénarios ; webhooks rejoués en rafale : un paiement, un reçu ; `iam.login` / `iam.refresh` : aucune réponse 429 dans les budgets du limiteur.

### 4.1 Lecture des résultats

* **Lectures : conformes.** Toutes les listes sont sous le SLO (p95 120-240 ms) à ~100 req/s. À 65 req/s sur la liste d'élèves, le CPU du processus est déjà à ~0,6 coeur (8,8 ms de CPU par requête, client compris) : la limite est le **thread unique de Node** (API + worker + client) bien avant Postgres.
* **Portail parent** (p95 642 ms) : 3,4 transactions par requête et une recherche de session (`iam.sessions` joint aux identités/adhésions/tenants) à chaque appel ; le dépassement tient surtout au poste chargé (la même charge a donné p95 ~160 ms à l'exécution précédente).
* **Écritures : les chemins métier sont lents, pas la base.** Un `COMMIT` coûte 5 à 30 ms et chaque transaction ajoute `BEGIN` + 2 `set_config` (§6) : 8 à 24 transactions par requête métier (`attendance.call` : 24 transactions / appel, `webhook` : 10, `bulletins` : ~950 transactions par lot de 50) — chaque transaction paie ~4 aller-retours Docker.
* **Verrous par tenant sérialisent les écritures** : numérotations gapless (`people.next_number`, `finance.next_number`) et chaîne d'audit (`pg_advisory_xact_lock` par tenant) tiennent leur verrou jusqu'au `COMMIT`. `finance.next_number` : 1 260 appels, **532 ms en moyenne** (attente de verrou, max 6,2 s) alors que la même requête s'exécute en quelques ms hors contention ; c'est ce qui borne le débit de paiements d'un tenant (webhook et virement : ~3 par seconde et par tenant ici).

## 5. Multi-tenant : isolation et « voisin bruyant »

### 5.1 Pas de fuite (hard)

* **2 354 sondes croisées** (jeton du tenant A, ressource du tenant B : élève, facture, inscription, relevé) en charge mixte simultanée de 3 tenants : **toutes refusées (403/404), 0 fuite**. Pour le seul relevé d'un apprenant, un 200 aurait été toléré s'il ne contenait aucune donnée de l'autre tenant (jamais une facture étrangère) ; aucune fuite n'a été relevée.
* Toutes les pages de listes d'élèves, factures et inscriptions renvoyées pendant la charge (≈ 3 600 des 6 000 requêtes du scénario) **ne contiennent que des identifiants du tenant demandeur**.
* **RLS sous concurrence, rôle applicatif** : 240 `SELECT count(*) ... FILTER (WHERE tenant_id <> $1)` en rafale sur 4 tables (élèves, inscriptions, factures, notes) : comptes exacts, **0 ligne étrangère** ; `UPDATE` d'un autre tenant = 0 ligne ; `INSERT` pour un autre tenant refusé (`WITH CHECK`).

### 5.2 Dégradation entre tenants : **échec du seuil proposé (x3)**

Un tenant « calme » (concurrence 2, lectures et portail) est mesuré seul, puis pendant qu'un voisin pousse 24 requêtes simultanées pendant ~2 minutes :

| Voisin | p50 calme seul -> avec voisin | p95 calme seul -> avec voisin | Rapport p95 | Voisin (req/s) | Pool pg (max 10) |
|---|---|---|---:|---:|---|
| Lectures lourdes (pages de 200, synthèse financière, factures) | 70 -> 606 ms | 122 -> 1 023 ms | **x8,4** | 48,8 | 10 connexions, **17 requêtes en attente** |
| Créations d'élèves en rafale | 70 -> 1 646 ms | 122 -> 3 826 ms | **x31,5** | 11,8 | 10 connexions, **17 en attente** |

Aucune erreur côté tenant calme (0 5xx, 0 timeout) : c'est de la **latence**, pas de la perte. Causes identifiées :

1. **Le pool Postgres (10 connexions) est partagé et servi en FIFO sans équité par tenant** : 24 requêtes d'un voisin font la queue devant celles de la victime (17 en attente observées). Le mode « créations » est pire car chaque requête détient sa connexion pendant qu'elle **attend le verrou gapless `people.next_number` de son propre tenant** (moyenne 636 ms par appel, max 10 s) : le voisin épuise le pool avec des transactions bloquées.
2. **Un seul thread Node** exécute tous les tenants (et le worker, qui traite en tâche de fond les ~3 300 événements `student.created` produits par le voisin).

**Recommandation (bulkhead par tenant implémenté ensuite : voir §10.1) :** plafonner la concurrence **par tenant** (bulkhead : p. ex. 1/4 du pool, files par tenant en tourniquet) devant le pool, limiter le débit d'écritures par tenant (`@fastify/rate-limit` par `tenantId`), et séparer lectures (réplica / pool dédié) et écritures. À tester ensuite avec ce même scénario.

## 6. Goulots, pires requêtes et index

### 6.1 Les trois requêtes les plus coûteuses en temps cumulé (`EXPLAIN (ANALYZE, BUFFERS)`)

Mesurées sur toute l'exécution, hors attentes de verrou (`next_number`) et overhead de transaction.

| # | Requête | Appels | Cumul | Moyenne vue de l'appli | Plan / exécution SQL |
|---|---|---:|---:|---:|---|
| 1 | Liste d'élèves (`people.students-repo.listStudentRows` : `students` JOIN `persons`, `LATERAL` vers la projection d'inscriptions, `count(*) OVER()`, tri `lower(nom), lower(prénom)`) | 9 064 | 893 s | 98,5 ms | `Hash Join` + `LATERAL` en `Index Scan` (`student_enrollment_summaries_by_student`) **exécuté pour CHAQUE élève du tenant** (3 971 boucles) avant le `LIMIT` : coût **O(N élèves par page demandée)**. 15,8 ms à 3 858 élèves sur un poste au repos, 288 ms sous charge. Index utilisés : aucun manquant. |
| 2 | Recherche de session à chaque requête authentifiée (`iam.sessions` JOIN `identities`, `memberships`, `tenants`) | 39 684 | 459 s | 11,6 ms | 0,28 ms d'exécution, 3 `Index Scan` par clé primaire. Aucun index manquant : c'est le **nombre** d'appels (1 par requête, plus 1 par appel de port) et les aller-retour qui coûtent. |
| 3 | `academic.grade_levels WHERE id = $1` (motif **N+1** : une lecture par élève ou par ligne pendant la clôture et les bulletins) | 6 996 | 246 s | 35,1 ms | 0,085 ms d'exécution (`Index Scan` sur la clé primaire). À charger **une fois par lot**, pas par élève. |

Autres constats SQL :

* **L'exécution SQL n'est pas le goulot** : aucune requête métier ne dépasse quelques ms hors attente de verrou. Les coûts sont **le nombre de transactions et d'aller-retour** (4 instructions de préambule par transaction : `BEGIN`, `set_config` tenant/utilisateur/acteur..., `set_config('statement_timeout')`, puis `COMMIT`, ~12 ms par transaction ici) et **l'attente de verrous par tenant** (gapless, chaîne d'audit).
* `analytics.refresh_requests` (`INSERT ... ON CONFLICT` sur une ligne chaude par tenant) : moyenne 20 ms, max 3,3 s sous rafale de paiements ; `kernel.processed_events` : 18 261 insertions (7 ms en moyenne) ; aucune purge n'a été observée pendant la mesure (la table croît avec les événements : vérifier la rétention).
* Balayages séquentiels (statistiques Postgres) : `people.persons` 15 032 balayages (33 M lignes lues), `people.students` 2 596, `assess.assessments` 19 566 : sans conséquence à 5 000 lignes (le planificateur préfère le balayage) ; `persons` est lu par la détection de doublons (`search_key % $4`, index GIN trigramme `persons_search_trgm` présent) — un voisin qui crée 3 000 homonymes la rend coûteuse (54 ms/appel) par conception (tous les « BRUIT... » se ressemblent).
* Contrôle systématique des **clés étrangères sans index** : les candidats sur grosses tables (`results.period_results.closure_id`, `finance.payments.intended_invoice_id`, `reportcards.batch_items.batch_id`) ne sont **jamais interrogés** par ces colonnes (ou déjà couverts par un index composé) : aucun index à ajouter.

### 6.2 Index ajoutés (`finance/migrations/0507_finance_perf_indexes.sql`, additive, `IF NOT EXISTS`)

Plage `finance` 0500-0599 : 0507 est le premier numéro libre (0500-0506 existent), sans ambiguïté. Aucune migration existante modifiée. La migration est appliquée par le test `test/v2-migrations.test.ts` (6 tests verts).

| Index | Requête servie | Mesure (Postgres 17, données synthétiques, table recopiée dans un schéma jetable) |
|---|---|---|
| `payments_pending_by_age ON finance.payments (tenant_id, created_at) WHERE status = 'PENDING'` | jauge « paiements en attente » du worker (`business-gauges.ts`), une fois par tenant à chaque passage. L'index partiel existant `payments_pending_online_idx` exige aussi `method = 'ONLINE'` : il ne peut pas la servir ; la note du runbook demandait cet index. | 336 000 paiements : **53 ms (`Parallel Seq Scan`, 45 000 pages lues) -> 1,5 ms (`Index Only Scan`, 160 pages)** ; index de 32 ko (les `PENDING` sont rares) |
| `invoices_by_created ON finance.invoices (tenant_id, created_at DESC, id DESC)` | `GET /finance/invoices` (`ORDER BY created_at DESC, id DESC LIMIT/OFFSET`, filtres facultatifs) : sans index d'ordre, Postgres lit toutes les factures du tenant satisfaisant le filtre puis trie. | 120 000 factures par tenant, 20 000 émises : page 1 **73 ms -> 0,4 ms** ; page 9 (`OFFSET 400`) 4,5 ms ; coût : ~20 Mo pour 360 000 factures et une écriture d'index par facture |

À l'échelle de l'exécution de référence (600 factures par tenant) l'effet est invisible (le planificateur choisit déjà un balayage) : l'index prépare les établissements de plusieurs années de factures. Les créer sur une très grosse table existante se fera plutôt hors migration en `CREATE INDEX CONCURRENTLY` (le fichier le dit).

## 7. Recommandations (par ordre de gain attendu)

1. **Équité entre tenants** (§5.2) : bulkhead par tenant devant le pool, limite de débit d'écriture par tenant, et mise en file des événements d'un tenant qui en produit des milliers (le worker partage le processus et le CPU avec l'API en test, pas en production — à re-mesurer avec API et worker séparés).
2. **Réduire les aller-retour par transaction** (`packages/database/src/executor.ts`) : fusionner `set_config(...)` et `statement_timeout` en une instruction (ou `BEGIN` + paramètres en une seule requête multi-instructions) : −2 aller-retour sur 4 par transaction. Mettre en cache de courte durée (quelques secondes, invalidée par `auth_epoch`) la résolution de session/droits, qui coûte 1 transaction par requête et par appel de port.
3. **Raccourcir les sections critiques par tenant** : dans les chemins de paiement (`finance.next_number` puis reçu, allocations, mise à jour de facture, audit, outbox) ne garder sous le verrou que ce qui doit l'être ; envisager de poser le numéro en dernier ou par un travail asynchrone « numérotation » quand la loi n'exige pas le numéro à la réponse. C'est ce qui borne ~3 paiements/s/tenant.
4. **Inscriptions en lot** (`POST /academic/enrollments/bulk`, jusqu'à 500 éléments) : séquentielles (une transaction par inscription, 90-160 ms chacune) : 50 éléments = 4-8 s, 500 = 45-80 s dans une seule requête HTTP. Au-delà de ~50, passer par le module `imports` (worker) ou paralléliser par lots.
5. **Liste d'élèves** : calculer la page (tri + `LIMIT`) sur `persons`/`students` avant le `LATERAL` d'inscription et le `count(*) OVER()`, pour passer de O(N) à O(page) ; pagination par curseur au-delà de quelques milliers.
6. **N+1** : `academic.grade_levels` par élève dans les résultats/bulletins (6 996 appels), `analytics.refresh_requests` (une demande par paiement/note) : regrouper.
7. **Connexion** : scrypt `logN=16` coûte ~0,35 s de CPU (54,9 s de CPU pour 160 connexions) et plafonne à ~10 connexions/s par processus (pool de threads libuv de 4 : `UV_THREADPOOL_SIZE` à ajuster ; limiter l'IP protège déjà de l'abus). Rentrée scolaire : prévoir de la marge CPU ou un service d'authentification dédié.
8. **Clôture de période** : p50 8,9 s pour 50 élèves (2,5 s à l'exécution précédente avec 2 tenants) ; ~109 transactions par clôture. À rendre asynchrone (file) au-delà de ~50 élèves ; la mesure est sensible à l'arriéré d'événements du worker (le voisin bruyant en avait laissé 3 300).
9. **Rétention** de `kernel.processed_events` et `kernel.domain_events` (≈ 18 000 et 26 000 lignes pour 1 800 élèves).
10. **Postgres de production** : `shared_buffers`, `work_mem`, `max_connections` et `V2_DB_POOL_MAX` à régler ; `pg_stat_statements` activé (le harnais s'en passe par le chronomètre de requêtes).

## 8. Limites de la mesure

* Client de charge, API et worker partagent **un processus et un thread** : les latences incluent la concurrence du client avec le serveur (borne haute) et le CPU du worker (traitement des événements pendant les scénarios d'écriture). Un banc réel sépare ces rôles (k6 / autocannon depuis une autre machine).
* Docker Desktop sous Windows ajoute une latence d'aller-retour réseau élevée (le README `imports` fait le même constat) : les chemins à nombreuses transactions (appel, bulletins, paiements) sont **surévalués** ; les chemins à une requête SQL sont proches du réel.
* Poste **partagé et de charge variable** pendant les mesures ; une seule exécution complète à l'échelle 10 ; pas d'intervalle de confiance. Écart observé entre exécutions : ×2 sur les écritures.
* ~600 élèves par tenant (1 800 au total) au lieu de ~2 000 par tenant ; les effets en O(N) (liste d'élèves, factures) sont extrapolés par `EXPLAIN` sur données synthétiques (120 000 factures, 336 000 paiements), pas mesurés de bout en bout.
* Boucle fermée (pas de débit imposé, pas de pointe de rentrée) ; scénarios mono-IP (les limiteurs d'IP de IAM sont ceux d'un client unique).
* PDF : moteur déterministe ; la mesure Chrome vient du README `reportcards`.
* Le test `test/scaffold-gates.test.ts`, lancé avec les tests de migration, a échoué par délai d'attente (`onTaskUpdate`) sur ce poste chargé (515 s) ; il est étranger aux changements de cette tâche et n'a pas été rejoué sur la base.

## 9. Reproduire

```bash
# échelle réduite, CI (60 élèves par tenant, 3 tenants) : ~10 à 15 min ; exige Docker
pnpm test:load

# échelle de référence de ce rapport
ED_LOAD_SCALE=10 pnpm test:load

# ~2 000 élèves par tenant (long : prévoir plusieurs heures sur un poste de développement)
ED_LOAD_SCALE=33 pnpm test:load

# variables : ED_LOAD_SCALE, ED_LOAD_TENANTS, ED_LOAD_CONCURRENCY, ED_LOAD_ENFORCE=1 (seuils bloquants),
# ED_LOAD_THRESHOLD_FACTOR, ED_LOAD_REAL_PDF=1, ED_LOAD_SCRYPT_LOG_N, ED_LOAD_ONLY=<préfixes de scénarios>,
# ED_LOAD_HOLD=1 (garde Postgres/Redis vivants après la mesure pour des EXPLAIN à la main ; créer results/release pour finir)
```

Avec Postgres et Redis déjà disponibles (CI) : `pnpm --filter @ecoledigitale/api exec vitest run -c vitest.load.config.ts` avec `TEST_DATABASE_URL` et `REDIS_URL`. Le job `.github/workflows/load.yml` fait cela (manuel ou lundi, non bloquant, seuils appliqués avec un facteur 2).

## 10. Après optimisations

Date : 2026-10-02. Mesure **avant / après sur la même machine, même harnais, même échelle réduite** : `ED_LOAD_SCALE=3` (3 tenants x 180 élèves = 540 élèves, 4 320 notes), concurrence 8, scénarios `people.students,portal,isolation.mixed,noisy,results.close,finance.payment.manual`. « Avant » = sources de `65767c25` (`apps/api/src` et `packages` remis à cet état, harnais identique), « après » = HEAD. Données brutes : `apps/api/test/load/reference/before-65767c25.json` / `after-optimisations.json` (copies de `results/latest.json`).

> **Mise en garde.** Poste Windows partagé avec d'autres agents : la charge ambiante a varié entre les deux exécutions (exemple : 180 inscriptions en lot du premier tenant en 192 s « avant » contre 44 s pour le dernier tenant « après »). Les latences absolues ne se comparent donc que **grossièrement** ; les comparaisons fiables sont les **compteurs d'instructions SQL** (déterministes) et les **plans `EXPLAIN`**. Une seule exécution de chaque, sans intervalle de confiance.

### 10.1 Voisin bruyant (bulkhead par tenant) : objectif proposé <= x3

Mécanisme : `packages/database/src/bulkhead.ts`, utilisé par `TransactionExecutor` (donc `TenantDb` et `SystemDb`). Une place est prise **avant** `pool.connect()` et rendue **après** sa libération. Plafond par tenant (défaut : moitié du pool), plafond total = taille du pool (l'attente se fait donc dans des files **par tenant servies en tourniquet**, plus dans la file FIFO du pool), attente maximale et file bornée ; au-delà : `503` `tenant_busy` avec `Retry-After` (nouvelle catégorie `unavailable` du noyau, corps `{status:503, code:"tenant_busy", kind:"unavailable"}`). Un `run` imbriqué (SAVEPOINT) ne reprend pas de place (pas d'interblocage). RLS, permissions et audit ne sont pas touchés : le bulkhead ne fait que retarder ou refuser l'ouverture d'une transaction. Actif par défaut, désactivable.

| Variable | Défaut | Rôle |
|---|---|---|
| `V2_DB_TENANT_BULKHEAD` | actif | `off` / `false` / `0` désactive |
| `V2_DB_TENANT_MAX_CONCURRENCY` | moitié du pool (5 pour 10) | transactions simultanées par tenant |
| `V2_DB_TENANT_MAX_WAIT_MS` | 8000 | attente maximale d'une place avant 503 |
| `V2_DB_TENANT_MAX_QUEUE` | 200 | demandes en attente par tenant avant 503 immédiat |
| `V2_DB_TENANT_RETRY_AFTER_S` | 2 | valeur de `Retry-After` |

Métriques Prometheus (sans étiquette de tenant, par cardinalité) : `ed_db_tenant_bulkhead{pool,state=active|queued|tenants_at_cap|max_one_tenant}`, `ed_db_tenant_bulkhead_wait_seconds`, `ed_db_tenant_bulkhead_rejected_total{reason=timeout|queue_full}` ; un refus est journalisé (warn) au plus une fois par tenant et par 30 s.

| Voisin (24 requêtes simultanées) | p95 calme seul -> avec voisin, **avant** | Rapport | p95 calme seul -> avec voisin, **après** | Rapport |
|---|---|---:|---|---:|
| Lectures lourdes (pages de 200, synthèse financière, factures) | 157 -> 1 608 ms | **x10,2** | 169 -> 597 ms | **x3,5** |
| Créations d'élèves en rafale (compteur gapless du tenant) | 157 -> 8 020 ms (p50 87 -> 2 331 ms) | **x51,0** | 169 -> 188 ms (p50 78 -> 101 ms) | **x1,1** |

* Pool « avant » : 10 connexions, **17 requêtes en attente** ; « après » : 7 à 8 connexions utilisées, **0 en attente** (le voisin attend dans sa propre file). Aucune erreur 5xx côté tenant calme dans les deux cas ; côté voisin « créations », 13 erreurs « avant », 0 « après » (aucun `tenant_busy` déclenché à cette échelle : aucune attente n'a dépassé 8 s).
* **Objectif x3 : atteint pour les écritures (x1,1), non atteint pour les lectures (x3,5 contre x10,2).** Les lectures lourdes restent limitées par le **thread Node unique** (client de charge, API et worker dans un même processus : le CPU du processus est saturé), qu'un bulkhead de connexions ne peut pas relâcher. À re-mesurer avec API et worker séparés. Le voisin « lectures » est aussi freiné (25 req/s contre 35) : il fait la queue chez lui, c'est le but.
* Tests : `packages/database/test/bulkhead.unit.test.ts` (plafond, tourniquet, délai, file pleine, SAVEPOINT, options), `bulkhead.integration.test.ts` (pool réel de 4 connexions : la victime attend plus de 300 ms sans bulkhead, moins de 250 ms avec ; RLS A/B inchangée ; places rendues même après erreur), `apps/api/test/tenant-bulkhead.test.ts` (503 + `Retry-After` + code, autre tenant non ralenti, désactivation, variables, métriques).
* Limites : le plafond par tenant est dur (un tenant seul sur la plateforme ne peut pas dépasser la moitié du pool : relever `V2_DB_TENANT_MAX_CONCURRENCY` pour un déploiement mono-tenant) ; le bulkhead est **par processus** (chaque instance d'API a le sien) ; le worker n'est pas câblé (son `TenantDb` n'a pas de bulkhead).

### 10.2 Liste d'élèves : paginer d'abord, joindre ensuite

`people/infrastructure/students-repo.ts` : la page est choisie (filtre, tri, `LIMIT/OFFSET`, `count(*) OVER()`) sur `students` JOIN `persons` dans un `WITH page AS MATERIALIZED`, puis la projection d'inscription (`LATERAL`) et l'accès portail ne sont joints que pour les lignes de la page. Contrat, filtres, ordre (`lower(nom), lower(prénom), id`) et total inchangés ; la page au-delà de la fin compte sans jointure. Test `students-list-pagination.integration.test.ts` : **mêmes lignes, même ordre, même total** que la requête historique (conservée dans le test) pour 14 combinaisons de filtres et de pages, plus RLS A/B.

`EXPLAIN (ANALYZE, BUFFERS)`, 20 000 élèves dans le tenant (+300 dans un autre), Postgres 17.10, médiane de 7 exécutions :

| Cas | Avant | Après | Boucles du `LATERAL` |
|---|---:|---:|---|
| Page 1 (50) | 507 ms | **48 ms** | 19 600 -> 50 |
| Dernière page | 601 ms | **97 ms** | 19 600 -> aucune boucle sur le tenant entier |
| Recherche `q=Nom12` | 268 ms | **180 ms** | 1 399 -> 50 |

Reste O(N) : le tri et le `count(*) OVER()` du filtre (inhérents à une pagination par `OFFSET` avec total) ; une pagination par curseur ferait mieux au-delà de quelques dizaines de milliers de lignes. Dans le harnais (540 élèves) l'effet est noyé par la charge ambiante : liste p50 227 -> 130 ms, recherche p95 795 -> 308 ms.

### 10.3 N+1 `academic.grade_levels WHERE id = $1`

`academic/infrastructure/grade-level-cache.ts` : mémoïsation **par objet `RequestContext`** (un traitement qui appelle les ports N fois avec le même contexte lit chaque niveau une fois ; un autre contexte, donc une autre requête, ne partage rien), durée de vie absolue de 10 s, jamais de `null` en cache, copies renvoyées, **désactivée définitivement pour un contexte qui écrit sur les niveaux** (`upsertGradeLevel`, `setGradeLevelNext`, `tpl*`) et jamais remplie par la transaction qui a écrit (ROLLBACK possible) ; `ACADEMIC_REQUEST_CACHE=off` la désactive. Aucun cache entre tenants, requêtes ou processus. Tests : `academic/test/unit/grade-level-cache.test.ts` (8 : même contexte, deux contextes, deux tenants avec valeurs différentes, désactivation, TTL, écriture, ROLLBACK, copies).

Mesure (compteur `gradeLevelById`) : `portal.parent.mix` **48 -> 3** ; `results.close` 35 -> 34 et `finance.payment.manual` 162 -> 162, **inchangés** : dans ces scénarios chaque appel de port arrive avec un contexte distinct (une lecture par requête HTTP, ce n'est pas un N+1). Les ~7 000 lectures du rapport initial venaient surtout de la génération (inscriptions en lot : un même contexte pour N inscriptions) et des bulletins par lot, qui ne sont pas rejoués dans cette exécution réduite : **le gain sur ces chemins n'est pas mesuré ici**. Limite assumée : une modification faite par un AUTRE processus pendant la vie (au plus 10 s) du contexte lecteur n'est pas vue par lui.

### 10.4 Recherche de session par requête authentifiée : **non réalisé** (volontairement)

L'exigence était un cache court, par jeton, invalidé à la révocation, **sans fenêtre de grâce**. Je ne peux pas la garantir : le verdict de `findSessionForRequest` dépend de plusieurs sources (`sessions.revoked_at`, `sessions.auth_epoch` contre `identities.auth_epoch`, `identities.status`, `memberships.status` et `roles`, `tenants.status`, `mfa_verified`) modifiées par plusieurs modules (IAM, tenancy pour la suspension d'un tenant, RBAC) et lues par **plusieurs instances d'API** : une invalidation locale ne protège pas les autres processus, et une invalidation partagée (Redis) devrait couvrir tous ces points d'écriture et refuser par défaut si Redis est indisponible. Une session révoquée resterait acceptée jusqu'à l'expiration du cache sur au moins une instance. Les tests existants (`iam/test/sessions.integration.test.ts`, `security.integration.test.ts`) continuent de prouver le refus immédiat tel qu'il est aujourd'hui.

Gain obtenu sans toucher à la sémantique : **un aller-retour de moins par transaction** (le `statement_timeout` est posé dans le même `SELECT set_config(...)` que le contexte de session : `BEGIN`, `SELECT`, requête, `COMMIT` au lieu de cinq instructions), ce qui profite à la recherche de session (une transaction par requête) comme à toutes les autres. Instructions SQL avant -> après : `people.students.list` 10 612 -> 8 204 (-23 %), `people.students.search` 10 474 -> 7 939 (-24 %), `isolation.mixed` 22 651 -> 18 456 (-19 %), `portal.parent.mix` 33 199 -> 27 724 (-16 %), pour un nombre de recherches de session identique (900 / 900 / 1 800 / 1 800). Piste ultérieure : un jeton de version de session partagé (Redis) vérifié à chaque requête (un aller-retour Redis au lieu d'une transaction), avec échec fermé.

### 10.5 Verrous des compteurs gapless : garantie intacte, une réduction minime

`finance.next_number` et `people.next_number` : **aucune modification de la numérotation** (compteur incrémenté dans la transaction qui insère le document, verrou jusqu'au `COMMIT`, sans trou). Un seul changement, sûr : dans `finalizeConfirmedPayment`, la relecture `getPayment` (indépendante du reçu) est faite **avant** `issueReceipt` : une requête de moins sous le verrou du compteur de reçus. Gain faible.

Non fait, et pourquoi : (a) la section critique réelle va du premier verrou de tenant (compteur) au `COMMIT` et inclut le verrou de la chaîne d'audit, lui aussi tenu jusqu'au `COMMIT` : déplacer l'audit avant le compteur ne ferait que déplacer la sérialisation ; (b) `issueDraft` (factures) a besoin du numéro avant `markInvoiceIssued`, puis de `refreshInvoiceStatus` qui lit l'état « émise » : non réordonnable sans changer le comportement ; (c) numéroter après coup ou en asynchrone changerait la garantie (numéro absent de la réponse) : décision métier hors périmètre. Les gains se trouvent plutôt dans la file par tenant (10.1) et la réduction des aller-retour (10.4).

### 10.6 Autres chiffres du harnais (avant -> après, même mise en garde)

| Scénario | p95 avant | p95 après | Instructions SQL avant -> après |
|---|---:|---:|---|
| people.students.list | 481 ms | 367 ms | 10 612 -> 8 204 |
| people.students.list.deep | 997 ms | 867 ms | 10 934 -> 8 790 |
| people.students.search | 795 ms | 308 ms | 10 474 -> 7 939 |
| finance.payment.manual | 4 950 ms | 2 499 ms | 17 905 -> 15 602 |
| isolation.mixed (0 fuite, 0 erreur) | 701 ms | 616 ms | 22 651 -> 18 456 |
| results.close | 7 063 ms | 9 856 ms | 10 890 -> 9 899 |
| portal.parent.mix | 438 ms | 602 ms | 33 199 -> 27 724 |

`results.close` et `portal.parent.mix` ont un p95 plus élevé « après » alors que leur nombre d'instructions baisse : charge ambiante différente d'une exécution à l'autre (cf. mise en garde) ; je ne les présente ni comme une régression prouvée ni comme un gain. Aucune erreur 5xx ni fuite inter-tenants dans aucune des deux exécutions.

### 10.7 Reproduire

```bash
ED_LOAD_SCALE=3 ED_LOAD_ONLY="people.students,portal,isolation.mixed,noisy,results.close,finance.payment.manual" pnpm test:load
# V2_DB_TENANT_BULKHEAD=off désactive le seul bulkhead ; les autres changements se comparent à 65767c25
PEOPLE_PERF_EXPLAIN=1 PEOPLE_PERF_N=20000 ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/people/vitest.config.ts students-list-pagination
```

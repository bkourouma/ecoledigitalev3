# Feature Specification: Rules Engine — usage produit (012-rules-engine)

**Feature Branch**: `012-rules-engine`

**Created**: 2026-10-01

**Status**: Rédigée — à relire avec le propriétaire du produit (questions métier : `open-questions.md` §B) avant `/speckit.plan`

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §13, §18, §51, §63 « Réglementation » ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.8, §4 (tranche 2.4) ; `docs/adr/ADR-003-dsl-regles-academiques.md` (fait foi pour le langage et le modèle) ; `docs/adr/ADR-004` (événements), `ADR-006` (schémas) ; `docs/architecture/module-conventions.md` ; `packages/rules-engine/` (types, `governance.ts`, `resolve.ts`, `simulate.ts`, fixtures et golden tests) ; legacy : `apps/api/src/services/bulletin-calc.ts`, `apps/api/src/routes/semester-averages.ts`. Gabarit : `specs/v2/000-platform-foundation/spec.md`.

> Cette spec **ne modifie pas le langage** : le DSL, le vérificateur, l'évaluateur, `RuleSet/RuleVersion/Rule`, `canTransition`, `resolveRuleSet` et `simulate` sont livrés par `@ecoledigitale/rules-engine` (tâche 0.8, 293 tests). Elle spécifie **l'usage produit** : la persistance, la gouvernance, les contrats avec les modules, la simulation, l'API et l'administration.
> Aucune règle réglementaire ivoirienne officielle (MGA, CEPE, BEPC, BAC, passage, redoublement…) n'est inventée : les RuleSets de départ sont le **portage de formules déjà en production** ; les textes officiels sont des QUESTIONS MÉTIER (`regulatory-sources-needed.md`).

## 1. Objectifs

1. **Zéro règle académique en dur** : tout seuil, formule, arrondi, mention, décision de passage ou de redoublement est une **RuleVersion** versionnée, datée, sourcée, testée ; les modules (`assess`, `results`, `reportcards`, `higher`) n'en contiennent aucune constante (garde-fou R2 de la spec 000, lint `modules/**`).
2. **Persister et gouverner** les RuleSets (nationaux publiés par le super-admin, variantes d'établissement) selon la chaîne `draft → simulated → proposed → approved → published → retired` (décision D5), avec simulation obligatoire sur les données réelles du tenant avant toute activation.
3. **Spécifier le contrat module ↔ moteur** : quelles données entrent (contexte typé), quelles sorties, comment le **module** (et non le moteur) orchestre le chaînage, comment le recalcul est déclenché, comment un résultat reste **reproductible et explicable** des années plus tard.
4. **Livrer les RuleSets de départ** `CI-HIGHER-LMD`, `CI-HIGHER-BTS`, `CI-CLASSIC-SEMESTRE`, portés des formules legacy, avec la liste des défauts du legacy à ne **pas** reproduire.
5. **Rendre l'ensemble administrable** : API et écrans (catalogue, éditeur validé en direct, éditeur de paramètres, simulation, file d'approbation, historique), sans livraison applicative pour modifier une règle (PRD §63 « Réglementation »).

## 2. Périmètre

### Inclus

- Module backend `rules` (`apps/api/src/modules/rules`, schéma Postgres `rules`) : persistance `RuleSet / RuleVersion / Rule`, paramètres, liaisons (`rule_bindings`), simulations, historique de gouvernance, seed des RuleSets de départ.
- API publique inter-modules (`rules/index.ts`) : `resolve`, `evaluate`, `evaluateMany`, `getContract`, `recordSimulationReport`, `requestSimulation` ; seul module autorisé à importer `@ecoledigitale/rules-engine` (règle `dependency-cruiser`).
- Catalogue des **contrats de règles** (`rule-contracts.md`) et vérification de conformité d'une version à son contrat.
- Gouvernance super-admin / tenant, files d'approbation, variante par paramètres et variante par expression, simulation (job worker).
- Cache de règles compilées, métriques d'évaluation, journal des évaluations échouées.
- Écrans d'administration (tenant et console super-admin) et page « Pourquoi ce résultat ? » (trace d'explicabilité), cette dernière alimentée par `results`/`reportcards`.
- Annexes : `rulesets-de-depart.md`, `regulatory-sources-needed.md`, `open-questions.md`.

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Langage, évaluateur, arithmétique décimale, budget, `simulate()` pur | `packages/rules-engine` (ADR-003, déjà livré) |
| Orchestration du calcul d'une période (chaînage, recalcul, surcharge, clôture) | 011-assessments-grades (module `results`) |
| Capitalisation de crédits, rattrapage, diplomation | 019-higher-education |
| Bulletins, snapshot, PDF | 013-report-cards |
| RuleSets primaire (MGA, CEPE…) et secondaire (BEPC, BAC…) | 005, 006, 018 — **dépendent des textes officiels** |
| Console super-admin générique (tenants, plans) | 001-saas-core ; cette spec ajoute ses écrans « Règles » |
| Authentification et RBAC | 002-auth-rbac |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Super-admin plateforme | Publie les RuleSets nationaux ; approuve les variantes d'établissement ; consulte l'impact multi-tenant. Agit via le `SuperAdminAuthorizer` (001/002) et `SystemDb` audité. |
| Administrateur d'établissement / directeur des études | Dérive une variante, édite paramètres ou expressions, lance la simulation, propose. N'approuve ni ne publie jamais (`canTransition`). |
| Propriétaire (owner) | Lit les règles actives et l'historique ; ne modifie pas. |
| Module consommateur (`results`, `higher`, `reportcards`) | Appelle l'API publique `rules` ; ne connaît ni le moteur ni les tables. |
| Auditeur / inspecteur | Consulte l'historique des versions et les rapports de simulation. |
| Worker | Exécute les simulations et le rejeu de reproductibilité. |

## 4. User Stories et critères d'acceptation

### US1 — Administrer les règles sans livraison de code (P1)

En tant qu'administrateur d'établissement, je modifie un seuil ou une pondération, je vois l'effet sur mes élèves réels, et la règle s'applique sans déploiement.

- **AC1.1** Dériver une variante depuis une version nationale publiée crée une `RuleVersion` tenant `draft` en une requête ; la variante reprend les règles de la base (copie, pas héritage).
- **AC1.2** Modifier un **paramètre** (ex. `poids_devoirs` 0,4 → 0,5) passe par un formulaire à bornes (`ParameterSpec.min/max`) ; une valeur hors bornes est refusée avec le message du moteur (« hors de l'intervalle autorisé »).
- **AC1.3** Modifier une **expression** exige la permission `rules.version.edit_expression` et la feature `rules.expression-editor` ; chaque frappe valide via `validate()` (≤ 300 ms p95 sur une règle de 1 000 caractères) et affiche les diagnostics français avec ligne/colonne et suggestion.
- **AC1.4** Une règle qui ne compile pas, ou dont le type de résultat ne respecte pas le contrat, **bloque** `draft → simulated` (aucun contournement).
- **AC1.5** Après approbation par le super-admin, la variante est utilisée pour les **périodes dont la date de début ≥ `effective_from`** sans redémarrage ni livraison ; les périodes antérieures et clôturées ne changent pas (AC4.x).

### US2 — Simuler avant d'activer (P1)

En tant qu'administrateur, je dois voir l'impact d'une variante sur mes données réelles avant de la proposer.

- **AC2.1** `draft → simulated` est impossible sans une simulation **terminée** sur la version courante ; toute modification de la version après simulation la repasse en `draft` (`canTransition simulated → draft`) et invalide le rapport.
- **AC2.2** Le rapport affiche : nombre de cas, de règles, d'évaluations ; modifiés / inchangés ; erreurs introduites / résolues ; **delta exact** (maximum absolu, moyenne) par règle numérique ; **matrice de transitions** pour les règles à code (mention, décision) ; part de résultats modifiés (`changedPercent`).
- **AC2.3** Une simulation sur 1 000 étudiants × un semestre (≈ 100 évaluations chacun) s'exécute en **≤ 60 s** (objectif ; débit du moteur ≥ 40 000 évaluations/s, ADR-003) ; elle est asynchrone (job worker) avec progression.
- **AC2.4** Le rapport conserve au plus 1 000 différences détaillées ; les **compteurs restent exacts** au-delà (`SimulationOptions.maxDifferences`).
- **AC2.5** Si plus de `X` % des **décisions** (passage/redoublement/validation) changent (seuil plateforme, défaut 5 %, réglable par le super-admin), la proposition exige une **confirmation explicite** de l'administrateur, tracée.

### US3 — Gouvernance des versions (P1)

En tant que super-admin, je valide les variantes et je publie les RuleSets nationaux.

- **AC3.1** Les transitions autorisées sont **exactement** celles de `canTransition` ; toute autre est rejetée `409 rules.transition_forbidden`.
- **AC3.2** Un administrateur d'établissement ne peut ni approuver, ni publier, ni toucher un RuleSet national (`403`, test exhaustif acteur × transition × portée).
- **AC3.3** Deux versions **actives** (`approved` ou `published`) d'un même RuleSet ne peuvent pas avoir de périodes d'effet qui se chevauchent : détection par `findEffectiveOverlaps` à l'approbation **et** contrainte d'exclusion en base (`daterange`, `btree_gist`).
- **AC3.4** L'auteur d'une version nationale ne peut pas l'approuver lui-même (séparation des tâches, réglage plateforme activé par défaut).
- **AC3.5** Chaque transition écrit une ligne d'historique (`rules.version_events`) **et** une entrée d'audit (`audit.record`), avec commentaire obligatoire pour `approved`, `rejected→draft`, `retired`.

### US4 — Résolution, pin et reproductibilité (P1)

En tant que directeur, un bulletin émis il y a trois ans doit pouvoir être expliqué et recalculé à l'identique.

- **AC4.1** La résolution (`resolve`) est une **fonction pure sur un état lu** : variante d'établissement active > national publié ; date d'effet = début de la période (jamais l'heure courante) ; la réponse inclut la liste `considered` avec la raison de chaque écart.
- **AC4.2** Chaque résultat calculé enregistre `(rule_version_id, definition_hash, engine_version, inputs_hash)` ; recalculer avec les mêmes quatre valeurs produit des sorties **strictement identiques** (comparaison d'`outputs_hash`).
- **AC4.3** Un job de **rejeu** (nuit, échantillon ≥ 1 % des résultats `FINAL` + 100 % des résultats portés par un bulletin contesté) recalcule et compare : tout écart déclenche une alerte `rules.replay.mismatch` (sévérité haute) ; objectif de production : 0 écart.
- **AC4.4** Publier ou activer une nouvelle version **ne modifie aucun résultat existant** ; elle n'est appliquée qu'aux calculs qui résolvent après sa date d'effet (pin), sauf action explicite « re-pin » sur une période **ouverte** accompagnée d'une simulation.
- **AC4.5** Une version `retired` reste lisible, compilable et rejouable (nécessaire à l'explication d'anciens bulletins) ; elle n'est jamais supprimée (aucun `DELETE`, garde en base).

### US5 — Contrat module ↔ moteur respecté (P1)

En tant que développeur d'un module consommateur, je n'écris aucune constante réglementaire et je ne casse pas une règle publiée.

- **AC5.1** `proposed` est refusé si la version ne satisfait pas son `contract_id` (clés manquantes, schéma d'entrée incompatible, type de résultat non conforme) ; le message nomme la clé et l'écart.
- **AC5.2** Seul le module `rules` importe `@ecoledigitale/rules-engine` ; une violation fait échouer `dependency-cruiser` (spec 000 US2).
- **AC5.3** Le lint R2 (spec 000) échoue sur toute constante numérique de seuil/pondération dans `assess`, `results`, `reportcards`, `higher` ; une liste blanche explicite couvre les constantes **structurelles** (taille de page, délais techniques).
- **AC5.4** Un test de contrat rejoue, pour chaque contrat, le pipeline du module avec les RuleSets de départ et compare aux golden tests du package.

### US6 — Expliquer un résultat (P2)

En tant que directeur ou parent autorisé, je comprends comment une moyenne a été obtenue.

- **AC6.1** « Pourquoi ce résultat ? » affiche, pour une valeur, la chaîne de règles évaluées (clé, version, expression, entrées, sortie) à partir de la **trace** du moteur (post-ordre, extrait de source, position) ; les valeurs surchargées sont signalées.
- **AC6.2** La trace est conservée pour tout résultat `FINAL` et pour tout bulletin émis ; les résultats `DRAFT` la reconstruisent à la demande par rejeu déterministe.
- **AC6.3** La page ne divulgue jamais de donnée d'un autre élève (le contexte de règle ne contient pas d'identité ; `rang` n'expose que des nombres).

### US7 — Banc d'essai de règle (P3)

- **AC7.1** `POST /evaluate` évalue une règle sur un contexte saisi (budget par défaut, sans persistance), limité à 30 appels/min par utilisateur (rate limiting 002), pour tester une expression pendant la rédaction.

## 5. Contrat module ↔ moteur

### 5.1 Frontières

```
packages/rules-engine (PUR)            apps/api/src/modules/rules (ce module)             modules consommateurs
 compile / validate / evaluate  <────  cache de règles compilées                 ◄────  results, higher, reportcards
 resolveRuleSet / simulate             persistance, gouvernance, contrats                 (importent rules/index.ts seulement)
 canTransition                         résolution + pin, journal, simulation (jobs)
```

- Le moteur est **sans E/S** ; il ne connaît ni tenant, ni base, ni horloge. Toutes les données lui sont **passées**.
- `rules` charge les `RuleSet`s candidats (nationaux + variantes du tenant courant), appelle `resolveRuleSet`, compile et évalue, et gère le cache. Il **ne connaît pas** les entités scolaires (élèves, notes) : il manipule des contextes opaques conformes aux schémas d'entrée.
- Les modules consommateurs ne connaissent pas le DSL. Ils connaissent des **clés de règle** et des **contrats**.

### 5.2 API publique (`rules/index.ts`)

| Fonction | Rôle |
|---|---|
| `resolve(tx, { contractId, tenantScope: { institutionId?, curriculumNodeId?, levelCode? }, date })` → `{ ruleVersionId, ruleSetCode, versionNo, definitionHash, origin: "tenant"\|"national", considered[] }` ou `null` | Résout via `rules.rule_bindings` puis `resolveRuleSet`. `null` ⇒ le consommateur lève `results.no_active_ruleset` (jamais de valeur par défaut codée). |
| `loadVersion(tx, ruleVersionId)` → `CompiledVersion` | Charge, compile (cache), vérifie le `definition_hash`. Fonctionne aussi pour une version `retired`. |
| `evaluate(compiled, ruleKey, context, { overrides?, trace? })` → `{ value, json, trace, nodesEvaluated }` | `contextWithParameters` + `evaluate` du moteur ; erreurs typées (`RuleEvaluationError`, `RuleBudgetError`) remontées en `rules.evaluation_failed` avec clé, position et message français. |
| `evaluateMany(compiled, calls[])` | Lot : évalue en une passe, fait court-circuit sur la première erreur **par appel**, renvoie les résultats partiels sans masquer l'échec. |
| `getContract(id)` | Contrat de règles (code). |
| `requestSimulation(tx, { versionId, dataset })` → `simulationId` | Crée la simulation, publie `rules.simulation.requested` (le module `results` construit les cas, voir §5.7). |
| `recordSimulationReport(tx, simulationId, report)` | Appelée par `results` à la fin du rejeu ; stocke le `SimulationReport`. |

Contrat d'erreur : aucune exception brute ; `Result<T, RulesError>` avec codes stables `rules.no_active_ruleset`, `rules.contract_violation`, `rules.evaluation_failed`, `rules.budget_exceeded`, `rules.hash_mismatch`, `rules.transition_forbidden`, `rules.overlap`.

### 5.3 Contrats de règles et RuleSets

Voir `rule-contracts.md`. Résumé : un **contrat** (`credit-semester@1`, `coef-semester@1`) est une **structure** versionnée dans le code (clés obligatoires, schémas d'entrée, types de résultat, ordonnancement) ; un **RuleSet** est de la **valeur** (expressions, paramètres, seuils, libellés). Changer une valeur = nouvelle RuleVersion. Changer la structure = nouveau contrat (`@2`) = livraison de code, avec période de coexistence (les RuleVersions déclarent le contrat qu'elles satisfont).

### 5.4 Entrées : constitution du contexte typé

Chaque consommateur construit le contexte par un **ContextBuilder** pur et testé, conforme au `RuleSchemaSpec` du contrat :

1. **Provenance** : uniquement des données **autoritatives** — notes `PUBLISHED`, nœuds de curriculum, surcharges `APPROVED`. Jamais de brouillon.
2. **Absence ≠ 0** : une note non saisie est `null` ; une absence justifiée ou non est transportée comme donnée (`entry_status`) et interprétée par la règle, pas par le builder.
3. **Pas d'arrondi en amont** : les nombres sont passés tels que stockés (chaînes ou nombres décimaux exacts) ; les sorties d'une règle sont rejointes **telles quelles** (chaîne décimale exacte) à l'entrée de la suivante.
4. **Déterminisme** : tri stable (ordre du curriculum, puis id) ; mêmes données ⇒ même contexte ⇒ même `inputs_hash` (JSON canonique, clés triées, chaînes décimales normalisées).
5. **Minimisation** : pas de nom, pas d'identifiant d'élève dans le contexte.
6. **Bornes** : listes ≤ capacité du budget ; `rang` sur cohorte ≤ 5 000 valeurs.

### 5.5 Sorties

`EvaluationResult` du moteur : `value` (Decimal / texte / booléen / null), `json` (nombres en chaînes décimales exactes), `trace` (≤ 500 entrées, post-ordre), `nodesEvaluated`. Le consommateur persiste : `value` exact (`numeric` sans perte), la valeur d'affichage (sortie de la règle d'arrondi, **jamais** réinjectée dans un calcul), le code (mention/décision), la trace (pour les résultats `FINAL` et les bulletins).

### 5.6 Chaînage orchestré par le module

Le moteur évalue **une** règle à la fois. L'orchestration est un **pipeline** défini par le contrat et exécuté par le consommateur :

- Un pipeline est une suite d'**étapes** `{ regle, contexte = f(sorties précédentes + données), sortie }`, déclarée dans le code du module (`results/application/pipelines/*.ts`), **sans constante réglementaire**.
- Une étape en échec marque la **branche** concernée `ERROR` (diagnostic conservé) ; le résultat de l'étudiant est `ERROR` (jamais `FINAL`), les autres étudiants ne sont pas affectés.
- Le chaînage est **déclaré** (graphe) pour que la simulation puisse rejouer exactement les mêmes étapes avec deux versions.
- La phase 2 (rang) s'exécute après la phase 1 de toute la classe (dépendance de cohorte).

### 5.7 Simulation : qui construit les cas

`rules` ne connaît pas les élèves. Le flux est asynchrone, sans dépendance circulaire :

```
Admin → rules.requestSimulation → événement rules.simulation.requested
      → abonné results.simulate-on-request : construit les cas depuis les résultats/entrées réels
        (périodes demandées, échantillon ou classe entière), exécute le pipeline avec ancienne puis nouvelle version,
        appelle rules.recordSimulationReport(rapport du moteur `simulate`)
      → rules.simulation.completed → notification de l'auteur
```

### 5.8 Recalcul

Le déclenchement et la coalescence relèvent de `results` (spec 011 §5.4) ; `rules` garantit seulement : (a) `loadVersion` rapide (cache), (b) déterminisme, (c) l'événement `rules.version.approved|published|retired` pour l'invalidation de cache et l'alerte « périodes ouvertes en retard sur la version active ». **Publier une version ne déclenche jamais de recalcul automatique** : un recalcul qui modifie des résultats est un acte de gestion explicite, précédé d'une simulation.

### 5.9 Pin de version

À la première évaluation d'un `(classe, période)`, `results` appelle `resolve(date = début de la période)` et **épingle** `rule_version_id` sur l'état de période. Toute évaluation ultérieure de cette période charge la version épinglée. Une résolution à une autre date (ex. année pour la moyenne annuelle) épingle sa propre version sur l'état d'année. Avantage : aucune ambiguïté de réforme en cours d'année (Q-16).

## 6. Règles métier

| # | Règle |
|---|---|
| R-RUL-01 | Les statuts et transitions sont ceux de `governance.ts` ; le module n'en ajoute pas. |
| R-RUL-02 | Une version `approved` ou `published` est **immuable** (contenu des règles, paramètres, bornes, source, dates d'effet) : trigger SQL + application. Seul `retired` s'ajoute, et `effective_to` peut être clôturée par une transition tracée. |
| R-RUL-03 | Le `definition_hash` (SHA-256 du JSON canonique des règles + paramètres + schémas + `label_map`) est calculé à `proposed`, vérifié à `approved`, `published` et à chaque chargement ; une divergence lève `rules.hash_mismatch` et bloque l'usage. |
| R-RUL-04 | Une variante d'établissement porte `based_on_version_id` (national) ; la simulation compare **toujours** à la version précédente active, jamais à une version vide. |
| R-RUL-05 | `effective_from/to` sont des dates calendaires inclusives ; la date de résolution est celle de la **période** (début), jamais `now()`. |
| R-RUL-06 | Une variante n'est pas activable pour une période **déjà clôturée** ; son `effective_from` doit être ≥ au premier jour de la première période encore ouverte (sauf rétroactivité demandée au super-admin par un bulletin de correction, Q-16). |
| R-RUL-07 | Les paramètres numériques portent toujours des bornes ; un paramètre hors bornes est refusé à la saisie **et** à l'évaluation. |
| R-RUL-08 | Aucun libellé affiché n'est comparé : la logique repose sur les codes ; les libellés viennent de `label_map`. |
| R-RUL-09 | Une règle ne peut être ni supprimée ni renommée dans une version publiée d'un contrat ; elle peut devenir « optionnelle » par évolution du contrat. |
| R-RUL-10 | Le catalogue national est édité uniquement par le super-admin ; un tenant ne peut jamais lire une variante d'un autre tenant (RLS). |
| R-RUL-11 | Le moteur reçoit un budget **par évaluation** (défaut 100 000 nœuds / 1 000 ms) ; un dépassement est une erreur de règle, jamais un résultat silencieux ; il est journalisé (`rules.evaluation_failures`). |
| R-RUL-12 | Les RuleSets de départ sont modifiables **uniquement** par nouvelle version ; la v1 de la baseline reste intacte (rejouable). |
| R-RUL-13 | Une montée de version du **moteur** qui change une sémantique est une version de contrat ; les versions du package sont enregistrées dans `engine_version` de chaque résultat ; une évolution non rétro-compatible exige une migration contrôlée par rejeu complet. |

## 7. Modèle de données

Voir `data-model.md`. Schéma `rules` (migrations `1000-1099`, plage proposée, à inscrire dans `module-conventions.md`) :

| Table | Rôle |
|---|---|
| `rules.national_rule_sets`, `national_rule_versions`, `national_rule_definitions` | Catalogue national (**globales**, hors RLS tenant, liste blanche d'isolation ; écriture réservée à l'acteur `system`) |
| `rules.rule_sets`, `rule_versions`, `rule_definitions` | Variantes d'établissement (`tenant_id`, RLS, FK composites) |
| `rules.rule_bindings` | Liaison contrat/périmètre → code de RuleSet |
| `rules.version_events` | Historique append-only de gouvernance |
| `rules.simulations`, `simulation_differences` | Simulations et différences |
| `rules.evaluation_failures` | Journal des échecs d'évaluation en production (purge 90 j) |
| `rules.settings` | Réglages tenant (séparation des tâches, seuil de confirmation) |

## 8. Endpoints

Préfixe `/api/v1/rules` (tenant) et `/api/v1/platform/rules` (super-admin). Schémas Zod dans `packages/contracts/src/v2/rules.ts` **avant** les routes (R4).

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET | `/rule-sets` | RuleSets visibles (nationaux + variantes), filtre `code`, `status` | `rules.ruleset.read` |
| GET | `/rule-versions/:id` | Version, règles, paramètres, hash, historique | `rules.ruleset.read` |
| POST | `/rule-sets/:code/variants` | Dériver une variante `{ baseVersionId, name, effectiveFrom }` | `rules.version.create` |
| PATCH | `/rule-versions/:id/parameters` | Modifier des paramètres (bornés) | `rules.version.edit` |
| PUT | `/rule-versions/:id/rules/:key` | Modifier une expression | `rules.version.edit_expression` + feature |
| POST | `/rule-versions/:id/validate` | `validate()` par règle + conformité au contrat | `rules.version.edit` |
| POST | `/rule-versions/:id/simulations` | Lancer une simulation `{ periodIds, classroomIds?, sample? }` → 202 | `rules.version.simulate` |
| GET | `/simulations/:id` | Rapport (résumé, règles, différences paginées) | `rules.version.simulate` |
| POST | `/rule-versions/:id/transitions` | `{ to, comment, confirmDecisionImpact? }` | `rules.version.propose` |
| GET / PUT | `/bindings` | Liaisons contrat / périmètre → RuleSet | `rules.binding.manage` |
| GET | `/contracts`, `/contracts/:id` | Catalogue de contrats | `rules.ruleset.read` |
| GET | `/resolve` | Diagnostic : version applicable à `(contrat, périmètre, date)` + `considered` | `rules.ruleset.read` |
| POST | `/evaluate` | Banc d'essai | `rules.version.edit` |
| GET | `/rule-versions/:id/events` | Historique | `rules.ruleset.read` |
| GET | `/platform/queue` | Variantes `proposed`, tous tenants | super-admin |
| POST | `/platform/rule-versions/:id/approve` \| `/reject` \| `/publish` \| `/retire` | Transitions réservées | super-admin |
| POST | `/platform/rule-sets` \| `/platform/rule-sets/:code/versions` | Catalogue national | super-admin |
| GET | `/platform/impact` | Variantes actives par tenant, périodes en retard de version | super-admin |

## 9. Écrans

| Portail | Écran | Contenu |
|---|---|---|
| Admin | **Règles — catalogue** | RuleSets actifs par contrat, origine (national / variante), version, dates d'effet, liaisons |
| Admin | **Éditeur de variante (paramètres)** | Formulaire généré depuis `ParameterSpec` (libellé, bornes, aide) ; différence avec la base ; bouton « Simuler » |
| Admin | **Éditeur d'expressions** (feature) | Colorisation, validation au fil de la frappe, diagnostics français, banc d'essai |
| Admin | **Simulation** | Progression ; rapport : résumé, tableau par règle (delta max/moyen), matrice de transitions, liste des cas modifiés (liens vers l'élève, droit `results.read`) |
| Admin | **Historique** | Chronologie des versions, auteurs, commentaires, diff ligne à ligne |
| Admin | **Pourquoi ce résultat ?** | Trace d'une valeur (appelée depuis bulletin, résultat, note) |
| Super-admin | **File d'approbation** | Variantes proposées, rapport de simulation joint, impact, boutons approuver / rejeter avec commentaire |
| Super-admin | **Catalogue national** | Versions, publication, retrait, chevauchements, conformité aux contrats |
| Super-admin | **Impact** | Tenants sur une variante ; périodes ouvertes en retard de version |

Accessibilité et i18n : libellés `fr-CI`, catalogues de messages ; erreurs du moteur déjà en français.

## 10. Permissions

Déclarées dans `manifest.ts` (`rules`), jamais de contrôle de rôle en dur.

| Clé | Libellé | Sensible |
|---|---|---|
| `rules.ruleset.read` | Consulter les règles actives et leur historique | non |
| `rules.version.create` | Créer une variante d'établissement | non |
| `rules.version.edit` | Modifier les paramètres d'une variante en brouillon, valider, tester | non |
| `rules.version.edit_expression` | Modifier les expressions de calcul | **oui** |
| `rules.version.simulate` | Lancer et consulter une simulation | non |
| `rules.version.propose` | Proposer une variante au super-admin | **oui** |
| `rules.binding.manage` | Choisir le jeu de règles d'un programme ou d'un niveau | **oui** |
| `rules.platform.manage` | (console super-admin) catalogue national, approbation, publication, retrait | **oui** |

Features (`entitlements`) : `rules.variants` (variantes d'établissement, packs payants), `rules.expression-editor` (édition d'expressions), `rules.simulation`.

## 11. Événements

Publiés (outbox, `{ v: 1, … }`) :

| Événement | Payload | Consommateurs |
|---|---|---|
| `rules.version.proposed` | `ruleVersionId, ruleSetCode, tenantId, simulationId` | console super-admin (notification) |
| `rules.version.approved` | `ruleVersionId, ruleSetCode, effectiveFrom, origin` | `results` (alerte « périodes en retard de version »), cache |
| `rules.version.published` / `rules.version.retired` | idem | `results`, cache |
| `rules.version.rejected` | `ruleVersionId, comment` | notification admin |
| `rules.simulation.requested` | `simulationId, versionId, baseVersionId, dataset` | `results` (construit les cas) |
| `rules.simulation.completed` | `simulationId, summary` | notification |
| `rules.replay.mismatch` | `resultId, expectedHash, actualHash` | exploitation / alerte |
| `rules.binding.changed` | `contractId, scope, ruleSetCode` | `results` (périodes ouvertes) |

Consommés : `results.period.opened` (vérifier qu'une règle active existe : alerte si `resolve = null`) ; `tenancy.tenant.provisioned` (créer les liaisons par défaut du pack).

## 12. Tests

- **Golden tests (bloquant, R6)** : les 293 tests du package restent verts ; les règles NOUVELLES de `rule-contracts.md` ajoutent des golden tests dont l'**oracle est le code legacy** (différentiel sur 2 000 UE et 5 800 jeux de moyennes, hors cas d'égalité à l'erreur flottante) et des cas de régression nommés (E1 de `rulesets-de-depart.md`).
- **Contrat** : pour chaque contrat × RuleSet de départ, `validate` conforme ; jeu de versions invalides (clé manquante, type de résultat erroné, schéma d'entrée élargi) refusées.
- **Gouvernance** : table de vérité acteur × portée × transition (`canTransition`) ; séparation des tâches ; chevauchement d'effet ; immuabilité (tentative d'`UPDATE` d'une règle approuvée par `app_user` ⇒ erreur de trigger).
- **Isolation** : test générique spec 000 (tables tenant) ; un tenant ne lit pas la variante d'un autre ; un tenant ne peut pas écrire une table nationale.
- **Reproductibilité** : mêmes (version, hash, entrées) ⇒ mêmes sorties sur 1 000 exécutions ; rejeu d'un échantillon de résultats `FINAL` ; modification d'une règle approuvée détectée par `rules.hash_mismatch`.
- **Simulation** : 1 000 cas × 100 évaluations en ≤ 60 s ; plafond de différences et compteurs exacts ; rapport identique à `simulate` du package.
- **Performance** : `loadVersion` ≤ 5 ms à chaud (cache), ≤ 100 ms à froid ; cache invalidé par `rules.version.*`.
- **Sécurité** : expressions hostiles refusées à la publication (suite `security.test.ts` du package) ; `evaluate` banc d'essai limité par débit.
- **Architecture** : `dependency-cruiser` (seul `rules` importe le moteur), lint R2 sur `modules/**`.

## 13. Cas limites

- **Aucune règle active** pour un périmètre/date : `resolve = null` ⇒ le calcul de la période est refusé avec `results.no_active_ruleset` (jamais de valeur implicite) ; l'écran guide vers la liaison manquante.
- **Deux variantes actives chevauchantes** : impossibles (contrainte + contrôle) ; si le catalogue national est corrompu, la plus spécifique l'emporte (règle du moteur) et une alerte est émise.
- **Réforme en cours d'année** : effet à la **période suivante** (pin par période), jamais à l'intérieur d'une période (Q-16).
- **Version retirée utilisée par un bulletin** : reste chargeable et rejouable (AC4.5).
- **Budget dépassé / règle ne terminant pas dans le temps** : erreur de règle, étudiant `ERROR`, journalisée ; la version fautive peut être retirée (`retired`) par le super-admin sans toucher aux résultats `FINAL`.
- **Cohorte > 5 000** : le groupe de classement est découpé en sous-groupes par `classroom_id` (jamais d'échec silencieux ; le plafond de 300 du legacy est supprimé).
- **Variante cassée après montée de contrat** : `@2` n'invalide pas les versions `@1` ; elles continuent jusqu'à retrait planifié.
- **Paramètre à effet de bord large** (ex. `seuil_validation`) : confirmation explicite si la simulation montre un impact sur les décisions (AC2.5).
- **Tenant hors pack Higher** : les contrats `credit-semester` ne lui sont pas liés ; aucune règle hors de ses packs n'est résolue.
- **Fuseau/horloge** : aucune règle n'accède à l'horloge ; `resolve` reçoit la date en paramètre.
- **Édition concurrente** : verrou optimiste (`version_row` / `updated_at`) sur la version en brouillon ; le second enregistrement reçoit `409`.

## 14. Dépendances

- **En amont** : 000 (kernel, `TenantDb`, outbox, RLS, lint R2), 001 (features/entitlements), 002 (RBAC, super-admin), 003 (`CountryProfile` : pays et système éducatif du tenant), `packages/rules-engine`, ADR-003.
- **En aval** : 011 (`results` : pipelines), 013 (trace et version dans le snapshot), 019 (diplomation, crédits), 005/006/018 (futurs contrats), 025 (analytique d'impact).
- **Technique** : PostgreSQL 14+ avec `btree_gist` ; worker (BullMQ) pour simulation et rejeu.
- **Textes à obtenir** (bloquants pour 005/006/018, pas pour cette spec) : `regulatory-sources-needed.md`.

## 15. Critères de sortie (mesurables)

1. Les trois RuleSets de départ sont seedés (`published`) et leurs golden tests passent dans la CI, **règles nouvelles incluses**.
2. Une variante est créée, simulée, proposée, approuvée par un super-admin de test, puis effectivement utilisée par un calcul de période suivante, **sans livraison de code** (test e2e).
3. Toute tentative d'`UPDATE` d'une règle d'une version `approved` échoue (test d'intégration) ; le hash détecte une altération faite hors application.
4. Le lint R2 et `dependency-cruiser` sont verts ; une violation volontaire les fait échouer.
5. Le rejeu de reproductibilité sur 1 000 résultats `FINAL` de test donne 0 écart.
6. Le test d'isolation générique (tables tenant) passe ; les tables nationales sont en liste blanche avec justification.
7. Le rapport de simulation d'une classe de 1 000 étudiants est produit en ≤ 60 s sur l'environnement de référence.

## Extensions Phase 4-5 (additif : packs Primaire, Secondaire, Examens)

Livré dans `apps/api/src/modules/rules` (migration `1004_rules_placeholder.sql`, aucune donnée existante modifiée) :

- **`source_kind = placeholder`** (tables `national_rule_versions` et `rule_versions`, schéma Zod du moteur, contrat `RulesSourceSchema`) : un jeu de **démonstration** (mécanisme seulement, aucune valeur officielle), distinct de `platform` (portage fidèle du legacy), `institution` et `regulation`. Une version `regulation` doit citer son texte (`source_reference`, contrainte SQL `NOT VALID` : elle protège toute nouvelle ligne sans réécrire l'historique). La provenance d'une version publiée est immuable (un jeu fictif ne devient jamais un règlement) ; une variante d'établissement dérivée d'un jeu fictif reste `placeholder`. `resolve` expose `sourceKind`.
- **Refus de liaison en production sans accusé** : `putBinding` refuse (`rules.placeholder_requires_ack`, 400) la liaison d'un jeu dont une version active, fictive, recoupe la période de la liaison, quand l'environnement est de production (`RulesConfig.productionMode`, dérivé de `RULES_ENV` puis `NODE_ENV`, **défaut sûr : production**). L'accusé (`placeholderAck: { reason }`, 10 caractères au moins) exige la permission **sensible** `rules.binding.accept_placeholder` (vérifiée par `PUT /bindings` quand le corps porte un accusé), est conservé sur la liaison (`placeholder_ack_by/at/reason`), audité (`rules.binding.placeholder_acknowledged`, sévérité `warning`) et signalé dans l'événement `rules.binding.changed` (`placeholderAcknowledged`). Hors production, l'accusé reste facultatif.
- **Liaison par cycle d'enseignement** : une liaison par niveau peut viser le niveau fin (`CP1`) ou le cycle (`PRIMARY`, `PRESCHOOL`, `LOWER_SECONDARY`, `UPPER_SECONDARY`) ; le niveau fin l'emporte à périmètre égal (`ResolveInput.educationLevelCode`). `applyPackPlaceholderBindings(deps, ctx, { pack, institutionId?, effectiveFrom, placeholderAck? })` pose les liaisons par défaut d'un pack vers son jeu fictif (`PACK_PLACEHOLDER_BINDINGS`) ; aucun abonné ne l'appelle d'office.
- **Contrats** `coef-period@1`, `competency-period@1`, `exam-national@1`, `secondary-annual@1` (voir `rule-contracts.md` §5) et **jeux fictifs** `CI-PRIMARY-PLACEHOLDER`, `CI-SECONDARY-PLACEHOLDER`, `CI-EXAM-PLACEHOLDER` (seed publié, `effective_from = 2026-09-01`, tous les libellés et descriptions marqués « fictif »).
- **Tests golden de MÉCANISME** (`test/golden/primary-mechanism`, `exam-mechanism`, `secondary-mechanism`) : G1 à G18 de `005-primary/rule-contract.md` §4, G1 à G14 de `018-examinations/rule-contract.md` §5, v1 du secondaire identique à `CI-CLASSIC-SEMESTRE`, `secondary-annual@1` sur 2, 3 et 4 périodes. Ils vérifient la plomberie (décimal exact, valeur absente, ex æquo, chaînage, reproductibilité), pas la conformité réglementaire.

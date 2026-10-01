# Plan de mise en œuvre — EcoleDigitale SaaS

**Référence :** `docs/PRD_EcoleDigitale_SaaS.md` (renommage effectué : le produit s'appelle **EcoleDigitale**).
**Date :** 1er octobre 2026
**Statut :** proposition à valider. Aucune modification de code n'a été faite.

---

## 1. Décisions validées

| # | Sujet | Décision |
|---|-------|----------|
| D1 | Primary / Secondary | **À créer de zéro.** L'application actuelle devient le socle SaaS et le pack Higher. |
| D2 | Deux piles académiques (classique + Professional) | **Unification complète d'emblée** dans un seul cœur académique. |
| D3 | Stack technique | **Garder Fastify + `pg` + migrations SQL**, passer en modular monolith. Pas de NestJS ni de Prisma. |
| D4 | Ordre de livraison | **Socle → migration de l'existant (Higher) → Primary → Secondary.** |
| D5 | Rules Engine | **Moteur de formules libre (DSL)**, sandboxé. Le super-admin publie ; l'admin tenant propose une variante, active seulement après simulation et validation du super-admin. |
| D6 | Finance | **Nouveau module Finance construit avec le socle**, puis migration des piles de paiement après stabilisation du cœur académique. |
| D7 | Imhotep (formations pro, portail public, LiveKit, paiements pro) | **Suppression** : code + tables + données, après sauvegarde. |
| D8 | Données de production | **Aucune donnée de prod à préserver.** Repartir d'une base propre est possible. |
| D9 | Numérotation Spec Kit | **Dossier séparé `specs/v2/`** avec numérotation 001–030 du PRD. |

Hypothèses que ces décisions rendent vraies, à reconfirmer avant toute action destructive :
- D7 et D8 ne dispensent pas de confirmation au moment de l'exécution. Toute suppression en base de production, ou tout reset de base, sera demandé explicitement, après sauvegarde.
- D8 est une hypothèse de travail. Avant le reset, on vérifie qu'aucun tenant (`imhotepacademy`, `ASPCI`…) ne contient de données réelles à conserver.

---

## 2. Constats qui orientent le plan

Constatés dans le code (exploration du 1er octobre 2026). Chacun est un écart avec le PRD.

### Multi-tenant et sécurité
- Tenant **plat** : pas d'organisation, d'établissement ni de campus. Un nouveau tenant clone ses données de référence depuis un tenant modèle.
- **Aucun** plan, pack, entitlement ni feature flag.
- Le RLS existe mais **n'isole rien en pratique** : l'API se connecte avec un super-utilisateur Postgres, qui contourne même `FORCE ROW LEVEL SECURITY`. L'isolation réelle repose sur les `WHERE tenant_id = $1` écrits à la main. Deux styles de policy coexistent (`app.tenant_id` et `app.current_tenant_id`). Le contexte est posé par monkey-patching de `pg.query`, en session, pas en transaction.
- `TENANT_TABLES_MIGRATION_STATUS.md` est **obsolète** (ancienne approche `_aspci`).
- RBAC **grossier** : gardes par rôle (`requireAdmin` × 178). Les « rôles personnalisés » ne pilotent que la visibilité du menu, côté client uniquement. Pas de permissions `resource.action`.
- Pas de MFA, pas de rate limiting, JWT 24 h sans refresh, blacklist vérifiée seulement sur POST/PUT/PATCH/DELETE. Le tenant d'un JWT est pris non vérifié sur les routes publiques.
- Mots de passe codés en dur (`technical-accounts.server.ts`, scripts du `package.json` racine, `DEFAULT_TECHNICAL_PASSWORD`), `NEXTAUTH_SECRET` avec valeur par défaut. **À considérer comme compromis : rotation obligatoire.**
- Audit générique **inexistant** : `AuditLogService` ne fait que `console.log`. Seuls existent l'audit super-admin et l'audit des paiements (triggers).

### Académique
- Deux piles parallèles, toutes deux supérieures/pro : pile classique (moyennes **saisies à la main**, bulletins PDF Puppeteer) et pile Professional (Filière > UE > ECUE, 4 158 lignes dans `routes/professional.ts`, bulletins jsPDF côté client).
- **Aucun** modèle primaire/secondaire. Aucun examen national, aucun conseil de classe.
- Formules **codées en dur** : `bulletin-calc.ts`, `professional-bulletin.service.ts`, `semester-averages.ts`, plus **quatre doublons côté frontend**. Mentions, seuils et décisions détectés par regex sur des noms de classe ou de filière.
- Pas de workflow de notes (brouillon → publié), **pas d'historique de notes**. Les notes sont écrasées.
- Périodes sans type (juste un nom libre).

### Finance, async, stockage
- **Trois** piles de paiement. Une abstraction `PaymentProviderService` existe (cinq adaptateurs), mais Orange et Wave sont des mocks, et le fallback silencieux en simulation est dangereux en production. Pas de remboursement réel, pas de session de caisse, pas de relances automatiques.
- Notifications : e-mail et SMS d'envoi **simulés** (`console.log` + échecs aléatoires) dans `notification.service.ts`. Pas de push.
- **Aucune file de jobs** : `bullmq` et `ioredis` sont installés mais jamais importés ; pas de Redis dans le compose. Les jobs tournent en `setInterval` dans le process API.
- Stockage sur disque local ; MinIO est déployé mais non branché. Le service API du compose n'a pas de volume : **les uploads peuvent être perdus à chaque redéploiement** (à confirmer).
- Pas d'import Excel/CSV.

### Plateforme
- 164 migrations SQL **plus** un Prisma partiel (Imhotep + 9 tables du cœur absentes du SQL) avec un contournement `_prisma_migrations` dans le script de déploiement.
- Aucune CI de tests ni de lint (seul workflow : `deploy.yml`). Tests API en Jest nécessitant un vrai Postgres. Tests web probablement non exécutables (`jest.config.js` invalide).
- Web : 1 001 fichiers, `Sidebar.tsx` de 2 176 lignes, `ignoreBuildErrors` activé, gardes **uniquement côté client**, résolution du tenant dupliquée à quatre endroits avec quatre fallbacks différents (`imhotepdata`, `ecoledigitale`, `imhotepacademy`), pas de PWA, pas d'i18n, trois bibliothèques de toasts, logos Imhotep/IPAM codés en dur dans les PDF.

---

## 3. Architecture cible

### 3.1 Principes (issus du PRD §66, rendus vérifiables)

| Principe | Garde-fou automatisé |
|----------|----------------------|
| Multi-tenant dès le premier jour | Test CI : toute table hors liste blanche a `tenant_id NOT NULL` + RLS forcé ; test d'isolation tenant A/B |
| Aucune règle académique codée en dur | Lint : interdiction de constantes de seuils dans `modules/**` hors `rules-engine` |
| Modular monolith | `dependency-cruiser` : un module n'importe que l'`index.ts` public d'un autre module |
| API first | Contrats Zod dans `packages/contracts` avant toute route ; client typé généré |
| Audit des opérations sensibles | Décorateur/Use case obligatoire sur notes, finance, rôles ; test qui échoue si absent |
| Tests obligatoires sur calculs | Seuil de couverture sur `rules-engine` et `finance` ; golden tests |
| Feature flags / entitlements | Toute route de pack est gardée par `requireFeature(...)` |

### 3.2 Vue d'ensemble

```
apps/
├── web        Next.js 15, route groups par portail, guards serveur
├── api        Fastify : adaptateurs HTTP uniquement
└── worker     BullMQ : PDF, notifications, recalculs, imports, webhooks

packages/
├── kernel         contexte requête, erreurs/Result, event bus, ids, money, clock, logger
├── contracts      schémas Zod (déjà présent) + client typé
├── rules-engine   DSL + évaluateur, PUR (zéro I/O, zéro Fastify, zéro pg)
├── database       runner de migrations, TenantDb, helpers RLS
├── auth           sessions, MFA, hash, JWT
├── ui             composants partagés (déjà présent)
└── utils
```

### 3.3 Structure d'un module backend

```
apps/api/src/modules/<module>/
├── index.ts            API publique (seul point d'entrée pour les autres modules)
├── manifest.ts         clé, packs, permissions, features, menus, événements publiés/consommés
├── domain/             entités, règles pures, événements
├── application/        use cases (une fonction par cas d'usage, transactionnels)
├── infrastructure/     repositories SQL, adaptateurs externes
└── http/               plugin Fastify, schémas Zod importés de contracts
```

Règles :
- Route → use case → repository. Aucune requête SQL dans une route.
- Un module **possède son schéma Postgres** (`iam`, `academic`, `assess`, `finance`…). Pas de requête SQL directe vers le schéma d'un autre module ; on passe par son `index.ts` ou par des événements.
- Un manifeste par module alimente le registre : permissions, menus, features, packs. La sidebar, les gardes et la console super-admin se génèrent depuis ce registre.

### 3.4 Accès aux données et tenancy (ADR-002, ADR-005, ADR-006)

- **Deux rôles Postgres** : `migrator` (propriétaire, DDL) et `app_user` (`NOBYPASSRLS`, jamais propriétaire). L'API ne se connecte qu'avec `app_user`.
- **`TenantDb.run(ctx, fn)`** remplace le monkey-patching : ouvre une transaction, exécute `SET LOCAL app.tenant_id = …`, fournit un client. Aucun accès SQL hors de cet objet. Les jobs ont un `SystemDb` explicite et audité, plus de fallback silencieux en super-admin.
- **Une seule policy**, générée par `enable_tenant_rls('schema.table')` : `ENABLE` + `FORCE` + index sur `tenant_id`.
- **Test d'isolation générique** : pour chaque table, se connecter comme tenant A et vérifier qu'on ne lit ni n'écrit rien de B. C'est un blocage CI.
- **Hiérarchie** : `Tenant` (= Organisation, 1:1) → `Institution` (pack, pays, système éducatif) → `Campus`. `tenant_id` reste la clé d'isolation ; `institution_id` et `campus_id` sont des dimensions de périmètre. Les rôles s'assignent par périmètre (tenant / établissement / campus).
- **`CountryProfile`** (CI : XOF, `fr-CI`, `Africa/Abidjan`, +225, système éducatif CI) en table, pas en constante.
- **Migrations** : fichiers SQL conservés, avec un runner à checksum (`node-pg-migrate` en mode SQL ou runner maison). Prisma et `_prisma_migrations` disparaissent avec le reset de la Phase 2, pas avant.
- **Conventions** : UUID partout ; montants en **entiers** (XOF n'a pas de sous-unité) ; horodatages en UTC, affichage `Africa/Abidjan`.
- **Typage SQL** : à trancher dans l'ADR-005 (générer les types depuis le schéma avec `kysely-codegen`, ou rester sur du SQL typé à la main avec des types de ligne). À décider sur un spike d'une demi-journée.

### 3.5 Entitlements, packs et feature flags

Tables : `plans` (STARTER, PROFESSIONAL, ENTERPRISE), `packs` (PRIMARY, SECONDARY, HIGHER, VIRTUAL), `features`, `plan_features`, `tenant_subscriptions`, `tenant_feature_overrides`, `usage_counters` (apprenants actifs, stockage, SMS).

- `requireFeature('finance.online-payment')` côté API ; `useFeature` côté web ; le registre de modules masque les menus non souscrits.
- La facturation SaaS elle-même (tranches d'apprenants) vient plus tard (spec 027). Le socle ne fait que **mesurer**.

### 3.6 RBAC granulaire

- Catalogue de permissions `resource.action` déclaré dans les manifestes (`grade.enter`, `grade.validate`, `grade.publish`, `finance.payment.create`, `report.export`…).
- `roles` **par tenant**, avec modèles système (propriétaire, directeur, directeur des études, secrétariat, économe, enseignant, éducateur, responsable pédagogique, parent, élève) instanciés au provisioning. Rôles personnalisés possibles.
- `role_permissions`, `user_role_assignments` avec périmètre. Garde `requirePermission(...)`.
- Les menus **dérivent** des permissions ; fin de `admin_role_menus`.
- MFA obligatoire pour propriétaire, directeur, économe, super-admin.

### 3.7 Cœur académique unifié

Entités : `EducationLevel`, `Program` (filière, série, cycle), `GradeLevel`, `Classroom` / promotion, `AcademicYear`, `AcademicPeriod` (**type configurable** : composition, trimestre, semestre, session…), `Subject`, `Student`, `Guardian`, `StudentGuardian`, `Enrollment` (type de financement inclus), `Staff` / `Teacher`, `TeachingAssignment`, `Assessment` (type configurable, poids, barème), `Grade`, `GradeRevision`, `PeriodResult`, `AcademicDecision`, `ReportCard`.

Le point de conception clé est le **curriculum polymorphe** : un seul arbre (`curriculum_nodes` : programme → niveau → période → [UE → ECUE] ou [matière]) avec `node_type`, `coefficient` et `credits` optionnels. Le primaire et le secondaire utilisent des matières avec coefficients ; Higher utilise UE/ECUE avec crédits. Le même moteur de notes et le même moteur de règles servent les quatre packs. Le schéma exact est l'objet de la spec 004.

- Un changement de classe ou d'année **ne crée jamais un nouvel élève** (`Enrollment` distinct).
- **Workflow de notes** : `DRAFT → SUBMITTED → REVIEWED → APPROVED → PUBLISHED`. Une note publiée est immuable ; toute correction crée un `GradeRevision` (ancienne/nouvelle valeur, auteur, justification, approbateur, date). L'immuabilité est appliquée par l'application **et** par un trigger.
- **Bulletins = snapshots immuables** : `ReportCard` stocke les valeurs calculées, l'identifiant de version de règle et un hash. Le PDF est rendu **côté serveur** depuis le snapshot (fin des PDF jsPDF côté client), stocké, avec QR de vérification.
- Les moyennes ne sont plus **saisies** : elles sont calculées. Une surcharge manuelle reste possible, avec justification et audit.

### 3.8 Rules Engine (P0)

Package `@ecoledigitale/rules-engine`, **pur** et testable isolément.

**DSL.** Langage d'expressions restreint, analysé en AST (jamais `eval`/`Function`), avec :
- liste blanche de fonctions (`wavg`, `avg`, `sum`, `min`, `max`, `round_half_up`, `rank`, `clamp`, `if`…) ;
- arithmétique décimale (pas de flottants pour les seuils) ;
- budget d'évaluation (nombre de nœuds, délai) ; pas de boucles, pas d'I/O, pas d'horloge, pas d'aléatoire (déterminisme) ;
- vérification de types à la **publication**, messages d'erreur en français.

Exemple illustratif, tiré de la règle actuelle `(S1 + 2×S2)/3` :
```
round_half_up((period("S1").average + 2 * period("S2").average) / 3, 2)
```
Le choix de la base (CEL, JSONata, parseur maison sur Peggy…) se fait par un **spike** comparant : absence de boucles, typage, délai maximal, qualité des erreurs. Critère éliminatoire : impossibilité de boucle infinie.

**Modèle.** `rule_sets` (pays, réglementation, système éducatif, niveau, périmètre) → `rule_versions` (`version`, `status`, `effective_from/to`, `source`) → `rules` (type, expression, schéma de paramètres). Types de règles : barème, agrégation d'évaluations, moyenne de période, moyenne annuelle, classement, arrondi, mention, passage, redoublement, orientation, validation de crédits, compensation, note éliminatoire.

**Résolution.** `resolveRuleSet(institution, niveau, année, date)` : variante tenant approuvée > RuleSet national.

**Gouvernance (D5).**
```
draft → simulated → proposed → approved → published → retired
          ▲             │
   tenant admin    super-admin valide
```
- Le super-admin publie les RuleSets réglementaires.
- L'admin d'établissement rédige une variante ; elle ne devient active qu'après une **simulation** sur les données réelles du tenant (rapport de différences avant/après) et la validation du super-admin.
- Chaque bulletin porte la version de règle utilisée : reproductible, contestable, **explicable** (trace des valeurs intermédiaires).

**Premiers RuleSets** : portage des formules existantes comme point de départ des golden tests : BTS/LMD (`bulletin-calc.ts` : note ECUE 0,4/0,6, moyenne UE pondérée par crédits, ECUE éliminatoire sous 5, validation 10, semestre 20 crédits, année > 48 crédits) et pile classique (moyenne pondérée par coefficient, `(S1+2·S2)/3`, mentions 16/14/12/10/8).

### 3.9 Asynchrone, événements et jobs

- **Transactional outbox** : table `domain_events` écrite dans la même transaction que la donnée ; un relais pousse vers BullMQ.
- `apps/worker` + **Redis** (à ajouter au compose) : PDF, notifications, recalcul de résultats, imports, webhooks.
- Les `setInterval` du process API disparaissent. Les tâches planifiées passent en jobs répétables.

### 3.10 Documents et stockage

- `StoragePort` avec adaptateur S3/MinIO. Fin du stockage disque et des colonnes `minio_key` qui contiennent des chemins locaux.
- Table `documents` : catégories, versions, expiration, permissions, historique, URLs signées, contrôle du type réel (magic bytes), hook antivirus.
- Un seul générateur PDF (Puppeteer dans le worker), gabarits versionnés par tenant, **branding par tenant** (logo, couleurs) à la place des logos Imhotep/IPAM codés en dur.

### 3.11 Communications

- Port `NotificationChannel` : in-app, e-mail, SMS, WhatsApp, push. Les simulations disparaissent du code de production.
- Gabarits par tenant dans une table (plus dans `settings_json`) ; chaque envoi est journalisé.
- Le SMS n'existe aujourd'hui que dans le flux Imhotep (Twilio). Sa suppression impose de **choisir un fournisseur SMS** pour la Côte d'Ivoire (point ouvert, §8).

### 3.12 Finance et paiements (D6)

- Module `finance` : `Fee`, `FeeSchedule`, `Invoice`, `InvoiceLine`, `Payment`, `Receipt`, `Refund`, `Discount`, `Scholarship`, `CreditNote`, `CashRegister` (sessions d'ouverture/fermeture), échéanciers.
- Le module référence les apprenants par **identifiant seulement** via un port `StudentRef`, ce qui permet de le construire en parallèle du cœur académique.
- Port `PaymentProvider` (on réutilise l'interface actuelle) + registre partagé. Adaptateurs : Orange Money, MTN MoMo, Wave, CinetPay, TresorPay. **Un mode sandbox explicite**, jamais un repli silencieux en simulation quand la configuration manque en production. Webhooks idempotents.
- Types de financement (`PRIVATE`, `STATE_ASSIGNED`, `SCHOLARSHIP`, `COMPANY`, `STAFF_CHILD`, `OTHER`) portés par l'inscription.
- Tests unitaires obligatoires sur tous les calculs (échéanciers, soldes, remises, remboursements).

### 3.13 Imports

Cadre générique `imports` (upload → mapping de colonnes → validation → erreurs → preview → import → rapport), exécuté dans le worker, avec un importeur par entité : élèves, parents, enseignants, classes, matières, notes, soldes financiers. Il conditionne l'objectif « établissement opérationnel en moins d'une journée ».

### 3.14 Frontend

- **Route groups** par portail : `(admin)`, `(teacher)`, `(parent)`, `(student)`, `(owner)`, `(super-admin)`. Gardes **serveur** (layout + middleware : session, rôle, permission, feature). Aujourd'hui `middleware.ts` ne fait aucune authentification.
- **Un seul** `TenantProvider` et **un seul** client API typé (généré depuis `contracts`, hooks react-query produits par une fabrique). Fin de la résolution de tenant dupliquée et du patch de `window.fetch`.
- **Zéro logique métier dans le web** : plus de moyenne, de rang ni de mention calculés côté client. Le web affiche ce que l'API fournit.
- Sidebar **générée** depuis le registre de modules (permissions + entitlements) ; fin du fichier de 2 176 lignes.
- Un seul design system (`packages/ui` + Radix + Tailwind) ; suppression d'antd et de deux des trois bibliothèques de toasts ; thème de tenant par variables CSS.
- **i18n** (`next-intl`, `fr-CI` par défaut), **PWA** dès la V1 (manifest, service worker ; hors-ligne d'abord pour l'appel, puis emploi du temps, puis notes).
- Suppression des pages `test-*` et `debug-*` ; réactivation progressive de `typescript` et `eslint` dans le build.

### 3.15 Observabilité, qualité, sécurité

- Logs pino structurés avec `request_id`, `tenant_id`, `user_id` ; OpenTelemetry (API + worker) ; endpoints `health` et `ready`.
- **CI GitHub Actions** : install, typecheck, lint, tests unitaires, tests d'intégration sur Postgres de test (Testcontainers), build ; le déploiement ne part qu'au vert.
- **Tests** : Vitest pour `kernel`, `rules-engine` et les nouveaux modules ; Jest conservé pour le code historique tant qu'il existe ; Playwright par portail.
- **Sécurité** : validation d'environnement par Zod avec démarrage refusé sans secrets ; plus aucun secret dans le dépôt ; sessions révocables (accès 15 min + refresh à rotation, vérification de blacklist sur **toutes** les méthodes) ; JWT vérifié avant toute confiance dans le tenant ; rate limiting adossé à Redis, verrouillage de compte ; politique de mots de passe ; MFA TOTP avec codes de secours ; impersonation super-admin auditée (fin du mot de passe technique par défaut) ; export contrôlé ; procédure de restauration testée.

---

## 4. Feuille de route par phases

Charge exprimée en tailles relatives (S ≈ 1–2 semaines, M ≈ 3–5, L ≈ 6–10, XL > 10, pour un développeur). **Le calendrier réel dépend de la capacité de l'équipe**, qui n'est pas encore connue (§8).

### Phase 0 — Cadrage et assainissement · M

| Tâche | Détail |
|-------|--------|
| 0.1 Nommage | **Fait** : PRD renommé en `PRD_EcoleDigitale_SaaS.md`, ancien nom du produit remplacé par EcoleDigitale. Noms de packs : « EcoleDigitale Primary / Secondary / Higher / Virtual ». |
| 0.2 Spec Kit `specs/v2` | Les scripts `.specify/scripts/powershell/{common,create-new-feature}.ps1` figent le dossier `specs/` et calculent le numéro suivant sur ses seuls sous-dossiers. Les adapter (variable `SPECS_DIR` lue depuis `.specify/init-options.json`) pour qu'ils gèrent `specs/v2/`. Mettre à jour la constitution avec les principes du §3.1. |
| 0.3 ADR | `docs/adr/` : ADR-001 modular monolith, 002 tenancy/RLS, 003 DSL de règles, 004 outbox et événements, 005 accès aux données et typage, 006 schémas Postgres par module, 007 conventions (UUID, montants entiers, UTC, i18n). |
| 0.4 Sécurité immédiate | Retirer les secrets du dépôt, **les faire tourner**, imposer l'échec au démarrage sans `NEXTAUTH_SECRET`/`JWT_SECRET`, retirer les pages `test-*`/`debug-*`. |
| 0.5 CI de base | Workflow : typecheck, lint, tests, build. Redis et MinIO branchés dans le compose, volume pour les uploads. |
| 0.6 Inventaire d'impact | Matrice automatisée « table → fichiers qui la lisent » (API et web) pour dimensionner l'unification (D2) et la suppression d'Imhotep (D7). |
| 0.7 Sauvegarde | Dump complet de la base avant toute suppression ou reset. |
| 0.8 Spike DSL | Comparer 2–3 moteurs sur les formules réelles ; produire l'ADR-003. |

**Sortie :** CI verte, ADR validés, `specs/v2` opérationnel, secrets sains, inventaire d'impact publié.

### Phase 1 — Socle SaaS · XL (deux pistes en parallèle)

**Piste A — Plateforme.** Specs v2 : 000-platform-foundation, 001-saas-core, 002-auth-rbac, 003-organization-campus, 030-security-audit.

1. `packages/kernel`, squelette `modules/*`, registre de modules, règles `dependency-cruiser`.
2. Base v2 : rôles `migrator`/`app_user`, runner de migrations, `TenantDb`, `enable_tenant_rls()`, test d'isolation générique en blocage CI.
3. Hiérarchie tenant → établissement → campus, `CountryProfile`, provisioning par modèles de pack (fin du clonage depuis un tenant de référence), API du parcours d'onboarding.
4. Entitlements et console super-admin (tenants, plans, packs, flags, suspension).
5. Authentification : sessions révocables, refresh, rate limiting, verrouillage, MFA TOTP, impersonation auditée.
6. RBAC granulaire, modèles de rôles, rôles personnalisés, périmètres.
7. Module `audit` générique (append-only, avant/après, ip, device, `request_id`), branché sur l'auth, le RBAC et l'admin tenant.
8. `apps/worker`, outbox, Redis, observabilité de base.

**Piste B — Finance fondation (D6).** Spec v2 : 014-finance, 015-payments.
Modèle Fee/Invoice/Payment/Receipt/Refund/CashRegister, `PaymentProvider` + registre, sandbox explicite, échéanciers, tests de calcul. Aucune migration des anciennes piles à ce stade.

**Piste C — Fondation web.** Route groups, `TenantProvider` et client API uniques, gardes serveur, sidebar générée, i18n et PWA en squelette, thème de tenant.

**Sortie :** deux tenants de test isolés en CI, un utilisateur avec rôle personnalisé et périmètre campus, MFA actif, audit visible, tous les modules déclarés dans le registre, premier encaissement en sandbox de bout en bout.

### Phase 2 — Cœur académique, Rules Engine et migration de l'existant (Higher) · XL

Specs v2 : 004-academic-core, 008-students-guardians, 009-teachers-staff, 010-attendance, 011-assessments-grades, 012-rules-engine, 013-report-cards, 017-scheduling, 019-higher-education.

Cette phase est la plus risquée (D2). Elle est découpée en **tranches verticales**, chacune se terminant par la **suppression** de l'ancien code et des anciennes tables qu'elle remplace. `main` reste déployable à chaque tranche.

| Tranche | Contenu | Remplace |
|---------|---------|----------|
| 2.0 | **Tests de caractérisation** : exécuter le code actuel sur des scénarios fixes (seeds déterministes) et figer les sorties en JSON. Sources : `professional-results.test.ts`, `moyennes-semestre.spec.ts`, scénario e2e S17-T. | — (filet de sécurité) |
| 2.1 | Années, périodes typées, programmes, curriculum polymorphe, classes | `cycles`, `filieres`, `programmes`, `classes`, `academic_years`, `academic_year_periods` |
| 2.2 | Élèves, tuteurs, personnel, inscriptions, affectations d'enseignement | `student_profiles`, `student_parents`, `teachers`, `student_enrollments`, `professional_enrollments` |
| 2.3 | Présences élèves et personnel, justificatifs ; emploi du temps et détection de conflits | `attendance_*`, `professional_ecue_seances`, `time_slots`, `professional_emploi_temps` |
| 2.4 | **Rules Engine** + RuleSets BTS/LMD et classique + golden tests contre 2.0 | `bulletin-calc.ts`, `semester-averages.ts`, doublons web |
| 2.5 | Évaluations, notes, workflow, `GradeRevision`, résultats, clôture de période, rattrapage | `professional_assignments`, `professional_ecue_notes/results`, `student_period_course_averages`, `submissions` |
| 2.6 | Bulletins snapshot + PDF serveur, relevés, diplômes, attestations, signataires | `report_cards`, `transcripts`, `professional_bulletins`, générateurs jsPDF |
| 2.7 | **Rémunération (spec 031)** : les collecteurs d'heures lisent le nouveau modèle | `hour-collectors/{academic,professional}` |
| 2.8 | Portails owner/parent/élève/enseignant sur modèles de lecture ; tableaux de bord owner | `owner-pedagogie`, `parent-*`, `student-*` |

**Règle de sortie de chaque tranche :** golden tests au vert, ancien code et anciennes tables supprimés, aucun accès web au calcul métier.
**Sortie de phase :** les 164 migrations historiques archivées (tag git `legacy-final`), schéma v2 seul en base, bulletins identiques à ceux de 2.0 sur les scénarios figés.

### Phase 3 — Finance migrée, communications, documents, imports · L

Specs v2 : 014/015 (suite), 016-communications, 024-documents, 031-imports (nouvelle), 032-payroll-port (nouvelle).

- Réimplémenter sur le module Finance les fonctions des piles legacy et Professional : natures de commande, échéanciers, reçus `REC-PRO-…`, paiements en lots, journal d'audit des paiements, rapports financiers, tableaux de bord owner (créances âgées, trésorerie, écarts de caisse). Supprimer les tables correspondantes.
- Fournisseurs de paiement réels pour la Côte d'Ivoire (voir §8) ; relances automatiques d'impayés en jobs.
- Notifications réelles (SMTP, SMS, WhatsApp, push), gabarits par tenant, journal d'envoi.
- GED (`documents`) et cadre d'imports avec les sept importeurs.

**Sortie :** une année de scolarité simulée de bout en bout (inscription → facture → paiement sandbox → reçu → relance), sans Excel.

### Phase 4 — Pack Primary · L

Specs v2 : 005-primary, 007-admissions, 018-examinations (moteur générique, CEPE en premier).

- Profil CI : maternelle (PS/MS/GS), primaire (CP1…CM2), compositions, MGA, passage/redoublement, conseil des maîtres, rangs, arrondis : **tout en RuleSet**, aucune formule en code.
- Admissions (workflow DRAFT → ENROLLED, personnalisable), matricule.
- `ExaminationManagement` : candidats, éligibilité, numéro, centre, examens blancs, résultats, statistiques, exports.
- Élèves affectés par l'État (`STATE_ASSIGNED`) : références d'affectation, parts État/parent, créances.

### Phase 5 — Pack Secondary · L

Specs v2 : 006-secondary.

- Collège (6e–3e → BEPC) et lycée (2nde–Tle → BAC), séries/options/langues configurables, types d'évaluations configurables.
- **Conseil de classe** : participants, résultats, absences, discipline, propositions, décisions, PV généré.
- Réutilise le moteur d'examens (BEPC, BAC) et le Rules Engine ; pas de nouveau moteur de calcul.
- Vie scolaire (retards, incidents, sanctions, convocations), historisée.

### Phase 6 — Durcissement V1 · M

Specs v2 : 025-analytics, 029-mobile-offline (première partie), 030 (suite).

- Tableaux de bord direction (effectifs, présence, moyenne, recouvrement, créances) en temps réel.
- Alertes configurables (absences, impayés, baisse de notes, charge d'enseignement, documents expirants).
- Hors-ligne pour l'appel, puis l'emploi du temps ; saisie des notes utilisable sur smartphone.
- Test de charge, exercice de restauration, revue de sécurité complète, accessibilité.

**Sortie V1 :** un établissement standard est créé sans développeur, un parent consulte résultats/absences/paiements/reçus, une année scolaire se déroule sans Excel pour les résultats.

### Après la V1 (hors périmètre de ce plan)

Stages et soutenances (021), BTS complet (020), pack Virtual et LMS (022/023, à reconstruire puisque Imhotep est supprimé), IA (026), facturation SaaS (027), intégrations et webhooks (028), application mobile.

---

## 5. Plan de remplacement de l'existant

### 5.1 Correspondance ancien → nouveau

| Existant | Devient |
|----------|---------|
| `cycles`, `filieres`, `programmes`, `classes` | `academic` : programmes, curriculum, classes |
| `professional_*` (UE, ECUE, semestres, notes, bulletins) | curriculum + évaluations + résultats + `report_cards` |
| `student_period_course_averages`, `report_cards`, `transcripts` | résultats calculés + snapshots de bulletins |
| `tuition_*`, `payment_*`, `professional_orders/payments/installments` | module `finance` |
| `admin_roles`, `admin_role_menus`, `role_menu_denials`, rôles globaux | RBAC granulaire par tenant |
| `super_admin_audit_logs`, `payment_audit_log` | module `audit` unifié (les triggers financiers restent en filet) |
| `tenants.settings_json` (adresse, logo, gabarits d'e-mail) | tables typées : profil d'établissement, branding, gabarits de notification |
| `jobs/*.job.ts` en `setInterval` | `apps/worker` |
| `fileStorage.ts`, `minio.ts` inutilisé | `StoragePort` S3/MinIO |
| Prisma + `_prisma_migrations` | **conservés jusqu'au reset de la Phase 2** (inventaire 0.6 : `deploy.sh` exécute `prisma migrate deploy`, et Prisma crée 9 tables du cœur absentes du SQL). Supprimés avec la baseline v2, pas avec Imhotep |
| Générateurs jsPDF du web | rendu PDF serveur depuis snapshot |

### 5.2 Suppression d'Imhotep (D7)

À conduire comme une tâche à part, en trois temps :
1. **Inventaire des dépendances** (Phase 0.6). Points à vérifier avant de supprimer : le rôle `formateur` (utilisé aussi par la pile Professional ?), les sessions LiveKit (**partagées avec le scolaire : à conserver**, retirer seulement la branche `professionnelle`/`public_user`), `entreprises`, `codes-promo`, la prospection et les commissions (migration `0125`), `subject_kind=public_user` dans les notifications.
2. **Retrait du code** : `apps/formation-pro-public`, routes/services `formations-pro`, `sessions-pro`, `inscriptions-pro`, `paiements-pro`, `formateur`, pages `formations-professionnelles/*`, scripts `migrate:imhotep-data`. **Prisma n'en fait pas partie** (voir §5.1).
3. **Retrait des tables et données** : migration de suppression après sauvegarde. **Exécution en production soumise à votre confirmation explicite.**

### 5.3 Reset de la base (D8)

Sans donnée à préserver, pas de double écriture ni de migration de données : on archive les 164 migrations (tag `legacy-final`), on pose le schéma v2 module par module, et on **reconstruit les environnements de démo par seeds déterministes** (un jeu par pack). Ces seeds servent aussi aux tests de caractérisation et aux e2e.

---

## 6. Découpage Spec Kit — `specs/v2/`

Le découpage du PRD §67 est repris ; j'ajoute quatre specs que le PRD oublie et qu'impose l'existant.

| Spec | Phase | | Spec | Phase |
|------|-------|-|------|-------|
| **000-platform-foundation** (ajout) | 1 | | 017-scheduling | 2 |
| 001-saas-core | 1 | | 018-examinations | 4 |
| 002-auth-rbac | 1 | | 019-higher-education | 2 |
| 003-organization-campus | 1 | | 020-bts | après V1 |
| 004-academic-core | 2 | | 021-internships-defenses | après V1 |
| 005-primary | 4 | | 022-lms | après V1 |
| 006-secondary | 5 | | 023-virtual-school | après V1 |
| 007-admissions | 4 | | 024-documents | 3 |
| 008-students-guardians | 2 | | 025-analytics | 6 |
| 009-teachers-staff | 2 | | 026-ai | après V1 |
| 010-attendance | 2 | | 027-subscriptions-billing | après V1 |
| 011-assessments-grades | 2 | | 028-integrations | après V1 |
| 012-rules-engine | 2 (spike en 0) | | 029-mobile-offline | 1 (squelette), 6 |
| 013-report-cards | 2 | | 030-security-audit | 1, 6 |
| 014-finance | 1 puis 3 | | **031-imports** (ajout) | 3 |
| 015-payments | 1 puis 3 | | **032-payroll-port** (ajout) | 2.7 / 3 |
| 016-communications | 3 | | **033-web-foundation** (ajout) | 1 |

Chaque spec suit le gabarit du PRD : objectifs, périmètre, acteurs, user stories, règles métier, critères d'acceptation, modèle de données, endpoints, écrans, permissions, événements, tests, cas limites, dépendances.

---

## 7. Stratégie de test et garde-fous

| Niveau | Contenu | Bloquant en CI |
|--------|---------|----------------|
| Isolation tenant | Test générique sur toutes les tables ; liste blanche explicite des tables globales | Oui |
| Frontières de modules | `dependency-cruiser` | Oui |
| Golden tests | Rules Engine : sorties des scénarios de la tranche 2.0 + cas réglementaires CI | Oui |
| Calculs financiers | Échéanciers, soldes, remises, remboursements, idempotence des webhooks | Oui |
| Intégration API | Postgres jetable, un test par use case sensible | Oui |
| Audit | Test échouant si une opération sensible n'écrit pas dans `audit_log` | Oui |
| E2E | Playwright par portail ; reprise du scénario S17-T | Sur `main` et avant release |
| Sécurité | Scan de secrets, dépendances, rate limiting, MFA | Oui |

---

## 8. Risques, hypothèses et points ouverts

**Risques**
- **L'unification totale (D2) est l'option la plus risquée.** Mitigations : tests de caractérisation (2.0), tranches verticales avec suppression à chaque étape, `main` toujours déployable, schémas Postgres par module pour pouvoir supprimer proprement l'ancien.
- **Calendrier inconnu.** Les tailles du §4 sont relatives. Il me faut la capacité réelle (nombre de développeurs, disponibilité) pour les convertir en dates.
- **Règles officielles ivoiriennes.** MGA, CEPE, BEPC, BAC et passage/redoublement demandent les textes officiels (MENAET) et des bulletins de référence pour écrire des golden tests justes. Je ne dois pas les inventer.
- **Spec Kit.** Les scripts supposent un dossier `specs/` unique ; la tâche 0.2 est un prérequis à toute nouvelle spec v2.
- **Qualité de départ du web** : build qui ignore les erreurs TypeScript, tests web probablement inexécutables. La réactivation se fera par étapes, sinon elle bloquerait tout.

**Points ouverts à trancher**
1. Capacité de l'équipe et horizon visé pour la V1.
2. Fournisseur de **SMS** pour la Côte d'Ivoire (le seul adaptateur actuel, Twilio, disparaît avec Imhotep).
3. **Agrégateur Mobile Money** prioritaire : Orange, MTN, Wave ou CinetPay (Orange et Wave sont aujourd'hui des mocks).
4. Un parent dont les enfants sont dans **plusieurs établissements/tenants** : l'e-mail est aujourd'hui unique globalement, avec un seul tenant par utilisateur. À régler dans la spec 002.
5. Source des **textes réglementaires** et personne de référence pour valider les RuleSets Primary/Secondary.
6. Suppression des fichiers à la racine sans rapport avec le produit (`activite2*.pdf`, `PROMPT_*.md`, collections Postman) : à confirmer avant de les retirer.

---

## 9. Premières actions proposées (dans l'ordre)

1. ~~Renommer le PRD et corriger le nom du produit (tâche 0.1).~~ Fait.
2. Faire tourner les secrets exposés et retirer les mots de passe du dépôt (0.4).
3. Adapter les scripts Spec Kit à `specs/v2/` (0.2).
4. Lancer l'inventaire d'impact (0.6) et la sauvegarde (0.7).
5. Écrire les ADR 001 à 007 et conduire le spike DSL (0.3, 0.8).
6. Poser la CI de base (0.5).
7. Ouvrir la spec `specs/v2/000-platform-foundation`, puis `001-saas-core` et `002-auth-rbac`.

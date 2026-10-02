# Module `rbac`

Rôles **par tenant**, assignations avec **périmètre** (tenant | établissement | campus) et
**validité**, catalogue de permissions agrégé depuis les manifestes, évaluation pure
`can()`, garde Fastify `requirePermission()`, navigation dérivée des droits.
Pack `CORE`, schéma Postgres `rbac`. Références : plan §3.6, ADR-001/002/006/007,
`docs/architecture/module-conventions.md`.

`dependsOn` est **vide** : la tenancy est optionnelle. Établissements et campus sont
référencés par UUID ; leur hiérarchie arrive par le port `ScopeTree`.

## API publique (`index.ts`)

| Besoin | Symbole |
|---|---|
| Garde de route | `requirePermission(key, { scope? })` |
| Décision pure | `can(auth, permission, scope?)`, `decide(...)` (avec la raison), `grantedScopes(auth, key)` |
| Droits d'une requête | `loadAuthorization(request)` (mémorisé par requête) |
| Catalogue | `buildPermissionCatalog(manifests)` (pur), `syncPermissionCatalog(tx, manifests)` |
| Rôles système | `instantiateSystemRoles(tx, tenantId)` (idempotent), `syncRbac(systemDb, manifests)` |
| Chargement + cache | `loadPermissionSet(tx, tenantId, userId, { cache? })`, `PermissionSetService`, `PermissionSetCache` |
| Navigation | `buildNavigation(manifests, auth, entitlements)` |
| Legacy | `legacyRoleToTemplate(role)`, `permissionsForLegacyRoles(roles, catalog)` |
| Ports | `ScopeTreeProvider`, `AuditPort` (no-op par défaut), `EntitlementsPort` |
| Plugin | `rbacPlugin` (routes `/api/v1/rbac/*` + décoration `fastify.rbac`) |

```ts
import { requirePermission, campusScope } from "../rbac";

app.post("/grades", { preHandler: requirePermission("grade.enter") }, handler);
app.post("/campus/:id/students", {
  preHandler: requirePermission("student.create", { scope: (req) => campusScope(req.params.id) }),
}, handler);
```

## Assemblage (fait — `docs/architecture/platform-assembly.md`)

Sous le registre de modules, `http/plugin.ts` exporte `setup(app, runtime)` — qui décore l'instance **racine**
(`app.rbac` : service de droits, cache, arbre des périmètres de `tenancy`), car `requirePermission` des *autres*
modules lit `request.server.rbac` et un décorateur posé dans le contexte encapsulé du module leur serait invisible —
puis `default(app, runtime)` qui déclare les routes **sans préfixe** (le registre applique `/api/v1/rbac`).
Audit : `rbacAuditAdapter` (`entityType` `role` / `assignment` → `entity` `role` / `role_assignment` ; tenant, acteur
et requête dérivés du contexte de la transaction). `assignSystemRoleUseCase` attribue un rôle système par sa clé de
modèle (propriétaire du fondateur, acteur `system`). Worker (`subscribers.ts`) : rôles système sur
`tenancy.tenant.provisioned` (et à la réactivation d'un tenant), diffusion Redis des invalidations de cache sur
`rbac.*.changed` / `tenancy.tenant.status_changed`.

Forme historique (tests du module, enregistrement autonome) :

```ts
await syncRbac(systemDb, allManifests);              // au démarrage : catalogue + rôles système
await app.register(rbacPlugin, {                     // SANS préfixe : le plugin porte /api/v1/rbac
  tenantDb, manifests: allManifests,
  eventBus,                                          // invalide le cache sur rbac.*.changed
  scopeTrees,                                        // tenancy -> ScopeTreeProvider (optionnel)
  entitlements,                                      // module entitlements (optionnel)
  audit,                                             // adaptateur vers audit.record (optionnel)
});
// provisioning d'un tenant, dans sa transaction :
await instantiateSystemRoles(tx, tenantId);
// puis attribuer `owner` au fondateur : assignRole… (use case `assignRoleUseCase`, acteur system)
```

Prérequis hors module : l'authentification pose `request.ctx` (`RequestContext`, avec
`mfa`) ; `apps/api/package.json` doit déclarer `@ecoledigitale/kernel` et
`@ecoledigitale/database` ; les migrations du dossier `migrations/` sont jouées par le runner
(plage **0200-0299** réservée à ce module, numérotation globale).

## Modèle de décision

* **Refus par défaut.** Sans assignation active couvrant la cible → non.
* **Héritage de périmètre** : tenant ⊇ établissement ⊇ campus. Une assignation d'établissement
  couvre ses campus *si* le `ScopeTree` (ou le contexte : `institutionId` + `campusId`) relie le
  campus à l'établissement ; sinon elle ne les couvre pas (échec fermé).
* **Cible omise** : périmètre actif de la requête (campus > établissement), sinon le tenant entier
  (donc seule une assignation tenant la couvre). `"any"` : « détenue quelque part » (menus,
  listes filtrées ensuite avec `grantedScopes`).
* **Validité** : `valid_from ≤ now < valid_until` évalué à *chaque* `can()` — un set en cache ne
  prolonge jamais un droit expiré.
* **Permission `sensitive`** : refus sans `RequestContext.mfa === true`
  (`ForbiddenError` code `rbac.mfa_required`). `rbac.role.manage` et `rbac.assignment.manage`
  sont sensibles.
* **Acteurs** : `system` (jobs) et `superAdmin` n'ont aucun droit implicite ; un super-admin agit
  par la console plateforme ou par impersonation (contexte d'un vrai utilisateur, audité).
* **Anti-escalade** : on ne peut accorder (rôle ou assignation) que des permissions que l'on
  détient soi-même sur le périmètre visé. **Dernier propriétaire** : jamais retirable.

## Rôles

* Catalogue : `rbac.permissions` (globale) est le reflet des manifestes ; une permission retirée
  est marquée `retired_at`, jamais supprimée (les rôles ne perdent rien en silence).
* Modèles système (`templates/system-roles.ts`), **onze** : `owner`, `directeur`, `directeur_etudes`,
  `secretariat`, `econome`, `enseignant`, `educateur`, `responsable_pedagogique`, `personnel`
  (nouveau), `parent`, `eleve`. Les rôles autres que `owner`/`directeur` énumèrent des **clés
  exactes** issues des manifestes (jamais `module.*` : une permission ajoutée plus tard à un module,
  surtout sensible, n'est pas accordée d'office). Un motif sans correspondance reste **en attente**
  à l'exécution (`rbac.role_pending_permissions`, un `warn` par instanciation, re-résolu à la
  prochaine `syncRbac`) ; **les tests échouent** s'il en reste un contre le catalogue complet des
  modules livrés (`test/system-roles.test.ts`, `test/system-roles.integration.test.ts`).
* Rôles système verrouillés (trigger SQL + use cases) : on les **clone** pour les adapter.
  Rôles personnalisés : création, clonage, modification, suppression (refusée tant qu'assigné ;
  FK `RESTRICT` en base).
* Conventions de nommage attendues des manifestes : données de l'élève `<ressource>.self.<action>`,
  des enfants du parent `<ressource>.child.<action>`, du personnel `<ressource>.own.<action>`
  (et `payroll.payslip.read_own`). Il n'existe pas de permission `portal.*` : l'accès aux portails
  est porté par les menus (`portal` dans les manifestes) filtrés par permission.

### Table des rôles système

| Rôle | Périmètre (permissions réelles des manifestes) | Ne peut pas (séparation des tâches / moindre privilège) |
|---|---|---|
| `owner` | `*` sauf `rules.platform.manage` (console plateforme). Abonnement, définition des rôles, validation de paie au-delà du seuil, réglages de paie | — |
| `directeur` | `*` sauf `entitlements.manage`, `rbac.role.manage`, `payroll.payslip.approve_owner`, `payroll.settings.manage`, `rules.platform.manage`. Détient les contreparties (approuver une surcharge, rouvrir une période, révoquer un document, rouvrir un appel, arrêter/annuler un bulletin) | cumule par construction : l'exigence « une autre personne » est imposée à l'exécution (réglages `require_separate_approver`, `payroll.settings`, quatre yeux des remboursements) |
| `directeur_etudes` | académique, curriculum, inscriptions (suivi), évaluations, `grade.review/validate/publish/revise.approve`, résultats (calcul, délibération, `period.lock/close`, **demande** de surcharge), bulletins (émission + publication), higher (octroi, émission), emplois du temps (+ validation des séances pour la paie), présences (supervision, décision sur justificatifs, personnel, congés), élèves/personnel en lecture, affectations d'enseignement | saisir une note, demander une correction, approuver une surcharge, rouvrir une période, révoquer un bulletin/diplôme, rouvrir un appel, contrats du personnel, finance, paie |
| `secretariat` | inscriptions (création/annulation), dossiers élèves et tuteurs (dont champs sensibles, export, statut), émission des bulletins/relevés, attestations (`higher.document.*`), présences (lecture, saisie, dépôt de justificatifs), emploi du temps en lecture, factures/paiements/reçus en **lecture seule** | publier/révoquer un document, décider d'un justificatif, encaisser, anonymiser, dérogation, personnel |
| `econome` | finance complète, financement des inscriptions, paie : configurations, tarifs, périodes, **calcul**, ajustements, notification, **versement**, rapports ; lecture élèves, tuteurs, inscriptions, personnel | arrêter/annuler un bulletin (direction), réglages et validation propriétaire de la paie, contrats, notes, validation des heures |
| `enseignant` | SES classes : évaluations, notes (`grade.enter`, demande de correction), appréciations de matière, appel ; `student.class.read` (pas `student.read`/`student.list`) ; emploi du temps personnel + déclaration de séance ; `staff.own.*`, `attendance.own.*`, `attendance.leave.request`, `payroll.payslip.read_own` | relire/valider/publier/approuver, évaluations d'autrui, justificatifs, higher, finance, gestion de paie, résultats |
| `educateur` | appel et suivi des présences (saisie, validation, correction, justificatifs : dépôt et lecture), constatation des séances, élèves/tuteurs/inscriptions en lecture ; ses données de personnel | décider d'un justificatif, rouvrir un appel, surcharger un récapitulatif, congés/présence du personnel, valider les séances pour la paie (aucune permission disciplinaire n'existe encore) |
| `responsable_pedagogique` | curriculum (édition), évaluations et notes en lecture, `grade.review` + `grade.validate`, résultats et bulletins en lecture, contexte (emplois du temps, enseignement, présences, personnel) | saisir, publier, approuver une correction, publier un curriculum, émettre |
| `personnel` | uniquement SES données : `staff.own.*`, `attendance.own.*`, `attendance.leave.request`, `payroll.payslip.read_own`, `schedule.own.read` ; à **cumuler** avec un rôle de fonction | tout le reste |
| `parent` | exactement toutes les permissions `*.child.*` du catalogue (élève, inscriptions, notes, résultats, bulletins, absences + justificatif, emploi du temps, parcours supérieur) | toute permission de gestion ; finance (voir ci-dessous) |
| `eleve` | exactement toutes les permissions `*.self.*` du catalogue (dossier, inscriptions, notes, résultats, bulletins, absences, emploi du temps, parcours) | toute permission de gestion ; finance |

Garde-fous vérifiés par test (`test/system-roles.test.ts`, catalogue **réel** issu de `discoverModules`) :

* pour chaque rôle et chaque module, ensemble exact de ce qui est permis / interdit (oracle écrit à
  part ; un module ou une permission sans décision explicite fait échouer le test) ;
* paires de tâches incompatibles (saisie ≠ validation/publication, demande ≠ approbation de surcharge,
  clôture ≠ réouverture, calcul/ajustement ≠ arrêt du bulletin, versement ≠ arrêt, validation des
  heures ≠ constatation/calcul, émission ≠ révocation, octroi ≠ révocation de diplôme, validation d'un
  appel ≠ réouverture, dépôt ≠ décision de justificatif, demande ≠ décision de congé…) : aucun rôle
  autre que `owner`/`directeur` ne détient les deux côtés ;
* toute permission `sensitive` d'un rôle autre que `owner` est justifiée (`sensitiveJustifications`
  du modèle, texte obligatoire, pas de justification périmée) ; `mfaRecommended` ⇔ le rôle porte une
  permission sensible ;
* seuls `owner` et `directeur` ont `*` ; `parent`/`eleve` = exactement `*.child.*`/`*.self.*` ; aucune
  fuite de ces permissions vers un rôle de gestion ;
* aucun motif en attente, aucune permission `rules.platform.manage` (console plateforme) dans un rôle de tenant.

Manques constatés dans les manifestes (voir le rapport de la tâche) : `finance` ne déclare aucune
permission `finance.child.*` / `finance.self.*` (le parent et l'élève ne voient ni facture ni solde) ;
aucun module `discipline`/`comms`/`document`/`report` n'existe encore (les anciens motifs
`discipline.*`, `comms.*`, `document.*`, `report.*`, `portal.*` ont été retirés).

## Événements (outbox, `{ v: 1, … }`)

`rbac.role.changed` (`created | cloned | updated | deleted | resynced`) et
`rbac.assignment.changed` (`granted | updated | revoked`), publiés dans la transaction de la
modification. Le module `audit` s'y abonne ; `AuditPort.record(tx, entry)` permet l'appel direct.
Le cache de permissions se vide sur ces événements (et directement après commit dans le
processus d'origine) ; le TTL (30 s) borne le délai entre instances si un événement tarde.

## Compatibilité legacy (code legacy non modifié)

| Rôle legacy | Modèle(s) v2 |
|---|---|
| `owner` | `owner` |
| `admin`, `administrateur` | `directeur` + `secretariat` + `econome` |
| `teacher`, `formateur` | `enseignant` |
| `student` | `eleve` |
| `parent` | `parent` |
| `super_admin` | aucun (hors RBAC tenant) |
| inconnu | aucun |

**Sens inverse (rôles d'un accès IAM -> rôle legacy)**, utilisé par la passerelle IAM -> legacy et par le web
(`packages/contracts/src/v2/iam-legacy-roles.ts`, vérifié contre `legacyRoleToTemplate` par `apps/api/test/legacy-iam-bridge.test.ts`) :
une clé legacy vaut elle-même ; un modèle ne vaut un rôle legacy que si l'accès tient **tous** les modèles qui le composent
(`admin` = `directeur` + `secretariat` + `econome`) ; un modèle partiel (`directeur` seul, `educateur`…) n'élève rien.
L'import `pnpm iam:import-legacy` écrit les clés legacy dans l'accès et pose les assignations `legacyRoleToTemplate`.

`admin` → trois modèles car l'« admin » legacy est fourre-tout (structure académique,
inscriptions, finances, rémunération) ; l'union reproduit son périmètre **sans** les droits
propriétaire (abonnement, définition des rôles : resserrement volontaire par rapport à
`requireOwnerOrAdmin`).

### Plan de migration `admin_roles` / menus (0091, 0092, 0095)

1. **Coexistence** (maintenant) : le legacy reste sur `public` ; `rbac` vit sur la base v2.
2. **Remplacement des gardes, tranche par tranche** (Phase 2) : pour chaque écran porté, la
   garde `requireAdmin`/`requireOwner` devient `requirePermission('…')`. Un test d'équivalence
   compare, pour chaque rôle legacy, `permissionsForLegacyRoles([role], catalog)` à l'ancien
   comportement avant de supprimer l'ancienne garde.
3. **Menus** : le web remplace `ADMIN_MENU_CATALOG`/`canSeeHref` par
   `GET /api/v1/rbac/me/navigation` (menus déclarés dans les manifestes, filtrés par permission
   + feature). Les clés legacy (`finance.scolarite`, `pro.notes`…) sont reliées, à la tranche qui
   porte l'écran, à la clé de menu du manifeste correspondant ; sa `permission` fait foi.
4. **Données** (au reset de Phase 2 ; D8 : rien à préserver en production, sinon script ponctuel) :
   * `admin_roles` actif → rôle personnalisé (clé = slug du nom, libellé = nom) ; permissions =
     ∪ des `permission` des menus de `admin_role_menus` (via la table clé legacy → clé de menu) ;
   * `user_admin_roles` (un seul rôle par utilisateur) → assignation de périmètre tenant ;
   * `role_menu_denials` (exclusions sur rôles socle) → clone du modèle correspondant moins les
     permissions qui ne servent que les menus refusés, assigné aux utilisateurs concernés ;
   * utilisateurs sans `user_admin_roles` (accès complet historique) → `admin` →
     `directeur`+`secretariat`+`econome`.
5. **Suppression** de `admin_roles`, `admin_role_menus`, `user_admin_roles`, `role_menu_denials`
   avec la dernière tranche qui les lit (règle de sortie de tranche).

## Routes `/api/v1/rbac/*`

`GET /permissions` · `GET|POST /roles` · `GET|PATCH|DELETE /roles/:id` · `POST /roles/:id/clone` ·
`GET|POST /assignments` · `PATCH|DELETE /assignments/:id` · `GET /me/permissions` ·
`GET /me/navigation`. Schémas Zod : `packages/contracts/src/v2/rbac.ts`. Lire exige
`rbac.role.read`, écrire `rbac.role.manage` (tenant entier) ou `rbac.assignment.manage` (sur le
périmètre de l'assignation). `GET /assignments` n'est pas filtré par périmètre.

## Tests

```bash
# unitaires purs (sans base)
pnpm --filter @ecoledigitale/api exec vitest run --config src/modules/rbac/vitest.config.mts

# + intégration réelle (Postgres éphémère dans Docker), depuis apps/api
ED_PG_IMAGE=postgres:17-alpine node ../../packages/database/scripts/with-postgres.mjs --config src/modules/rbac/vitest.config.mts

# types
pnpm --filter @ecoledigitale/api exec tsc -p src/modules/rbac/tsconfig.json
```

Les tests vivent dans `test/` (et non `__tests__/`) pour ne pas être ramassés par le Jest historique de `apps/api`.

## Isolation

`isolation-allowlist.rbac.ts` (dossier `modules/`) : seule `rbac.permissions` est globale
(justifiée). Les quatre autres tables portent `tenant_id` + `tenant_isolation`. Les tables à
FK composite `(tenant_id, role_id)` ne sont vérifiées que structurellement par
`assertTenantIsolation` ; leur comportement inter-tenant est couvert par `db.integration.test.ts`.

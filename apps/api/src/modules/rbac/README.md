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
* Modèles système (`templates/system-roles.ts`), **quatorze** : `owner`, `directeur`, `directeur_etudes`,
  `secretariat`, `econome`, `enseignant`, `instituteur` (spec 005), `educateur`,
  `responsable_pedagogique`, `responsable_examens` (nouveau, spec 018), `admissions_officer` (nouveau, spec 007),
  `personnel`, `parent`, `eleve`. Les rôles autres que `owner`/`directeur` énumèrent des **clés
  exactes** issues des manifestes (jamais `module.*` : une permission ajoutée plus tard à un module,
  surtout sensible, n'est pas accordée d'office). Un motif sans correspondance reste **en attente**
  à l'exécution (`rbac.role_pending_permissions`, un `warn` par instanciation, re-résolu à la
  prochaine `syncRbac`) ; **les tests échouent** s'il en reste un contre le catalogue complet des
  modules livrés (`test/system-roles.test.ts`, `test/system-roles.integration.test.ts`), **sauf** les
  permissions de la liste blanche `RESERVED_FOR_UPCOMING_MODULES` (voir « Permissions réservées »).
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
| `directeur_etudes` | académique, curriculum, inscriptions (suivi), évaluations, `grade.review/validate/publish/revise.approve`, résultats (calcul, délibération, `period.lock/close`, **demande** de surcharge), bulletins (émission + publication), higher (octroi, émission), emplois du temps (+ validation des séances pour la paie), présences (supervision, décision sur justificatifs, personnel, congés), élèves/personnel en lecture, affectations d'enseignement ; **pack Primaire** : référentiels (`primary.framework.read\|manage\|publish`), banque d'appréciations, présidence du conseil des maîtres, préparation des bilans et de l'archive, états, `primary.class.read_all` ; vie scolaire `schoollife.read.all` ; `stateassign.read` ; examens en **consultation** (`exam.type\|session\|candidate\|result\|statistics` en lecture) ; imports de classes et de curriculum | saisir une note, demander une correction, approuver une surcharge, rouvrir une période, révoquer un bulletin/diplôme, rouvrir un appel, contrats du personnel, finance, paie, **primary.bilan.seal/reissue, competency.revise, archive.freeze, template.apply, settings.manage**, valider une mesure de vie scolaire, vérifier une affectation, publier/déroger/approuver en examens |
| `secretariat` | inscriptions (création/annulation), dossiers élèves et tuteurs (dont champs sensibles, export, statut), émission des bulletins/relevés, attestations (`higher.document.*`), présences (lecture, saisie, dépôt de justificatifs), emploi du temps en lecture, factures/paiements/reçus en **lecture seule** ; **admissions** : traitement complet d'un dossier (`admission.read\|create\|update\|document.upload\|document.review\|interview.manage\|offer.manage\|duplicate.resolve\|waitlist.manage\|prospect.manage\|enroll\|report.read`) ; **affectation d'État** : `stateassign.read\|record\|document.manage` ; **primaire** : `primary.report.read\|class.read_all\|bilan.read\|competency.read` ; **imports** : élèves et tuteurs (`imports.read\|create\|cancel`, `imports.import.students\|guardians`) | publier/révoquer un document, décider d'un justificatif, encaisser, anonymiser, dérogation, personnel ; **`admission.decide`, `capacity.override`, `workflow.*`, `campaign.manage`, `settings.manage`, `anonymize`, `export`** ; **`stateassign.verify` (séparation des tâches : enregistrer ≠ vérifier)**, `manage`, `amend` ; écriture pédagogique du primaire ; soldes d'ouverture, notes et personnel en import |
| `econome` | finance complète, financement des inscriptions, paie : configurations, tarifs, périodes, **calcul**, ajustements, notification, **versement**, rapports ; lecture élèves, tuteurs, inscriptions, personnel ; **affectation d'État** : `stateassign.read\|reconcile\|receivable.manage\|control.perform\|export` ; **imports** : préparation seulement (`imports.read\|create`) | arrêter/annuler un bulletin (direction), réglages et validation propriétaire de la paie, contrats, notes, validation des heures ; `stateassign.record\|verify\|manage` ; **lancer** un import (`imports.import.*`, dont les soldes d'ouverture : direction, MFA) |
| `enseignant` | SES classes : évaluations, notes (`grade.enter`, demande de correction), appréciations de matière, appel ; `student.class.read` (pas `student.read`/`student.list`) ; emploi du temps personnel + déclaration de séance ; `staff.own.*`, `attendance.own.*`, `attendance.leave.request`, `payroll.payslip.read_own`, `payroll.my.dispute` ; vie scolaire de SES classes : `schoollife.read\|incident.write\|note.write` ; conseils de classe : `council.read` (périmètre de ses classes revérifié par le module) + `council.proposal.write` | relire/valider/publier/approuver, évaluations d'autrui, justificatifs, higher, finance, gestion de paie, résultats, proposer une mesure, valider une sanction, examens |
| `instituteur` | titulaire UNIQUE d'une classe du primaire (spec 005 pack-template §7) : mêmes clés que `enseignant` pour sa classe (`attendance.take\|read`, `assessment.type.read\|read\|create\|update`, `grade.read\|enter\|revise.request`, `appreciation.write`, `student.class.read`, emploi du temps et données `*.own.*`) + `reportcard.read`, messagerie ; **pack Primaire** : `primary.competency.read\|record\|validate`, `primary.phrase.read`, `primary.council.read\|prepare`, `primary.framework.read`, `primary.bilan.read` (bilan de sa classe) | `grade.review/validate/publish/revise.approve`, `period.lock/close`, `student.read/list`, toute `finance.*`, `primary.competency.revise`, `primary.bilan.prepare\|seal\|reissue`, `primary.class.read_all` (pas de permission sensible : pas de MFA recommandée) |
| `educateur` | appel et suivi des présences (saisie, validation, correction, justificatifs : dépôt et lecture), constatation des séances, élèves/tuteurs/inscriptions en lecture ; ses données de personnel ; **vie scolaire** : `schoollife.read\|read.all\|incident.write\|incident.review\|measure.propose\|note.write\|convocation.manage` (propose, ne valide pas) | décider d'un justificatif, rouvrir un appel, surcharger un récapitulatif, congés/présence du personnel, valider les séances pour la paie, **valider/rejeter/révoquer une mesure ou une exclusion, appliquer son effet, trancher un recours, éléments restreints/confidentiels, barèmes et réglages de conduite** |
| `responsable_pedagogique` | curriculum (édition), évaluations et notes en lecture, `grade.review` + `grade.validate`, résultats et bulletins en lecture, contexte (emplois du temps, enseignement, présences, personnel) | saisir, publier, approuver une correction, publier un curriculum, émettre |
| `responsable_examens` | **nouveau** (module `examinations`, spec 018) : toutes les `exam.*` NON sensibles : types, centres, sessions, candidats, éligibilité (règle), notes d'épreuves, examens blancs, imports et exports de l'autorité, saisie des résultats, convocations/attestations ; contexte en lecture (élèves, classes, inscriptions, évaluations) | **`exam.result.publish`, `exam.result.release`, `exam.result.revise`, `exam.eligibility.override`** (sensibles, direction : saisie/demande ≠ publication/approbation), notes courantes, finance, personnel (à cumuler avec `personnel`) |
| `admissions_officer` | **nouveau** (module `admissions`, spec 007 §11) : chargé d'admissions distinct du secrétariat : traitement d'un dossier (admission : `read`, `create`, `update`, `document.upload\|review`, `interview.manage`, `offer.manage`, `duplicate.resolve`, `waitlist.manage`, `prospect.manage`, `enroll`, `report.read`), messagerie | `admission.document.attach` (exige `documents.upload` que seul le secrétariat détient), `admission.decide`, `capacity.override`, `workflow.*`, `campaign.manage`, `settings.manage`, `anonymize`, `export` ; aucun accès aux élèves, notes ni finance |
| `personnel` | uniquement SES données : `staff.own.*`, `attendance.own.*`, `attendance.leave.request`, `payroll.payslip.read_own`, `payroll.my.dispute`, `schedule.own.read` ; à **cumuler** avec un rôle de fonction | tout le reste |
| `parent` | exactement toutes les permissions `child` du catalogue, à trois ET quatre segments (élève, inscriptions, notes, résultats, bulletins, absences + justificatif, emploi du temps, parcours supérieur, compétences et bilan annuel du primaire, vie scolaire partageable + recours + accusé de convocation, statut d'affectation d'État, documents d'examen ; `council.child.read`) | toute permission de gestion (la finance est limitée à `finance.child.read` / `finance.child.pay`) |
| `eleve` | exactement toutes les permissions `self` du catalogue, à trois ET quatre segments (dossier, inscriptions, notes, résultats, bulletins, absences, emploi du temps, parcours, finance `finance.self.read` / `finance.self.pay`, compétences et bilan du primaire, vie scolaire partageable + recours, documents d'examen ; `council.self.read`) | toute permission de gestion |

### Permissions réservées pour les modules à venir (liste blanche)

Les modules des packs livrent parfois **après** les rôles qui les concernent. Leurs permissions sont alors inscrites
dans les modèles de rôles (clés exactes) et restent **en attente** — signalées au niveau `info`, sans échec, sans
accorder quoi que ce soit — jusqu'à ce que le manifeste du module les déclare ; la prochaine `syncRbac` les résout dans
tous les tenants existants (idempotent, rôles personnalisés intouchés).

**État** : `primary_school` (005), `schoollife` et `stateassign` (006), `admissions` (007), `examinations` (018) et
`imports` (031) sont **livrés** ; leurs permissions sont déclarées par leur manifeste, accordées aux rôles ci-dessus
et ont donc été **retirées** de la liste blanche (le test de non-oubli l'exige). `councils` (conseils de classe,
spec 006) est lui aussi **livré** : ses entrées sont retirées et `RESERVED_FOR_UPCOMING_MODULES` / `RESERVED_MODULES`
sont désormais **vides** (le mécanisme et ses garde-fous restent, testés avec un module fictif).

La liste est **versionnée** dans `templates/reserved-permissions.ts` (`RESERVED_FOR_UPCOMING_MODULES`) : pour
chaque clé, le module futur (clé de manifeste), la spec source et la sensibilité prévue.

Liste actuelle : **aucune entrée**.

### Modules livrés des packs : attribution aux rôles

| Module | Attribution (permissions non listées = direction `*` seulement) |
|---|---|
| `primary_school` | `instituteur` : `competency.read\|record\|validate`, `phrase.read`, `council.read\|prepare`, `framework.read`, `bilan.read` ; `directeur_etudes` : référentiels (`framework.read\|manage\|publish`), `phrase.read\|manage`, `council.read\|manage`, `bilan.read\|prepare`, `archive.prepare`, `report.read`, `class.read_all`, `competency.read` ; `secretariat` : `report.read`, `class.read_all`, `bilan.read`, `competency.read` ; `parent` / `eleve` : `*.child.read` / `*.self.read`. Direction seule : `competency.revise`, `bilan.seal\|reissue`, `archive.freeze`, `template.apply` (sensibles), `settings.manage`, `scale.manage` |
| `schoollife` | `educateur` : `read`, `read.all`, `incident.write\|review`, `measure.propose`, `note.write`, `convocation.manage` ; `enseignant` : `read`, `incident.write`, `note.write` ; `directeur_etudes` : `read.all` ; `parent` : `child.read\|appeal\|acknowledge` ; `eleve` : `self.read\|appeal`. Direction seule (sensibles) : validation/révocation de mesures et d'exclusions, effet d'une exclusion, recours, lecture restreinte/confidentielle et son journal, barèmes, ajustement de conduite, réglages ; `appeal.file` |
| `stateassign` | `secretariat` : `read`, `record`, `document.manage` ; `econome` : `read`, `reconcile`, `receivable.manage`, `control.perform`, `export` ; `directeur_etudes` : `read` ; `parent` : `child.read`. **Direction seule** : `verify` (séparation des tâches : le secrétariat enregistre, il ne vérifie pas), `manage`, `amend`, `settings.manage` |
| `admissions` | `secretariat` et `admissions_officer` : traitement d'un dossier (`read`, `create`, `update`, `document.upload\|review`, `interview.manage`, `offer.manage`, `duplicate.resolve`, `waitlist.manage`, `prospect.manage`, `enroll`, `report.read`). Direction seule : `decide`, `capacity.override`, `workflow.manage\|publish`, `campaign.manage`, `settings.manage`, `anonymize`, `export` ; le parent n'a aucune permission (accès par jeton) |
| `examinations` | `responsable_examens` : toutes les `exam.*` non sensibles ; `directeur_etudes` : consultation (`type.read`, `session.read`, `candidate.read`, `result.read`, `statistics.read`) ; `parent` / `eleve` : `exam.document.child.read` / `self.read`. Direction seule (sensibles) : `eligibility.override`, `result.publish\|release\|revise` |
| `councils` | `directeur_etudes` : `council.*` SAUF `unlock.approve` et `minutes.revoke` (préparation, tenue de séance, décisions humaines, signature du PV, effets, exclusion, réglages, orientation, demande de déverrouillage) ; `secretariat` : `read`, `manage`, `minutes.generate\|read\|sign` (pas la tenue de séance ni les décisions) ; `enseignant` : `read` (périmètre de ses classes) et `proposal.write` (propose, ne décide jamais ; le professeur principal est une affectation d'enseignement, pas un rôle RBAC) ; `parent` : `child.read` ; `eleve` : `self.read`. Direction seule : `unlock.approve` (la demande est séparée de l'approbation) et `minutes.revoke` (émission/signature ≠ révocation). Paires incompatibles testées : demande ≠ approbation du déverrouillage ; génération/signature ≠ révocation du PV |
| `analytics` (spec 025 partie B) | `econome` : `finance.read`, `treasury.read`, `alerts.read`, `alerts.acknowledge` ; `directeur_etudes` : `pedagogy.read`, `attendance.read`, `alerts.read`, `alerts.acknowledge`, `admissions.read`, `schoollife.read` ; `admissions_officer` : `admissions.read`. Aucune n'est sensible. **Direction seule** : `alerts.manage` (seuils et destinataires), `payroll.read` (sensible), `charges.read`, `export`, `settings.manage`, `rebuild`. Chaque alerte reste filtrée par la permission de données de son indicateur (décision 4 de la spec §9 levée : l'économe et le directeur des études reçoivent exactement les permissions de données de leur domaine, rien de plus) |
| `finance` (webhooks, 2026-10-02) | `econome` : `finance.webhook.read` (lecture seule, sans charge brute). Direction seule : `finance.webhook.replay` (**sensible**, MFA, justification portée par `finance.*`) comme `finance.payment.reconcile` : le rejeu applique une issue financière après re-vérification du fournisseur |
| `admissions` (rattachement GED) | `secretariat` : `admission.document.attach` (non sensible ; la route exige AUSSI `documents.upload`, que seul le secrétariat détient) |
| `imports` | `secretariat` : `read`, `create`, `cancel`, `import.students\|guardians` ; `directeur_etudes` : `read`, `create`, `cancel`, `import.classrooms\|curriculum` ; `econome` : `read`, `create` (**prépare** les soldes d'ouverture, la direction les **lance**, MFA). Chaque importeur exige AUSSI les droits du module cible. Direction seule : `import.staff\|grades\|opening_balances`, `template.manage`, `manage` (arbitrage O-03, `specs/v2/031-imports/open-questions.md`) |

Garde-fous (`test/reserved-permissions.test.ts`, `test/system-roles.test.ts`) :

* un motif **en attente hors de la liste** fait échouer les tests (faute de frappe, permission renommée) ;
* chaque entrée de la liste est référencée par au moins un modèle ;
* **non-oubli** : dès qu'une entrée est déclarée par un manifeste chargé, le test échoue avec « retire-la de
  la liste » ; si le module est chargé mais ne déclare pas la clé, il échoue aussi (modèle à aligner) ; le
  drapeau `sensitive` de la liste est comparé à celui du manifeste ;
* un manifeste fictif par module à venir prouve qu'à son arrivée plus rien n'est en attente et que
  `parent` / `eleve` reçoivent exactement les permissions `child` / `self` ;
* conventions de portée : segment `self` ⇒ rôle `eleve` seul, `child` ⇒ `parent` seul. Les motifs de
  portail couvrent les clés à trois segments (`student.child.read`) **et** à quatre
  (`primary.competency.child.read`, `exam.document.self.read`) : `CHILD_PERMISSION_PATTERNS` /
  `SELF_PERMISSION_PATTERNS` dans `templates/reserved-permissions.ts` ;
* séparation des tâches des modules à venir (proposition ≠ validation d'une mesure, enregistrement ≠
  vérification d'une affectation, demande ≠ approbation d'un déverrouillage, signature ≠ révocation d'un PV,
  traitement ≠ décision d'admission, saisie/validation ≠ révision d'une compétence) évaluée sur les clés
  **déclarées** (accordées ou en attente), donc active dès aujourd'hui.

**Pour livrer un module à venir** : déclarer les permissions dans son `manifest.ts` avec les clés de la liste
(ou corriger modèles + liste si la clé change), puis **retirer** les lignes correspondantes de
`RESERVED_FOR_UPCOMING_MODULES`, étendre l'oracle de `system-roles.test.ts` (le module entre alors dans la matrice
rôle × module) et justifier dans `sensitiveJustifications` toute permission sensible accordée.

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
* seuls `owner` et `directeur` ont `*` ; `parent`/`eleve` = exactement les permissions `child`/`self` (3 et 4 segments, réservées incluses) ; aucune
  fuite de ces permissions vers un rôle de gestion ;
* aucun motif en attente hors liste blanche, aucune permission `rules.platform.manage` (console plateforme) dans un rôle de tenant.

Finance : `finance` déclare `finance.child.read|pay` (parent) et `finance.self.read|pay` (élève) ; ils figurent
dans `parent` / `eleve` (routes `/api/v1/finance/me/*`, tutelle relue côté serveur).

Synchronisation des tenants existants (`test/system-roles.integration.test.ts`) : un nouveau modèle (`instituteur`) est ajouté par
`syncRbac` sans toucher aux rôles personnalisés ni aux autres rôles système, de façon idempotente ; un rôle personnalisé qui
occupait la clé est déplacé (`instituteur_custom`), jamais écrasé.

Manques constatés dans les manifestes : aucun module `discipline`/`comms`/`document`/`report` n'existe encore (les anciens motifs
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

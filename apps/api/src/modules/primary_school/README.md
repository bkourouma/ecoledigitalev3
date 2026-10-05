# Module `primary_school` — pack Primary (spec v2/005)

Évaluation par **compétences** (maternelle sans note, primaire), banque d'appréciations, **conseil des maîtres** (dossier et présence),
**bilan annuel SCELLÉ** et versionné, **archive d'année** gelable, états du primaire, garde « classe active ⇒ titulaire ».

> **Le pack Primary est une COMPOSITION, pas un moteur.** `primary_school` ne calcule ni moyenne, ni rang, ni décision de passage :
> tout vient de `results` / `rules` (RuleSet **fictif** `CI-PRIMARY-PLACEHOLDER`, `source_kind = placeholder`, filigrane « Règles de
> démonstration — document sans valeur officielle »). Il porte des **données** (échelles, référentiels, phrases), des **journaux**
> (révisions, présence) et des **instantanés** (bilan, archive). Aucune règle réglementaire ivoirienne n'y est écrite
> (`regulatory-sources-needed.md`, `open-questions.md` de la spec). Un test de lint (R2) échoue si une moyenne, un seuil ou un coefficient apparaît dans le code.

> **Rang et mentions (décisions Q-P04 et Q-P05, 2026-10-05).** Le rang de période est calculé par `results` (classement « compétition » : 1, 1, 3) et **affiché par défaut** sur le bulletin du primaire ; la maternelle, sans note, n'a jamais de rang. Les **mentions** de période viennent de la règle optionnelle `mention_periode` du jeu fictif `CI-PRIMARY-PLACEHOLDER` v3 : seuils de départ fictifs (non officiels), réglables par l'établissement par une variante du jeu de règles, désactivables. Ce module ne calcule toujours ni rang, ni mention, ni seuil.

## Tables (schéma `primary_school`, migrations 1800-1803)

Les migrations 1800-1802 sont **identiques** au DDL testé de `specs/v2/005-primary/ddl` (test de conformité octet pour octet) ; 1803 est
un ajout de l'implémentation (période du conseil, procès-verbal figé), testé par `ddl/tests/40_council_minutes.sql` (118 tests de comportement au total).

| Migration | Tables |
|---|---|
| 1800 | `rating_scales`, `rating_levels`, `settings`, `template_applications`, `competency_frameworks`, `framework_grade_levels`, `competency_domains`, `competencies`, `appreciation_phrases` |
| 1801 | `period_locks`, `competency_assessments`, `competency_revisions` (ajout seul), fonction `summarize_competencies` |
| 1802 | `council_cases`, `council_attendance`, `annual_reviews`, `year_archives` |
| 1803 | `council_minutes` (procès-verbal figé), `council_cases.academic_period_id` |

Toutes portent `tenant_id` + RLS forcée ; clés étrangères internes **composites** `(tenant_id, id)` ; aucune FK vers un autre schéma que `kernel.tenants` ;
allowlist d'isolation **vide**. Références à `academic`, `people`, `results`, `reportcards` : UUID sans FK, vérifiés par des ports ; niveaux de classe désignés par leur **code** (PS…CM2).

> **Plage de migrations.** La spec réservait `1800-1899`, mais `imports` y a pris `1800` entre-temps (le générateur refuse la plage) :
> le module est en **`1800-1899`** (ligne ajoutée à `docs/architecture/module-conventions.md`). Le runner suit les versions par dossier, donc un
> renumérotage ultérieur reste un simple renommage de fichiers (DDL de la spec renommé en miroir).

## Invariants garantis par la base (déclencheurs) ET par l'application

| Invariant | Où |
|---|---|
| Un référentiel se publie avec ≥ 1 compétence, ≥ 1 niveau d'application, échelle ≥ 2 niveaux ; publié, sa structure est figée | `competency_frameworks_guard`, `framework_structure_guard` ; `publishFramework` liste les manques |
| Une appréciation vise un référentiel PUBLIÉ, un niveau de **son** échelle, une classe × période non verrouillée | `competency_assessments_guard` + `PeriodStatePort` (échec fermé) |
| Appréciation validée ⇒ correction par **révision** seulement (même transaction, motif ≥ 10 car., droit sensible) | `competency_revisions.xid = txid_current()` + `reviseCompetencyAssessment` |
| Présence au conseil : 1 président, 1 secrétaire ; on ne signe pas absent ; présence signée figée | index partiels, `CHECK`, `council_attendance_guard` |
| Bilan : scellé immuable, une seule version vivante, sceller exige résultat d'année FINAL (+ décision selon réglage) | `annual_reviews_guard` + `sealBlockers` |
| Année archivée (`FROZEN`) : plus aucun bilan écrit ; archive non supprimable | `annual_reviews_guard`, `year_archives_guard` |
| Procès-verbal : contenu figé, seul l'identifiant du document émis se renseigne, une fois | `council_minutes_guard` |

## API (`/api/v1/primary_school`, schémas Zod : `packages/contracts/src/v2/primary_school.ts`)

Paramètres `GET|PUT /settings` · `POST /template/apply` — Échelles `GET|POST /rating-scales`, `PATCH /rating-scales/:id`, `PUT /rating-scales/:id/levels` —
Référentiels `GET|POST /frameworks`, `GET /frameworks/:id`, `PUT /frameworks/:id/structure`, `DELETE /frameworks/:id` (brouillon), `POST /frameworks/:id/publish|new-version` —
Compétences `GET /my-classrooms`, `GET /rule-banner`, `GET /classrooms/:id/competency-sheet?periodId=`, `PUT /competency-assessments/bulk`,
`POST /classrooms/:id/periods/:pid/competencies/validate`, `POST|GET /competency-assessments/:id/revisions`, `GET /enrollments/:id/competency-summary`,
`GET /children/:studentId/enrollments/:id/competency-summary` — Appréciations `GET|POST|PATCH /phrases` —
Conseil `GET /councils`, `POST /councils/prepare`, `GET /councils/:id[/cases]`, `PATCH /councils/:id/cases/:caseId`, `POST /councils/:id/cases/:caseId/decide`,
`PUT /councils/:id/attendance`, `POST /councils/:id/minutes` —
Bilan `POST /annual-reviews/prepare`, `GET /annual-reviews[/:id]`, `POST /annual-reviews/:id/seal|reissue`, `GET /me/annual-reviews`, `GET /children/:studentId/annual-reviews` —
Archives `POST /year-archives/prepare`, `GET /year-archives[/:id]`, `POST /year-archives/:id/freeze` — Rapports `GET /progress`, `GET /reports/:key?format=json|csv`
(`class-list`, `enrollment-stats`, `attendance-register`, `repeaters`, `competency-coverage`, `council-pack`, `progress`).

Saisie en lot : ≤ 500 lignes, **tout ou rien**, idempotente **par convergence** (rejouer un lot = `unchanged` ; une ligne existante dont la valeur diffère exige `rowVersion`) ;
limiteur de débit par utilisateur. Réponses `Cache-Control: no-store`. 404 hors périmètre (classe non affectée, enfant non lié).

## Permissions (manifeste)

`primary.settings.manage`, `primary.scale.manage`, `primary.framework.read|manage|publish`, `primary.competency.read|record|validate|revise`,
`primary.competency.child.read|self.read`, `primary.phrase.read|manage`, `primary.council.read|prepare|manage`, `primary.bilan.read|prepare|seal|reissue`,
`primary.bilan.child.read|self.read`, `primary.archive.prepare|freeze`, `primary.report.read`, `primary.template.apply`, **`primary.class.read_all`** (ajout à la spec §10).
**Sensibles** (MFA + audit) : `revise`, `seal`, `reissue`, `freeze`, `template.apply`.
Sans `primary.class.read_all`, un instituteur n'accède qu'aux classes auxquelles il est affecté. Features : `primary.competencies`, `primary.council`, `primary.annual-review`, `primary.year-archive`, `primary.reports`.

## Événements (outbox `{ v: 1 }`, aucun contenu pédagogique : ni appréciation, ni niveau, ni note, ni nom)

Publiés : `primary_school.template.applied`, `framework.published`, `competency.validated|revised`, `council.prepared|minutes_requested`,
`annual_review.sealed|superseded`, `year_archive.ready|frozen`. Consommés (abonnés idempotents) : `tenancy.institution.created` (modèle de pack, pack PRIMARY),
`academic.classroom_period.grading_closed|closed|reopened` (miroir `period_locks`), `results.decision.confirmed` (dossier décidé + issue d'inscription de fin d'année),
`primary_school.annual_review.sealed` (demande du PDF à reportcards), `reportcards.official_document.rendered` (nature `ANNUAL_REVIEW` : renseigne `reportcard_id`).
Job : `primary_school.purge-draft-reviews` (04:35, par tenant, brouillons intacts > 90 jours).

## Ports (`application/ports.ts`) — échec fermé `primary_school.port_unavailable`

`ClassroomPort` (classes, inscriptions, périodes, années, établissements), `PeriodStatePort`, `OutcomePort`, `TeachingPort` (affectations, titulaire),
`GuardianshipPort`, `ResultsPort` (délibération COUNCIL, propositions, confirmation, résultat d'année), `RulesPort` (quorum, motifs d'examen),
`AttendancePort` (récapitulatif, registre mensuel), `DocumentsPort` (PV, bilan, périodes publiées), `TemplatePort` (modèle `templates/CI/primary.json`).
Enregistrés par `registerPrimarySchoolPorts(app, ports)` (API) / `setPrimarySchoolWorkerPorts(ports)` (worker) ; adaptateurs :
`apps/api/src/platform/adapters/*-primary.ts` (sur les **API publiques** des modules, jamais de SQL). Implémentations en mémoire : `InMemoryWorld`.

### État des interfaces avec les modules voisins (phase 3 : branchées et prouvées par `apps/api/test/phase3/primary.integration.test.ts`)

| Interface | Module | État |
|---|---|---|
| Contrats de règles `coef-period@1` et `competency-period@1` + RuleSet `CI-PRIMARY-PLACEHOLDER` (`source_kind = placeholder` accepté par `rules`) | rules (012) | `ResultsPort.openCouncil` / `listProposals` échouent fermé (`results.*` : aucun contrat) ; la maternelle décide au conseil sans proposition (R6 du plan) |
| Pipeline `results` pour ces contrats ; `ruleSourceKind` dans le bundle FINAL ; `createDeliberation` portant `participants` | results (011) | pas de propositions de règle, pas de `getRuleSourceKind` : `null`, aucun filigrane déduit |
| Natures de document `COUNCIL_MINUTES` et `ANNUAL_REVIEW` (`OFFICIAL_DOCUMENT_KINDS`), gabarits `council-minutes` / `annual-review-primary` / `report-primary`, filigrane conditionnel | reportcards (013) | `requestCouncilMinutes` refuse (409/500 `port_unavailable`, rien n'est écrit) ; l'abonné `request-review-document` rejoue ; les familles ne voient pas les bilans (pas de `reportcard_id`) |
| `ClassroomActivationGuard` appelé par `activateClassroom` | academic (004) | la règle existe (`checkHomeroomForActivation`, testée) mais n'est pas appelée à l'activation |
| Rôle système `instituteur` (+ `primary.bilan.read`, `primary.class.read_all` pour direction et secrétariat) | rbac (002) | **FAIT** (`rbac/templates/system-roles.ts`) : `instituteur`, `secretariat`, `directeur_etudes`, `parent`, `eleve` dotés ; le scellé, la révision, le gel et le modèle restent à la direction |
| `calculationContract` `coef-period@1` / `competency-period@1` dans `academic/templates/CI/primary.json`, poids de période | academic (004) | le pipeline de `results` ne sait pas quel contrat appliquer |
| Sexe, âge et financement dans un port de statistiques d'inscription (rapport R2) | people / academic | R2 n'a que niveau, classe, effectif, redoublants |
| Contrats `coef-period@1` et `competency-period@1`, jeu `CI-PRIMARY-PLACEHOLDER` (`source_kind = placeholder`) | rules (012) | livrés ; **liés par défaut** à l'établissement par l'abonné `rules.apply-pack-bindings` (`tenancy.institution.created`, hors production seulement ; en production : accusé explicite d'un utilisateur, le refus est journalisé et ignoré) |
| Pipeline `results`, `ruleSourceKind` (vue de période et bundle FINAL), conseil COUNCIL | results (011) | livrés ; **compteurs de compétences** : `results.competencyCounters` <- `getCompetencyCounters` de ce module (adaptateur `platform/adapters/primary-results.ts`) : évaluées = compétences distinctes validées du référentiel applicable, attendues = ses compétences |
| Natures `COUNCIL_MINUTES` et `ANNUAL_REVIEW`, gabarits, filigrane conditionnel | reportcards (013) | livrés ; l'adaptateur transmet `ruleSourceKind` (provenance SCELLÉE avec le document) : la vérification publique annonce `demonstration: true` et le rendu impose le filigrane ; clé de signature et gabarits préparés au démarrage hors transaction |
| `ClassroomActivationGuard` appelé par `activateClassroom` | academic (004) | **branché** (`platform/adapters/primary-academic.ts`) : 409 `primary_school.homeroom_required` sans titulaire ; un titulaire `HOMEROOM` (sans nœud) est accepté sur une classe en BROUILLON (sinon la garde serait insatisfiable) |
| Rôle système `instituteur` (+ `primary.bilan.read`, `primary.class.read_all` pour direction et secrétariat) | rbac (002) | livré |
| `calculationContract` dans `academic/templates/CI/primary.json`, poids de période | academic (004) | livrés |
| Catégories de frais `REGISTRATION` / `TUITION` du modèle de pack | finance (014) | **branchées** : abonné `finance.instantiate-pack` (`tenancy.institution.created`), libellés seulement |
| Sexe, âge et financement dans un port de statistiques d'inscription (rapport R2) | people / academic | NON livré : R2 n'a que niveau, classe, effectif, redoublants |
| `getPackTemplateSection('PRIMARY', 'CI', 'primary_school')` | tenancy (003) | modèle livré avec le module (`TemplatePort` par défaut), remplaçable sans toucher au module |

**Dates d'effet** : les versions des jeux de démonstration sont effectives à partir du 2026-09-01 (`PLACEHOLDER_EFFECTIVE_FROM`, `rules/seed/rulesets.ts`) ; une année qui commence avant n'a aucune règle applicable (`results.no_active_ruleset`, jamais de valeur par défaut). Les liaisons posées à la création de l'établissement valent depuis 2000-01-01 (origine des temps de la plateforme) : seule la date de la version borne l'application.

## Décisions de conception à connaître

- **Idempotence de la saisie en lot** par convergence (pas de table de reçus) : le rejeu d'un lot identique n'écrit rien.
- **Verrou de période à deux étages** : le port lit l'état EFFECTIF (academic) et aligne le miroir `period_locks` avant l'écriture ; le déclencheur SQL est la défense en profondeur.
- **Quorum** : jamais une constante ; `RulesPort.quorum` évalue `quorum_conseil` du RuleSet lié ; sans règle liée, présence comptée et affichée, aucun blocage (Q-P14).
- **Décision de fin d'année** : confirmée par `results.confirmDecision` (le conseil ne duplique pas la décision), puis `academic.recordEnrollmentOutcome` pour la dernière période de l'année.
- **Famille** : bilans SCELLÉS dont le PDF est ÉMIS ; compétences des seules périodes dont le bulletin est publié ; 404 hors lien de tutelle.
- **Archive** : `READY` exige tous les bilans scellés, chaque inscription pourvue d'un bilan, et le PDF émis (le gel interdit ensuite d'écrire `reportcard_id`).
- **Réémission** : l'index « une seule version vivante » impose de remplacer l'ancienne version dans la même transaction ; entre la réémission et le nouveau scellement, la famille ne voit pas le bilan.

## Tests

`test/unit` (domaine, contrats, manifeste, conformité des migrations au DDL de la spec, lint R2, chargement par le registre), `test/integration` (Postgres réel, rôle soumis à la RLS :
modèle de pack idempotent, compétences, conseil, bilan scellé, archive, garde d'activation, isolation A/B de chaque table, HTTP par rôle avec validation des contrats).

```bash
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/primary_school
node specs/v2/005-primary/ddl/run.mjs          # 118 tests de comportement du DDL (Docker)
```

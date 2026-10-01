# Module `results` — résultats, décisions et clôture de période (spec v2/011)

Résultats de période et d'année **calculés** par le module `rules` (contrats `credit-semester@1` et `coef-semester@1`) à partir des
seules notes **publiées** d'`assess` : contexte typé, chaînage des règles, version de règle **épinglée**, empreintes d'entrées et de
sorties (`inputs_hash`, `outputs_hash`), trace d'explicabilité, rang avec ex æquo, décisions proposées par règle puis confirmées en
délibération, surcharges justifiées à quatre yeux, résultats **FINAL immuables** (application ET déclencheurs SQL), réouverture
motivée (version n+1), dette d'UE et rattrapage (la session 2 REMPLACE la session 1).

**Aucune formule, aucun seuil, aucune arithmétique de moyenne dans ce module.** Il trie, regroupe, transporte des décimaux EXACTS (chaînes)
vers les règles et persiste leurs sorties (valeurs, codes). La logique de décision se lit dans les CODES de sortie, jamais dans un
libellé (R-RES-07). Références au cœur (classe, inscription, nœud de curriculum, période, élève, personnel) : UUID sans clé étrangère,
fournis par des **ports**.

## Tables (schéma `results`, migrations 1200-1203)

`settings`, `period_states` (état, version de règle épinglée, compteur de clôtures), `closures` (append-only : hash de clôture),
`period_results` (en-têtes versionnés `DRAFT/FINAL/SUPERSEDED/ERROR`), `line_results` (ECUE/matière, UE, période, année),
`overrides`, `deliberations`, `decisions` (proposition ET décision finale conservées), `appreciations`, `recompute_requests`
(file coalescée). Toutes portent `tenant_id` + RLS forcée ; allowlist d'isolation vide (`modules/isolation-allowlist.results.ts`).

Garde-fous SQL (`1203_results_guards.sql`), valables pour tout rôle, superuser compris (tests d'intégration) : machine à états de la
période, résultat FINAL immuable (seul passage permis : `SUPERSEDED`), lignes d'un FINAL scellées (`line_count`), clôtures en
ajout seul, surcharge approuvée figée, décision confirmée conservant la proposition, plus aucune écriture sur une période `CLOSED`.

## Cycle d'une période

```
OPEN ──lock──► GRADING_LOCKED ──deliberate──► DELIBERATED ──close──► CLOSED ──reopen──► OPEN (version n+1)
```

- `lock` : refusé tant que des évaluations de la classe et de la période ne sont pas publiées (liste renvoyée) ; forçage avec motif.
  Pose le verrou de notes d'`assess` (par session) dans la MÊME transaction ; les déclencheurs d'`assess` l'imposent.
- `close` : recalcule toute la classe en résultats FINAL **avec trace**, calcule le hash de clôture (agrégat des `outputs_hash`),
  supersède les anciens FINAL — une transaction : règle indisponible ⇒ rien ne change. Refusée si une inscription est en ERREUR
  (forçage avec exclusion explicite et motif).
- `reopen` : motif obligatoire, droit sensible. `CORRECTION` libère tout ; `RESIT_SESSION` ne libère que la session 2.
- Vue de travail : la version la plus récente (après réouverture, le brouillon de correction prime) ; le FINAL reste le résultat
  officiel et la seule version lue par les familles.

## Calcul

- **Crédits (ECUE → UE → semestre → rang)** : `note_sur_20`, `moyenne_devoirs`, `note_examen_retenue` (session 2 remplace), `note_ecue`
  / `note_ecue_directe` (conduite), `ecue_eliminee`, `ecue_validee` (validation manuelle du jury = entrée de la règle), `moyenne_ue`,
  `ue_validee`, `credits_ue`, `etat_ue`, `session_validation_ue`, `statut_ecue`, `eligible_rattrapage`, `moyenne_session`,
  `credits_valides`, `credits_total`, `semestre_valide`, `decision_semestre`, mentions, `arrondi_affichage`, `rang`.
  Une UE sans AUCUN résultat est « en attente » : ni état LMD, ni décision de semestre (jamais « ajourné » faute de note).
- **Coefficients (matière → section → période → rang → décision)** : `moyenne_matiere`, `moyenne_ponderee`, `moyenne_section`, `mention`,
  `decision_conseil`, rangs de matière / section / global ; au 2ᵉ semestre `moyenne_annuelle`, `decision_fin_annee`, `distinction`,
  `appreciation_conseil`, rang annuel. Le « 2ᵉ semestre » et l'examen terminal viennent de la DONNÉE (rang de période, attribut du
  programme), plus du nom d'une période ou d'une classe.
- Pipelines par ÉTAPE sur toute la classe (une passe par étape), isolement des échecs par inscription (ERREUR), rang en seconde phase.
- **Année** (`getYearResult`, `GET /enrollments/:id/years/:yearId`) : dérivée des FINAL de période ; crédits : règles de l'étape
  « année » (`moyenne_annuelle`, `annee_validee`, `credits_valides/total`, `mention_diplome`, `rang`) sous la version épinglée ; coefficients :
  ligne `YEAR` du dernier semestre. Incomplète (`complete: false`, périodes manquantes) tant qu'une période n'est pas clôturée.
- Recalcul **coalescé** (une demande par classe × période, temporisation 10 s) déclenché par `assess.grade.published|revised`,
  `assess.assessment.cancelled`, `academic.enrollment.*` ; jamais de calcul dans la requête qui publie. Idempotent : sans changement
  d'entrée ni de version de règle, aucune nouvelle version. Publier une version de règle ne recalcule rien : la vue de période signale
  le **retard de version** et le **re-pin** (période ouverte) joint une simulation de l'effet avant de remplacer la version.

## Ports (`application/ports.ts`)

`CurriculumPort` (structure d'une classe × période : nœuds UE/ECUE/matière, crédits et coefficients décimaux, mode de saisie, rattrapage
autorisé, section, examen terminal, faits de période), `RosterPort`, `AssessPort` (adaptateur réel `assessPortFrom(AssessDeps)`),
`RulesPort` (adaptateur réel `rulesPortFrom(RulesApi)`), `GuardianshipPort`, `ActorNamePort`. Enregistrés par
`registerResultsPorts(app, ports)` (décorateur racine `app.resultsPorts`) ; non branchés : indisponibles (échec fermé).
Implémentations en mémoire : `InMemoryCurriculum`, `InMemoryRoster`, `InMemoryAssess`…

**Worker.** Les jobs et abonnés ne disposent pas du registre Fastify : `createWorkerResultsDeps` construit `assess` et `rules` sur leur API
publique ; `curriculum` et `roster` doivent être branchés par `setResultsWorkerPorts({ curriculum, roster })` (amorçage du worker ou
d'`academic`). Sans eux, le recalcul échoue FERMÉ (`results.port_unavailable`) : jamais de calcul sur une structure devinée.

## API publique (`index.ts`)

Pour `reportcards` / `higher` : `getFinalResult`, `listFinalLines`, `listResitCandidates`, `getYearResult`, `reopenPeriod` (`RESIT_SESSION`),
`computePeriod`, `closePeriod`… Pipelines purs (`computeCreditSemester`, `computeCoefSemester`) testables sans base.

## Routes (`/api/v1/results`)

`GET /classrooms/:c/periods/:p[/state]`, `GET /enrollments/:e/periods/:p`, `GET /enrollments/:e/years/:y`, `GET /results/:id/explain`,
`POST /recompute`, `POST /classrooms/:c/periods/:p/lock|deliberate|close|reopen`, `POST /periods/:id/repin`,
`/overrides[/:id/approve|reject|revoke]`, `/decisions[/:id/confirm]`, `/deliberations`, `/appreciations`, `/settings`,
`/me/results`, `/children/:studentId/results`. Les lectures famille ne renvoient que des résultats FINAL, sans surcharge, trace
ni entrée de calcul.

## Événements (outbox, `{ v: 1 }`, aucune note ni moyenne)

`results.period_result.computed`, `results.period.locked|deliberated|closed|reopened`, `results.decision.confirmed`,
`results.override.requested|approved|revoked`, `results.recompute.blocked`. Consommés : `assess.grade.published|revised`,
`assess.assessment.cancelled`, `academic.enrollment.created|transferred|withdrawn`, `rules.binding.changed` (aucun recalcul).
Jobs : `results.process-recomputes` (toutes les 10 s), `results.purge` (quotidien).

## Reproductibilité

Chaque résultat porte `(rule_version_id, definition_hash, engine_version, inputs_hash, outputs_hash)` ; un FINAL conserve en plus ses
entrées canoniques (sans identité d'élève) et la trace de chaque ligne, dont le **contexte exact de chaque appel** (sauf `rang`).
`application/replay.ts` branche dans `rules` une source de **rejeu** (échantillon quotidien : 0 écart attendu, toute altération
émet `rules.replay.mismatch`) et une source de **cas de simulation** construits sur les données réelles du tenant.

## Parité avec le legacy (`test/parity`)

Les scénarios déclaratifs de `tests/characterization/scenarios` sont rejoués à travers ce module et les VRAIES règles du catalogue
national, puis projetés sur la forme des snapshots du legacy et comparés par `compareWithTolerance` :
`licence-rattrapage`, `bts-premiere-annee`, `notes-limites`, `conduite-absences`, `cloture-semestre` (pile à crédits, `CI-HIGHER-LMD`),
`classique-terminale`, `classique-flottants`, `classique-nommage-periodes` (pile à coefficients, `CI-CLASSIC-SEMESTRE` / `CI-HIGHER-BTS`).
Seuls écarts tolérés : les bogues catalogués de statut `bug` (virgule flottante à 10 et à 5, recalcul sur entrées arrondies…) — la v2
doit les avoir CORRIGÉS, jamais reproduits — et deux divergences documentées (UE de conduite non notée, note saisie 9,995). Voir
`test/parity/*.integration.test.ts`. Les défauts `dead` (`RULES_NOT_WIRED_*`) ne sont pas tolérés : leur portée masquerait des écarts réels.

## Décisions et points d'attention

- Tout vient des règles ; ce module ne connaît que des clés de règle, des contrats et des codes.
- Le groupe d'agrégation `EXAM` (examen d'une ECUE) fait partie du chaînage du contrat (`EXAM_AGGREGATION_GROUP`) ; les types
  d'évaluation eux-mêmes (codes, barèmes, poids) restent des données du tenant (`assess`).
- Un FINAL est immuable : une correction est une réouverture (`period.reopen`, sensible, motif) puis une nouvelle clôture.
- Une décision confirmée différente de la proposition exige une justification (20 caractères) ; les deux sont conservées.
- Une surcharge approuvée s'applique à l'étape ciblée, est rejouée par chaque recalcul et tracée ; l'approbation exige une seconde personne
  (réglage `require_separate_approver`).
- `effectif` (taille de la classe, `summary.classSize`) est distinct de `cohortSize` (inscriptions classées, avec moyenne).

## Assemblage

- `isCurriculumNodeInResults` : garde d'usage d'un nœud de curriculum (`platform/adapters/academic-guards.ts`) ;
- la structure de calcul vient des **données** du curriculum (`platform/adapters/academic-results.ts`) : contrat (`program.calculation_contract ?? education_level.calculation_contract ?? null`, aucun défaut), rang de période, crédits, parents, `levelCode` = code du niveau ;
- ports du worker : `setResultsWorkerPorts` (recalcul sur notes publiées).

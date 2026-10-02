# Module `stateassign` — élèves affectés par l'État

Pack `SECONDARY` (feature `stateassign.core`). Schéma Postgres `stateassign`, migrations **2300-2303**. Spec : `specs/v2/006-secondary` (US10, §5.4 R-A1..R-A6, `data-model.md` §5.9-5.10), PRD §20. Conventions : `docs/architecture/module-conventions.md`.

Le module ne décide jamais seul : il **enregistre** ce que dit l'acte d'affectation, le fait **vérifier par un humain**, **rapproche** l'acte avec la facturation de `finance`, **suit** les versements attendus de l'État, planifie des **contrôles** que des personnes réalisent. Aucune règle officielle, aucun barème : tolérance, délai de grâce, contrôles exigés sont des **réglages d'établissement**, vides ou à zéro par défaut (questions métier : `specs/v2/006-secondary/open-questions.md`, section « stateassign »).

## Ce que fait le module

| Domaine | Fonctions |
|---|---|
| Dossier | un dossier **par inscription** (`RECEIVED → VERIFIED → ACTIVE ⇄ SUSPENDED → ENDED / TRANSFERRED`, `REJECTED`, `SUPERSEDED`), référence unique par établissement et année (hors rejeté / remplacé), source `MANUAL` / `IMPORT` / `GATEWAY` ; **montants déclarés** État et famille en entiers (`Money`, jamais de flottant) |
| Vérification | acte **humain** imposé par la base (`require_human_actor` : un job, un abonné, un opérateur de plateforme sont refusés) ; **séparation des tâches** (l'enregistrant ne vérifie pas, réglable) ; la vérification appelle `academic.changeEnrollmentFunding(STATE_ASSIGNED, référence)` **dans la même transaction** : la référence d'affectation de l'inscription n'a qu'une source, le dossier vérifié |
| Avenant | remplacer la version courante (`SUPERSEDED`, date, motif) puis créer la version `n+1` (repart à `RECEIVED`) ; le contenu d'un dossier vérifié ne se modifie jamais en place ; un avenant ne peut pas descendre sous le calendrier de créances déjà planifié |
| Rapprochement | écart = **facturé − déclaré** par part ; la facture de la famille ne porte **que** la part parent (finance la sépare à l'émission) ; **statut calculé par la base** (`BALANCED` si les deux écarts ≤ tolérance de l'établissement, sinon `DISCREPANCY`), un statut saisi est ignoré ; jour par jour, rien n'est réécrit s'il n'y a rien à changer |
| Créances sur l'État | calendrier **attendu** des versements (échéances), montant **reçu** rapproché des paiements du financeur dans `finance` (affecté à l'échéance la plus ancienne d'abord, surplus « non affecté »), statut calculé par la base, **retard dérivé** (échéance + jours de grâce), alerte `receivable.overdue` **une fois** par échéance, historique en ajout seul ; `finance` reste le grand livre (R-A6) |
| Contrôles | planifiés (humain, ou règle de l'établissement : rien par défaut), **réalisés par un humain** (`OK`, `ANOMALY` + constat, `WAIVED` + motif), anomalie résolue avec motif ; les faits de présence viennent d'`attendance`, jamais calculés ici |
| Pièces | des **références** vers `documents` (acte d'affectation, certificat de présence, reçu, courrier), retrait motivé |
| États et exports | tableau de bord, état de rapprochement, contrôles à faire, créances par ancienneté ; **exports CSV avec formats en données** (colonnes, ordre, en-têtes, séparateur composés par l'établissement ; format neutre intégré en repli ; cellules texte neutralisées contre l'injection de formule ; troncature signalée) |
| Passerelle future | port `StateGateway`, adaptateur par défaut **`NotConfigured`** : aucun appel externe n'existe ; `source = GATEWAY` + empreinte d'échange sont prêts |
| Vue famille | le **statut** du dossier de l'enfant, jamais les montants de l'État, échéances, écarts ni contrôles ; lien de tutelle relu à chaque requête |

## Arborescence

```
domain/          règles PURES : machines d'états (miroir de la base, test de parité), rapprochement, affectation des versements, retards, planification des contrôles, exports, événements, erreurs
application/     cas d'usage (deps, ctx, input) => Result ; ports ; registre de ports ; jobs ; présentateurs DTO
infrastructure/  dépôts SQL (via Tx), traduction des refus de la base en codes stables, ports en mémoire / « indisponibles »
http/            plugin Fastify /api/v1/stateassign, gardes de permission
migrations/      2300 init · 2301 gardes · 2302 créances et formats · 2303 gardes des créances
test/            unit/ (purs, registre) · integration/ (Postgres réel : base, cas d'usage, rapprochement, contrôles, HTTP, isolation)
```

## Modèle de données (schéma `stateassign`, 8 tables, RLS forcée, aucune table globale)

`settings` (réglages par établissement) · `assignments` (dossiers versionnés) · `assignment_events` (historique, ajout seul) · `controls` · `documents` · `receivables` (échéances de la créance) · `receivable_events` (ajout seul) · `export_formats` (formats d'export en données).

Garanties **imposées par la base** (déclencheurs `2301` / `2303`, valables pour un superutilisateur aussi) : acte humain pour vérifier / rejeter / activer / suspendre / terminer / amender / planifier ou annuler une échéance / réaliser un contrôle / régler ; vérificateur et date posés par la session (non falsifiables) ; contenu figé après vérification ; une seule version vivante par inscription ; référence unique ; statut de rapprochement et statut d'échéance **calculés** ; somme des échéances ≤ montant État déclaré ; échéance reçue (même en partie) non annulable ; historiques en ajout seul (`clock_timestamp()` : ordre déterministe) ; aucun `DELETE`.

Les identifiants d'élève, d'inscription, de facture, de bourse, de document sont des **UUID sans clé étrangère** vers d'autres schémas (vérifiés par des ports).

## Permissions (manifeste)

`stateassign.read`, `.record`, `.verify` (sensible), `.manage` (sensible), `.amend` (sensible), `.reconcile`, `.receivable.manage`, `.control.perform`, `.document.manage`, `.export`, `.settings.manage` (sensible), `.child.read`. Features : `stateassign.core` (pack `SECONDARY`), `stateassign.gateway` (réservée : aucun pack).

Accordé aux rôles système (modèles `rbac/templates/system-roles.ts`, **fait**, voir `rbac/README.md`) : `directeur` / `owner` : `*` ; `secretariat` : `stateassign.read`, `.record`, `.document.manage` ; `econome` : `stateassign.read`, `.reconcile`, `.receivable.manage`, `.control.perform`, `.export` ; `directeur_etudes` : `stateassign.read` ; `parent` : `stateassign.child.read`. **La vérification n'est pas donnée au secrétariat par défaut** (séparation des tâches).

## Routes `/api/v1/stateassign`

| Route | Permission |
|---|---|
| `GET /me/context`, `GET\|PUT /settings?institutionId` | toute permission du module ; `read` ou `settings.manage` / `settings.manage` |
| `GET\|POST /assignments`, `GET\|PATCH /assignments/:id` | `read` / `record` |
| `POST /assignments/:id/{verify,reject}` | `verify` |
| `POST /assignments/:id/{activate,suspend,resume,end,transfer-out}` | `manage` |
| `POST /assignments/:id/amend` | `amend` |
| `POST /assignments/:id/reconcile` | `reconcile` |
| `POST /assignments/:id/controls`, `GET /assignments/:id/attendance-facts`, `POST /controls/:id/{complete,waive,resolve}` | `control.perform` (lecture des faits : `read` aussi) |
| `POST /assignments/:id/documents`, `POST /documents/:id/withdraw` | `document.manage` |
| `GET /receivables`, `GET /receivables/aging`, `GET /receivables/:id/history` | `read` |
| `POST /assignments/:id/receivables`, `PATCH /receivables/:id`, `POST /receivables/:id/cancel` | `receivable.manage` |
| `GET /reports/{summary,reconciliation,controls-due}` | `read` (selon l'état : aussi `reconcile`, `control.perform`) |
| `GET /exports/catalog`, `GET /export-formats` | `export` ou `settings.manage` ; `POST\|PATCH /export-formats` : `settings.manage` |
| `GET /exports/:dataset`, `GET /exports/:dataset/meta` | `export` (CSV ; en-têtes `X-Export-Truncated`, `X-Export-Row-Count`, `X-Export-Total-Count`, `X-Export-Max-Rows`) |
| `GET /gateway/status` ; `POST /gateway/fetch`, `POST /assignments/:id/gateway/push-certificate` | `read` ; `record` / `manage` **+ feature `stateassign.gateway`** (réservée) |
| `GET /children/:studentId/assignment` | `child.read` + lien de tutelle (404 sinon) |

Toutes les routes exigent la feature `stateassign.core`. Erreurs : codes stables `stateassign.*` (`STATEASSIGN_ERROR_CODES` des contrats) ; `503` pour un port absent (`stateassign.port_unavailable`) ou la passerelle non configurée ; `403` pour un acte refusé à un acteur non humain ou la séparation des tâches ; aucune violation prévisible de la base ne donne `500`. `PATCH` / actes : `rowVersion` (concurrence optimiste, `409 stateassign.version_conflict`).

## Événements (outbox, `{ v: 1, … }`, aucun nom ni référence d'acte)

`stateassign.assignment.received|verified|activated|suspended|resumed|ended|transferred|superseded|rejected` · `stateassign.control.due|performed|anomaly_detected` · `stateassign.reconciliation.discrepancy` · `stateassign.receivable.scheduled|overdue|received|cancelled`. Schémas : `stateassignEventPayloadSchemas` (contrats). **Consommés** : `finance.payment.completed` (paiement d'un FINANCEUR seulement), `finance.invoice.issued`.

Alertes de l'économe / de la direction : `notifications` consomme `stateassign.reconciliation.discrepancy`, `receivable.overdue`, `control.due`, `control.anomaly_detected` (règles livrées `stateassign.*`, gabarit interne `stateassign_alert`, rôles `econome` et `directeur`, aucun nom d'élève dans le message ; voir le README de `notifications`).

## Abonnés et jobs (worker, `WORKER_TZ`)

| Nom | Quand | Rôle |
|---|---|---|
| `stateassign.reconcile-on-state-payment` | `finance.payment.completed` (payeur `FUNDER`) | rapproche les dossiers de l'élève |
| `stateassign.reconcile-on-invoice-issued` | `finance.invoice.issued` | idem (la facturation change) |
| `stateassign.reconcile` | 01:40 | rapproche tous les dossiers à suivre, tenant par tenant ; un échec n'arrête pas les autres |
| `stateassign.plan-controls` | 06:20 | planifie les contrôles exigés par les réglages (rien par défaut) |
| `stateassign.flag-overdue` | 07:20 | signale une fois chaque échéance en retard |
| `stateassign.notify-due-controls` | 07:25 | publie une fois `control.due` |

Tous idempotents. **Le worker embarque les modules** : `pnpm --filter @ecoledigitale/worker build` après tout changement.

## Ports attendus (`application/ports.ts`) — branchés par `platform/adapters`

| Port | Fournisseur | Adaptateur |
|---|---|---|
| `enrollments` (`getEnrollment`, `listPeriods`), `funding` (`setStateAssignedFunding`) | `academic` | `academic-stateassign.ts` |
| `finance` (`getStateFundingBilling` : factures de l'État et de la famille nettes d'avoirs, paiements reçus du financeur) | `finance` | `finance-stateassign.ts` |
| `attendance` (`getFacts` par période, valeur effective) | `attendance` | `attendance-stateassign.ts` |
| `documents` (`exists`, droits de lecture sondés par le plugin) | `documents` | `documents-stateassign.ts` |
| `students` (noms), `guardianship` (tutelle) | `people` | `people-stateassign.ts` |
| `gateway` | futur | `NotConfigured` (par défaut, explicite) |

Un port manquant **échoue fermé** (`stateassign.port_unavailable`) : rien n'est écrit ; seuls les noms d'élèves (décoration) et la tutelle (refus) ont un repli. Registre : `app.stateassignPorts` (API) / `setStateassignWorkerPorts` (worker).

## Variables d'environnement

`STATEASSIGN_EXPORT_MAX_ROWS` (défaut 50 000, borné à 500 000) : plafond de lignes d'un export (au-delà : tronqué **et** signalé).

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/stateassign/test/unit          # purs + registre
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/stateassign   # + intégration réelle
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/stateassign   # academic + finance + attendance + people réels
```

L'intégration reprend les 12 tests de comportement du DDL de référence (`specs/v2/006-secondary/ddl-test/stateassign.test.mjs`) et ajoute créances, formats, réglages ; l'isolation A/B couvre les 8 tables (`assertTenantIsolation` + cas d'usage).

## Limites connues et décisions

* **Rejet d'un dossier déjà vérifié** : l'inscription **n'est pas** automatiquement remise à `PRIVATE` (acte financier : un humain décide) ; l'audit porte `enrollmentFundingUnchanged`.
* **Contrôle de présence** : exige une période (les faits d'`attendance` sont par période).
* **Facturé** = total des factures émises non annulées, **net d'avoirs** ; les paiements reçus sont les imputations nettes de remboursements des factures du financeur.
* `verified_at`, `activated_at`… sont posés par la base (`now()`) ; les horodatages d'écriture du rapprochement, des alertes et des retards viennent de l'horloge injectée.
* Admission en non-valeur d'une créance : non modélisée (question métier).

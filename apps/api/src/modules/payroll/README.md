# Module `payroll` — rémunération des enseignants

Spec : `specs/v2/032-payroll-port/` (spec, data-model, plan, parity). Plage de migrations **1500-1599**. Préfixe HTTP `/api/v1/payroll`.
Conventions : `docs/architecture/module-conventions.md` (normatif), `platform-assembly.md`, `new-module-guide.md`.

> **Une heure ne se paie qu'une fois — et un jour de salaire non plus.** La clé primaire de `payroll.hour_claims`
> `(tenant, origine, source, enseignant)` et celle de `payroll.salary_day_claims` `(tenant, enseignant, jour)` l'imposent,
> y compris pour des périodes qui se chevauchent et sous concurrence. Le calcul est **pur** (domaine), en **entiers XOF**
> et **minutes**, arrondi **demi-supérieur** ligne par ligne, et le total d'un bulletin est la somme de ses lignes
> **par construction** (contrôlée par `CHECK` et par un déclencheur différé au `COMMIT`).

## Ce que fait le module

| Besoin | Où |
|---|---|
| Réglages du tenant (seuil d'heures sup, majoration, séparation des tâches, seuil propriétaire) | `payroll.settings` — défauts 2 400 min / 1 500 ‰ **en base**, jamais en constante |
| Périodes collectives ou ciblées, qui peuvent se chevaucher ; une seule « en attente de calcul » | `pay_periods`, `pay_period_targets` |
| Configurations datées (salaire / horaire / mixte), sans chevauchement (`EXCLUDE`) | `pay_configs` |
| Tarifs horaires par nœud de curriculum, nominatifs ou génériques, datés (`EXCLUDE`) ; tarif résolu **à la date de la séance** | `hourly_rates`, `domain/rates.ts` |
| Collecte d'heures par **ports** (séances réalisées de `scheduling`, présences enseignants de `attendance`) | `application/ports.ts`, doublures `infrastructure/in-memory-ports.ts` |
| Prédicat de payabilité défini **à un seul endroit** | `domain/payability.ts` (+ test d'architecture) |
| Bulletin : lignes, réclamations, primes/retenues **préservées au recalcul**, snapshot immuable | `payslips`, `payslip_lines`, `hour_claims`, `salary_day_claims`, `payslip_adjustments` |
| États `CALCULATED → APPROVED → PAID` (+ `DISPUTED`, `CANCELLED`) imposés **par trigger** | `migrations/1504_payroll_guards.sql`, `domain/state.ts` |
| Annulation sans résurrection ; « tout arrêter » côté serveur ; séparation des tâches ; seuil propriétaire | `application/workflow.ts` |
| Accès au bulletin réservé à son titulaire ou à la gestion | `application/queries.ts` (`authorizeRead`) |
| Journal à auteur figé, audit, événements (outbox), export CSV audité | `payslip_events`, `audit`, `domain/events.ts` |

## Tables (schéma `payroll`, toutes `tenant_id` + RLS forcée)

`settings`, `pay_periods`, `pay_period_targets`, `pay_configs`, `hourly_rates`, `payslips`, `payslip_lines`, `hour_claims`,
`salary_day_claims`, `payslip_adjustments`, `payslip_events` (append-only), `calculation_runs`, `calculation_run_items`
+ vue `v_payslip_breakdown` (ventilation à trois postes : Σ présences + Σ séances + hors-heures = total).
Aucune table globale (`isolation-allowlist.payroll.ts` est vide, avec des `fixtures`).

## Branchement des sources (assemblage)

```ts
// dans le setup(app, runtime) de scheduling / attendance / people / academic — ordre indifférent, résolution paresseuse
import { registerPayrollPorts } from "../payroll";
registerPayrollPorts(app, { sessionHours, attendanceHours, staff, curriculum });
```

Contrat de `HoursSourcePort.collect(ctx, { from, to, staffIds? })` : renvoyer les **faits** d'heures dont la **date** est dans
la fenêtre, tous statuts confondus (la paie applique elle-même le prédicat, pour pouvoir expliquer un refus). Un fournisseur qui
ne sait renvoyer que du payable (`scheduling.listPayableHours`) marque `realized: true, validated: true`.
`lock` / `release` (facultatifs) gèlent / libèrent les heures à la source quand le bulletin est arrêté / annulé
(`scheduling.lockHours` / `releaseHoursLock`, `lockRef` = identifiant du bulletin) ; un refus de gel empêche l'arrêt.
**Échec fermé** : port absent ou en panne ⇒ calcul refusé (`payroll.port_unavailable`), jamais de résultat partiel.

| Port | Rôle | Fournisseur |
|---|---|---|
| `sessionHours` (origine `SESSION`) | séances réalisées et validées | `scheduling` (017) |
| `attendanceHours` (origine `ATTENDANCE`) | présences enseignants `COMPLETED` (durée en minutes) | `attendance` (010) |
| `staff` | identité, matricule, compte lié, **titulaire d'un compte** (`getStaffIdForUser`) | `people` (009) |
| `curriculum` | libellés (facultatif) | `academic` (004) |

## Routes

Chemins statiques déclarés avant les chemins paramétrés. Aucune route de purge, aucun `PATCH …/status`, aucune création manuelle de bulletin.

| Route | Permission |
|---|---|
| `GET/PUT /settings` | `payroll.settings.manage` |
| `GET/POST /configs`, `GET/PUT /configs/:id`, `GET /staff/:id/config/current` | `payroll.config.read` / `.manage` |
| `GET /rates/resolve` (simulateur), `GET/POST /rates`, `PUT/DELETE /rates/:id` | `payroll.rate.read` / `.manage` |
| `GET /periods/pending`, `GET/POST /periods`, `GET/PATCH /periods/:id` | `payroll.period.manage` |
| `POST /periods/:id/calculate` (`dryRun`, `recalculate`, `scope`, `staffIds`), `GET /periods/:id/runs`, `GET /runs/:id` | `payroll.run.calculate` |
| `GET /payslips` ; `POST /payslips/approve`, `POST /payslips/pay` (`{ payslipIds }` ou `{ all: true, periodId }`) | `payroll.payslip.read` ; `.approve` ; `.pay` |
| `GET /payslips/:id`, `GET /payslips/:id/data` | `payroll.payslip.read` **ou** `.read_own` (propriété vérifiée par le cas d'usage) |
| `POST /payslips/:id/cancel`, `/dispute`, `PATCH /payslips/:id/adjustments`, `POST /payslips/:id/notify` | `.cancel` ; `.approve` ; `.adjust` ; `.notify` |
| `GET /history`, `GET /history/export` | `payroll.payslip.read` |
| `GET /reports/summary`, `GET /reports/export` | `payroll.report.read` |
| `GET /my/payslips`, `GET /my/payslips/:id` (identité dérivée du compte) | `payroll.payslip.read_own` |
| `GET /owner/mass`, `POST /owner/payslips/:id/validate` | `payroll.report.read` / `.approve` + feature `payroll.owner-validation` |

Le rendu PDF passe plus tard par `reportcards`/le worker : `GET /payslips/:id/data` fournit le **snapshot** figé à l'arrêt du montant
(`final`, `watermark` « NON VERSÉ » tant que non payé, empreinte SHA-256 vérifiée).

## Événements (outbox, `{ v: 1, … }`, montants entiers, identifiants seulement)

Publiés : `payroll.period.created|closed|archived`, `payroll.run.completed`, `payroll.payslip.calculated|approved|paid|disputed|cancelled|adjusted|notification_requested`
(`approved`/`paid` portent `recipientUserId` pour la notification du titulaire, 016), `payroll.claim.source_changed` (alerte : une séance
réclamée a changé à la source — le bulletin arrêté n'est jamais réécrit).
Consommés (charges alignées sur leurs producteurs, test de contrat `apps/api/test/events-contracts/payroll.test.ts`) : `tenancy.tenant.provisioned`, `scheduling.occurrence.cancelled|unvalidated|rescheduled|paid_minutes_changed`, `academic.year.closed`.
Job : `payroll.fail-stale-runs` (abandonne les calculs interrompus). **Reconstruire le worker** après modification (`pnpm --filter @ecoledigitale/worker build`).

## Écarts assumés avec la spec 032 (corrigés dans `specs/v2/032-payroll-port/`)

1. **`session_validations` supprimée** : la validation et la dérogation de durée des séances sont des actes de `scheduling` (017 : `validateOccurrence`, `setPaidMinutes`, verrous de paie). La paie les lit par le port ; ses permissions `payroll.session.*` ne sont pas déclarées.
2. **`settings.hour_source_by_pack` supprimée** : les origines d'heures actives viennent des features `payroll.session-source` (HIGHER, VIRTUAL) / `payroll.attendance-source` (PRIMARY, SECONDARY) — Q-36.
3. **`salary_day_claims` ajoutée** : corrige le défaut « deux périodes qui se chevauchent versent deux salaires » (le legacy n'avait aucune réclamation pour le salaire). La seconde période ne verse que les jours ouvrés restants ; motif d'écart `NOTHING_TO_PAY`.
4. `payslips.salary_amount` et `calculated_by_name` ajoutés ; multiplicateur de ligne `>= 1000` (×1,0 permis) ; `pay_period_targets` clé `(tenant, période, enseignant)` ; motifs `NOTHING_TO_PAY` et `ALREADY_CALCULATED` ajoutés.
5. **Ordre des heures d'une même semaine** : `(date, origine ATTENDANCE avant SESSION, heure de début [nulle en dernier], identifiant)` — l'ordre de fait du legacy (académique collecté avant professionnel), conservé pour que les montants du legacy soient reproduits ; le legacy ne triait que par date.
6. Période d'**un seul jour** acceptée (DDL : `end_date >= start_date`) ; le legacy la refusait.
7. Un enseignant ne lit son bulletin qu'**une fois le montant arrêté** (APPROVED, DISPUTED, PAID) ; un brouillon calculé est réservé à la gestion.

## Tests

`pnpm --filter @ecoledigitale/api exec vitest run --config src/modules/payroll/vitest.config.ts` (unitaires) ; avec Postgres éphémère :
`ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/payroll/vitest.config.ts`.
Unitaires : calcul (golden + 5 propriétés × 60 graines), calendrier, payabilité, tarifs, états, architecture, contrat de module.
Intégration : contraintes SQL, calcul, cycle de vie, concurrence, isolation A/B, HTTP + matrice d'accès, performance (T17), **parité chiffrée**
avec `tests/characterization` (`paie-enseignants`) — voir `specs/v2/032-payroll-port/parity.md` §9.

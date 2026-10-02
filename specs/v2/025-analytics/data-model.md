# Modèle de données — 025-analytics

Schéma Postgres `analytics`, migrations `apps/api/src/modules/analytics/migrations/1600_analytics_init.sql` et `1601_analytics_alerts_indicators.sql` (plage 1600-1699). **Le fichier SQL est le DDL de référence** ; il est appliqué et vérifié par `test/refresh.integration.test.ts` (migrations complètes, 28 tables, `assertTenantIsolation` : `tenant_id` + RLS forcée, comportement A/B) et par les tests d'assemblage `apps/api/test/adapters/analytics.integration.test.ts` (base migrée par **toutes** les migrations v2).

## Principes

1. **Aucune donnée source** : chaque table est un **instantané dérivé**, reconstructible à l'identique depuis les modules sources ; elle porte `refreshed_at` / `computed_at` (l'instant de la passe).
2. **Références** vers les autres modules : UUID **sans clé étrangère** ; seule `kernel.tenants(id)` est référencée. Pas de FK entre tables d'`analytics` non plus (un fait peut précéder sa dimension : un fait n'est jamais rejeté faute de libellé).
3. **Montants** : `bigint` en unités mineures + `currency` (3 lettres) ; **décimaux exacts** des résultats : `numeric` (jamais `float`) ; dates `date`, instants `timestamptz` UTC.
4. **Remplacement par périmètre** : écrire = `DELETE` du périmètre puis `INSERT` dans la même transaction (idempotent ; une ligne disparue de la source disparaît).
5. Toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, `SELECT kernel.enable_tenant_rls(...)`, `GRANT SELECT, INSERT, UPDATE, DELETE ... TO app_user`. **Aucune table globale** (`isolation-allowlist.analytics.ts` vide).

## Tables

### File et fraîcheur

| Table | Clé | Contenu |
|---|---|---|
| `refresh_requests` | `id` ; index unique partiel `(tenant_id, kind, scope_key) WHERE status = 'PENDING'` | demande coalescée : `kind`, `scope_key`, `causes jsonb` (20 dernières), `not_before`, `status` (`PENDING`, `RUNNING`, `DONE`, `FAILED`, `UNAVAILABLE`), `attempts`, `last_error` |
| `refresh_state` | `(tenant_id, kind, scope_key)` | `last_success_at` (= `asOf`), `last_attempt_at`, `last_status` (`OK`, `FAILED`, `UNAVAILABLE`), `rows_written`, `duration_ms`, `content_hash` |
| `settings` | `tenant_id` | seuils d'affichage (`collection_good/warning_bps`, `attendance_good/warning_bps`) et `stale_after_seconds` ; absence de ligne = défauts du domaine |

Genres (`kind`) : `REBUILD`, `CALENDAR`, `ENROLLMENT`, `RESULTS`, `ATTENDANCE`, `STAFF_PRESENCE`, `FINANCE`, `COLLECTIONS`, `CASH`, `PAYROLL`, `TEACHING_LOAD`. Périmètre (`scope_key`) : `*`, un identifiant d'année, `classe|période` (classe `*` = toutes), ou `AAAA-MM-JJ..AAAA-MM-JJ` (borné à 400 jours).

### Dimensions

| Table | Clé | Source |
|---|---|---|
| `dim_scope` | `(tenant_id, scope_kind, scope_id)` — `INSTITUTION` / `CAMPUS` | `tenancy` |
| `dim_year` | `(tenant_id, year_id)` : code, libellé, bornes, statut, `is_current` | `academic` |
| `dim_period` | `(tenant_id, period_id)` : année, code, libellé, rang, bornes, statut | `academic` |
| `dim_classroom` | `(tenant_id, classroom_id)` : établissement, campus, année, nom, niveau (code, libellé), cycle d'enseignement, programme, effectif | `academic` |

### Faits

| Table | Clé | Grain et colonnes utiles |
|---|---|---|
| `enrollment_facts` | `(tenant_id, enrollment_id)` | une inscription : établissement, campus, année, classe, `status`, `funding_type`, `sex` (M/F/null), `is_repeating`, **`in_schooling`** (classification d'`academic`), `source_kind`, dates de création / confirmation / annulation |
| `result_facts` | `(tenant_id, enrollment_id, period_id)` | un résultat **FINAL** : `average`, `rank`, `cohort_size`, `mention_code`, `decision_code/outcome` (décision de période confirmée sinon celle de la règle), `year_decision_code/outcome`, `validated`, crédits, `results_version` |
| `result_line_facts` | `(tenant_id, enrollment_id, period_id, node_id)` | une ligne FINAL (matière, ECUE, UE) : `level`, `node_code`, `node_label`, `value`, `validated`, `session_obtained`, `resit_eligible` |
| `result_scopes` | `(tenant_id, classroom_id, period_id)` | état connu de la (classe, période) : `FINAL` / `NOT_FINAL` et nombre de résultats |
| `attendance_daily` | `(tenant_id, day, classroom_id)` | pointages des séances **soumises ou validées** du jour : séances, pointages, présents, absents, justifiés, retards, minutes d'absence |
| `staff_presence_facts` | `(tenant_id, day, staff_id)` | présent / absent / en congé approuvé |
| `finance_summary` | `(tenant_id, year_key, campus_key, currency)` | facturé, avoirs, net, encaissé, restant dû, en retard, non imputé, taux (bps), date de référence |
| `finance_by_group` | `(…, group_key, currency)` | créances par **classe** (`group_key` = identifiant de classe, instantané des factures) |
| `finance_by_learner` | `(…, learner_id, currency)` | créances par apprenant (nom d'affichage, classe, plus ancienne échéance en retard) |
| `finance_aged` / `finance_aged_learner` | `(…, bucket)` / `(…, learner_id)` | balance âgée (5 tranches) et 200 principaux débiteurs |
| `collections_daily` | `(tenant_id, day, currency)` | encaissé, remboursé, net, nombre de paiements du jour |
| `cash_session_facts` | `(tenant_id, session_id)` | session de caisse : fonds, attendu, compté, écart |
| `payroll_status_facts` | `(tenant_id, period_id, status)` | bulletins et total par période de paie et statut |
| `teaching_load_facts` | `(tenant_id, staff_id, year_id)` | heures prévues, classes, volume contractuel hebdomadaire |

`year_key` = **code** de l'année (clé des factures de finance) ou `*` ; `campus_key` = identifiant de campus ou `*`.

## Alimentation : événement → demande → lecture de la source

Un abonné ne calcule rien : il traduit l'événement en demande (`domain/refresh-plan.ts`, testé) ; le job `analytics.process-refreshes` exécute les demandes échues en lisant la source par son **port** (`application/ports.ts`), puis remplace le périmètre.

| Événement(s) consommé(s) | Demande (genre, périmètre) | Port sollicité → API publique |
|---|---|---|
| `academic.year.*`, `period.*`, `classroom.*`, `classroom_period.*` | `CALENDAR` `*` (+ `TEACHING_LOAD` à l'ouverture/clôture d'année) | `calendar` → `academic.listAcademicYears/Periods/Classrooms`, `getClassroomFacts` ; `scopes` → `tenancy.listInstitutions/Campuses` |
| `academic.enrollment.*` (+ `people.student.status_changed`, `anonymized`, `updated` si le sexe change) | `ENROLLMENT` année du payload, sinon `*` | `enrollments` → `academic.listEnrollments`, `opensSchooling` ; `people.getStudentsByIds` (sexe) |
| `results.period.closed` / `reopened` | `RESULTS` `classe\|période` | `results` → `getClassMatrix`, `getFinalResult` (FINAL officiel), `academic.getResultsStructure` (libellés) |
| `results.decision.confirmed` | `RESULTS` `*\|période` (toutes les classes) | idem |
| `attendance.session.{submitted,validated,reopened,cancelled}`, `absence.recorded`, `late.recorded` | `ATTENDANCE` jour du payload | `attendance` → `listAttendanceSessions`, `getAttendanceSession`, `listStatusDefinitions` |
| `attendance.staff_absence.recorded`, `staff_leave.{approved,cancelled}` | `STAFF_PRESENCE` jour / intervalle (≤ 400 j) | `staffPresence` → `listStaffRecords`, `listStaffLeaves`, `listStatusDefinitions` |
| `finance.invoice.{issued,paid,overdue,cancelled}`, `credit_note.issued`, `payment.{completed,allocated}`, `refund.completed` | `FINANCE` `*` (+ `COLLECTIONS` mois de `confirmedAt`) | `finance` → `getFinanceSummary`, `getReceivablesByGroup/ByLearner`, `getAgedBalance`, `getCollectionsTrend` |
| `finance.cash_session.{opened,closed}` | `CASH` `*` | `finance.listSessionPage` |
| `payroll.period.*`, `run.completed`, `payslip.*` | `PAYROLL` `*` | `payroll.ownerMass` |
| `people.teaching_assignment.*` | `TEACHING_LOAD` `*` | `people.listStaff`, `getTeachingLoad` |

Ne déclenchent **rien** : `results.period_result.computed` (un brouillon n'est jamais un FINAL), `finance.payment.initiated` (non encaissé), `attendance.staff_leave.requested` (une demande n'est pas un congé).

## Reconstruction et idempotence

- `rebuildTenant` : `CALENDAR` → `ENROLLMENT` → `RESULTS` (toutes les classes de chaque période connue) → `ATTENDANCE` et `STAFF_PRESENCE` (de l'ouverture de la plus ancienne année, au plus 400 jours, à aujourd'hui) → `FINANCE` → `COLLECTIONS` → `CASH` → `PAYROLL` → `TEACHING_LOAD`. Réécrit toujours (`force`).
- **Empreinte de contenu** (`refresh_state.content_hash`, SHA-256 du JSON canonique des faits lus) : une passe qui retrouve la même empreinte n'écrit rien et ne publie rien mais avance `last_success_at`. Tests : deux reconstructions successives donnent **exactement** les mêmes lignes (`to_jsonb` hors horodatages), sans nouvel événement.
- Une lecture impossible laisse les faits précédents **et leur ancien `asOf`** (`FAILED` / `UNAVAILABLE` dans `refresh_state`, `gaps` dans la réponse).

## Isolation des lectures

Les agrégats ne filtrent pas par `tenant_id` (la RLS s'en charge). Le périmètre de l'utilisateur (`ctx.institutionId`, `ctx.campusId`) borne `institution_id` / `campus_id` des faits et la clé de campus de la finance ; une demande hors périmètre est refusée (`403 analytics.scope_forbidden`).

## Événements publiés

`analytics.snapshot.refreshed` `{ v: 1, kind, scopeKey, asOf, rows, changed }` (seulement si le contenu a changé), `analytics.rebuild.requested` `{ v: 1, requestedBy, reason, kinds }`, `analytics.rebuild.completed` (réservé).

---

# Partie B (migration 1601) : indicateurs transverses et alertes

Même principes (instantanés dérivés, UUID sans clé étrangère hors `kernel.tenants`, RLS forcée, `GRANT app_user`). Nouveaux genres de rafraîchissement : `ADMISSIONS`, `SCHOOLLIFE` (contrainte `refresh_requests_kind_check` étendue).

| Table | Clé | Contenu |
|---|---|---|
| `result_scopes.rules_source_kind` (colonne ajoutée) | — | provenance des règles épinglées : `regulation`, `institution`, `platform`, `placeholder` (démonstration) ou `NULL` (illisible) |
| `admissions_campaign_facts` | `(tenant_id, campaign_id)` | campagne : établissement, année, code, libellé, état, places et places restantes |
| `admissions_stage_facts` | `(tenant_id, campaign_id, stage_code)` | étape : libellé, statut canonique, rang, terminale, **nombre** de dossiers — aucun candidat |
| `schoollife_facts` | `(tenant_id, institution_key, indicator)` | 4 comptages (`OPEN_INCIDENTS`, `MEASURES_TO_VALIDATE`, `ACTIVE_EXCLUSIONS`, `CONVOCATIONS_TO_HOLD`) ; `institution_key` = identifiant ou `*` |
| `alert_rules` | `(tenant_id, id)` | règle : libellé, `metric`, seuils (`warning_value`, `critical_value`, au moins un), fenêtre, périmètre, `recipient_roles text[]` (1 à 8), `frequency`, `enabled`, `row_version`, dernière évaluation (instant, issue, valeur) |
| `alert_events` | `(tenant_id, id)` ; index unique partiel `(tenant_id, rule_id) WHERE status IN ('OPEN','ACKNOWLEDGED')` | alerte (épisode) : gravité, état (`OPEN`, `ACKNOWLEDGED`, `RESOLVED`), valeur, seuil franchi, devise, périmètre, année / période, `raised_at`, `last_seen_at`, `as_of`, notifications émises, accusé de réception (qui, quand, note), résolution |
| `alert_notifications` | `(tenant_id, id)` ; **`UNIQUE (tenant_id, dedupe_key)`** | notification émise (historique + anti-doublon) : motif (`RAISED`, `ESCALATED`, `REMINDER`), gravité, valeur, rôles, instant ; `dedupe_key = règle:gravité:créneau` |

Alimentation : `admissions.*` -> `ADMISSIONS` (`admissions.listCampaigns`, `getBoard` : colonnes et totaux seulement) ; `schoollife.*` -> `SCHOOLLIFE` (`schoollife.getAggregateCounts`) ; la provenance des règles est lue avec chaque (classe, période) FINAL (`results.getPeriodView`).

Cycle d'évaluation d'une règle (transaction unique, `FOR UPDATE` sur la règle) : fraîcheur et manques des genres lus (sinon `SOURCE_UNAVAILABLE`) -> valeur (sinon `NOT_MEASURED`) -> gravité (`severityOf`) -> alerte active ? création / mise à jour / résolution -> insertion de la notification (clé unique) -> événement `analytics.alert.raised` seulement si l'insertion a réussi.

Événements publiés en plus : `analytics.alert.raised` `{ v: 1, alertId, ruleId, metric, metricLabel, severity, reason, unit, comparator, value, threshold, currency, recipientRoles, dedupeKey, institutionId, campusId }`, `analytics.alert.acknowledged` `{ v: 1, alertId, ruleId, acknowledgedBy }`, `analytics.alert.resolved` `{ v: 1, alertId, ruleId, metric, resolvedValue }`.

# Module `attendance` — présences (spec v2/010)

UN SEUL modèle d'appel (statuts `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, `EARLY_LEAVE`) remplace les quatre systèmes du legacy : appel par séance (occurrence fournie par `scheduling`) ou journalier par classe (primaire), justificatifs structurés, récapitulatifs par période DÉRIVÉS avec surcharge tracée, présence et congés du personnel, synchronisation hors-ligne idempotente, alertes d'assiduité configurables.

Schéma Postgres `attendance` · migrations `0900-0905` (plage 0900-0949) · préfixe HTTP `/api/v1/attendance` · `dependsOn: ["rbac"]`.

## Règles qui structurent le module

- **Aucun seuil, aucune équivalence** (« 3 retards = 1 absence ») : des comptages bruts et des événements. Les règles d'alerte sont des PARAMÈTRES d'établissement (`settings.alert_rules`, alimentés par le modèle de pack ou un RuleSet via `AlertPolicyPort`) ; vide par défaut. Un test scanne le code pour s'en assurer.
- **Références sans FK** (élèves, classes, inscriptions, séances, périodes, personnel) vérifiées par des PORTS (`application/ports.ts`) : `EnrollmentRosterPort`, `OccurrencePort`, `PeriodPort`, `PeoplePort`, `StoragePort`, `AlertPolicyPort`. Sans port branché : échec FERMÉ (`attendance.port_unavailable`). Implémentations en mémoire : `infrastructure/in-memory-ports.ts` (`inMemoryPorts()`), utilisables par les modules consommateurs. `academic`, `people`, `scheduling` s'enregistrent par `registerAttendancePorts(app, ports)` (dans leur `setup(app, runtime)`, ordre indifférent).
- **Statuts = données** (`status_definitions`, par tenant) ; les drapeaux pilotent tous les comptages. Sémantique des statuts système verrouillée.
- **Récapitulatif** : `absent*` = total (justifiées comprises), `excused*` = sous-ensemble. Recalcul SYNCHRONE dans la transaction qui change les pointages, idempotent ; consommateurs et job `attendance.recompute-summaries` = filet de sécurité. `computeSummary` (domaine) est le miroir de `attendance.summarize_enrollment` (SQL), vérifié par test.
- **Verrous en base** : appel validé/annulé figé, transitions légales, historique automatique (`record_history`, ordre par `seq`), suppressions interdites. Exceptions strictes : `attendance.reopen` (réouverture sensible) et `attendance.excuse_apply` (ABSENT ⇄ EXCUSED seulement).
- **Audit** (`AuditPort` → `runtime.auditPort`, même transaction) : réouverture, annulation d'un appel soumis/validé, décisions de justificatif, lecture de pièce, surcharge, congés, export CSV, paramétrage, arbitrage de conflit.
- **Un `GET` n'écrit jamais** (sauf l'audit de la lecture d'une pièce).

## Saisie rapide et hors-ligne

- `PUT /sessions/:id/records` : lot jusqu'à 500 pointages, idempotent (rejeu = « unchanged »), dernier arrivé gagne. 60 élèves ≈ 4,6 Ko, p95 ≈ 70 ms.
- `POST /sessions/:id/submit {allPresent:true}` : « tous présents sauf ».
- `POST /sync` (feature `attendance.offline`) : séances et pointages portent un `clientId` (UUID de l'appareil) → registre `sync_ops` ; rejeu = résultat d'origine (`REPLAYED`) ; même `clientId` avec un autre contenu = `attendance.idempotency_key_reused`. L'instant appareil (`clientMarkedAt`, corrigé de `clockOffsetMs`, plafonné à la réception) ne sert qu'à ordonner deux saisies concurrentes ; le serveur fait foi. Saisie sur appel validé/annulé, hors fenêtre de correction, ou plus ANCIENNE que le pointage d'un autre auteur → file de conflits (`GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve`), jamais écrite en silence.

## API publique (`index.ts`)

Cas d'usage `(deps, ctx, input) => Promise<Result>` : `openAttendanceSession`, `getAttendanceSession`, `listAttendanceSessions`, `markStudentRecords`, `markWithJustification`, `submitAttendanceSession`, `validateAttendanceSession`, `reopenAttendanceSession`, `cancelAttendanceSession`, `getRecordHistory`, `syncOfflineAttendance`, `bulkMarkFromExternal`, justificatifs (`submit/accept/reject/withdraw/revoke`, pièces), `getAttendanceSummary`, `getClassroomAttendanceSummary`, `setSummaryOverride`, `removeSummaryOverride`, `recomputeSummaries`, `listAbsences`, `exportAbsencesCsv`, `getCallCompliance`, `getAttendanceCertificateData`, personnel (`markStaffAttendance`, `checkInStaff`, `checkOutStaff`, congés, `getStaffAttendanceSummary`), paramétrage (`upsert*`, `instantiateAttendancePack`).

## Événements publiés (`{ v: 1, … }`, sans donnée sensible ; schémas dans `packages/contracts/src/v2/attendance.ts`)

`attendance.session.opened|submitted|validated|reopened|cancelled` · `attendance.absence.recorded` · `attendance.late.recorded` (à la soumission, republiés avec `correction: true`) · `attendance.justification.submitted|accepted|rejected|revoked` · `attendance.staff_leave.requested|approved|rejected|cancelled` · `attendance.staff_absence.recorded` · `attendance.summary.recomputed` · `attendance.alert.triggered|cleared` · `attendance.sync.conflict_recorded`.

Consommés (`subscribers.ts` ; charges alignées sur leurs producteurs, test de contrat `apps/api/test/events-contracts/attendance.test.ts`) : `scheduling.occurrence.cancelled`, `academic.enrollment.withdrawn|cancelled|transferred`, `academic.period.closed|reopened`, `tenancy.tenant.provisioned`. Job : `attendance.recompute-summaries` (02:50).

## Permissions (voir `manifest.ts`)

Spec §10 + `attendance.child.justify`, `attendance.self.justify`, `attendance.own.record` (le rôle système « parent » n'a que `*.child.*`). Sensibles : `attendance.session.reopen`, `attendance.summary.override`, `attendance.leave.decide`. Les routes à plusieurs profils (parent, élève, personnel habilité) utilisent « au moins une permission » ; la RELATION (tuteur lié, intervenant, déposant) est vérifiée par le cas d'usage.

## Tests

```bash
# unitaires (sans base)
pnpm exec vitest run --config apps/api/src/modules/attendance/vitest.config.ts test/unit
# + intégration sur Postgres éphémère (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/attendance/vitest.config.ts
pnpm exec tsc -p apps/api/src/modules/attendance/tsconfig.json
```

Données de pack : `domain/reference-pack.ts` (statuts, motifs, types de congé, politiques d'appel par cycle, pièces acceptées) — politiques d'établissement modifiables, aucun seuil.

## Assemblage

- `listCompletedStaffPresence` : présences du personnel terminées (heures de la paie d'origine ATTENDANCE) ;
- les ports de `academic` sont appelés **en séquence** dans `loadSessionContext` : chacun ouvre un SAVEPOINT sur la connexion partagée de la transaction, des appels entrelacés (`Promise.all`) libèrent des points de sauvegarde inexistants. Ne pas les paralléliser.
- ports branchés par `platform/adapters` : `academic-attendance`, `scheduling-attendance`, `people-attendance`, `storage`.

## Extensions Phase 4-5 (2026-10-02) — pack Primary (appel journalier)

Additives (spec 010 §17).

- **Modèle de pack PRIMARY** : `templates/CI/primary.json` (version 2) déclare `PRESCHOOL_DAILY` (appel journalier unique de la maternelle) et `PRIMARY_HALF_DAYS` (primaire : appel du matin ET de l'après-midi, voir plus bas) — `scope: DAILY`, `dailyMinutes: null` : aucune conversion en minutes, les récapitulatifs ne comptent que des jours ; il hérite des statuts, motifs et paramètres de la base. `getAttendancePackTemplate(educationSystem, pack)`, `onTenantProvisioned` instancie le modèle de chaque pack provisionné. `validatePackTemplate` accepte la forme déclarative (`scope` + `educationLevels`) et la forme historique. Aucune valeur réglementaire.
- **Absences en journées et jours ouverts** (règle `cas_absences` de la spec 005) : `getAttendanceDays` / `getAttendanceDaysForEnrollments` renvoient `absentDays`, `excusedAbsentDays`, `unexcusedAbsentDays`, `lateDays`, `openDays` et `ruleInputs: { absences_journees, jours_ouverts }`. Seuls les appels `DAILY` soumis ou validés comptent ; sans calendrier, `jours_ouverts` = jours d'appel tenus ; le calendrier d'établissement se fournit par `openDays`. Aucun seuil.

## Appel du primaire par demi-journée (décision Q-P17, 2026-10-05) — migration 0905

Le primaire fait l'appel le **matin ET l'après-midi** dès la V1. Évolution additive (rien n'est supprimé, aucune donnée n'est réécrite) :

- **Politique d'appel** : `call_policies.daily_call_mode` = `SINGLE` (un appel par jour, défaut historique) ou `HALF_DAYS` (deux appels par jour). Modifiable par l'établissement (`PUT /reference/call-policies`, audité) ; réservé à l'appel journalier (`DAILY` ou `BOTH`). Le modèle de pack PRIMARY pose `HALF_DAYS` pour le niveau `PRIMARY` ; la maternelle (`PRESCHOOL`) et le secondaire sont inchangés. Les établissements existants gardent leur politique (le modèle ne s'applique qu'à l'instanciation du pack).
- **Séances** : `sessions.day_part` = `FULL` (appel unique de la journée, valeur de toutes les séances existantes), `MORNING` ou `AFTERNOON`. En `HALF_DAYS`, la demi-journée est **obligatoire** à l'ouverture (`attendance.day_part_required`, jamais devinée d'après l'heure) et `FULL` est refusé (`attendance.day_part_not_allowed`) ; en `SINGLE`, le matin / l'après-midi est refusé. Un appel par séance planifiée est toujours `FULL`. Un seul appel par classe, par jour et par demi-journée (`sessions_one_daily`) ; un appel `FULL` exclut le matin et l'après-midi du même jour (`sessions_daily_parts_exclusive`, `attendance.day_part_taken`). La demi-journée est figée comme la classe, la date et la portée.
- **Récapitulatifs** : `summarize_enrollment` compte un pointage par appel, donc une demi-journée compte pour un appel. Minutes d'une absence : la moitié de `daily_minutes` pour une demi-journée (rien sans `daily_minutes`).
- **Journées** (`getAttendanceDays`) : l'unité est la demi-journée, rendue en journées (multiples de 0,5 ; entiers pour l'appel unique, donc `ruleInputs` historiques inchangés). Une journée appelée le matin seulement vaut 0,5 jour ouvert.
- **Hors-ligne** : la cible d'une séance `DAILY` porte `dayPart` ; la clé d'idempotence (`clientId` de la séance) est propre à chaque demi-journée — la même clé pour l'autre demi-journée donne `attendance.idempotency_key_reused`, sans demi-journée en `HALF_DAYS` : `attendance.day_part_required` (rien n'est écrit en silence). Côté web, la file locale distingue `day:<classe>:<date>:MORNING|AFTERNOON`.
- **Événement** `attendance.session.opened` : charge additive `dayPart`.
- Contrats : `dayPart` (séance, ouverture, cible de synchronisation), `dailyCallMode` (politique) dans `packages/contracts/src/v2/attendance.ts`.
- Hors périmètre : le contrôle de conformité (`getCallCompliance`) ne porte que sur les séances planifiées, pas sur les appels journaliers ; un calendrier d'établissement des demi-journées ouvertes n'est pas modélisé (`openDays` fourni par l'appelant reste possible).

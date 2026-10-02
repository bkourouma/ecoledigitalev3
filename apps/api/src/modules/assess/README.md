# Module `assess` — évaluations et notes (spec v2/011)

Types d'évaluation configurables par tenant, évaluations, saisie en lot idempotente (smartphone), circuit de validation
`DRAFT → SUBMITTED → REVIEWED → APPROVED → PUBLISHED`, **immuabilité après publication** (application ET déclencheurs SQL),
révisions de notes (`GradeRevision`), verrous de période distinguant les sessions, absences et dispenses.

**Aucune formule, aucun seuil.** Moyennes, rangs, mentions : module `results` via `rules`. `assess` ne dépend ni de
`results` ni de `rules` (décision A-21). Références au cœur (classe, inscription, nœud, période, élève, personnel) :
UUID sans clé étrangère, vérifiés par des **ports**.

## Tables (schéma `assess`, migrations 1100-1105)

`assessment_types`, `settings`, `assessments`, `assessment_transitions` (historique append-only), `grades`,
`grade_revisions`, `period_locks`, `batch_receipts` (idempotence des lots). Toutes portent `tenant_id` + RLS forcée ;
allowlist d'isolation vide (`modules/isolation-allowlist.assess.ts`).

Écarts avec `data-model.md` : `assessment_transitions` (trace acteur/date/commentaire de chaque transition, AC2.4),
`batch_receipts` (clé `Idempotency-Key`, AC1.3), `grade_revisions.student_id` (nécessaire à une ADDITION). `grades.status`
reste le miroir de l'évaluation, tenu par déclencheur.

## Garde-fous SQL (`1105_assess_guards.sql`)

Valables pour tout rôle, **superuser compris** (test d'intégration) : transitions légales, contenu figé dès la soumission,
séparation des tâches (réglage `assess.settings` relu), `0 ≤ score ≤ barème`, précision, `UPDATE`/`DELETE` d'une note
publiée refusés, voie unique `assess.apply_revision(uuid, timestamptz)` (révision APPROUVÉE correspondante relue en base :
un réglage de transaction forgé ne suffit pas), ancienne valeur d'une révision relue en base, verrou de période par session
(`locked_sessions` ne peut que diminuer), annulation d'une évaluation publiée = lot de `REMOVAL` approuvé.

## Ports (`application/ports.ts`)

`RosterPort`, `PeriodPort`, `CurriculumPort`, `TeachingAssignmentPort`, `GuardianshipPort`, `ActorNamePort`. Enregistrés par
`registerAssessPorts(app, ports)` (decorateur racine `app.assessPorts`). Non branchés : indisponibles (échec fermé).
Implémentations en mémoire : `inMemoryAssessPorts()`.

## API publique (`index.ts`)

Pour `results` / `higher` : `listPublishedGrades`, `lockPeriodGrades`, `unlockPeriodGrades`, `releaseSessionLock`
(la session 2 seulement), `listPendingAssessments`, `getPeriodLock` — acceptent la transaction `tx` de l'appelant.

## Routes (`/api/v1/assess`)

`/assessment-types`, `/settings`, `/assessments[/bulk|/:id|/:id/grades|/:id/transitions|/:id/cancel|/:id/additions]`,
`/grades/:id/revisions|history`, `/revisions[/:id|/approve|/reject|/apply]`, `/classrooms/:c/periods/:p/lock`,
`/me/grades`, `/children/:studentId/grades`. Permissions : voir `manifest.ts` (`grade.validate`, `grade.publish`,
`grade.revise.approve`, `assessment.type.manage` sensibles).

## Événements (outbox, `{ v: 1 }`, aucune note)

`assess.assessment.created|submitted|reviewed|approved|returned|cancelled`, **`assess.grade.published`** (un par évaluation,
liste des inscriptions), `assess.grade.revised`, `assess.revision.requested|rejected`, `assess.period.locked|unlocked`.
Consommé : `tenancy.tenant.provisioned` (types du pack). Job : `assess.purge-batch-receipts`.

## Décisions et points d'attention

- Permissions `assessment.create|update|manage` : les modèles de rôles de `rbac` accordent `assessment.create|update` aux
  enseignants ; `assessment.manage` (autre enseignant, toute classe) reste à la direction.
- Le responsable pédagogique a `grade.validate` mais pas `grade.publish` ni `grade.revise.approve` (modèle `rbac` inchangé).
- `ensureTeacherAccess` : un enseignant n'agit que sur ses évaluations ET tant qu'il reste affecté (`assess.not_assigned`).
- Une ligne existante dont la valeur diffère exige la `rowVersion` lue ; le lot est « tout ou rien ».
- Approuver une révision l'applique aussitôt, sauf période verrouillée pour la session : elle reste APPROUVÉE et
  s'applique à la libération du verrou (`applyApprovedRevisionsInTx`).
- La session 2 exige type `allows_session2`, nœud `resit_allowed` et la feature `assess.session2`.

## Assemblage

`isCurriculumNodeInUse` : un nœud de curriculum portant une évaluation est « utilisé » (garde d'amendement structurel d'`academic`, branchée par `platform/adapters/academic-guards.ts`). Ports `roster`, `periods`, `curriculum` (rattrapage autorisé = **donnée** du nœud), `teaching`, `guardianship`, `names` : `platform/adapters`.

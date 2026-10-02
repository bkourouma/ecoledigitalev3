# Module `schoollife` — vie scolaire (spec v2/006, §5.2 et US8-US9, US12)

Retards et absences (VUE sur `attendance`, jamais dupliqués), incidents, sanctions, avertissements, encouragements, exclusions temporaires, convocations des tuteurs, observations, recours, points de conduite PARAMÉTRÉS. Schéma Postgres `schoollife` · migrations `2200-2203` (plage 2200-2299) · préfixe HTTP `/api/v1/schoollife` · pack `SECONDARY` · `dependsOn: []` (les autres modules arrivent par des PORTS).

## Les règles qui structurent le module

- **Le TYPE (donnée) porte le circuit** : `event_types` fixe par type la validation, la séparation des tâches (quatre yeux), la permission d'approbation, la notification des tuteurs, le partage aux familles, la confidentialité plancher, le recours, les dates. Seule la FAMILLE (`INCIDENT`, `SANCTION`, `WARNING`, `ENCOURAGEMENT`, `TEMP_EXCLUSION`, `OBSERVATION`) est une énumération (elle pilote les tables). **Aucune règle réglementaire, aucun catalogue de fautes, aucune gravité, aucun barème n'est livré** : tout est donnée d'établissement, vide par défaut (un test scanne le code et les migrations).
- **L'HUMAIN décide, IMPOSÉ EN BASE** : toute décision, validation, mesure, saisie exige `app.actor = 'user'` ET un utilisateur (`schoollife.require_human_actor`) ; un job, une règle, le système ou un super-administrateur est refusé par un déclencheur (`schoollife.human_actor_required`). La personne enregistrée (déclarant, proposant, validateur, notifieur, auteur, convocateur, lecteur) est TOUJOURS l'utilisateur de la session, recopié par la base : aucun champ de la requête ne peut s'y substituer (contrats stricts).
- **Quatre yeux** : si le type l'exige, le validateur n'est pas le proposant (`schoollife.four_eyes_required`). Le type peut aussi exiger une permission d'approbation propre (`approver_permission`), vérifiée via le RBAC.
- **Exclusion temporaire** : validation obligatoire, dates obligatoires, aucun chevauchement avec une autre exclusion vivante du même élève (contrainte d'exclusion). Ses EFFETS sur le statut de l'élève naissent `AWAITING_HUMAN` (`measure_effects`, créés par la base à la validation) : le module ne suspend jamais seul ; un utilisateur habilité (`schoollife.exclusion.apply`, sensible) applique (`people.changeStudentStatus`), écarte ou lève l'effet ; `applied_by` est posé par la base.
- **Confidentialité à trois niveaux** (`STANDARD` < `RESTRICTED` < `CONFIDENTIAL`, jamais abaissée) appliquée par **UNE règle SQL unique, `schoollife.audience_may_see`** : familles (`GUARDIAN`, `STUDENT`) et habilitation du personnel (`STAFF_STANDARD|RESTRICTED|CONFIDENTIAL`, dérivée de `schoollife.restricted.read` et `schoollife.confidential.read`). Chaque lecture (dossier, listes, portails, tableau de bord, comptages) filtre par elle ; `domain/confidentiality.ts` n'en est que le miroir (parité testée sur >10 000 combinaisons). Une donnée absente (NULL) vaut refus. Hors habilitation ou hors périmètre : l'élément n'existe pas (404), jamais de 403 qui trahirait son existence.
- **Lecture confidentielle journalisée** : un élément `CONFIDENTIAL` est MASQUÉ partout (`masked: true`, type, motif, description à `null`) ; son contenu ne sort que par `POST /confidential-reads` (permission sensible `schoollife.confidential.read`, motif exigé selon le réglage de l'établissement, lecture inscrite en ajout seul AVANT le contenu, événement sans contenu, audit). Journal consultable par `schoollife.confidential.audit`.
- **Historisation obligatoire, en ajout seul** : aucune suppression ; correction = transition motivée ou nouvelle ligne ; `life_events` alimenté par déclencheurs à chaque création et changement de statut ; `confidential_reads`, `conduct_movements` en ajout seul (aucun `UPDATE`/`DELETE` accordé).
- **Points de conduite** : `conduct_points_enabled` faux par défaut ; un barème (brouillon -> actif -> figé -> retiré, un seul actif par établissement, niveau et période d'effet) est un PARAMÈTRE ; le solde est DÉRIVÉ (`schoollife.conduct_balance`, miroir pur `domain/conduct.ts`) ; chaque mouvement égale la valeur du barème pour le type de l'événement (mouvement écrit à la validation d'une mesure ou à la création d'un encouragement par l'utilisateur de la session, mouvement inverse exact à la révocation / au retrait). **Aucune note de bulletin n'est calculée ici** : le solde est une aide (`getConductPoints`), la note reste une saisie humaine dans `assess`. Un barème `placeholder` est signalé comme tel.
- **Un `GET` n'écrit jamais** (sauf la lecture confidentielle, un POST). Réponses `Cache-Control: no-store`. Événements sans texte libre (identifiants, codes, familles).

## Tables (15, toutes de tenant, RLS forcée, allowlist d'isolation VIDE)

`settings`, `severity_levels`, `event_types`, `conduct_scales`, `conduct_scale_items` (2200) · `incidents`, `incident_involvements`, `measures`, `measure_appeals`, `notes`, `convocations`, `conduct_movements`, `life_events`, `confidential_reads` (2201) · garde-fous, machines à états, audience et solde (2202) · `measure_effects` (2203). Références vers élèves, inscriptions, classes, tuteurs, périodes : UUID SANS clé étrangère, vérifiées par les ports. Le DDL de référence et ses 28 tests de comportement sont dans `specs/v2/006-secondary/` (`data-model.md` §5.6-5.8, `ddl-test/`) ; `test/ddl-behavior.integration.test.ts` les reprend sur les migrations RÉELLES du module.

## Routes (`/api/v1/schoollife`, voir `http/plugin.ts`)

| Domaine | Routes |
|---|---|
| Paramètres | `GET /reference` · `GET /settings` · `GET /severity-levels` · `GET /event-types` · `PUT /settings` · `PUT /severity-levels` · `PUT /event-types` |
| Incidents | `GET /incidents` · `GET /incidents/:id` · `POST /incidents` · `POST /incidents/:id/{involvements,review,confirm,dismiss,close,confidentiality}` |
| Mesures | `GET /measures` · `GET /measures/:id` · `POST /measures` · `POST /measures/:id/{validate,reject,cancel,notify,execute,revoke}` |
| Recours | `POST /measures/:id/appeals` · `POST /appeals/:id/{uphold,overturn,withdraw}` |
| Effets d'exclusion | `GET /measure-effects` · `POST /measure-effects/:id/{apply,skip,revert}` |
| Notes | `GET /notes` · `POST /notes` · `POST /notes/:id/withdraw` |
| Convocations | `GET /convocations` · `POST /convocations` · `POST /convocations/:id/{send,acknowledge,hold,no-show,cancel,reschedule}` |
| Conduite | `GET /conduct-scales` · `POST /conduct-scales` · `PUT /conduct-scales/:id/items` · `POST /conduct-scales/:id/{activate,retire}` · `POST /conduct-movements` · `GET /students/:id/conduct` |
| Lectures | `GET /students/:id/life` · `GET /students/:id/absences` · `GET /classrooms/:id/summary` · `GET /dashboard` |
| Confidentiel | `POST /confidential-reads` · `GET /confidential-reads` (journal) |
| Portails | `GET /me/life` · `GET /me/children` · `GET /children/:studentId/life` |

Un enseignant (permission `schoollife.read` sans `schoollife.read.all`) ne voit que les élèves de SES classes (affectation vérifiée par `people`, comme `student.class.read`) et, sans filtre, que ses propres saisies. Features : `schoollife.core` (toutes les routes), `schoollife.conduct-points`, `schoollife.convocations`.

## Permissions (voir `manifest.ts`)

Spec §10 + `schoollife.read.all` (périmètre général), `schoollife.exclusion.apply` (sensible), `schoollife.confidential.audit` (sensible), `schoollife.self.appeal`, `schoollife.child.appeal`, `schoollife.child.acknowledge` (le rôle système « parent » n'a que `*.child.*`, « élève » que `*.self.*`). Sensibles : `restricted.read`, `confidential.read`, `confidential.audit`, `measure.validate`, `exclusion.validate`, `exclusion.apply`, `measure.revoke`, `appeal.decide`, `conduct.manage`, `conduct.adjust`, `settings.manage`.

## Événements publiés (`{ v: 1, … }` ; schémas dans `packages/contracts/src/v2/schoollife.ts`)

`schoollife.incident.declared|status_changed` · `measure.proposed|validated|notified|executed|revoked|rejected|cancelled` · `appeal.filed|decided` · `note.created|withdrawn` · `convocation.sent|acknowledged|held|missed|cancelled` · `conduct.movement_recorded` · `exclusion_effect.requested|applied|skipped|reverted` · `confidential.accessed`. Consommés : aucun. (`convocation.missed` remplace le `no_show` de la spec : le catalogue des événements impose un participe passé.)

## API publique (`index.ts`) pour les autres modules

`getStudentLifeSummary`, `getClassroomLifeSummary`, `getDisciplineFacts`, `getConductPoints`, `isStudentExcludedOn` : **comptages et codes uniquement**, audience `STAFF_RESTRICTED` (jamais un texte libre, une déclaration d'élève ni un élément `CONFIDENTIAL`). Cas d'usage `(deps, ctx, caps, input) => Result`, `registerSchoolLifePorts(app, ports)`, `inMemoryPorts()`, miroirs purs (`audienceMaySee`, `conductBalance`).

## Ports (`application/ports.ts`) et adaptateurs (`platform/adapters/*-schoollife.ts`)

| Port | Fournisseur | Fichier |
|---|---|---|
| `EnrollmentPort`, `PeriodPort` | `academic` (`getEnrollment`, `getClassroom` pour le niveau, `listEnrollmentsByStudent`, `getRoster`, `listAcademicPeriods`) | `academic-schoollife.ts` |
| `PeoplePort` (tutelle, élève et enfants d'un compte, périmètre d'enseignant, tuteurs d'un élève, noms) | `people` + `academic` (le périmètre d'enseignant croise `classroomsOfCurrentStaff` et les inscriptions vivantes d'`academic`, sans dépendre de la projection) | `people-schoollife.ts` |
| `StudentStatusPort` (`SUSPENDED` / `EXCLUDED` / `ACTIVE`) | `people.changeStudentStatus`, appelé UNIQUEMENT sur un acte d'utilisateur habilité | `people-schoollife.ts` |
| `AttendanceViewPort` (VUE d'absences et retards) | `attendance.listAbsences` (lecture seule) | `attendance-schoollife.ts` |
| `NotificationPort` (convocation, avis de mesure) | `notifications.sendManualNotification` (mise en file dans la transaction) | `notifications-schoollife.ts` |

**Échec FERMÉ** : un port non branché lève `schoollife.port_unavailable` (aucune écriture ; la vue d'assiduité du dossier se dégrade en `available: false`). Les ports sont lus à CHAQUE accès (`app.schoollifePorts`, `registerSchoolLifePorts`) : ordre de chargement indifférent.

### Interfaces attendues, NON branchées (à livrer par d'autres modules)

- **rbac** (`rbac/templates/system-roles.ts`, PR dédiée) : accorder les permissions `schoollife.*` aux modèles de rôles — `educateur` : `read`, `read.all`, `incident.write`, `incident.review`, `measure.propose`, `note.write`, `convocation.manage` (sans validation) ; `enseignant` : `read`, `incident.write`, `note.write` ; `directeur_etudes` : `read.all` ; `parent` : `child.read`, `child.appeal`, `child.acknowledge` ; `eleve` : `self.read`, `self.appeal`. `owner` et `directeur` ont `*` (déjà opérationnel). Tant que ce n'est pas fait, seuls ces deux rôles accèdent au module.
- **notifications** : gabarits dédiés `schoollife.convocation` et `schoollife.measure.notified` (aujourd'hui `convocation` et `announcement` avec un texte NEUTRE, jamais le motif) ; abonné `attendance.alert.triggered` -> suggestion de convocation (non faite).
- **attendance** : consommer `schoollife.measure.validated` (famille `TEMP_EXCLUSION`) pour qualifier les absences d'une période d'exclusion (spec 010, Q6-19). **NON branché volontairement (phase 3)** : la qualification (justifiée, non justifiée, non comptée) est une QUESTION MÉTIER OUVERTE (`specs/v2/006-secondary/open-questions.md` Q6-19, aucune décision dans `DECISIONS-METIER.md`) ; l'implémenter reviendrait à inventer une règle. À livrer après arbitrage : réglage d'établissement + abonné `attendance` (aucune note générée automatiquement). L'effet d'une exclusion sur le STATUT de l'élève, lui, est branché et prouvé (effet `AWAITING_HUMAN`, appliqué par un humain habilité).
- **Jobs** `schoollife.remind-convocations` et `schoollife.exclusion-boundaries` (spec §11) : non livrés (aucune table de rappel n'existe ; le registre de convocations est gelé par déclencheur pour un acteur système). `subscribers.ts` et `jobs.ts` restent vides et valides.
- **councils** (spec 006) : consommera `getStudentLifeSummary` / `getDisciplineFacts` (instantané de conseil).

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/schoollife/test/unit        # unitaires (sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/schoollife      # + intégration (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/schoollife.integration.test.ts   # adaptateurs réels
```

`test/unit/domain.test.ts` (visibilité, machines à états en parité avec le SQL, barème, types, traduction des refus, manifeste, contrats, garde-fous « aucune règle réglementaire en code ») · `ddl-behavior` (28 tests du DDL) · `ddl-effects` (effets, audiences) · `lifecycle` (cycle complet, quatre yeux, recours, exclusions, conduite, refus des acteurs système, ports, atomicité) · `confidentiality` (matrice éducateur / enseignant / direction / parent / élève, parité exhaustive SQL/miroir, lectures journalisées) · `isolation` (RLS A/B, 15 tables) · `http` (Fastify + Postgres réel).

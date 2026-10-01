# Dépendants de l'existant par tranche (Phase 2, tranches 2.1 à 2.8)

> Généré par `scripts/inventory/build-slice-dependents.mjs` à partir de `tables-usage-matrix.json` et de `scripts/inventory/slice-notes.mjs` (notes de couplage rédigées à la main, avec fichier:ligne). Ne pas éditer ce fichier : éditer les notes puis relancer.

## Méthode et lecture

- **Tables de la tranche** : colonne « tranche » des règles de `inventory.config.mjs`, qui suit le tableau « Remplace » du plan §4. Une table citée par plusieurs tranches (`2.5/3`) compte pour chacune.
- **API structurants** : fichiers `apps/api/src` (routes, services, jobs) qui citent les tables de la tranche au moins 6 fois ou qui en citent au moins 3 différentes. Les autres sont des **jointures légères** (une table de la tranche jointe pour un libellé) : ils changeront, mais mécaniquement.
- **Routes d'entrée** : routes HTTP enregistrées dans `index.ts` dont l'arbre d'imports atteint ces fichiers ; c'est le contrat HTTP à préserver ou à réécrire. **Web direct** : fichiers web qui citent la table (rare : le web ne fait pas de SQL). **Web appelant** : fichiers web contenant `/api/v1/<préfixe>` d'une route d'entrée, borne haute (sur-estimation par préfixe, ex. `/teacher`, `/courses`).
- **Taille** (structurants seulement) : S = ≤ 6 fichiers, ≤ 4000 lignes, ≤ 6 web direct ; M = ≤ 20 / 20000 / 25 ; L au-delà. L'ajustement manuel, s'il existe, est justifié dans la section de la tranche. Ce n'est pas une estimation d'effort calendaire (le plan §4 dit : S ≈ 1–2 sem., M ≈ 3–5, L ≈ 6–10, XL > 10 pour un développeur) : c'est une mesure de surface de code touchée.

## Synthèse

| Tranche | Intitulé | Tables | API structurants / lignes | + légers | Routes d'entrée | Web direct | Web appelant (≤) | Tests | Scripts | Taille |
|---|---|--:|---|--:|--:|--:|--:|--:|--:|:-:|
| 2.1 | Années, périodes typées, programmes, curriculum polymorphe, classes | 18 | 79 / 68314 | 34 | 67 | 71 | 240 | 14 | 68 | **L** |
| 2.2 | Élèves, tuteurs, personnel, inscriptions, affectations d'enseignement | 12 | 65 / 70593 | 48 | 61 | 22 | 236 | 12 | 67 | **L** |
| 2.3 | Présences, justificatifs, emploi du temps et conflits | 16 | 22 / 20168 | 28 | 28 | 27 | 126 | 2 | 32 | **L** |
| 2.4 | Rules Engine + RuleSets BTS/LMD et classique + golden tests | 0 | 7 / 7086 | 0 | 1 | 5 | 0 | 3 | 0 | **M** |
| 2.5 | Évaluations, notes, workflow, GradeRevision, résultats, clôture, rattrapage | 20 | 22 / 23483 | 15 | 22 | 35 | 159 | 7 | 18 | **L** |
| 2.6 | Bulletins snapshot + PDF serveur, relevés, diplômes, attestations, signataires | 7 | 9 / 10801 | 4 | 5 | 22 | 74 | 0 | 7 | **M** |
| 2.7 | Rémunération (spec 031) : collecteurs d'heures sur le nouveau modèle | 9 | 24 / 13871 | 8 | 13 | 29 | 70 | 4 | 27 | **L** |
| 2.8 | Portails owner / parent / élève / enseignant sur modèles de lecture | 3 | 54 / 43505 | 0 | 23 | 183 | 0 | 0 | 0 | **L** |

## Fichiers transverses (touchent ≥ 3 tranches)

Ces fichiers seront modifiés dans plusieurs tranches : ordonnancer les tranches pour qu'un même fichier ne soit pas réécrit en parallèle, ou le découper avant la Phase 2 (étape « 2.0 bis »).

| Fichier | Lignes | Nb tranches | Tranches |
|---|--:|--:|---|
| `api/services/professional-bulletin.service.ts` | 1911 | 6 | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 |
| `api/routes/parent-documents.ts` | 1013 | 6 | 2.1, 2.2, 2.3, 2.5, 2.6, 2.8 |
| `api/services/owner-pedagogie.service.ts` | 696 | 6 | 2.1, 2.2, 2.4, 2.5, 2.6, 2.8 |
| `api/routes/professional.ts` | 4159 | 5 | 2.1, 2.2, 2.3, 2.5, 2.6 |
| `api/routes/parent-children.ts` | 2056 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/services/professional-diplomas.service.ts` | 1314 | 5 | 2.1, 2.2, 2.4, 2.5, 2.6 |
| `api/routes/semester-averages.ts` | 1285 | 5 | 2.1, 2.2, 2.3, 2.4, 2.5 |
| `api/routes/parent-academic.ts` | 1068 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/routes/student-courses.ts` | 971 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/routes/teacher-students.ts` | 948 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/services/owner-pulse.service.ts` | 773 | 5 | 2.1, 2.2, 2.3, 2.7, 2.8 |
| `api/services/owner-payroll-mass.service.ts` | 730 | 5 | 2.1, 2.2, 2.3, 2.7, 2.8 |
| `api/services/owner-risque.service.ts` | 634 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/services/owner-assiduite.service.ts` | 628 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/services/owner-remplissage.service.ts` | 613 | 5 | 2.1, 2.2, 2.3, 2.7, 2.8 |
| `api/services/owner-documents.service.ts` | 397 | 5 | 2.1, 2.2, 2.5, 2.6, 2.8 |
| `api/services/professional-cycle-groups.ts` | 275 | 5 | 2.1, 2.2, 2.4, 2.5, 2.6 |
| `api/services/owner-academic.service.ts` | 232 | 5 | 2.1, 2.2, 2.3, 2.5, 2.8 |
| `api/services/professional-enrollment.service.ts` | 1717 | 4 | 2.1, 2.2, 2.3, 2.5 |
| `api/routes/teacher-assignments.ts` | 1578 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/routes/parent-homework.ts` | 1444 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/services/professional-results.service.ts` | 1391 | 4 | 2.1, 2.2, 2.4, 2.5 |
| `api/services/professional-assignments.service.ts` | 1331 | 4 | 2.1, 2.2, 2.3, 2.5 |
| `api/routes/payment-reports.ts` | 1197 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/routes/parent-grades.ts` | 1104 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/routes/teacher-attendance.ts` | 1072 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/services/professional-seance-validation.service.ts` | 874 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/services/owner-economie.service.ts` | 759 | 4 | 2.1, 2.2, 2.7, 2.8 |
| `api/services/teacher-payroll-overview.service.ts` | 703 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/routes/student-assignments.ts` | 666 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/services/owner-personnes.service.ts` | 621 | 4 | 2.1, 2.2, 2.7, 2.8 |
| `api/services/professional-teacher.service.ts` | 560 | 4 | 2.1, 2.2, 2.3, 2.5 |
| `api/routes/teacher-courses.ts` | 454 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/routes/teacher-corrections.ts` | 411 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/services/owner-programme.service.ts` | 347 | 4 | 2.1, 2.2, 2.3, 2.8 |
| `api/services/professional-ecue-materials.service.ts` | 298 | 4 | 2.1, 2.2, 2.3, 2.5 |
| `api/services/professional-attestations.service.ts` | 279 | 4 | 2.1, 2.2, 2.5, 2.6 |
| `api/routes/student-grades.ts` | 263 | 4 | 2.1, 2.2, 2.5, 2.8 |
| `api/services/teacher-payslip.service.ts` | 237 | 4 | 2.1, 2.2, 2.3, 2.7 |
| `api/services/owner-staff.service.ts` | 156 | 4 | 2.1, 2.2, 2.7, 2.8 |

## Tranche 2.1 — Années, périodes typées, programmes, curriculum polymorphe, classes

**Remplace** : `cycles`, `filieres`, `programmes`, `classes`, `academic_years`, `academic_year_periods` (+ `class_courses`, `courses`, `bilan_types`, `professional_ue*`, `professional_ecue*`, `professional_semestre*` pour le curriculum Professional).

**Taille** : **L** (calculée) — 79 fichiers API structurants (68314 lignes) + 34 jointures légères, 67 routes HTTP d'entrée, 71 fichiers web directs, ~240 fichiers web appelants (borne haute), 14 tests existants, 68 scripts/seeds.

**Tables** (18) : `academic_year_periods`, `academic_years`, `bilan_types`, `class_courses`, `classes`, `courses`, `cycles`, `filieres`, `professional_classe_noms`, `professional_ecue`, `professional_semestre_sessions`, `professional_semestre_ue`, `professional_semestres`, `professional_ue`, `professional_ue_ecue`, `professional_ue_prerequisites`, `professional_ue_sessions`, `programmes`

### Points de couplage dangereux

- **L'année scolaire n'est pas une entité côté Professional : elle est dérivée d'une date, pivot au 1er septembre, à CINQ endroits qui doivent rester identiques** — `apps/api/src/services/professional-annee-scolaire.ts:6-13` (`anneeScolaireOf`, dont le commentaire dit « identique à `academicYearFromDate` du front »), `apps/api/src/services/professional-seance-validation.service.ts:96-105` (`ANNEE_SCOLAIRE_SQL`), `apps/api/src/services/owner-pro-annee.sql.ts:174` (`anneeDe`), `apps/api/src/services/owner-pedagogie.service.ts` (en-tête : « l'année scolaire n'est pas une colonne »), et le web `apps/web/src/lib/diplome-format.ts:187`. La pile classique, elle, a `academic_years` (`infra/scripts/migrations/0005_academic_years.sql:34-46`, une seule année active par tenant par contrainte `EXCLUDE`) et `academic_year_periods` sans type (`0048_academic_year_periods.sql:4-15` : nom libre + `sort_order`). Unifier = faire d'`AcademicYear` la source unique ET migrer ces cinq dérivations en même temps, sinon deux écrans voisins donneront deux années pour la même séance.
- **La « classe » du Professional n'existe pas comme ligne** : c'est une ouverture de cohorte (`professional_ue_sessions`) dont le nom est calculé en retirant le suffixe « — CODE UE » du libellé : `apps/api/src/services/owner-pro-annee.sql.ts:155-165` (`NOM_DE_CLASSE_SQL`, « la transcription SQL suit le JavaScript au caractère près, tirets cadratin et demi-cadratin compris ») ; clé de filtre owner = `filiereId|nom`. Le JavaScript miroir vit dans les pages admin (Paiements, Étudiants inscrits). L'entité `Classroom`/promotion du plan doit porter ce nom en colonne, et les deux copies (SQL owner et JS admin) disparaître ensemble.
- **Contrat de paramètres positionnels figé pour tous les services owner** — `apps/api/src/services/owner-perimetre.sql.ts:1-45` ($1 tenant, $2 année, $3 filières, $4 nom de classe, $5 semestre ; CTE `OUVERTURES_CTE` :93, `COMMANDES_PERIMETRE_CTE` :159, `ETUDIANTS_PERIMETRE_CTE` :202). Changer les tables d'ouverture/classe casse ces fragments partagés par ~15 services owner (voir 2.8) : à migrer en une seule passe.
- **Une lecture qui écrit** : `apps/api/src/services/professional-ue.service.ts:837-846` (`adminListSessions`) fait un `UPDATE professional_ue_sessions SET statut = 'termine'` avant de lister ; `apps/api/src/services/owner-pedagogie.service.ts` (en-tête, §4.4-8) contourne exprès cet endpoint pour ne pas clôturer les sessions échues. Le nouveau modèle doit sortir cette finalisation d'un GET (job planifié) avant que les lecteurs ne soient rebranchés.
- **Provisioning par clonage depuis un tenant de référence** : `apps/api/src/services/tenant-provisioning.service.ts:7` (`REFERENCE_TABLES = cycles, filieres, programmes, courses, time_slots`) et `:411-423` (`cloneReferenceTable`). Les clés naturelles (`code`, `version`) servent à la déduplication (`:108-134`). Remplacé par les modèles de pack (Phase 1) : ne pas toucher `cycles/programmes/courses` avant que le provisioning ne les clone plus.
- **Double chemin semestre → sessions** : `professional_semestre_sessions` (legacy) ET `professional_semestre_ue` (courant) sont tous deux interrogés (`apps/api/src/services/professional-cloture-guard.ts:1-40`, `owner-pedagogie.service.ts` §4.4-5). Ne porter que le chemin courant exige d'abord de migrer les lignes du chemin legacy.
- **`bilan_types`, `programmes`, `courses` sont aussi déclarés dans Prisma** (`apps/api/prisma/schema.prisma:10,24,32`) et `bilan_types` n'existe que dans la chaîne Prisma (migration `20260403120000_add_bilan_types`), pas dans `infra/scripts/migrations`. À prendre en compte dans le plan « reset » : le schéma réel ne se reconstruit pas depuis les seules migrations SQL.
- **Détection par regex du nom de filière** (grade, niveau) : `apps/web/src/lib/bulletin-format.ts:76-82,174-180,199`, `apps/web/src/lib/diplome-format.ts:191`, `apps/api/src/services/professional-bulletin.service.ts:478` (`/licence\s*[12]\b/i`). À remplacer par un attribut `Program.cycle/level` (donnée), cf. 2.4.

### Fichiers API structurants (79)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/services/professional-bulletin.service.ts` | 1911 | 120 | professional_ue_sessions(31), professional_semestre_sessions(28), professional_semestre_ue(24), professional_semestres(13), +4 | 6 |
| `api/services/professional-ue.service.ts` | 1590 | 78 | professional_ue(20), professional_ue_sessions(20), professional_ue_ecue(8), professional_ecue(7), +5 | 3 |
| `api/services/professional-enrollment.service.ts` | 1717 | 63 | professional_ue_sessions(18), professional_ue(15), programmes(11), professional_semestre_sessions(4), +6 | 4 |
| `api/services/owner-referentiel.service.ts` | 705 | 63 | professional_ue(15), professional_ue_sessions(11), professional_ue_ecue(10), programmes(10), +6 | 3 |
| `api/services/professional-semestre.service.ts` | 651 | 52 | professional_semestres(11), professional_semestre_ue(10), professional_ue(7), programmes(7), +5 | 2 |
| `api/services/professional-emploi-temps.service.ts` | 455 | 47 | professional_ue_sessions(13), professional_semestre_sessions(11), professional_ue(7), programmes(6), +3 | 3 |
| `api/services/professional-results.service.ts` | 1391 | 43 | professional_ue_sessions(11), professional_ecue(7), professional_ue(6), professional_ue_ecue(6), +4 | 4 |
| `api/routes/classes.ts` | 1234 | 37 | class_courses(11), classes(10), courses(6), programmes(6), +1 | 3 |
| `api/routes/semester-averages.ts` | 1285 | 36 | classes(12), academic_year_periods(9), academic_years(7), courses(3), +3 | 5 |
| `api/services/professional-teacher.service.ts` | 560 | 30 | professional_ue_sessions(8), professional_ecue(7), professional_ue(7), programmes(7), +1 | 4 |
| `api/routes/teacher-assignments.ts` | 1578 | 29 | class_courses(11), classes(10), courses(6), academic_years(2) | 4 |
| `api/routes/parent-children.ts` | 2056 | 26 | courses(10), classes(9), class_courses(6), professional_ecue(1) | 5 |
| `api/routes/programmes.ts` | 937 | 25 | programmes(12), cycles(6), filieres(5), classes(1), +1 | 1 |
| `api/routes/courses.ts` | 708 | 25 | courses(10), bilan_types(7), programmes(7), class_courses(1) | 2 |
| `api/services/owner-pedagogie.service.ts` | 696 | 25 | professional_ecue(6), professional_ue(4), professional_ue_sessions(4), professional_semestre_sessions(3), +4 | 6 |
| `api/routes/academic-years.ts` | 1039 | 23 | academic_years(15), academic_year_periods(6), classes(2) | 2 |
| `api/services/professional-assignments.service.ts` | 1331 | 21 | professional_ue_ecue(7), professional_ue_sessions(7), professional_ecue(4), professional_semestre_sessions(1), +2 | 4 |
| `api/services/professional-cycle-groups.ts` | 275 | 21 | professional_ue(4), programmes(3), professional_ecue(2), professional_semestres(2), +4 | 5 |
| `api/routes/teacher-students.ts` | 948 | 20 | class_courses(8), classes(8), courses(3), programmes(1) | 5 |
| `api/services/owner-stats-filters.service.ts` | 293 | 20 | academic_years(4), professional_ue_sessions(4), classes(2), cycles(2), +5 | 3 |
| `api/routes/attendance.ts` | 1227 | 18 | class_courses(8), classes(5), courses(5) | 3 |
| `api/routes/parent-homework.ts` | 1444 | 17 | classes(7), courses(7), class_courses(3) | 4 |
| `api/routes/enrollments.ts` | 1492 | 16 | classes(6), academic_years(4), programmes(4), cycles(2) | 2 |
| `api/services/owner-remplissage.service.ts` | 613 | 16 | professional_ue_sessions(5), professional_ue(3), professional_ecue(2), programmes(2), +4 | 5 |
| `api/routes/parent-academic.ts` | 1068 | 15 | academic_years(5), class_courses(5), courses(3), classes(2) | 5 |
| `api/routes/student-courses.ts` | 971 | 15 | courses(6), class_courses(5), classes(4) | 5 |
| `api/services/owner-programme.service.ts` | 347 | 15 | professional_ecue(5), professional_ue(5), professional_ue_ecue(3), professional_ue_sessions(1), +1 | 4 |
| `api/services/owner-economie.service.ts` | 759 | 14 | professional_ue_sessions(6), professional_ue(5), programmes(2), academic_years(1) | 4 |
| `api/services/owner-payroll-mass.service.ts` | 730 | 13 | academic_years(6), class_courses(3), classes(2), courses(2) | 5 |
| `api/services/owner-finances-pro.service.ts` | 658 | 13 | professional_ue(5), professional_ue_sessions(5), programmes(3) | 3 |
| `api/services/professional-catalog.service.ts` | 235 | 13 | professional_ecue(7), professional_ue_ecue(4), professional_ue(2) | 1 |
| `api/routes/parent-grades.ts` | 1104 | 12 | classes(5), courses(5), academic_years(2) | 4 |
| `api/routes/teacher-attendance.ts` | 1072 | 12 | class_courses(6), classes(5), courses(1) | 4 |
| `api/routes/tuition-schedules.ts` | 937 | 12 | classes(9), academic_years(2), programmes(1) | 2 |
| `api/services/professional-seance-validation.service.ts` | 874 | 12 | professional_ue_sessions(4), professional_ecue(2), professional_semestre_sessions(2), professional_semestres(2), +2 | 4 |
| `api/services/owner-pulse.service.ts` | 773 | 12 | academic_years(6), professional_ue_sessions(5), classes(1) | 5 |
| `api/routes/cycles.ts` | 645 | 12 | cycles(11), programmes(1) | 1 |
| `api/routes/teacher-courses.ts` | 454 | 12 | class_courses(4), classes(2), courses(2), cycles(2), +1 | 4 |
| `api/services/professional-diplomas.service.ts` | 1314 | 11 | professional_ue(6), professional_ue_sessions(4), programmes(1) | 5 |
| `api/services/owner-personnes.service.ts` | 621 | 11 | professional_ue(3), professional_ue_sessions(3), programmes(2), academic_years(1), +2 | 4 |
| `api/routes/filieres.ts` | 395 | 11 | filieres(8), programmes(3) | 1 |
| `api/services/professional-planning.service.ts` | 317 | 11 | professional_ue_sessions(5), professional_ecue(2), professional_ue(2), professional_ue_ecue(2) | 3 |
| `api/services/professional-payment.service.ts` | 728 | 10 | professional_ue(2), professional_ue_sessions(2), cycles(1), filieres(1), +4 | 2 |
| `api/services/owner-risque.service.ts` | 634 | 10 | professional_ue_sessions(4), professional_ue(3), programmes(2), professional_ecue(1) | 5 |
| `api/routes/assignment-instances.ts` | 630 | 10 | classes(5), courses(4), academic_years(1) | 3 |
| … 34 autres (liste complète : `tables-usage-matrix.json`, champ `refs`) | | | | |

### Jointures légères (34 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/academic-calendar-events.ts`, `api/routes/admin-email.ts`, `api/routes/admin-messages.ts`, `api/routes/assignments.ts`, `api/routes/attendance-reports.ts`, `api/routes/bilan-types.ts`, `api/routes/classroom-reservations.ts`, `api/routes/course-assignments.ts`, `api/routes/course-hourly-rates.ts`, `api/routes/evaluation-questions.ts`, `api/routes/files.ts`, `api/routes/parent-payments.ts`, `api/routes/payment-reports.ts`, `api/routes/report-cards.ts`, `api/routes/sessions.ts`, `api/routes/simple-payment-periods.ts`, `api/routes/simple-schedule.ts`, `api/routes/student-grades.ts`, `api/routes/student-payments.ts`, `api/routes/submissions.ts`, `api/routes/teacher-conversations.ts`, `api/routes/teacher-payments.ts`, `api/routes/teaching-hours.ts`, `api/routes/transcripts.ts`, `api/routes/webhooks/livekit.ts`, `api/services/financial-reports.service.ts`, `api/services/hour-collectors/academic-hour-collector.ts`, `api/services/hour-collectors/professional-hour-collector.ts`, `api/services/hour-collectors/types.ts`, `api/services/owner-scolarite.service.ts`, `api/services/professional-ecue-rates.service.ts`, `api/services/professional-live-sessions.service.ts`, `api/services/prospection.service.ts`, `api/services/teacher-payroll-overview.service.ts`

### Routes HTTP d'entrée (67)

`api/routes/academic-calendar-events.ts`, `api/routes/academic-years.ts`, `api/routes/admin-email.ts`, `api/routes/admin-messages.ts`, `api/routes/assignment-instances.ts`, `api/routes/assignments.ts`, `api/routes/attendance-reports.ts`, `api/routes/attendance.ts`, `api/routes/bilan-types.ts`, `api/routes/class-courses.ts`, `api/routes/classes.ts`, `api/routes/classroom-reservations.ts`, `api/routes/course-assignments.ts`, `api/routes/course-hourly-rates.ts`, `api/routes/courses.ts`, `api/routes/cycle-fees.ts`, `api/routes/cycles.ts`, `api/routes/enrollments.ts`, `api/routes/evaluation-questions.ts`, `api/routes/exam-schedules.ts`, `api/routes/files.ts`, `api/routes/filieres.ts`, `api/routes/financial-reports.ts`, `api/routes/materials.ts`, `api/routes/owner/index.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/parent-grades.ts`, `api/routes/parent-homework.ts`, `api/routes/parent-messages.ts`, `api/routes/parent-payments.ts`, `api/routes/payment-reports.ts`, `api/routes/professional-remuneration.ts`, `api/routes/professional.ts`, `api/routes/programmes.ts`, `api/routes/prospection.ts`, `api/routes/receipts.ts`, `api/routes/report-cards.ts`, `api/routes/schedule-generation.ts`, `api/routes/semester-averages.ts`, `api/routes/session-instances.ts`, `api/routes/sessions.ts`, `api/routes/simple-payment-periods.ts`, `api/routes/simple-schedule.ts`, `api/routes/student-assignments.ts`, `api/routes/student-courses.ts`, `api/routes/student-grades.ts`, `api/routes/student-messages.ts`, `api/routes/student-payments.ts`, `api/routes/students.ts`, `api/routes/submissions.ts`, `api/routes/super-admin-roles.ts`, `api/routes/super-admin-tenants.ts`, `api/routes/teacher-assignments.ts`, `api/routes/teacher-attendance.ts`, `api/routes/teacher-conversations.ts`, `api/routes/teacher-corrections.ts`, `api/routes/teacher-courses.ts`, `api/routes/teacher-messages.ts`, `api/routes/teacher-payments.ts`, `api/routes/teacher-students.ts`, `api/routes/teachers.ts`, `api/routes/teaching-hours.ts`, `api/routes/transcripts.ts`, `api/routes/tuition-schedules.ts`, `api/routes/webhooks/livekit.ts`

### Web : fichiers directs (71) et appelants (~240)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/annee-academique/moyennes-semestre/page.tsx` | 1004 | 7 | class_courses(1) | 2 |
| `web/app/annee-academique/rapports-de-presence/page.tsx` | 883 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/releves-de-notes/page.tsx` | 848 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/EnrollmentForm.tsx` | 718 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/courses/[id]/page.tsx` | 686 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/demarrer/page.tsx` | 616 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ReportCardForm.tsx` | 612 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/CourseForm.tsx` | 576 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/matieres/page.tsx` | 482 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/classes/[id]/page.tsx` | 475 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/TeacherAssignmentForm.tsx` | 444 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ProgrammeForm.tsx` | 430 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/classes/page.tsx` | 421 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/inscription/page.tsx` | 413 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/cycles/page.tsx` | 410 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/courses/page.tsx` | 402 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/ajouter-classe/page.tsx` | 391 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/ue/page.tsx` | 384 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ClassroomForm.tsx` | 382 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/semestres/page.tsx` | 365 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ClassForm.tsx` | 362 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/programmes/page.tsx` | 353 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/semestres/new/page.tsx` | 334 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/annee-academique/types-de-bilan/page.tsx` | 314 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ExamScheduleForm.tsx` | 308 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/StudentStats.tsx` | 301 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/matieres/new/page.tsx` | 299 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/AcademicCalendarEventForm.tsx` | 264 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/semestres/[id]/edit/page.tsx` | 263 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/AntdCycleForm.tsx` | 256 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/cycles/[id]/page.tsx` | 250 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/ue/[id]/page.tsx` | 245 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/diplome-format.ts` | 245 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `web/app/professionnel/admin/ue/[id]/edit/page.tsx` | 231 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/semestres/[id]/page.tsx` | 225 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/CyclesList.tsx` | 210 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/ParentForm.tsx` | 208 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/matieres/[id]/edit/page.tsx` | 204 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/TeacherCard.tsx` | 204 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/academic/StudentCard.tsx` | 196 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| … 31 autres (liste complète : `tables-usage-matrix.json`, champ `refs`) | | | | |

Appelants par dossier (borne haute) : `lib/hooks` 78, `app/api/v1` 44, `app/api/teacher` 14, `components/assignments` 12, `app/(dashboard)/admin` 8, `app/(dashboard)/schedule-generation` 4, `app/api/assignments` 4, `lib/utils` 4, `app/academic/evaluations` 3, `app/api/materials` 3, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/api/receipts` 2, `app/api/teacher-payments` 2

### Tests existants (14)

- `api/__tests__/upload-management-complete.test.ts`
- `api/__tests__/upload-management.test.ts`
- `api/services/__tests__/professional-gardes.test.ts`
- `api/tests/payment-flow.integration.test.ts`
- `api/tests/student-payments.test.ts`
- `web/app/annee-academique/bulletins/__tests__/report-card-submit.test.ts`
- `web/components/academic/__tests__/CycleCard.test.tsx`
- `tests/contract/parent-grades.test.ts`
- `tests/integration/parent-assignment-grades.test.ts`
- `tests/integration/parent-completed-assignments.test.ts`
- `tests/integration/parent-grade-trends.test.ts`
- `tests/integration/parent-grades-by-course.test.ts`
- `tests/integration/parent-grades.test.ts`
- `tests/integration/parent-overall-averages.test.ts`

### Scripts, seeds et packages (72)

`api:scripts/debug-student-grades.ts`, `api:scripts/delete-assignments-by-title.js`, `api:scripts/delete-eca-formation-ue-ecue.ts`, `api:scripts/delete-tenant-programmes.ts`, `api:scripts/get-teacher-assignments.js`, `api:scripts/pro-tl-01-sessions.ts`, `api:scripts/pro-tl-03-inscriptions.ts`, `api:scripts/pro-tl-04-paiements.ts`, `api:scripts/pro-tl-05-planning.ts`, `api:scripts/pro-tl-06-presences.ts`, `api:scripts/pro-tl-07-notes.ts`, `api:scripts/pro-tl-08-bulletins.ts`, `api:scripts/pro-tl-99-verification.ts`, `api:scripts/pro-tl-common.ts`, `api:scripts/seed-absences-fabrice-lprigla.ts`, `api:scripts/seed-eca-formation-filieres.ts`, `api:scripts/seed-eca-formation-l1daf-ue-ecue.ts`, `api:scripts/seed-eca-formation-l1fc-ue-ecue.ts`, `api:scripts/seed-eca-formation-l2fc-ue-ecue.ts`, `api:scripts/seed-finances-lprigla-scolarite-schedule.ts`, `api:scripts/seed-semester-averages-bts-gerna-1-500.ts`, `api:scripts/seed-simple-schedule-lprigla-year.ts`, `api:scripts/seed-student-payments-lprigla-class-a.ts`, `api:scripts/seed-students-bts-gerna-1-500.ts`, `api:scripts/seed-students-lprigla-class-a.ts`, … +47

### Test de sortie de tranche

Les deux écrans de création de classe (classique, Professional) lisent/écrivent le même modèle ; `tenant-provisioning` ne référence plus `cycles/filieres/programmes/classes` ; plus aucune dérivation d'année par pivot septembre hors du noyau ; `0118_annees_scolaires_sans_trou` (années contiguës) reste vrai sur le nouveau modèle.

## Tranche 2.2 — Élèves, tuteurs, personnel, inscriptions, affectations d'enseignement

**Remplace** : `student_profiles`, `student_parents`, `teachers`, `student_enrollments`, `professional_enrollments` (+ `teacher_assignments`, `emergency_contacts`, `student_status_history`, `professional_student_matricules`, `registration_requests`).

**Taille** : **L** (calculée) — 65 fichiers API structurants (70593 lignes) + 48 jointures légères, 61 routes HTTP d'entrée, 22 fichiers web directs, ~236 fichiers web appelants (borne haute), 12 tests existants, 67 scripts/seeds.

**Tables** (12) : `emergency_contacts`, `professional_enrollments`, `professional_session_ecue_teachers`, `professional_student_matricules`, `registration_requests`, `student_enrollments`, `student_parents`, `student_profiles`, `student_status_history`, `teacher_assignments`, `teacher_assignments_audit`, `teachers`

### Points de couplage dangereux

- **Le Professional réutilise DÉJÀ `student_profiles` et `teachers`** (ex. `professional_enrollments.student_id` → `student_profiles.id`, `professional_ue_sessions.enseignant_id` → `teachers.id`, jointures visibles dans `apps/api/src/services/professional-live-sessions.service.ts:48-58`). La divergence est dans l'inscription : `student_enrollments` (classe + année, `routes/enrollments.ts`, 14 citations) contre `professional_enrollments` (cohorte d'UE, `professional-enrollment.service.ts`, 29 citations). C'est donc l'`Enrollment` qu'il faut fusionner, pas l'élève.
- **17 fichiers owner citent `professional_enrollments`, 8 citent `student_enrollments`, et 5 services owner citent LES DEUX** (`owner-personnes`, `owner-prospection`, `owner-pulse`, `owner-remplissage`, `owner-tresorerie`) ; hors owner, `routes/parent-children.ts` et `routes/students.ts` citent aussi les deux. Les 12 autres lecteurs owner de `professional_enrollments` : `owner-economie`, `owner-finances-pro`, `owner-finances`, `owner-perimetre.sql.ts`, `owner-pro-annee.sql.ts`, `owner-referentiel`, `owner-risque`, `owner-scolarite`, `owner-assiduite`, `owner-pedagogie`, `owner-programme` (+ `contracts/owner-stats.schema.ts`). Une seule table `Enrollment` simplifie les lectures croisées mais oblige à réécrire ces fichiers dans la même tranche (ou à laisser des vues de compatibilité jusqu'à 2.8).
- **Trois numérotations de matricule** : `professional_student_matricules` (migration 0086, format 0093), `student_profiles.student_number` + séquence (0094), matricule manuel (0088), et `getNextEstablishmentMatricule` (`apps/api/src/routes/registration-requests.ts:58`). `apps/api/src/routes/students.ts` lit les trois (3 citations de `professional_student_matricules`). Un seul générateur de matricule par tenant à définir avant la migration, sinon doublons.
- **La création d'un élève crée aussi un utilisateur, des rôles et parfois un tuteur**, avec du SQL direct sur les tables RBAC : `apps/api/src/routes/parents.ts` (12 citations de `user_roles`), `routes/registration-requests.ts` (`user_roles`, `roles`, `users`, `student_parents`), `routes/teachers.ts`, `routes/students.ts`. Ces écritures changent quand le RBAC passe par tenant (Phase 1) : coordonner avec la spec 002.
- **Historique de statut** : `student_status_history` (migration 0099) n'est lue que par `owner-economie.service.ts` (1 citation) ; le statut courant est porté par plusieurs colonnes (`student_profiles`, `student_enrollments`, `professional_enrollments.statut`). Le plan veut un `Enrollment` avec type de financement : décider où va l'historique avant de supprimer la table.
- **Champs administratifs déplacés vers les inscriptions** par la migration Prisma `20260423133000_move_student_admin_fields_to_enrollments` : le schéma réel de `student_enrollments` n'est donc probablement pas celui de`infra/scripts/migrations/0059_add_per_enrollment_fields.sql` seul.
- **Portail parent = 5 routes sur les inscriptions** (`parent-children.ts` 2 056 lignes, `parent-documents.ts`, `parent-academic.ts`, `parent-grades.ts`, `parent-homework.ts`) : voir 2.8 ; elles traversent les tranches 2.1, 2.2, 2.3 et 2.5.

### Fichiers API structurants (65)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/services/professional-enrollment.service.ts` | 1717 | 57 | professional_enrollments(29), student_profiles(12), professional_student_matricules(7), student_parents(3), +1 | 4 |
| `api/services/professional-bulletin.service.ts` | 1911 | 47 | professional_enrollments(18), student_profiles(16), professional_session_ecue_teachers(5), teachers(5), +2 | 6 |
| `api/routes/students.ts` | 2700 | 45 | student_profiles(31), student_parents(6), student_enrollments(4), professional_student_matricules(3), +1 | 3 |
| `api/routes/teacher-assignments.ts` | 1578 | 34 | teachers(17), teacher_assignments(15), student_enrollments(1), student_profiles(1) | 4 |
| `api/routes/parent-messages.ts` | 3554 | 30 | student_profiles(13), student_parents(9), student_enrollments(3), teacher_assignments(3), +1 | 3 |
| `api/routes/admin-messages.ts` | 2423 | 27 | student_profiles(15), student_parents(6), student_enrollments(4), teachers(2) | 2 |
| `api/routes/parent-homework.ts` | 1444 | 27 | student_parents(11), student_enrollments(8), student_profiles(8) | 4 |
| `api/routes/teacher-messages.ts` | 1181 | 26 | teachers(8), student_enrollments(6), student_profiles(5), teacher_assignments(5), +1 | 3 |
| `api/routes/teacher-students.ts` | 948 | 26 | teacher_assignments(10), student_enrollments(8), student_profiles(4), teachers(4) | 5 |
| `api/routes/parent-children.ts` | 2056 | 24 | student_enrollments(12), professional_enrollments(3), student_parents(3), teachers(3), +2 | 5 |
| `api/services/professional-ue.service.ts` | 1590 | 24 | professional_enrollments(8), professional_session_ecue_teachers(5), teachers(5), professional_student_matricules(3), +1 | 3 |
| `api/services/professional-results.service.ts` | 1391 | 24 | professional_enrollments(7), student_profiles(6), professional_student_matricules(4), professional_session_ecue_teachers(3), +2 | 4 |
| `api/routes/parent-payments.ts` | 1431 | 20 | student_parents(8), student_enrollments(6), student_profiles(6) | 3 |
| `api/services/professional-teacher.service.ts` | 560 | 20 | professional_session_ecue_teachers(10), professional_enrollments(4), teachers(4), student_profiles(2) | 4 |
| `api/routes/submissions.ts` | 2126 | 19 | student_profiles(11), teachers(5), student_enrollments(3) | 3 |
| `api/routes/enrollments.ts` | 1492 | 19 | student_enrollments(14), student_profiles(5) | 2 |
| `api/routes/teacher-attendance.ts` | 1072 | 19 | teachers(10), teacher_assignments(8), student_profiles(1) | 4 |
| `api/routes/student-messages.ts` | 1013 | 19 | student_profiles(9), student_enrollments(4), teacher_assignments(3), teachers(3) | 3 |
| `api/routes/registration-requests.ts` | 814 | 18 | registration_requests(8), student_profiles(8), student_parents(2) | 1 |
| `api/services/owner-personnes.service.ts` | 621 | 18 | student_profiles(5), professional_session_ecue_teachers(4), student_enrollments(3), student_parents(3), +2 | 4 |
| `api/routes/teachers.ts` | 1380 | 17 | teachers(14), teacher_assignments(3) | 2 |
| `api/routes/parent-emergency.ts` | 1340 | 17 | student_parents(7), emergency_contacts(5), student_profiles(5) | 2 |
| `api/routes/parent-academic.ts` | 1068 | 17 | student_parents(7), student_enrollments(5), student_profiles(5) | 5 |
| `api/routes/parent-grades.ts` | 1104 | 16 | student_parents(6), student_enrollments(5), student_profiles(5) | 4 |
| `api/services/financial-reports.service.ts` | 601 | 16 | student_enrollments(8), student_profiles(8) | 2 |
| `api/routes/teacher-conversations.ts` | 892 | 15 | student_enrollments(4), teacher_assignments(4), student_profiles(3), teachers(3), +1 | 3 |
| `api/services/professional-assignments.service.ts` | 1331 | 14 | student_profiles(5), professional_enrollments(4), teachers(3), professional_session_ecue_teachers(1), +1 | 4 |
| `api/routes/student-courses.ts` | 971 | 14 | student_profiles(7), student_enrollments(6), teachers(1) | 5 |
| `api/routes/parent-documents.ts` | 1013 | 13 | student_parents(6), student_profiles(4), student_enrollments(3) | 6 |
| `api/routes/parents.ts` | 1459 | 12 | student_parents(7), student_profiles(4), student_enrollments(1) | 2 |
| `api/services/professional-diplomas.service.ts` | 1314 | 12 | student_profiles(5), professional_enrollments(4), professional_student_matricules(2), student_parents(1) | 5 |
| `api/routes/semester-averages.ts` | 1285 | 12 | student_enrollments(7), student_profiles(5) | 5 |
| `api/routes/parent-settings.ts` | 2037 | 11 | emergency_contacts(7), student_parents(2), student_profiles(2) | 2 |
| `api/services/owner-economie.service.ts` | 759 | 11 | professional_enrollments(6), teacher_assignments(2), professional_session_ecue_teachers(1), student_parents(1), +1 | 4 |
| `api/routes/assignments.ts` | 1161 | 9 | teachers(8), teacher_assignments(1) | 3 |
| `api/services/prospection.service.ts` | 886 | 9 | student_profiles(7), professional_enrollments(1), professional_student_matricules(1) | 2 |
| `api/routes/student-assignments.ts` | 666 | 9 | student_enrollments(4), teachers(3), student_profiles(2) | 4 |
| `api/routes/assignment-instances.ts` | 630 | 9 | teachers(5), student_enrollments(3), student_profiles(1) | 3 |
| `api/routes/teacher-courses.ts` | 454 | 9 | teachers(5), teacher_assignments(4) | 4 |
| `api/routes/teacher-corrections.ts` | 411 | 8 | student_enrollments(4), student_profiles(2), teachers(2) | 4 |
| `api/services/professional-ecue-materials.service.ts` | 298 | 8 | teachers(3), professional_enrollments(2), professional_session_ecue_teachers(1), student_parents(1), +1 | 4 |
| `api/routes/attendance.ts` | 1227 | 7 | teachers(4), student_profiles(2), teacher_assignments(1) | 3 |
| `api/routes/student-payments.ts` | 1185 | 7 | student_profiles(5), student_enrollments(2) | 3 |
| `api/services/owner-tresorerie.service.ts` | 896 | 7 | professional_enrollments(4), student_enrollments(2), student_profiles(1) | 3 |
| `api/routes/evaluation-questions.ts` | 830 | 7 | teachers(3), student_enrollments(2), student_profiles(2) | 3 |
| … 20 autres (liste complète : `tables-usage-matrix.json`, champ `refs`) | | | | |

### Jointures légères (48 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/academic-years.ts`, `api/routes/attendance-reports.ts`, `api/routes/auth.ts`, `api/routes/classes.ts`, `api/routes/course-assignments.ts`, `api/routes/course-hourly-rates.ts`, `api/routes/files.ts`, `api/routes/live-sessions.ts`, `api/routes/notifications.ts`, `api/routes/professional-remuneration.ts`, `api/routes/receipts.ts`, `api/routes/report-cards.ts`, `api/routes/sessions.ts`, `api/routes/simple-schedule.ts`, `api/routes/teacher-payment-configs.ts`, `api/routes/teacher-payments.ts`, `api/routes/teaching-hours.ts`, `api/routes/transcripts.ts`, `api/routes/tuition-schedules.ts`, `api/routes/webhooks/livekit.ts`, `api/services/ScheduleGeneratorService.ts`, `api/services/SchedulePersistenceService.ts`, `api/services/hour-collectors/academic-hour-collector.ts`, `api/services/hour-collectors/professional-hour-collector.ts`, `api/services/hour-collectors/types.ts`, `api/services/notifications-dispatch.service.ts`, `api/services/owner-academic.service.ts`, `api/services/owner-documents.service.ts`, `api/services/owner-finances.service.ts`, `api/services/owner-payroll.service.ts`, `api/services/owner-pedagogie.service.ts`, `api/services/owner-perimetre.sql.ts`, `api/services/owner-pro-annee.sql.ts`, `api/services/owner-programme.service.ts`, `api/services/owner-referentiel.service.ts`, `api/services/owner-scolarite.service.ts`, `api/services/owner-staff.service.ts`, `api/services/owner-stats-filters.service.ts`, `api/services/payment-calculator.ts`, `api/services/professional-cloture-guard.ts`, `api/services/professional-cycle-groups.ts`, `api/services/professional-ecue-rates.service.ts`, `api/services/professional-planning.service.ts`, `api/services/professional-seance-validation.service.ts`, `api/services/professional-semestre.service.ts`, `api/services/teacher-payroll-overview.service.ts`, `api/services/teacher-payslip.service.ts`, `api/services/whatsapp-delivery-log.ts`

### Routes HTTP d'entrée (61)

`api/routes/academic-years.ts`, `api/routes/admin-email.ts`, `api/routes/admin-messages.ts`, `api/routes/assignment-instances.ts`, `api/routes/assignments.ts`, `api/routes/attendance-reports.ts`, `api/routes/attendance.ts`, `api/routes/auth.ts`, `api/routes/classes.ts`, `api/routes/course-assignments.ts`, `api/routes/course-hourly-rates.ts`, `api/routes/enrollments.ts`, `api/routes/evaluation-questions.ts`, `api/routes/files.ts`, `api/routes/financial-reports.ts`, `api/routes/live-sessions.ts`, `api/routes/notifications.ts`, `api/routes/owner/index.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/parent-emergency.ts`, `api/routes/parent-grades.ts`, `api/routes/parent-homework.ts`, `api/routes/parent-messages.ts`, `api/routes/parent-payments.ts`, `api/routes/parent-settings.ts`, `api/routes/parents.ts`, `api/routes/payment-reports.ts`, `api/routes/professional-remuneration.ts`, `api/routes/professional.ts`, `api/routes/prospection.ts`, `api/routes/receipts.ts`, `api/routes/registration-requests.ts`, `api/routes/report-cards.ts`, `api/routes/schedule-generation.ts`, `api/routes/semester-averages.ts`, `api/routes/session-instances.ts`, `api/routes/sessions.ts`, `api/routes/simple-schedule.ts`, `api/routes/student-assignments.ts`, `api/routes/student-courses.ts`, `api/routes/student-grades.ts`, `api/routes/student-messages.ts`, `api/routes/student-payments.ts`, `api/routes/students.ts`, `api/routes/submissions.ts`, `api/routes/teacher-assignments.ts`, `api/routes/teacher-attendance.ts`, `api/routes/teacher-conversations.ts`, `api/routes/teacher-corrections.ts`, `api/routes/teacher-courses.ts`, `api/routes/teacher-messages.ts`, `api/routes/teacher-payment-configs.ts`, `api/routes/teacher-payments.ts`, `api/routes/teacher-students.ts`, `api/routes/teachers.ts`, `api/routes/teaching-hours.ts`, `api/routes/transcripts.ts`, `api/routes/tuition-schedules.ts`, `api/routes/webhooks/livekit.ts`

### Web : fichiers directs (22) et appelants (~236)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/academic/registrations/page.tsx` | 1028 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/teachers/page.tsx` | 573 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/students/new/page.tsx` | 547 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/parents/new/page.tsx` | 536 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/teachers/new/page.tsx` | 532 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/teachers/[id]/edit/page.tsx` | 479 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/students/[id]/edit/page.tsx` | 470 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/students/page.tsx` | 460 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/parents/page.tsx` | 451 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/register/page.tsx` | 433 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/parents/assign/page.tsx` | 376 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/parents/[id]/page.tsx` | 333 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/inscrits/page.tsx` | 331 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/teachers/[id]/page.tsx` | 330 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/inscrits/[id]/page.tsx` | 308 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/inscrits/etudiant/[studentId]/[filiereId]/page.tsx` | 254 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/students/[id]/page.tsx` | 248 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/parents/[id]/edit/page.tsx` | 229 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/academic/teachers/[id]/assignments/page.tsx` | 75 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/personnes/page.tsx` | 608 | 1 | student_enrollments(1) | 2 |
| `web/app/(dashboard)/simple-schedule/page.tsx` | 474 | 1 | teacher_assignments(1) | 2 |
| `web/lib/utils/session-report.ts` | 228 | 1 | student_profiles(1) | 1 |

Appelants par dossier (borne haute) : `lib/hooks` 71, `app/api/v1` 43, `app/api/teacher` 14, `components/assignments` 12, `app/(dashboard)/admin` 8, `app/(dashboard)/schedule-generation` 4, `app/api/assignments` 4, `lib/utils` 4, `app/academic/evaluations` 3, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/api/receipts` 2, `app/api/teacher-payments` 2, `app/evaluations/[id]` 2

### Tests existants (12)

- `api/__tests__/professional-parent.test.ts`
- `api/services/__tests__/professional-gardes.test.ts`
- `api/tests/payment-flow.integration.test.ts`
- `api/tests/student-payments.test.ts`
- `tests/contract/parent-grades.test.ts`
- `tests/contract/parent-homework.test.ts`
- `tests/integration/parent-assignment-grades.test.ts`
- `tests/integration/parent-completed-assignments.test.ts`
- `tests/integration/parent-grade-trends.test.ts`
- `tests/integration/parent-grades-by-course.test.ts`
- `tests/integration/parent-grades.test.ts`
- `tests/integration/parent-overall-averages.test.ts`

### Scripts, seeds et packages (68)

`api:scripts/add-student-admin-fields.js`, `api:scripts/calculate-and-create-payments.js`, `api:scripts/debug-student-grades.ts`, `api:scripts/delete-all-students.js`, `api:scripts/get-teacher-assignments.js`, `api:scripts/get-teachers.js`, `api:scripts/pro-tl-03-inscriptions.ts`, `api:scripts/pro-tl-04-paiements.ts`, `api:scripts/pro-tl-05-planning.ts`, `api:scripts/pro-tl-06-presences.ts`, `api:scripts/pro-tl-07-notes.ts`, `api:scripts/pro-tl-08-bulletins.ts`, `api:scripts/pro-tl-99-verification.ts`, `api:scripts/pro-tl-common.ts`, `api:scripts/seed-absences-fabrice-lprigla.ts`, `api:scripts/seed-finances-lprigla-scolarite-schedule.ts`, `api:scripts/seed-parents-lprigla-students.ts`, `api:scripts/seed-semester-averages-bts-gerna-1-500.ts`, `api:scripts/seed-simple-schedule-lprigla-year.ts`, `api:scripts/seed-student-payments-lprigla-class-a.ts`, `api:scripts/seed-students-academic-20.ts`, `api:scripts/seed-students-bts-gerna-1-500.ts`, `api:scripts/seed-students-lprigla-class-a.ts`, `api:scripts/seed-teacher-assignments-lprigla.ts`, `api:scripts/seed-teachers-cote-divoire.ts`, … +43

### Test de sortie de tranche

Un élève inscrit en classique ET en Professional a UNE ligne `Student` et DEUX `Enrollment` (ou une, selon le choix) ; plus de lecture croisée `student_enrollments` ∪ `professional_enrollments` ; un seul générateur de matricule.

## Tranche 2.3 — Présences, justificatifs, emploi du temps et conflits

**Remplace** : `attendance_*`, `professional_ecue_seances`, `time_slots`, `professional_emploi_temps` (+ `student_attendance`, `teacher_attendance_*`, `session_instances`, `classrooms`, `exam_schedules`, `academic_calendar_events`, `professional_course_plannings`).

**Taille** : **L** (calculée) — 22 fichiers API structurants (20168 lignes) + 28 jointures légères, 28 routes HTTP d'entrée, 27 fichiers web directs, ~126 fichiers web appelants (borne haute), 2 tests existants, 32 scripts/seeds.

**Tables** (16) : `academic_calendar_events`, `attendance_reports`, `attendance_sessions`, `classroom_reservations`, `classrooms`, `exam_schedules`, `professional_course_plannings`, `professional_ecue_attendance`, `professional_ecue_seances`, `professional_emploi_temps`, `session_instances`, `student_attendance`, `student_period_attendance_summaries`, `teacher_attendance_records`, `teacher_attendance_sessions`, `time_slots`

### Points de couplage dangereux

- **La séance Professional est AUSSI l'unité de paie** : `professional_ecue_seances` est lue par le collecteur d'heures (`apps/api/src/services/hour-collectors/professional-hour-collector.ts:48-59`) via `DUREE_PAYEE_SQL` et `SEANCE_PAYABLE_PREDICATE` (`apps/api/src/services/professional-seance-validation.service.ts:46,85`, colonnes `validated_at`, `duree_payee`, statut « réalisée »). Toute refonte de la séance (2.3) doit conserver ces deux fragments ou migrer le collecteur dans la même livraison (2.7). La suppression d'une séance est restreinte tant qu'une ligne de détail de paie la référence (`payment_hour_details.seance_id`, migration 0105).
- **Deux chaînes de présence classiques + une Professional** : `attendance_sessions`/`student_attendance` (élèves, 0008), `teacher_attendance_sessions/records` (enseignants, 0028, lues par le collecteur académique `hour-collectors/academic-hour-collector.ts:44-62` avec `s.status = 'completed'` et `s.duration_hours`), `professional_ecue_attendance` (0069, justificatifs 0100/0101). Aucune clé commune ; le résumé `student_period_attendance_summaries` n'existe que dans la chaîne Prisma (`semester-averages.ts`, 4 citations).
- **Le webhook LiveKit écrit dans les présences classiques** : `apps/api/src/routes/webhooks/livekit.ts:216-300` fait correspondre un `session_instances` (date + classe + enseignant), crée un `attendance_sessions` et un `student_attendance` avec `marked_via = 'livekit'` (colonne ajoutée par 0056). Le modèle de présence cible doit garder ce point d'entrée (et l'identité `tu_…`/`pu_…` du jeton).
- **Code mort référençant des tables supprimées** : `apps/api/src/routes/schedule-generation.ts` (enregistrée à `/api/v1/schedule-generation`) et `apps/api/src/services/SchedulePersistenceService.ts` interrogent `scheduled_sessions`, `generated_schedules`, `schedule_generation_requests`, `approved_schedules`, toutes supprimées par `0027_cleanup_old_schedule_tables.sql` ; la vue `calendar_sessions` (0024) repose sur `scheduled_sessions`. À vérifier en base réelle puis SUPPRIMER plutôt que porter. Fichiers de routes non enregistrées dans `index.ts` (mortes) : `session-instances.ts`, `sessions.update.ts`, `assignment-instances.ts`, `student-dashboard.ts`.
- **L'emploi du temps Professional est généré côté web** (DOCX/PDF jsPDF : `apps/web/src/lib/emploi-temps-docx.ts` 308 lignes, `emploi-temps-pdf.ts` 303, `emploi-temps-model.ts` 166) alors que la détection de conflits du plan est un use case serveur : prévoir le déplacement du modèle vers l'API (cf. 2.6 pour le PDF serveur).
- **`time_slots` est clonée depuis le tenant de référence** (`tenant-provisioning.service.ts:7`) et fusionnée par la boucle de `0055` : voir 2.1.
- **Les salles ne sont PAS une clé commune** : le Professional référence `classrooms` (`professional_ue_sessions.classroom_id` et `professional_ecue_seances.classroom_id`, 0069:150,176) alors que la séance classique `session_instances` stocke le nom de la salle en texte libre (`classroom VARCHAR(255)`, `0026_simplify_schedule_system.sql:44`) ; les créneaux non plus (`time_slots` côté classique, `heure_debut/heure_fin` libres côté séance ECUE). La détection de conflits du plan suppose de normaliser les deux avant de la construire.

### Fichiers API structurants (22)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/routes/parent-children.ts` | 2056 | 41 | teacher_attendance_records(10), student_attendance(9), session_instances(8), attendance_sessions(4), +4 | 5 |
| `api/routes/attendance.ts` | 1227 | 34 | attendance_sessions(15), student_attendance(7), session_instances(4), teacher_attendance_sessions(4), +2 | 3 |
| `api/routes/teacher-attendance.ts` | 1072 | 32 | teacher_attendance_sessions(26), teacher_attendance_records(6) | 4 |
| `api/services/professional-ue.service.ts` | 1590 | 28 | professional_ecue_attendance(17), professional_ecue_seances(10), classrooms(1) | 3 |
| `api/services/professional-seance-validation.service.ts` | 874 | 25 | professional_ecue_seances(15), professional_ecue_attendance(3), professional_emploi_temps(1) | 4 |
| `api/services/owner-assiduite.service.ts` | 628 | 22 | professional_ecue_attendance(6), professional_ecue_seances(6), professional_emploi_temps(5), classrooms(4), +1 | 5 |
| `api/routes/webhooks/livekit.ts` | 503 | 18 | student_attendance(7), attendance_sessions(3), session_instances(2) | 3 |
| `api/services/professional-emploi-temps.service.ts` | 455 | 17 | professional_emploi_temps(9), classrooms(2) | 3 |
| `api/services/professional-teacher.service.ts` | 560 | 16 | professional_ecue_seances(8), professional_ecue_attendance(6), classrooms(1), professional_emploi_temps(1) | 4 |
| `api/services/professional-planning.service.ts` | 317 | 12 | professional_course_plannings(6) | 3 |
| `api/services/owner-remplissage.service.ts` | 613 | 11 | professional_emploi_temps(7), professional_ecue_seances(3), classrooms(1) | 5 |
| `api/routes/classrooms.ts` | 489 | 10 | classrooms(7), classroom_reservations(3) | 1 |
| `api/routes/parent-academic.ts` | 1068 | 9 | academic_calendar_events(4), exam_schedules(4), session_instances(1) | 5 |
| `api/services/SchedulePersistenceService.ts` | 352 | 9 | session_instances(3) | 3 |
| `api/services/ScheduleGeneratorService.ts` | 491 | 8 | classrooms(2) | 3 |
| `api/routes/classroom-reservations.ts` | 432 | 8 | classroom_reservations(7), classrooms(1) | 2 |
| `api/routes/teacher-assignments.ts` | 1578 | 7 | session_instances(7) | 4 |
| `api/services/owner-risque.service.ts` | 634 | 7 | professional_ecue_seances(4), professional_ecue_attendance(3) | 5 |
| `api/routes/academic-calendar-events.ts` | 615 | 7 | academic_calendar_events(7) | 2 |
| `api/services/professional-seance-constat.ts` | 54 | 7 | professional_ecue_seances(1) | 1 |
| `api/routes/professional.ts` | 4159 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/routes/session-instances.ts` | 401 | 6 | session_instances(6) | 3 |

### Jointures légères (28 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/attendance-reports.ts`, `api/routes/classes.ts`, `api/routes/exam-schedules.ts`, `api/routes/live-sessions.ts`, `api/routes/parent-documents.ts`, `api/routes/payment-reports.ts`, `api/routes/schedule-generation.ts`, `api/routes/semester-averages.ts`, `api/routes/sessions.ts`, `api/routes/sessions.update.ts`, `api/routes/simple-schedule.ts`, `api/routes/student-courses.ts`, `api/routes/teacher-students.ts`, `api/services/hour-collectors/academic-hour-collector.ts`, `api/services/hour-collectors/professional-hour-collector.ts`, `api/services/hour-collectors/types.ts`, `api/services/owner-academic.service.ts`, `api/services/owner-payroll-mass.service.ts`, `api/services/owner-programme.service.ts`, `api/services/owner-pulse.service.ts`, `api/services/professional-assignments.service.ts`, `api/services/professional-bulletin.service.ts`, `api/services/professional-ecue-materials.service.ts`, `api/services/professional-enrollment.service.ts`, `api/services/professional-live-sessions.service.ts`, `api/services/teacher-payroll-overview.service.ts`, `api/services/teacher-payslip.service.ts`, `api/services/tenant-provisioning.service.ts`

### Routes HTTP d'entrée (28)

`api/routes/academic-calendar-events.ts`, `api/routes/attendance-reports.ts`, `api/routes/attendance.ts`, `api/routes/classes.ts`, `api/routes/classroom-reservations.ts`, `api/routes/classrooms.ts`, `api/routes/exam-schedules.ts`, `api/routes/live-sessions.ts`, `api/routes/owner/index.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/payment-reports.ts`, `api/routes/professional-remuneration.ts`, `api/routes/professional.ts`, `api/routes/schedule-generation.ts`, `api/routes/semester-averages.ts`, `api/routes/session-instances.ts`, `api/routes/sessions.ts`, `api/routes/simple-schedule.ts`, `api/routes/student-courses.ts`, `api/routes/super-admin-roles.ts`, `api/routes/super-admin-tenants.ts`, `api/routes/teacher-assignments.ts`, `api/routes/teacher-attendance.ts`, `api/routes/teacher-payments.ts`, `api/routes/teacher-students.ts`, `api/routes/webhooks/livekit.ts`

### Web : fichiers directs (27) et appelants (~126)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/(dashboard)/schedule-generation/stats/page.tsx` | 394 | 7 | session_instances(1) | 1 |
| `web/app/(dashboard)/schedule-generation/page.tsx` | 700 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/(dashboard)/attendance/[id]/page.tsx` | 612 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/(dashboard)/attendance/page.tsx` | 586 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/(dashboard)/schedule-generation/[requestId]/page.tsx` | 521 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/(dashboard)/attendance/admin/page.tsx` | 493 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/professional/TeacherSeancesPanel.tsx` | 483 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/(dashboard)/simple-schedule/page.tsx` | 474 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/(dashboard)/attendance/student/page.tsx` | 421 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/attendance/[seanceId]/page.tsx` | 402 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/teacher/schedule/calendar/page.tsx` | 387 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/(dashboard)/schedule-generation/calendar/page.tsx` | 383 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/attendance/page.tsx` | 377 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/lib/emploi-temps-docx.ts` | 309 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/emploi-temps-pdf.ts` | 304 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/professional-seances/page.tsx` | 302 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/schedule/AddSessionDialog.tsx` | 282 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/schedule/StatsCards.tsx` | 251 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/schedule/CalendarView.tsx` | 249 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/attendance/new/page.tsx` | 197 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/schedule/Calendar.tsx` | 196 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/professional/EmploiTempsGrid.tsx` | 191 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/emploi-temps-model.ts` | 167 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/schedule/page.tsx` | 146 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/schedule/ClassSelector.tsx` | 124 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/schedule/SessionDetails.tsx` | 80 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-attendance.ts` | 384 | 1 | session_instances(1) | 1 |

Appelants par dossier (borne haute) : `lib/hooks` 52, `app/api/v1` 13, `app/api/teacher` 8, `app/(dashboard)/schedule-generation` 4, `lib/utils` 4, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/api/teacher-payments` 2, `app/live/[id]` 2, `app/owner/assiduite` 2, `app/payments/manage` 2, `components/owner` 2, `components/schedule` 2, `app/(dashboard)/attendance` 1

### Tests existants (2)

- `api/__tests__/payment-calculator-academic.test.ts`
- `web/app/(dashboard)/attendance/[id]/__tests__/attendance-excuse-reason.test.ts`

### Scripts, seeds et packages (35)

`api:scripts/pro-tl-02-classrooms.ts`, `api:scripts/pro-tl-05-planning.ts`, `api:scripts/pro-tl-06-presences.ts`, `api:scripts/pro-tl-99-verification.ts`, `api:scripts/rattraper-seances-appelees.ts`, `api:scripts/seed-absences-fabrice-lprigla.ts`, `api:scripts/seed-semester-averages-bts-gerna-1-500.ts`, `api:scripts/seed-simple-schedule-lprigla-year.ts`, `api:scripts/verif-heures-consommees.ts`, `infra/scripts/tests/cleanup-and-test.js`, `infra/scripts/tests/schedule-generation-cleanup-and-test.ts`, `scripts/ajouter-heures-aout-2026.js`, `scripts/ajouter-seances-decembre-2025.js`, `scripts/apply-migration-0103-remuneration-pro.js`, `scripts/apply-migration-0104-duree-payee.js`, `scripts/check-payment-hour-details-fk.js`, `scripts/configurer-enseignants-manquants.js`, `scripts/creer-session-aout-2026.js`, `scripts/db-audit.js`, `scripts/fix-seances-chevauchements.js`, `scripts/generate-audit-documentation.js`, `scripts/migrate-academic-calendar-events.js`, `scripts/migrate-attendance-reports.js`, `scripts/migrate-exam-schedules.js`, `scripts/parcours-paie-janvier-2026.js`, … +10

### Test de sortie de tranche

Une séance réalisée alimente à la fois la présence et le collecteur d'heures (test `seance-constat-realisee.test.ts` et `heures-consommees.test.ts` verts) ; le webhook LiveKit écrit toujours une présence ; les routes mortes sont supprimées.

## Tranche 2.4 — Rules Engine + RuleSets BTS/LMD et classique + golden tests

**Remplace** : `bulletin-calc.ts`, `semester-averages.ts`, doublons web (aucune table : tranche de calcul).

**Taille** : **M** (calculée) — 7 fichiers API structurants (7086 lignes) + 0 jointures légères, 1 routes HTTP d'entrée, 5 fichiers web directs, ~0 fichiers web appelants (borne haute), 3 tests existants, 0 scripts/seeds.

**Tables** (0) : (aucune : tranche de calcul)

### Points de couplage dangereux

- **Formules BTS/LMD codées en dur, déjà isolées** : `apps/api/src/services/bulletin-calc.ts:24-29` (0,4/0,6, seuil 10, éliminatoire 5, 20 crédits, > 48) et fonctions pures `:73-210` (`evaluerEcue`, `moyenneUe`, `moyenneSession`, `semestreValide`, `peutPasserAnneeSuperieure`). Ce sont les seules déjà testables isolément : point de départ des golden tests. Mais `professional-bulletin.service.ts:711` recalcule la moyenne annuelle (Σ/crédits) hors de ce module, `:748` le rang.
- **Formules classiques noyées dans une route** : `apps/api/src/routes/semester-averages.ts:1151` `(sem1 + sem2 × 2) / 3`, `:197-207` `buildEndYearDecision` (≥ 10 → admis, sinon redoublement ; texte libre), `:209-218` `buildAssignmentFlagsFromDecision` qui **déduit « redoublant » en cherchant « REDOUBL » dans la décision en texte**, `:220-226` distinctions (≥ 17 / ≥ 15 / ≥ 12), `:228` appréciation du conseil. Ces fonctions sont locales à la fonction de plugin Fastify (non exportées, non testables).
- **Moyennes classiques SAISIES puis écrasées** : `semester-averages.ts:488-494,650` font `DELETE FROM student_period_course_averages` puis `INSERT` — pas d'historique, pas de recalcul. Le plan remplace par une moyenne calculée avec surcharge justifiée : la table sert aussi de source aux bulletins Puppeteer (`report-card-template.service.ts`).
- **Doublons web des seuils et libellés** (le web recalcule des mentions) : `apps/web/src/lib/bulletin-format.ts:65-72` (`appreciation` : < 10, 12, 14, 16, 18), `:187-195` (`appreciationGenerale` : 8, 10, 12, 14, 16, 18, qui « reprend le libellé de semester-averages.ts »), `:76-82` (grade par regex sur le nom de filière), `:174-180` (niveau par regex), `:199` (`isLicenceUnOuDeux`), `apps/web/src/lib/diplome-format.ts:191`. Plus : `apps/web/src/lib/bulletin-pdf.ts`, `bulletin-pdf-bts.ts` (« Moyenne annuelle », l. 308-339).
- **Conduite détectée par heuristique textuelle** : `apps/api/src/services/owner-pedagogie.service.ts` `NOT_CONDUITE = "NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')"` ; migration `0123_conduite_transversale.sql` ; page `apps/web/src/app/professionnel/admin/conduite/page.tsx`. Le RuleSet doit porter un attribut « matière non comptée dans les statistiques » plutôt qu'un motif sur le libellé.
- **`owner-pedagogie.service.ts` ne recalcule rien : il lit `b.data->>'decision'`** (`:228-229,271-273` — valeurs `admis`/`rattrapage`/`ajourne`) et `jsonNumber(key)` (`:179`) sur `professional_bulletins.data`. Si le moteur change le JSON du bulletin (clé `decision`, noms des clés numériques, valeurs), les tableaux de bord owner se vident sans erreur (`safeQuery` avale les échecs, `:38-50`). À figer par un test de contrat sur le JSON du snapshot (2.6) avant 2.4.
- **Tests de caractérisation existants à réutiliser (2.0)** : `apps/api/src/__tests__/professional-results.test.ts`, `professional-ecue.test.ts`, `professional-completion.test.ts`, `heures-consommees.test.ts`, `apps/web/e2e/moyennes-semestre.spec.ts`, scripts `scripts/verify-moyennes-semestre.mjs` / `verify-moyennes-semestre-stack.mjs`, scénario `docs/testing/e2e-computer-use/scenarios/S17-T-paie-tenant-test-30091.md`. Aucun test ne couvre `semester-averages.ts` (formule `(S1+2·S2)/3`, décisions).

### Fichiers API structurants (7)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/services/professional-bulletin.service.ts` | 1911 | — | (rattaché à la main : formule / écran / PDF) | 6 |
| `api/services/professional-results.service.ts` | 1391 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/professional-diplomas.service.ts` | 1314 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/routes/semester-averages.ts` | 1285 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-pedagogie.service.ts` | 696 | — | (rattaché à la main : formule / écran / PDF) | 6 |
| `api/services/professional-cycle-groups.ts` | 275 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/bulletin-calc.ts` | 214 | — | (rattaché à la main : formule / écran / PDF) | 1 |

### Routes HTTP d'entrée (1)

`api/routes/semester-averages.ts`

### Web : fichiers directs (5) et appelants (~0)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/annee-academique/moyennes-semestre/page.tsx` | 1004 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/professional/BulletinView.tsx` | 316 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/diplome-format.ts` | 245 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `web/lib/bulletin-format.ts` | 239 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/lib/hooks/use-semester-averages.ts` | 218 | — | (rattaché à la main : formule / écran / PDF) | 1 |

Appelants par dossier (borne haute) : —

### Tests existants (3)

- `api/__tests__/professional-ecue.test.ts`
- `api/__tests__/professional-results.test.ts`
- `web:e2e/moyennes-semestre.spec.ts`

### Scripts, seeds et packages (0)

_aucun_

### Test de sortie de tranche

Les sorties JSON figées en 2.0 sont reproduites à l'identique par le RuleSet ; aucune constante de seuil dans `modules/**` hors `rules-engine` ; `bulletin-format.ts` ne calcule plus de mention.

## Tranche 2.5 — Évaluations, notes, workflow, GradeRevision, résultats, clôture, rattrapage

**Remplace** : `professional_assignments`, `professional_ecue_notes/results`, `student_period_course_averages`, `submissions` (+ `assignments*`, `evaluation_*`, `ai_*`).

**Taille** : **L** (calculée) — 22 fichiers API structurants (23483 lignes) + 15 jointures légères, 22 routes HTTP d'entrée, 35 fichiers web directs, ~159 fichiers web appelants (borne haute), 7 tests existants, 18 scripts/seeds.

**Tables** (20) : `ai_document_processing`, `ai_generated_questions`, `ai_generation_usage`, `assignment_instances`, `assignment_submissions`, `assignments`, `course_materials`, `evaluation_question_responses`, `evaluation_questions`, `homework_annotations`, `professional_assignment_question_answers`, `professional_assignment_questions`, `professional_assignment_submissions`, `professional_assignments`, `professional_ecue_material_views`, `professional_ecue_materials`, `professional_ecue_notes`, `professional_ecue_results`, `student_period_course_averages`, `student_professional_ue_results`

### Points de couplage dangereux

- **Deux piles de notes sans workflow ni historique** : classique (`assignments`/`assignment_submissions`/`student_period_course_averages` — moyennes saisies) et Professional (`professional_assignments`, `professional_ecue_notes`, `professional_ecue_results`). Aucune table de révision : côté Professional `professional_ecue_notes` (0078) est modifiée en place (`updated_at`, un seul examen par ECUE/étudiant/cohorte via index unique partiel) ; côté classique les moyennes sont supprimées/réinsérées (`semester-averages.ts:488-494`). Le trigger d'immuabilité du plan n'a pas d'équivalent à migrer — mais les bulletins déjà générés (`professional_bulletins.data`) sont, eux, figés : ne PAS les recalculer lors de la migration.
- **Verrou de clôture par semestre** : `apps/api/src/services/professional-cloture-guard.ts:1-40` empêche la saisie de notes quand `professional_semestres.bulletins_clotures_at` est posé (migration 0115) ; appelé par `professional-assignments.service.ts:3` et `professional-results.service.ts:6`. Le workflow `DRAFT → … → PUBLISHED` doit reprendre exactement cette règle, sinon on rouvre des notes de bulletins déjà remis. Tests existants : `apps/api/src/services/__tests__/professional-gardes.test.ts`.
- **`routes/submissions.ts` (2 125 lignes) + `routes/assignments.ts` (1 160)** portent à la fois le dépôt de devoirs, la correction, la note et l'IA (`ai-evaluations.ts`, `ai-evaluation.service.ts`) ; le plan ne parle que de notes : prévoir de séparer « LMS / devoirs » (hors V1, après-V1 spec 022) de « évaluation / note ».
- **Rattrapages** : session 1/2 (`COALESCE(session, 1)` dans `professional-bulletin.service.ts:948,1106`), pages `apps/web/src/app/professionnel/admin/notes/rattrapages/page.tsx`, `apps/web/src/components/RattrapagesView.tsx`, rapports `apps/web/src/lib/utils/rattrapage-report.ts` ; `owner-pedagogie` compte `decision = 'rattrapage'`. La notion de session doit être un champ du modèle de résultat, pas un entier implicite.
- **Notes affichées côté parent/élève via des routes distinctes** : `parent-grades.ts` (1 103 lignes), `student-grades.ts`, `parent-homework.ts`, `student-assignments.ts` : ce sont des lecteurs (2.8) mais ils joignent les tables de notes de 2.5 ; ne pas les oublier au moment de supprimer l'ancien modèle.
- **Évaluations « en ligne » côté Professional** : `professional_assignment_questions/answers`, composants `OnlineEvaluationPlayer.tsx`, `SubmissionAnswersReviewer.tsx`, `AssignmentQuestionsManager.tsx` (`apps/web/src/components/professional/`) ; la pile classique a la sienne (`evaluation_questions`, `evaluation_question_responses`). Deux moteurs de QCM à fusionner.

### Fichiers API structurants (22)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/services/professional-assignments.service.ts` | 1331 | 71 | professional_assignments(30), professional_assignment_submissions(16), professional_assignment_questions(13), professional_assignment_question_answers(6), +1 | 4 |
| `api/routes/submissions.ts` | 2126 | 54 | assignment_submissions(27), assignments(14), assignment_instances(11), evaluation_question_responses(1), +1 | 3 |
| `api/services/professional-results.service.ts` | 1391 | 51 | professional_ecue_notes(19), professional_ecue_results(13), professional_assignments(5), student_professional_ue_results(5), +2 | 4 |
| `api/routes/teacher-students.ts` | 948 | 34 | assignment_submissions(15), assignments(14), assignment_instances(5) | 5 |
| `api/routes/assignments.ts` | 1161 | 22 | assignments(15), ai_generated_questions(2), course_materials(2), evaluation_questions(2), +1 | 3 |
| `api/routes/parent-homework.ts` | 1444 | 18 | assignment_instances(5), assignment_submissions(5), assignments(5), course_materials(3) | 4 |
| `api/routes/assignment-instances.ts` | 630 | 17 | assignment_instances(7), assignments(7), assignment_submissions(3) | 3 |
| `api/routes/parent-grades.ts` | 1104 | 15 | assignment_instances(5), assignment_submissions(5), assignments(5) | 4 |
| `api/routes/student-assignments.ts` | 666 | 15 | assignment_instances(5), assignments(4), assignment_submissions(3), evaluation_questions(3) | 4 |
| `api/routes/evaluation-questions.ts` | 830 | 14 | evaluation_questions(7), assignments(5), assignment_instances(2) | 3 |
| `api/services/professional-bulletin.service.ts` | 1911 | 10 | professional_ecue_notes(4), professional_assignment_submissions(2), professional_assignments(2), professional_ecue_results(2) | 6 |
| `api/services/professional-ecue-materials.service.ts` | 298 | 9 | professional_ecue_materials(6), professional_ecue_material_views(3) | 4 |
| `api/routes/semester-averages.ts` | 1285 | 8 | student_period_course_averages(8) | 5 |
| `api/routes/materials.ts` | 636 | 8 | course_materials(8) | 2 |
| `api/routes/professional.ts` | 4159 | 7 | professional_assignment_submissions(1) | 5 |
| `api/services/professional-cloture-guard.ts` | 116 | 7 | professional_assignments(1) | 3 |
| `api/services/owner-pedagogie.service.ts` | 696 | 6 | professional_ecue_notes(3), professional_ecue_results(3) | 6 |
| `api/routes/teacher-corrections.ts` | 411 | 6 | assignments(3), assignment_submissions(2), assignment_instances(1) | 4 |
| `api/services/ai-evaluation.service.ts` | 313 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/services/owner-risque.service.ts` | 634 | 5 | professional_ecue_material_views(2), professional_ecue_materials(1), professional_ecue_notes(1), professional_ecue_results(1) | 5 |
| `api/routes/student-grades.ts` | 263 | 5 | assignment_submissions(2), assignments(2), assignment_instances(1) | 4 |
| `api/routes/files.ts` | 1130 | 3 | assignment_instances(1), assignment_submissions(1), assignments(1) | 3 |

### Jointures légères (15 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/ai-evaluations.ts`, `api/routes/courses.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/student-courses.ts`, `api/routes/teacher-courses.ts`, `api/services/owner-academic.service.ts`, `api/services/owner-assiduite.service.ts`, `api/services/owner-documents.service.ts`, `api/services/professional-attestations.service.ts`, `api/services/professional-cycle-groups.ts`, `api/services/professional-diplomas.service.ts`, `api/services/professional-enrollment.service.ts`, `api/services/professional-teacher.service.ts`

### Routes HTTP d'entrée (22)

`api/routes/ai-evaluations.ts`, `api/routes/assignment-instances.ts`, `api/routes/assignments.ts`, `api/routes/courses.ts`, `api/routes/evaluation-questions.ts`, `api/routes/files.ts`, `api/routes/materials.ts`, `api/routes/owner/index.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/parent-grades.ts`, `api/routes/parent-homework.ts`, `api/routes/professional.ts`, `api/routes/semester-averages.ts`, `api/routes/student-assignments.ts`, `api/routes/student-courses.ts`, `api/routes/student-grades.ts`, `api/routes/submissions.ts`, `api/routes/teacher-corrections.ts`, `api/routes/teacher-courses.ts`, `api/routes/teacher-students.ts`

### Web : fichiers directs (35) et appelants (~159)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/professionnel/admin/notes/page.tsx` | 1018 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/FileUploadSubmission.tsx` | 732 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/grades/page.tsx` | 720 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/professionnel/admin/notes/historique/page.tsx` | 629 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/assignments/[id]/page.tsx` | 601 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/assignments/OnlineEvaluationSubmission.tsx` | 597 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/notes/rattrapages/page.tsx` | 581 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/grades/page.tsx` | 532 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/teacher/corrections/page.tsx` | 525 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-professional-assignments.ts` | 519 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/evaluations/history/page.tsx` | 444 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/assignments/page.tsx` | 440 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/assignments/SubmissionReviewModal.tsx` | 404 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/evaluations/QuestionsList.tsx` | 398 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/TextResponseSubmission.tsx` | 388 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/RattrapagesView.tsx` | 316 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/evaluations/DocumentSelector.tsx` | 316 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadUnified.tsx` | 292 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/evaluations/SubmissionsList.tsx` | 285 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/UploadDebugger.tsx` | 216 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/DownloadDebugger.tsx` | 199 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadAllMethods.tsx` | 175 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadTest.tsx` | 164 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadFallback.tsx` | 160 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadMultiFormat.tsx` | 154 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadDebug.tsx` | 136 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadFinal.tsx` | 129 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadFixed.tsx` | 128 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadDirect.tsx` | 126 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadButtonV2.tsx` | 115 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadNextAPI.tsx` | 104 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadButton.tsx` | 102 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadSimple.tsx` | 80 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/assignments/AssignmentDownloadAPI.tsx` | 75 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/api/v1/student/assignments/route.ts` | 175 | 1 | professional_assignments(1) | 1 |

Appelants par dossier (borne haute) : `lib/hooks` 53, `app/api/v1` 30, `app/api/teacher` 12, `components/assignments` 12, `app/api/assignments` 4, `lib/utils` 4, `app/academic/evaluations` 3, `app/api/materials` 3, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/evaluations/[id]` 2, `app/owner/assiduite` 2, `components/owner` 2, `app/api/courses` 1

### Tests existants (7)

- `tests/contract/parent-grades.test.ts`
- `tests/integration/parent-assignment-grades.test.ts`
- `tests/integration/parent-completed-assignments.test.ts`
- `tests/integration/parent-grade-trends.test.ts`
- `tests/integration/parent-grades-by-course.test.ts`
- `tests/integration/parent-grades.test.ts`
- `tests/integration/parent-overall-averages.test.ts`

### Scripts, seeds et packages (19)

`api:scripts/debug-student-grades.ts`, `api:scripts/delete-assignments-by-title.js`, `api:scripts/inject-test-subject.js`, `api:scripts/pro-tl-07-notes.ts`, `api:scripts/pro-tl-99-verification.ts`, `api:scripts/seed-more-evaluations.js`, `api:scripts/seed-online-evaluation.js`, `api:scripts/seed-semester-averages-bts-gerna-1-500.ts`, `api:scripts/seed-test-online-submission.js`, `api:scripts/seed-upcoming-deadlines-lprigla.ts`, `scripts/apply-migration-0066-professional-session-features.js`, `scripts/check-duplicate-courses.ts`, `scripts/generate-audit-documentation.js`, `scripts/remove-duplicate-course-direct.ts`, `scripts/remove-duplicate-course.ts`, `scripts/seed-genie-logiciel-workflow.js`, `scripts/seed-professional-session-evaluations.js`, `scripts/seed-remaining-submissions-algebre-pdf-lprigla.ts`, `packages/contracts/src/owner-stats.schema.ts`

### Test de sortie de tranche

Golden tests : mêmes moyennes qu'en 2.0 ; une note publiée est immuable (test d'intégration + trigger) ; saisie bloquée sur semestre clôturé ; `student_period_course_averages` supprimée.

## Tranche 2.6 — Bulletins snapshot + PDF serveur, relevés, diplômes, attestations, signataires

**Remplace** : `report_cards`, `transcripts`, `professional_bulletins`, générateurs jsPDF.

**Taille** : **M** (calculée) — 9 fichiers API structurants (10801 lignes) + 4 jointures légères, 5 routes HTTP d'entrée, 22 fichiers web directs, ~74 fichiers web appelants (borne haute), 0 tests existants, 7 scripts/seeds.

**Tables** (7) : `professional_bulletins`, `professional_diploma_requirements`, `professional_diplomas`, `professional_signataires`, `report_cards`, `student_professional_diplomas`, `transcripts`

### Points de couplage dangereux

- **Le bulletin Professional est déjà un snapshot JSON, mais sans version de règle ni hash** : `professional_bulletins.data` (JSONB, migration 0083 ; statut `provisoire|definitif`, UNIQUE (tenant, étudiant, semestre)) ; clôture de semestre par `professional_semestres.bulletins_clotures_at` (0115) ; RLS ajoutée tardivement par 0130 et sans effet réel tant que l'API se connecte en propriétaire/super-utilisateur (cf. en-tête de 0130) ; la référence d'authenticité AUTH/année/NNN (0089) est portée par `student_professional_diplomas`, pas par le bulletin. Il est LU par l'owner (`owner-pedagogie.service.ts:179,228-273`) et par les services de diplômes (`professional-diplomas.service.ts`, `professional-cycle-groups.ts` — cycles Licence/Master). Le futur `ReportCard` doit reprendre ces clés JSON ou une vue de compatibilité doit les exposer jusqu'à 2.8.
- **Le bulletin classique n'est pas calculé** : `report_cards` (0034) stocke une note saisie + une URL de fichier (`routes/report-cards.ts:5-20`, `report_url`) ; `transcripts` (0035) est analogue ; la génération réelle passe par `report-card-template.service.ts` (Puppeteer, 867 lignes) appelé depuis `semester-averages.ts`. Trois mécanismes de bulletin coexistent.
- **Deux moteurs PDF** : Puppeteer côté API (`report-card-template.service.ts`, `attendance-certificate-template.service.ts`, `receipt-generator.service.ts`, `pdf-generation.service.ts`) et jsPDF côté web (`bulletin-pdf.ts` 517 lignes, `bulletin-pdf-bts.ts` 490, `diplome-pdf.ts` 567, `attestation-pdf.ts` 358, `attestation-authenticite-pdf.ts` 499, plus `receipt-pdf.ts`, `payslip-pdf.ts`, `emploi-temps-pdf.ts`). Les PDF jsPDF dépendent des helpers de format de la tranche 2.4.
- **Identité de l'établissement codée en dur dans chaque gabarit** : `apps/web/src/lib/bulletin-format.ts:6-48` (ministère, `INSTITUT = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT"`, logos `/logo-ipam.jpeg`, couleurs IPAM) ; côté API « IMHOTEP ACADEMY (EXASP CI) » dans `report-card-template.service.ts:399-404`, `attendance-certificate-template.service.ts:444,467,504,509`, `receipt-generator.service.ts:414`, `teacher-payslip.service.ts:91`, `invoice.service.ts:117`. Le branding par tenant est un prérequis du PDF serveur (plan §3.10), sinon le premier tenant non-IPAM imprimera le logo d'un autre.
- **Signataires et authenticité** : `professional_signataires` (0087) et la référence d'authenticité (0089) alimentent le QR de vérification ; la page publique de vérification, si elle existe, doit être inventoriée avant de supprimer `professional_bulletins`/`professional_diplomas`.
- **Les bulletins sont LUS par le portail parent/élève avec des filtres SQL propres** (`parent-documents.ts` 1 013 lignes touche 5 tranches ; `professional-bulletin.service.ts` expose `getBulletinForUser`, `getChildBulletin`, `listChildSemestres`, :853-1090) : trois chemins d'autorisation (admin, titulaire, parent) à reprendre — le fix récent « bulletin de paie réservé à son titulaire ou à la gestion » (`1dbb34f`) montre que ces gardes sont sensibles.

### Fichiers API structurants (9)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/services/professional-diplomas.service.ts` | 1314 | 40 | student_professional_diplomas(16), professional_diplomas(11), professional_diploma_requirements(6), professional_signataires(1), +1 | 5 |
| `api/services/professional-bulletin.service.ts` | 1911 | 13 | professional_bulletins(7) | 6 |
| `api/services/owner-pedagogie.service.ts` | 696 | 9 | professional_bulletins(9) | 6 |
| `api/services/owner-documents.service.ts` | 397 | 8 | professional_diplomas(3), student_professional_diplomas(3), professional_diploma_requirements(1), professional_signataires(1) | 5 |
| `api/services/professional-signataires.service.ts` | 98 | 8 | professional_signataires(2) | 1 |
| `api/routes/professional.ts` | 4159 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/attendance-certificate-template.service.ts` | 1079 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/services/report-card-template.service.ts` | 868 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/services/professional-attestations.service.ts` | 279 | — | (rattaché à la main : formule / écran / PDF) | 4 |

### Jointures légères (4 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/parent-documents.ts`, `api/routes/report-cards.ts`, `api/routes/transcripts.ts`, `api/services/professional-cycle-groups.ts`

### Routes HTTP d'entrée (5)

`api/routes/owner/index.ts`, `api/routes/parent-documents.ts`, `api/routes/professional.ts`, `api/routes/report-cards.ts`, `api/routes/transcripts.ts`

### Web : fichiers directs (22) et appelants (~74)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/lib/diplome-format.ts` | 245 | 7 | professional_signataires(1) | 3 |
| `web/app/professionnel/admin/diplomes/page.tsx` | 653 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/bulletins/historique/page.tsx` | 625 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/diplomes/[id]/page.tsx` | 617 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/bulletins/page.tsx` | 569 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/diplome-pdf.ts` | 568 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-professional-bulletins.ts` | 545 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/attestations/page.tsx` | 539 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/bulletin-pdf.ts` | 518 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/attestation-authenticite-pdf.ts` | 500 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/bulletin-pdf-bts.ts` | 491 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/bulletins/[studentId]/page.tsx` | 464 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/attestation-pdf.ts` | 359 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-professional-diplomas.ts` | 345 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/bulletin-format.ts` | 239 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/api/v1/report-cards/[id]/route.ts` | 237 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/signataires/page.tsx` | 226 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/diplomes/page.tsx` | 221 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/api/v1/report-cards/route.ts` | 174 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/api/v1/report-cards/upload/route.ts` | 158 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/api/v1/transcripts/upload/route.ts` | 148 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/diplomes/[id]/edit/page.tsx` | 140 | — | (rattaché à la main : formule / écran / PDF) | 1 |

Appelants par dossier (borne haute) : `lib/hooks` 41, `app/api/v1` 5, `lib/utils` 4, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/owner/assiduite` 2, `components/owner` 2, `app/annee-academique/releves-de-notes` 1, `app/owner/acces` 1, `app/owner/documents` 1, `app/owner/economie` 1, `app/owner/ouvertures` 1, `app/owner/personnes` 1, `app/owner/programme` 1

### Tests existants (0)

_aucun test existant ne cite ces tables : filet à écrire en 2.0_

### Scripts, seeds et packages (7)

`api:scripts/pro-tl-08-bulletins.ts`, `api:scripts/pro-tl-10-diplomes.ts`, `api:scripts/pro-tl-99-verification.ts`, `scripts/apply-migration-0064-professional-diplomas.js`, `scripts/migrate-report-cards.js`, `scripts/seed-genie-logiciel-workflow.js`, `scripts/seed-professional-module-029.js`

### Test de sortie de tranche

Un bulletin généré en 2.0 est reproduit octet à octet (PDF serveur) depuis le snapshot ; plus de jsPDF dans `apps/web/src/lib` ; branding lu depuis le tenant.

## Tranche 2.7 — Rémunération (spec 031) : collecteurs d'heures sur le nouveau modèle

**Remplace** : `hour-collectors/{academic,professional}` (+ `payment_periods`, `payment_period_teachers`, `teacher_payment_configs`, `teacher_payments`, `payment_hour_details`, `course_hourly_rates`, `professional_ecue_hourly_rates`, `teaching_hours`, `course_assignments`).

**Taille** : **L** (calculée) — 24 fichiers API structurants (13871 lignes) + 8 jointures légères, 13 routes HTTP d'entrée, 29 fichiers web directs, ~70 fichiers web appelants (borne haute), 4 tests existants, 27 scripts/seeds.

**Tables** (9) : `course_assignments`, `course_hourly_rates`, `payment_hour_details`, `payment_period_teachers`, `payment_periods`, `professional_ecue_hourly_rates`, `teacher_payment_configs`, `teacher_payments`, `teaching_hours`

### Points de couplage dangereux

- **L'abstraction existe déjà et limite le rayon d'action** : `apps/api/src/services/hour-collectors/types.ts:1-79` (`HourCollector`, `HourRecord`, `HourCollectionScope`) ; seuls DEUX fichiers lisent le modèle académique : `academic-hour-collector.ts:44-62` (`teacher_attendance_sessions` ⟶ `teacher_assignments` ⟶ `class_courses` ⟶ `courses`, filtre `s.status = 'completed'` et `duration_hours`) et `professional-hour-collector.ts:48-59` (`professional_ecue_seances` ⟶ `professional_ecue` ⟶ `professional_ue_sessions`, via `SEANCE_PAYABLE_PREDICATE`/`DUREE_PAYEE_SQL`). Brancher le nouveau modèle = réécrire ces deux requêtes, pas le calculateur (`payment-calculator.ts:90-91,452-457`).
- **Un seul garde-fou « une heure ne se paie qu'une fois »** : `heures-consommees.ts` (`heureDejaPayeeSQL`) interroge `payment_hour_details.{seance_id|attendance_session_id}` et exclut `teacher_payments.status = 'cancelled'` ; la période en cours de calcul ne s'exclut pas elle-même (recalcul = `DELETE` puis `INSERT`, `teacher-payments.ts`). Les nouvelles séances/présences doivent garder des identifiants STABLES : un changement d'id fait repayer des heures déjà versées (bulletins non annulés). La migration 0112 autorise le chevauchement de périodes, donc le calendrier ne protège plus.
- **`payment_hour_details` référence trois origines** (`teaching_hours_id`, `attendance_session_id`, `seance_id`) et la vue `v_payment_hour_details_enriched` (migration 0103:336 ; lue par `routes/teacher-payments.ts:325`) joint les trois : toute suppression de table source casse la vue. Triggers d'audit des paiements qui « survivent à la suppression » (0109–0111, `payment_audit_log`) : conserver comme filet (plan §5.1).
- **`teaching_hours` et `course_assignments` n'existent que dans la chaîne Prisma** (baseline `20260403110000`), sont supprimées par `0005_academic_years.sql` côté SQL, mais 12 fichiers API (hors tests et scripts) les citent (`routes/teaching-hours.ts`, `course-assignments.ts`, `teaching-hours-batch.ts`, `teacher-assignments.ts`, `payment-reports.ts`, `owner-economie.service.ts:174`, `owner-staff.service.ts:52`, `owner-payroll-mass.service.ts:38`…). `owner-payroll-mass.service.ts:38` indique que `teaching_hours` « EST VIDE sur cette base » et `payment-calculator.ts:323` que le calculateur ne la lit pas : candidate à suppression, mais confirmer en base avant.
- **Le périmètre « paie par ouverture »** (migrations 0106_periodes_paie_ciblees, 0107 multi-enseignants, 0129 index) lie la paie à `professional_ue_sessions` : la tranche 2.1 (cohorte → classe) doit être livrée avant 2.7 ou en même temps. Ne pas confondre avec les migrations 0106_un_bulletin_par_periode, 0108 (archivage) et 0113 (statut « impayé »), qui concernent les BULLETINS DE PAIE des enseignants (`teacher_payments`) et non les bulletins de notes.
- **Frontières du module** : le moteur de paie (semaines, heures supplémentaires, salaire, mixte) reste inchangé selon la spec 031 ; les tarifs ECUE (`professional_ecue_hourly_rates`) suivent l'ECUE (2.1). Plan §6 : `032-payroll-port` — ne PAS migrer les tables `teacher_payments*` en 2.7, seulement les sources d'heures.

### Fichiers API structurants (24)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/routes/payment-reports.ts` | 1197 | 49 | teacher_payments(19), payment_periods(14), payment_hour_details(10), course_assignments(3), +1 | 4 |
| `api/services/owner-payroll-mass.service.ts` | 730 | 35 | teacher_payments(12), payment_periods(10), professional_ecue_hourly_rates(5), teacher_payment_configs(1), +2 | 5 |
| `api/routes/payment-periods.ts` | 1064 | 29 | payment_periods(15), teacher_payments(9), payment_period_teachers(4), payment_hour_details(1) | 1 |
| `api/services/teacher-payroll-overview.service.ts` | 703 | 29 | teacher_payments(11), payment_period_teachers(4), payment_periods(4), payment_hour_details(2), +2 | 4 |
| `api/routes/teacher-payments.ts` | 1607 | 26 | teacher_payments(17), payment_periods(4), payment_hour_details(3), payment_period_teachers(1), +1 | 3 |
| `api/routes/course-hourly-rates.ts` | 801 | 13 | course_hourly_rates(10), course_assignments(1), payment_hour_details(1), teaching_hours(1) | 3 |
| `api/routes/course-assignments.ts` | 257 | 12 | teaching_hours(8), course_assignments(4) | 3 |
| `api/routes/teacher-assignments.ts` | 1578 | 11 | teaching_hours(8), course_assignments(3) | 4 |
| `api/routes/teacher-payment-configs.ts` | 926 | 11 | teacher_payment_configs(10), teacher_payments(1) | 2 |
| `api/services/teacher-payslip.service.ts` | 237 | 11 | teacher_payments(2), payment_hour_details(1), payment_periods(1), teacher_payment_configs(1), +1 | 4 |
| `api/services/hour-collectors/heures-consommees.ts` | 64 | 11 | payment_hour_details(4), teacher_payments(1) | 1 |
| `api/services/payment-calculator.ts` | 679 | 10 | course_hourly_rates(1), payment_periods(1), teacher_payment_configs(1), teaching_hours(1), +1 | 2 |
| `api/services/professional-ecue-rates.service.ts` | 381 | 10 | professional_ecue_hourly_rates(6), teacher_payment_configs(2), course_hourly_rates(1), payment_hour_details(1) | 3 |
| `api/services/owner-payroll.service.ts` | 94 | 10 | teacher_payments(3), payment_periods(1) | 3 |
| `api/services/professional-seance-validation.service.ts` | 874 | 9 | payment_hour_details(4), teacher_payments(4), payment_periods(1) | 4 |
| `api/services/hour-collectors/academic-hour-collector.ts` | 81 | 9 | teaching_hours(2), payment_hour_details(1) | 4 |
| `api/services/teacher-payslip-template.service.ts` | 670 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/services/teacher-payslip-notification.service.ts` | 197 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/services/hour-collectors/professional-hour-collector.ts` | 83 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/hour-collectors/types.ts` | 80 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-economie.service.ts` | 759 | 4 | teacher_payments(2), payment_periods(1), teaching_hours(1) | 4 |
| `api/routes/professional-remuneration.ts` | 583 | 4 | payment_hour_details(1), payment_periods(1), teacher_payment_configs(1), teacher_payments(1) | 2 |
| `api/services/owner-staff.service.ts` | 156 | 3 | payment_periods(1), teacher_payments(1), teaching_hours(1) | 4 |
| `api/routes/teaching-hours-batch.ts` | 70 | 3 | course_assignments(1), payment_periods(1), teaching_hours(1) | 1 |

### Jointures légères (8 fichiers, < 6 occurrences et < 3 tables de la tranche)

`api/routes/owner/index.ts`, `api/routes/simple-payment-periods.ts`, `api/routes/teacher-attendance.ts`, `api/routes/teaching-hours.ts`, `api/services/owner-personnes.service.ts`, `api/services/owner-pulse.service.ts`, `api/services/owner-remplissage.service.ts`, `api/services/owner-resultat.sql.ts`

### Routes HTTP d'entrée (13)

`api/routes/course-assignments.ts`, `api/routes/course-hourly-rates.ts`, `api/routes/owner/index.ts`, `api/routes/payment-periods.ts`, `api/routes/payment-reports.ts`, `api/routes/professional-remuneration.ts`, `api/routes/simple-payment-periods.ts`, `api/routes/teacher-assignments.ts`, `api/routes/teacher-attendance.ts`, `api/routes/teacher-payment-configs.ts`, `api/routes/teacher-payments.ts`, `api/routes/teaching-hours-batch.ts`, `api/routes/teaching-hours.ts`

### Web : fichiers directs (29) et appelants (~70)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/professionnel/admin/remuneration/historique/page.tsx` | 748 | 7 | payment_periods(1) | 1 |
| `web/app/payments/calculate/page.tsx` | 1800 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/remuneration/bulletins/page.tsx` | 1250 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/remuneration/seances/page.tsx` | 1131 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/remuneration/MasseSalariale.tsx` | 956 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/payments/manage/page.tsx` | 870 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/payments/page.tsx` | 638 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/hours/page.tsx` | 584 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/teaching-hours/page.tsx` | 538 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/manage/[id]/page.tsx` | 482 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/payslip-pdf.ts` | 423 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/teacher-configs/page.tsx` | 422 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/remuneration/historique/page.tsx` | 421 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/periods/page.tsx` | 384 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/payments/AntdTeacherPaymentConfigForm.tsx` | 369 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/remuneration/seances/_shared.tsx` | 312 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/professionnel/admin/remuneration/seances/[id]/page.tsx` | 303 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/remuneration/Configuration.tsx` | 249 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/components/payments/PaymentPeriodForm.tsx` | 218 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/remuneration/configuration/page.tsx` | 198 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/utils/paie-report.ts` | 187 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/utils/paie-bulletins-report.ts` | 166 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/utils/paiements-report.ts` | 147 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/periods/[id]/_edit/page.tsx` | 122 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/teacher-configs/[id]/edit/page.tsx` | 115 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/periods/new/page.tsx` | 70 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/payments/teacher-configs/new/page.tsx` | 68 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/remuneration/page.tsx` | 40 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/payments/layout.tsx` | 7 | — | (rattaché à la main : formule / écran / PDF) | 1 |

Appelants par dossier (borne haute) : `lib/hooks` 27, `app/api/teacher` 6, `app/owner/finances` 3, `app/owner/pedagogie` 3, `app/api/teacher-payments` 2, `app/owner/assiduite` 2, `app/payments/manage` 2, `components/owner` 2, `app/(dashboard)/schedule-generation` 1, `app/(dashboard)/simple-schedule` 1, `app/owner/acces` 1, `app/owner/documents` 1, `app/owner/economie` 1, `app/owner/ouvertures` 1

### Tests existants (4)

- `api/__tests__/heures-consommees.test.ts`
- `api/__tests__/payment-calculator-mixed.test.ts`
- `api/__tests__/payment-calculator-professional.test.ts`
- `web/components/payments/__tests__/PaymentPeriodForm-error-handling.test.tsx`

### Scripts, seeds et packages (30)

`api:scripts/appliquer-0114.ts`, `api:scripts/calculate-and-create-payments.js`, `api:scripts/delete-all-payment-periods.js`, `api:scripts/delete-all-payments-for-period.js`, `api:scripts/delete-all-teacher-payment-configs.js`, `api:scripts/delete-all-teacher-payments.js`, `api:scripts/rattraper-statuts-archives.ts`, `api:scripts/verif-bulletin-mode.ts`, `api:scripts/verif-heures-consommees.ts`, `scripts/ajouter-heures-aout-2026.js`, `scripts/ajouter-seances-decembre-2025.js`, `scripts/apply-migration-0103-remuneration-pro.js`, `scripts/check-payment-hour-details-fk.js`, `scripts/configurer-enseignants-manquants.js`, `scripts/creer-session-aout-2026.js`, `scripts/db-audit.js`, `scripts/fix-seances-chevauchements.js`, `scripts/generate-audit-documentation.js`, `scripts/generer-bulletins-paie.js`, `scripts/jeu-essai-cycle-paie.js`, `scripts/parcours-paie-decembre-2025.js`, `scripts/parcours-paie-janvier-2026.js`, `scripts/preparer-paie-complete.js`, `scripts/reinitialiser-cycle-paie.js`, `scripts/resoudre-doublons-bulletins.js`, … +5

### Test de sortie de tranche

Le scénario S17-T (`docs/testing/e2e-computer-use/scenarios/S17-T-paie-tenant-test-30091.md`) et `payment-calculator-{academic,professional,mixed}.test.ts`, `heures-consommees.test.ts`, `seance-constat-realisee.test.ts` passent sans changement de montant ; aucune lecture de `teacher_attendance_sessions`/`professional_ecue_seances` hors des deux collecteurs.

## Tranche 2.8 — Portails owner / parent / élève / enseignant sur modèles de lecture

**Remplace** : `owner-pedagogie`, `parent-*`, `student-*` (+ tableaux de bord owner).

**Taille** : **L** (calculée) — 54 fichiers API structurants (43505 lignes) + 0 jointures légères, 23 routes HTTP d'entrée, 183 fichiers web directs, ~0 fichiers web appelants (borne haute), 0 tests existants, 0 scripts/seeds.

**Tables** (3) : `dashboard_templates`, `dashboard_widgets`, `student_dashboard_configs`

### Points de couplage dangereux

- **L'espace owner = ~15 500 lignes de SQL brut en lecture sur TOUTES les tranches précédentes** (`apps/api/src/routes/owner/index.ts` 1 659 lignes + 31 fichiers `owner-*.ts`) ; il est le consommateur le plus couplé de l'ancien schéma : `professional_enrollments` (17 services), `student_enrollments`, `professional_orders/payments`, `professional_bulletins`, `professional_ue_sessions`, `teaching_hours`. La règle du plan « portails sur modèles de lecture » suppose des vues/tables de lecture stables AVANT de supprimer les anciennes tables en 2.1–2.6.
- **Fragments SQL partagés à paramètres positionnels figés** : `owner-perimetre.sql.ts` ($1–$5 ; `OUVERTURES_CTE`, `COMMANDES_PERIMETRE_CTE`, `ETUDIANTS_PERIMETRE_CTE`), `owner-pro-annee.sql.ts`, `owner-pro-outstanding.sql.ts`, `owner-resultat.sql.ts`, `owner-caisse.sql.ts`. Une CTE changée sans changer le contrat de paramètres fait échouer la requête entière à l'exécution (Postgres exige de typer chaque `$n`, cf. en-tête de `owner-perimetre.sql.ts`).
- **Erreurs avalées** : plusieurs services utilisent `safeQuery(...)` qui renvoie `[]` et logge un warning (`owner-pedagogie.service.ts:38-50`, `owner-staff.service.ts`, `owner-formations.service.ts`). Après suppression d'une table, les tableaux de bord affichent « 0 » au lieu d'échouer : les tests d'API owner (`apps/api/src/__tests__/owner-api-surface.test.ts`, `owner-routes.test.ts`) doivent être étendus à des valeurs non nulles (golden), sinon la casse est silencieuse.
- **`owner-pedagogie.service.ts` lit `b.data->>'decision'`** (`:228-229,271-273`) et des clés numériques de `professional_bulletins.data` (`jsonNumber`, `:179`) : couplage au format JSON du bulletin (cf. 2.4/2.6). Le même fichier exclut la « Conduite » par `ILIKE` sur libellé/code.
- **Le portail parent est le plus transversal** : `parent-children.ts` (2 056 lignes, 4 tranches), `parent-documents.ts` (1 013, 5 tranches), `parent-grades.ts` (1 103), `parent-homework.ts`, `parent-academic.ts`, `parent-payments.ts`. Il unit déjà classique + Professional (`professional-parent.test.ts`). `parent-payments.ts` cite une table `payment_methods` inexistante (à vérifier).
- **Dépendances Imhotep dans l'owner** : `owner-formations.service.ts` (lit `sessions_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `entreprises_clientes`, `formateurs`) est ORPHELIN côté web (`use-owner-formations.ts` jamais importé ; `apps/web/src/app/owner/formations/page.tsx` n'est qu'une redirection) et `owner-staff.service.ts:110-125,150` lit `formateurs` pour `activeFormateurs` : voir `imhotep-removal-inventory.md` (catégorie B).
- **Contrats Zod owner** (`packages/contracts/src/owner*.schema.ts`) : les écrans owner valident les réponses (`OwnerStaffResponseSchema.parse`, `OwnerFormationsResponseSchema.parse`, `routes/owner/index.ts:1255-1283`) ; ajouter un champ ou changer un nom dans un modèle de lecture exige de versionner ces schémas.

### Fichiers API structurants (54)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `api/routes/student-dashboard.ts` | 821 | 17 | student_dashboard_configs(8), dashboard_templates(2), dashboard_widgets(1) | 1 |
| `api/routes/parent-messages.ts` | 3554 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/students.ts` | 2700 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/parent-children.ts` | 2056 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/routes/parent-settings.ts` | 2037 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/owner/index.ts` | 1660 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/parents.ts` | 1459 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/parent-homework.ts` | 1444 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/routes/parent-payments.ts` | 1431 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/parent-emergency.ts` | 1340 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/student-payments.ts` | 1185 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/teacher-messages.ts` | 1181 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/parent-grades.ts` | 1104 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/routes/parent-academic.ts` | 1068 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/routes/parent-documents.ts` | 1013 | — | (rattaché à la main : formule / écran / PDF) | 6 |
| `api/routes/student-messages.ts` | 1013 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/student-courses.ts` | 971 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-stats-csv.service.ts` | 968 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `api/routes/teacher-students.ts` | 948 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-tresorerie.service.ts` | 896 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/routes/teacher-conversations.ts` | 892 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-pulse.service.ts` | 773 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-economie.service.ts` | 759 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-payroll-mass.service.ts` | 730 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-referentiel.service.ts` | 705 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-pedagogie.service.ts` | 696 | — | (rattaché à la main : formule / écran / PDF) | 6 |
| `api/routes/student-assignments.ts` | 666 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-finances-pro.service.ts` | 658 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-risque.service.ts` | 634 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-assiduite.service.ts` | 628 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-prospection.service.ts` | 624 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-personnes.service.ts` | 621 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-remplissage.service.ts` | 613 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-finances.service.ts` | 587 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-scolarite.service.ts` | 485 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-charges.service.ts` | 473 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/teacher-courses.ts` | 454 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/routes/teacher-corrections.ts` | 411 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-documents.service.ts` | 397 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-programme.service.ts` | 347 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-stats-filters.service.ts` | 293 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| `api/services/owner-recrutement.service.ts` | 274 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `api/routes/student-grades.ts` | 263 | — | (rattaché à la main : formule / écran / PDF) | 4 |
| `api/services/owner-academic.service.ts` | 232 | — | (rattaché à la main : formule / écran / PDF) | 5 |
| `api/services/owner-perimetre.sql.ts` | 228 | — | (rattaché à la main : formule / écran / PDF) | 3 |
| … 9 autres (liste complète : `tables-usage-matrix.json`, champ `refs`) | | | | |

### Routes HTTP d'entrée (23)

`api/routes/owner/index.ts`, `api/routes/parent-academic.ts`, `api/routes/parent-children.ts`, `api/routes/parent-documents.ts`, `api/routes/parent-emergency.ts`, `api/routes/parent-grades.ts`, `api/routes/parent-homework.ts`, `api/routes/parent-messages.ts`, `api/routes/parent-payments.ts`, `api/routes/parent-settings.ts`, `api/routes/parents.ts`, `api/routes/student-assignments.ts`, `api/routes/student-courses.ts`, `api/routes/student-dashboard.ts`, `api/routes/student-grades.ts`, `api/routes/student-messages.ts`, `api/routes/student-payments.ts`, `api/routes/students.ts`, `api/routes/teacher-conversations.ts`, `api/routes/teacher-corrections.ts`, `api/routes/teacher-courses.ts`, `api/routes/teacher-messages.ts`, `api/routes/teacher-students.ts`

### Web : fichiers directs (183) et appelants (~0)

| Fichier | Lignes | Occ. | Tables citées | Tranches |
|---|--:|--:|---|--:|
| `web/app/owner/remuneration/MasseSalariale.tsx` | 956 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/owner/finances/tresorerie/ImpayesProfessionnel.tsx` | 894 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/messages/ParentTeacherMessages.tsx` | 816 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/homework/page.tsx` | 739 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-parent-messages.ts` | 727 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/components/owner/filters/OwnerFilterBar.tsx` | 723 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/student/grades/page.tsx` | 720 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/lib/hooks/use-student-data.ts` | 719 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/economie/page.tsx` | 703 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/documents/page.tsx` | 696 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/dashboard/page.tsx` | 644 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/documents/page.tsx` | 642 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/economie/SaisieCharges.tsx` | 633 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/owner/ouvertures/page.tsx` | 611 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/personnes/page.tsx` | 608 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/student/assignments/[id]/page.tsx` | 601 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/owner/prospection/page.tsx` | 581 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/lib/hooks/use-parents.ts` | 569 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/reports/personal/page.tsx` | 568 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/emergency/EmergencyContacts.tsx` | 564 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/assiduite/Presences.tsx` | 562 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/children/[childId]/page.tsx` | 556 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/messages/EventInvitations.tsx` | 556 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/settings/EmergencyContacts.tsx` | 556 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/risque/QualiteRisque.tsx` | 553 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/support/page.tsx` | 532 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/grades/page.tsx` | 532 | — | (rattaché à la main : formule / écran / PDF) | 2 |
| `web/app/parent/progression/page.tsx` | 520 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/documents/AttendanceReports.tsx` | 517 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/pedagogie/ResultatsProfessionnel.tsx` | 516 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/owner/finances/page.tsx` | 513 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/messages/SchoolMessageForm.tsx` | 509 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/messages/page.tsx` | 485 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/payments/PaymentHistory.tsx` | 480 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/documents/PaymentReceipts.tsx` | 471 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/documents/ReportCards.tsx` | 463 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/student/progression/page.tsx` | 463 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/teacher/reports/page.tsx` | 457 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/messages/Notifications.tsx` | 441 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| `web/app/parent/components/homework/GradesReceived.tsx` | 440 | — | (rattaché à la main : formule / écran / PDF) | 1 |
| … 143 autres (liste complète : `tables-usage-matrix.json`, champ `refs`) | | | | |

Appelants par dossier (borne haute) : —

### Tests existants (0)

_aucun test existant ne cite ces tables : filet à écrire en 2.0_

### Scripts, seeds et packages (0)

_aucun_

### Test de sortie de tranche

Chaque écran owner/parent/élève/enseignant affiche les mêmes chiffres qu'en 2.0 sur les scénarios figés (valeurs non nulles) ; plus aucune requête hors modèle de lecture dans `routes/owner/**`.


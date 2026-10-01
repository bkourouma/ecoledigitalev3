# Parité legacy — 011-assessments-grades

**Périmètre** : saisie et validation des notes, calcul des résultats par période, rattrapages (côté notes), clôture et verrou, lecture élève/parent. Les formules sont dans `012/parity.md` ; les bulletins dans `013/parity.md` ; la capitalisation, le rattrapage (inscriptions) et les diplômes dans `019/parity.md`.

Statuts : **Conservé**, **Amélioré** (même intention, défaut corrigé, détaillé), **Abandonné** (non reproduit, justification), **Reporté** (autre spec). Lignes : état au 2026-10-01.

Tables legacy remplacées (tranche 2.5) : `professional_assignments`, `professional_assignment_submissions`, `professional_ecue_notes`, `professional_ecue_results`, `student_professional_ue_results`, `student_period_course_averages`, `assignments`, `assignment_submissions`, `assignment_instances`, `student_period_attendance_summaries` (absences → 010), plus les tables IA/QCM (reportées).

## 1. Évaluations et notes — pile Professional

| ID | Fonction legacy (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-ASS-01 | `ASSIGNMENT_TYPES` `["devoir","controle","examen","projet","qcm","autre"]` (`professional-assignments.service.ts:13`) | Types figés en code ; **`examen` = note d'examen, tout le reste = devoirs** (`professional-results.service.ts:203-222`) | **Amélioré** | `assess.assessment_types` configurables + `aggregation_group` lu par la règle | Aucun type en dur ; PRD §17. |
| P-ASS-02 | `create` (`:219`) | Évaluation rattachée à l'ECUE + cohorte optionnelle, `note_max`, `coefficient`, dates, statut `brouillon/publie/cloture` | **Amélioré** | `assess.assessments` (classe, nœud, période, session, barème, poids) | Une évaluation appartient toujours à une classe et une période (le legacy autorisait `ue_session_id` nul = toutes les cohortes, ambigu). |
| P-ASS-03 | `duplicateToTargets` (`:341`) | Duplication vers d'autres cohortes | **Conservé** | `POST /assessments/bulk` | |
| P-ASS-04 | `update` / `delete` (`:516`, `:558`) | Modification et suppression sans contrainte de statut de notes | **Amélioré** | Modification en `DRAFT` ; plus de suppression (annulation par lot de révisions) | Immuabilité après soumission. |
| P-ASS-05 | `grade` (`:1292`) | Note par `INSERT … ON CONFLICT DO UPDATE` : **écrase** la note, aucune trace | **Amélioré** | Saisie `PUT /grades` + workflow + `GradeRevision` | Plan §2 : « les notes sont écrasées ». |
| P-ASS-06 | Contrôle du barème : `0 ≤ note ≤ note_max` (`:1311`) | Contrôle applicatif | **Conservé** | Applicatif **et** trigger | Défense en profondeur. |
| P-ASS-07 | `teacherTeachesEcue` (`:137`) | L'enseignant n'écrit que sur les ECUE qui lui sont affectées | **Conservé** | `TeachingAssignmentPort` (009/004) | AC1.1. |
| P-ASS-08 | `studentEnrolledInEcue` (`:164`) | L'élève ne voit que ses évaluations | **Conservé** | Lecture élève/tuteur sur notes publiées | |
| P-ASS-09 | `late_submission_allowed`, `late_penalty_percent` (`:55-57`, `:299`, `:749`) ; `submit`, fichiers, délai | Remise de devoirs avec pénalité de retard | **Reporté** | 022-lms (après V1) | Hors périmètre « notes ». |
| P-ASS-10 | Questions/réponses en ligne (`listQuestions` … `getMyAnswers`, `:858-1157`), `gradeQuestionAnswer` (`:1208`) | QCM, correction automatique/manuelle | **Reporté** | 022-lms / 026-ai | Deux moteurs de QCM à fusionner (inventaire) : traité hors de cette spec. |
| P-ASS-11 | `show_results_mode` (`immediately`/`after_correction`/`never`, `:22`) | Visibilité des résultats d'un devoir | **Amélioré** | `visible_to_students` + mode de publication du type | Un seul mécanisme : la publication. |
| P-ASS-12 | `ai_config`, `ai_source_material_ids`, `ai_document_processing`, `ai_generated_questions` | Génération IA d'évaluations | **Reporté** | 026-ai | |

## 2. Notes manuelles par ECUE et résultats — pile Professional

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-ASS-20 | `upsertManualEcueNote` (`professional-results.service.ts:465`) | Note « devoir » (plusieurs) ou « examen » (une par session) saisie directement par ECUE, sans évaluation | **Amélioré** | Toute note passe par une évaluation (type EXAM / CONTINUOUS) | Un seul chemin de saisie ; plus de notes sans source. |
| P-ASS-21 | `updateManualEcueNote` / `deleteManualEcueNote` (`:559`, `:627`) | Modification/suppression libres | **Amélioré** | `GradeRevision` après publication | |
| P-ASS-22 | `computeEcueBreakdown` (`:195`) : devoirs (évals hors examen + notes manuelles), examen (note manuelle prioritaire, sinon évaluation la plus récemment corrigée), **S2 remplace S1** | Agrégation | **Conservé** (fond) | Contexte des règles `moyenne_devoirs`, `note_examen_retenue` (012) | Q-02. |
| P-ASS-23 | `recomputeEcueResult` (`:270`) | Écrit le résultat d'ECUE (`INSERT … ON CONFLICT DO UPDATE`), préserve l'override manuel | **Amélioré** | Pipeline `results` ; versions de résultats | Aucune écriture destructive. |
| P-ASS-24 | `evaluateUeValidation` + `upsertUeResult` (`:337`, `:382`) | Statut UE `validee/echec/en_cours`, UV acquises | **Amélioré** | `line_results` (UE) + `higher.credit_ledger` (019) | Capitalisation dans 019. |
| P-ASS-25 | `validateEcueResultManually` (`:411`) | Validation manuelle d'une ECUE **sans motif**, `valide_par` seulement | **Amélioré** | `results.overrides` (`VALIDATION`), justification ≥ 20 caractères, approbateur distinct, audit | Plan §3.7. |
| P-ASS-26 | `recomputeSessionResults` (`:101`), `recomputeAfterGrade` (`:146`) | Recalcul synchrone dans la requête de saisie | **Amélioré** | Événement `assess.grade.published` → file coalescée → job worker | Plus de calcul dans la requête HTTP ; coalescence. |
| P-ASS-27 | `listSessionResults`, `getSessionGrid` (`:727`, `:979`) | Grille de résultats d'une cohorte | **Conservé** | `GET /classrooms/:id/periods/:id` | |
| P-ASS-28 | `getSemestreConduite`, `conduiteSemestreRows` (`:761`, `:862`) ; `NOT_CONDUITE` (`:36`) | Conduite = UE/ECUE repérée par `libelle ILIKE 'conduite%'` / `code ILIKE '%EC-CON%'`, saisie comme note d'examen unique, écrans dédiés | **Amélioré** | Nœud de curriculum `grading_mode = DIRECT`, `resit_allowed = false` ; saisie par une évaluation ordinaire | Plus d'heuristique textuelle (`0123_conduite_transversale.sql` documente la même fragilité côté facturation). |
| P-ASS-29 | `listSemestreRattrapages`, `listRattrapageFilieres/Noms/Semestres`, `listStudentRattrapages`, `listChildRattrapages`, `rattrapageRowsForStudent` (`:1101-1372`) | Listes de rattrapage (admin, enseignant, élève, parent) ; états `a_repasser/non_validee/validee` | **Reporté** | 019 (candidats via `eligible_rattrapage`, inscriptions session 2) ; ici : évaluations `session_no = 2` | Le rattrapage est une fonction du supérieur ; les notes de session 2 sont des notes ordinaires. |
| P-ASS-30 | `listStudentUeResults` (`:1375`) | UV capitalisées par UE | **Reporté** | 019 (`credit_ledger`) | |
| P-ASS-31 | `student_professional_ue_results` `UNIQUE (tenant, ue, student)` : un enregistrement par UE et étudiant, **écrasé** à chaque recalcul | Pas d'historique ni de multiplicité d'années | **Amélioré** | `period_results/line_results` versionnés ; ledger de crédits par année (019) | |

## 3. Clôture et verrou

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-ASS-40 | `semestreClotureDeSession` (`professional-cloture-guard.ts:27`) | Refuse toute écriture/recalcul si le semestre porteur a `bulletins_clotures_at` ; deux chemins de rattachement (direct + par UE) | **Conservé** (règle) / **Amélioré** (mécanisme) | `assess.period_locks` + trigger `grades_guard` | La règle « une note de bulletin remis ne bouge plus » est reprise exactement, mais appliquée par la base. |
| P-ASS-41 | `messageCloture` (`:67`) : « On ne propose PAS de rouvrir le semestre » | Aucune route de réouverture | **Amélioré** | `results … /reopen` : motif + approbation + version `n+1` + bulletins « à rééditer » | Le legacy n'offrait aucune sortie légale ; v2 en crée une, auditée. |
| P-ASS-42 | `semestreClotureDeEvaluation` (`:81`) | La correction d'une copie est refusée si la cohorte est clôturée | **Conservé** | Verrou de période (couvre aussi les révisions) | |
| P-ASS-43 | `cloturerSemestre` (`professional-semestre.service.ts:614`) | Passe les cohortes d'UE à `termine` | **Abandonné** | État explicite de période (`period_states`) | La clôture des notes ne dépend plus du statut des cours. |
| P-ASS-44 | `cloturerBulletins` / `generateBulletins` refusé après clôture (`professional-bulletin.service.ts:1223-1228`, `:1557-1603`) | Clôture des bulletins distincte de la clôture des notes ; refus si aucun bulletin | **Reporté** | 013 (`reportcards`) | |

## 4. Pile classique — moyennes saisies et lectures

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-ASS-50 | `GET/PUT /manual` (`semester-averages.ts:389-515`) | Saisie de la moyenne d'une matière pour une classe/période (liste d'élèves) | **Amélioré** | Évaluation de type « moyenne saisie » (Q-35) ou calcul | Passe par le circuit de validation. |
| P-ASS-51 | `GET/PUT /matrix` (`:516-715`) : matrice élèves × matières + heures d'absence ; `DELETE`+`INSERT` | Tableau de saisie ; moyenne nulle ⇒ ligne supprimée ; justifiées ≤ absences | **Amélioré** | Grille de saisie (US1) ; absences ← 010 | Plus d'effacement ; plus de saisie manuelle d'absences. |
| P-ASS-52 | `assertClassPeriodAlignment`, `assertCourseInClass` (`:55`, `:75`) | Vérifie que la période appartient à l'année de la classe et la matière à la classe | **Conservé** | Contrôles à la création d'évaluation (ports 004) | |
| P-ASS-53 | `fetchMatrixCourses` (`:87`) : matières = cours du programme de la classe (`courses.programme_id`), `coef` retombe à 1 | Périmètre de saisie | **Amélioré** | Nœuds du curriculum de la classe ; coefficient explicite | |
| P-ASS-54 | `student-grades.ts` (`GET /`, `grade_distribution` : excellent ≥ 16, good 14-15, average 12-13, below_average < 12) | Statistiques calculées dans la route | **Abandonné** | Analytique (025) alimentée par règles | Seuils en dur dans une route de lecture. |
| P-ASS-55 | `parent-grades.ts` (`/assignments`, `/by-course`, `/averages`, `/trends` : `:36`, `:321`, `:564`, `:814`) | Notes, moyennes et tendances pour le parent, **moyennes recalculées dans la route** | **Amélioré** | `GET /children/:id/grades` + `GET /children/:id/results` (valeurs fournies par l'API) | Zéro calcul dans les lecteurs (tranche 2.8). |
| P-ASS-56 | `teacher-students.ts`, `teacher-corrections.ts`, `parent-homework.ts`, `student-assignments.ts`, `assignment-instances.ts`, `submissions.ts` | Devoirs, remises, corrections, instances | **Reporté** | 022-lms | Hors périmètre notes. |

## 5. Défauts du legacy volontairement NON reproduits

1. Écrasement des notes (aucune table de révision) et des moyennes (`DELETE`+`INSERT`).
2. Notes manuelles sans évaluation, sans source, sans valideur.
3. Validation manuelle d'une ECUE sans motif ni approbation.
4. Calcul synchrone dans la requête de saisie.
5. Verrou de clôture sans voie de réouverture.
6. Conduite, BTS, « 2ᵉ semestre » reconnus par le texte des libellés.
7. Seuils statistiques codés dans les routes de lecture (`student-grades.ts`) et moyennes recalculées par le parent-route.
8. Deux piles de saisie divergentes, deux moteurs de QCM.
9. `DELETE`/`UPDATE` libres sur une évaluation dont des notes ont été publiées.
10. `coef || 1` : un coefficient absent ne vaut plus 1 en silence.

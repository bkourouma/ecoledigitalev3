# Parité legacy — 006-secondary

**Périmètre** : ce que l'application actuelle fait déjà pour le **secondaire** (pile « classique » : classes, matières, coefficients, moyennes, bulletin, décision, appréciation, distinctions, absences) et pour la **conduite** (module Professionnel), et ce qui n'existe **pas** (conseil de classe, vie scolaire, orientation, élèves affectés par l'État). Les formules sont dans `012/parity.md` (P-RUL-20 à P-RUL-28) ; la saisie et le calcul dans `011/parity.md` ; les bulletins et PDF dans `013/parity.md` ; les inscriptions et classes dans `004/parity.md`. Ce fichier ne répète pas ces lignes : il les **complète** pour les points propres au pack.

Statuts : **Conservé**, **Amélioré**, **Abandonné**, **Reporté**, **Nouveau** (aucun équivalent legacy). Lignes : état du dépôt au 2026-10-02 (`feat/v2-phase-0`), sources `apps/api/src/routes/semester-averages.ts`, `apps/api/src/services/report-card-template.service.ts`, `docs/menus-et-fonctionnalites-par-profil.md`, `infra/scripts/migrations/`.

## 1. Pile classique — bulletin et décisions (`semester-averages.ts`)

| ID | Fonction (ligne) | Comportement legacy | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-S-01 | `GET/PUT /manual` (`:389`, `:450`) | Moyenne d'une matière **saisie à la main** pour un élève et une période | **Abandonné** | Notes du circuit `assess` ; la moyenne est **calculée** (`moyenne_matiere`) ; le cas « moyenne saisie » reste possible comme **type d'évaluation `MOYENNE_SAISIE`** (une note ordinaire, circuit de validation, Q-35 de 012) | Une moyenne saisie sans note ne prouve rien ; plan §3.7. |
| P-S-02 | `GET/PUT /matrix` (`:516`, `:611`) | Grille classe × matières de moyennes manuelles, avec garde de cohérence classe/période | **Amélioré** | Grille de saisie des notes (011) + matrice de **résultats calculés** (`results.getClassMatrix`) | Les gardes `assertClassPeriodAlignment`/`assertCourseInClass` deviennent des contraintes de 004. |
| P-S-03 | `buildCouncilDecision` (`:181`) | Décision de période par seuils (validée / renforcement / non validée / incomplète) | **Conservé** (comme **suggestion**) | Règle `decision_conseil` → proposition `RULE_SUGGESTION` ; **décision humaine** du conseil (`councils.decisions`) | Le legacy **imprimait** la décision calculée : il n'existait aucun acte humain ni trace de qui décide. |
| P-S-04 | `buildEndYearDecision` (`:197`) | Décision de fin d'année (admis / redoublement / « redouble en cas d'échec au BTS » / en attente) | **Conservé** (comme **suggestion**) | Règle `decision_fin_annee` → suggestion ; décision humaine `PASSAGE`/`REPEAT`/… ; propagée à `results.decisions` puis lue par la reconduction (004) | Le cas BTS passe par la donnée `examen_terminal_requis` (012). |
| P-S-05 | `buildAssignmentFlagsFromDecision` (`:209`) et affichage « Affecté(e) : Oui/Non », « Red. : Oui/Non » (`report-card-template.service.ts:430-431`) | « Affecté » = **ni redoublant ni en attente**, déduit d'une **recherche de texte** (« REDOUBL », « ATTENTE ») dans la décision | **Abandonné** — **divergence à confirmer (Q6-23)** | « Red. » = inscription redoublante / décision `REPEAT` (code) ; « Affecté(e) » = **type de financement `STATE_ASSIGNED` de l'inscription** (PRD §20), jamais la décision | Le legacy confond « affecté par l'État » et « admis ». 012 avait écarté l'indicateur en le déduisant du code ; 006 le **rattache au financement** (donnée d'`academic`). À valider avec le propriétaire avant que 013 ne fige le gabarit. |
| P-S-06 | `buildDistinctionSanctionsFromAverage` (`:220`) | Texte « Tableau d'honneur + félicitations / encouragement » selon la moyenne annuelle (17 / 15 / 12) ; le champ mélange **distinctions et sanctions** | **Amélioré** | Distinction = suggestion de règle `distinction` → proposition `DISTINCTION` **acceptée par un humain** → `RESULTS_DISTINCTION` ; les **sanctions** viennent de `schoollife` (jamais d'un seuil de moyenne) | Libellés des distinctions : données (Q6-06). |
| P-S-07 | `buildCouncilAppreciationFromAverage` (`:228`) | Phrase d'appréciation générale par seuils de moyenne | **Amélioré** | Suggestion `appreciation_conseil` pour **préremplir** ; l'appréciation du conseil est un texte humain (proposition `APPRECIATION`, 1-1 000 caractères) écrit dans `results.appreciations` (`COUNCIL`) | Aucune appréciation n'est publiée sans humain. |
| P-S-08 | `buildAttendanceSummary` (`:245`) et `student_period_attendance_summaries` | « NN heure(s) d'absence (dont NN justifiée(s)) » ; chiffres **saisis à la main** | **Amélioré** | Lecture d'`attendance` (`getAttendanceSummary`) dans l'instantané du conseil et le snapshot de bulletin | Voir P-RC-07 (013). |
| P-S-09 | `POST /attendance-certificates/pdf` et `/pdf-html` (`:716`, `:847`) | Attestation d'assiduité d'une classe / d'un élève | **Reporté** | 024-documents / 010 via le rendu de 013 ; **réutilisation** pour le contrôle de présence d'un affecté (`stateassign.documents`, nature `ATTENDANCE_CERTIFICATE`) | Voir P-RC-08 (013). |
| P-S-10 | `fetchReportCardCourses` (`:300`) : matières par type de bilan, `coef` repli 1 | Sections de bilan, coefficient implicite | **Amélioré** | Nœuds du curriculum, `section_key`, coefficient explicite (004/012) | Voir P-RC-06 (013). |
| P-S-11 | `POST /report-cards/pdf` (`:961`) | Bulletin classique PDF avec décision, distinctions, appréciation | **Conservé** (contenu) | Snapshot de 013 alimenté par `councils.getCouncilDecisionsForEnrollment` ; gabarit `secondary-bulletin` | La date de délibération imprimée est la date **réelle** du conseil (R-RC-11). |
| P-S-12 | Rangs et moyennes de classe | Calculés dans la route, plafonnés | **Abandonné** | `results` (phase de rang) ; le conseil **lit** le rang, il ne le calcule pas | Voir P-RUL-20. |

## 2. Conduite (module Professionnel)

| ID | Fonction | Comportement legacy | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-S-20 | Page « Conduite » (`/professionnel/admin/conduite`, `docs/menus-et-fonctionnalites-par-profil.md` A.6.2) | Note de conduite **/20 par semestre**, saisie avec enregistrement automatique, suppression d'une note ; ECUE « conduite » repérée par le **libellé** | **Conservé** (intention) / **Abandonné** (détection par libellé) | Note de conduite = note du nœud transversal `grading_mode = DIRECT` dans `assess` (circuit de validation, historique) ; `schoollife.getConductPoints` fournit une **aide** (jamais la note) | Cohérent avec 004 AC2.7 et 012 E4. |
| P-S-21 | Aucune vie scolaire dans l'application | — | **Nouveau** | `schoollife` | Les tables `rso_incidents` (migration `026`, sécurité d'installations « RSO-PFSO ») **n'ont rien à voir** avec la vie scolaire : hors périmètre, non réutilisées. |
| P-S-22 | `student_profiles.status = 'suspended'` (routes `students.ts`) | Suspension d'un élève **sans trace disciplinaire** | **Amélioré** | Mesure `TEMP_EXCLUSION` (validation, dates, recours) ; le passage du dossier à `SUSPENDED` (008) est un **acte humain** explicite (`StudentStatusPort`) | 008 R3 : « la sanction disciplinaire détaillée relève de 006 ». |

## 3. Fonctions du PRD sans équivalent legacy (**Nouveau**)

| ID | Fonction | Statut | Cible v2 | Remarque |
|---|---|---|---|---|
| P-S-30 | Conseil de classe : séance, participants, quorum, ordre du jour, propositions, décisions, PV, signatures, verrouillage (PRD §19) | **Nouveau** | `councils` | Le legacy n'a ni conseil ni PV : seul `results.deliberations` (011) existe, **sans** séance, quorum, PV signé ni verrouillage. |
| P-S-31 | Orientation, réorientation, passage d'une série à l'autre (PRD §16, §19) | **Nouveau** | `councils` (orientation), `academic` (séries, options) | Le legacy n'a aucune notion de série, d'orientation ni de vœux. |
| P-S-32 | Élèves affectés par l'État (PRD §20) | **Nouveau** | `stateassign` + `academic.funding_type` + `finance` | Le legacy n'a que l'indicateur d'affichage de P-S-05. |
| P-S-33 | Convocation des parents (PRD §34) | **Nouveau** | `schoollife.convocations` + `messaging` | |
| P-S-34 | Examens blancs, BEPC, BAC (PRD §21) | **Nouveau** | `assess` (type `EXAMEN_BLANC`, déjà livré), `examinations` (018) | |

## 4. Comportements que le pack ne reproduit **pas** (volontairement)

| Défaut / limite legacy | Traitement v2 |
|---|---|
| Une décision de passage ou de redoublement était **imprimée** sans qu'une personne l'ait prise | Décision humaine imposée **en base** ; suggestion conservée à côté (R-C1, R-C2) |
| Aucune trace de la composition du conseil, de la date réelle, du président | Séance, participants (noms figés), date réelle, PV signé |
| Une moyenne saisie ou modifiée sans historique | `assess` (révisions) et résultats versionnés (011) |
| « Affecté(e) » déduit de la décision | Financement `STATE_ASSIGNED` (P-S-05) |
| Distinctions et sanctions mélangées dans un seul texte | Distinctions (conseil) et mesures (vie scolaire) séparées |
| Absences saisies à la main au bulletin | Lecture d'`attendance` |
| Statut « suspendu » sans motif ni dates | Mesure `TEMP_EXCLUSION` historisée |

## 5. Tests de caractérisation

Les scénarios déclaratifs de `tests/characterization/scenarios` (`classique-terminale`, `classique-nommage-periodes`, `classique-flottants`, `conduite-absences`) sont la **recette de non-régression** du bulletin classique : le conseil de test confirme **exactement** les suggestions de la règle (décision de fin d'année, mention, distinction, appréciation) lorsqu'il n'y déroge pas, et les valeurs de `getCouncilDecisionsForEnrollment` alimentent le snapshot du bulletin identique à celui de 013. Les écarts assumés sont P-S-05 (« Affecté(e) »), P-S-06 (distinctions/sanctions séparées) et P-S-20 (conduite par nœud transversal).

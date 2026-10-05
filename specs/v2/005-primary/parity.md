# Parité legacy — 005-primary

**Périmètre** : fonctions et données de l'application actuelle (`EcoleDigitale` legacy) qui touchent le primaire ou que le primaire réutilise, avec leur sort en v2 : **reproduit** (conservé), **amélioré** (même fond, défaut corrigé), **abandonné** (justifié), **hors module → NNN** (relève d'une autre spec), **nouveau** (sans équivalent legacy).

**Constat fondateur (plan D1, §2).** Le legacy n'a **aucun** modèle primaire : pas de niveaux PS/MS/GS ni CP1…CM2, pas de compétences, pas de conseil des maîtres, pas de bilan annuel, pas d'archive d'année, pas de rôle d'instituteur, pas d'examen national. Le pack Primary est donc **à créer de zéro** ; la parité porte sur (a) les comportements de la « pile classique » que le primaire hérite, (b) les champs d'inscription du legacy qui portent déjà des notions de primaire (`cepe_code`, `affectation_*`, `is_repeating`…), (c) les défauts à ne pas reproduire. Vérifié par l'inventaire `docs/inventory/tables-usage-matrix.md` (aucune table primaire) et par recherche des mots « maternelle »/« primaire » dans `apps/api/src` et `apps/web/src` (aucune logique ; seules des mentions dans les nouveaux modules v2).

Références : `RT` = `apps/api/src/routes`, `MIG` = `infra/scripts/migrations`, `SVC` = `apps/api/src/services`. Les identifiants `P-RUL-*` renvoient à `specs/v2/012-rules-engine/parity.md`, `P-RC-*` à `013-report-cards/parity.md`, `A-*`/`T-*` à `004-academic-core/parity.md`, `AT-*` à `010-attendance/parity.md`, `S-*` à `008-students-guardians/parity.md`.

## 1. Champs d'inscription du legacy portant des notions de primaire

Source : `MIG/0059_add_per_enrollment_fields.sql`, `RT/enrollments.ts` (`:71-73`, `:206-242`, `:414-416`, `:663-710`, `:1101-1139`, `:1235-1249`). Ces dix champs vivaient sur la fiche **et** l'inscription (duplication).

| ID | Champ legacy | Sort en v2 | Cible | Remarque |
|---|---|---|---|---|
| PR-01 | `student_enrollments.is_repeating` | **Conservé** | `academic.enrollments.is_repeating` (004, T-16) | Posé par la reconduction (issue `REPEATED`) ; entrée de la règle `cas_deja_redoublant` (nombre de redoublements du cycle, calculé par `academic`) |
| PR-02 | `is_transfer`, `origin_school`, `transfer_decision` | **Amélioré** | `enrollments.is_transfer_in`, `origin_school` ; `transfer_decision` (texte libre) → `enrollment_history` | La « décision de transfert » libre devient une ligne d'historique avec acteur et motif |
| PR-03 | `lv2` (langue vivante 2) | **Hors module → 004** | `enrollment_courses.source = OPTION` | Sans objet au primaire ; conservé pour le secondaire |
| PR-04 | `scholarship_level` | **Amélioré** | `enrollments.funding_type = SCHOLARSHIP` + `funder_label` (004) | Montants → `finance` (014) |
| PR-05 | `affectation_status` ∈ `affecte`, `non_affecte`, `prise_en_charge` ; `affectation_decision` | **Amélioré** | `enrollments.funding_type` + `assignment_reference` (004) | Correspondance proposée : `affecte` → `STATE_ASSIGNED` ; `non_affecte` → `PRIVATE` ; `prise_en_charge` → `OTHER` (**à confirmer**, question Q-P16) ; `affectation_decision` → `assignment_reference` (+ `assignment_issued_on`) |
| PR-06 | `cepe_code` (identifiant libre, 100 caractères) | **Hors module → 018** | `examinations.candidate_identifiers` (`CEPE_CODE`) | Voir `018-examinations/parity.md` |
| PR-07 | `is_inscribed` | **Abandonné** | statut d'inscription (`PENDING/ACTIVE…`, 004) | Booléen redondant avec le statut |

## 2. Calculs et décisions de la « pile classique » (héritage du primaire)

La pile classique (classes, matières, coefficients, semestres) est la plus proche du primaire. Ses **mécanismes** sont repris ; ses **valeurs** (mentions 16/14/12/10/8, décision à 10, etc.) sont des pratiques d'établissement du supérieur et **ne sont pas** transposées au primaire : le primaire n'a pas de RuleSet de départ « fidèle », seulement un jeu fictif (spec §2, rule-contract §3).

| ID | Fonction legacy (réf.) | Sort en v2 | Cible | Remarque |
|---|---|---|---|---|
| PR-10 | Moyennes de matière **saisies à la main** (`RT/semester-averages.ts` `/manual`, `/matrix`) — P-RUL-31 | **Amélioré** | `moyenne_matiere` calculée depuis les notes publiées (`coef-period@1`) ; type d'évaluation « moyenne saisie » (011) pour un établissement qui continue à saisir | Plan §3.7 : « les moyennes ne sont plus saisies » |
| PR-11 | `computeWeightedStats` — moyenne pondérée, matières sans note ignorées, `coef \|\| 1` — P-RUL-28 | **Amélioré** | `moyenne_periode` (`wavg`) ; coefficient explicite, 0 = ignoré | Le repli silencieux sur 1 disparaît (le coefficient est une donnée du curriculum) |
| PR-12 | `computeCompetitionRanks` — P-RUL-20 | **Amélioré** | `rang_matiere`, `rang_periode`, `rang_annuel` = `rank(x, cohorte, 4)` | Plafond silencieux de 300 élèves supprimé ; affichage = réglage (Q-P04) |
| PR-13 | Moyenne annuelle `(S1 + 2·S2)/3`, « 2ᵉ semestre » détecté par le nom — P-RUL-29 | **Amélioré** (mécanisme) / **non transposé** (valeurs) | `moyenne_generale_annuelle` sur N périodes **pondérées par le plan** | La détection par nom est abandonnée ; `(S1+2·S2)/3` reste réalisable par poids 1 et 2 dans un plan à deux semestres |
| PR-14 | `buildCouncilDecision` (10 / 8) — P-RUL-22 ; `buildEndYearDecision` — P-RUL-24 | **Mécanisme conservé**, valeurs **non reprises** | `decision_fin_annee` (`PENDING`, `PROMOTED`, `REPEAT`, `COUNCIL_REVIEW`) ; seuil fictif | Les seuils du supérieur ne sont pas des règles du primaire |
| PR-15 | `buildAssignmentFlagsFromDecision` (cherche « REDOUBL » dans le texte) — P-RUL-25 | **Abandonné** | Le **code** de décision porte l'issue ; `recordEnrollmentOutcome` | Dépendance à la langue et à l'orthographe |
| PR-16 | `buildCouncilAppreciationFromAverage` (7 phrases par seuils) — P-RUL-27 | **Amélioré** | `appreciation_periode` (règle **optionnelle**, inactive) + banque de phrases proposées, jamais appliquées seules | L'appréciation est rédigée ou choisie par l'instituteur |
| PR-17 | Mentions et distinctions (`buildAverageMention`, `…Distinction…`) — P-RUL-21, P-RUL-26 | **Transposé (mentions)** | Règle `mention_periode` (optionnelle, seuils réglables, valeurs de départ fictives) dans `CI-PRIMARY-PLACEHOLDER` v3 (Q-P05, décidé le 2026-10-05) | Les distinctions (tableau d'honneur…) restent non transposées |
| PR-18 | Seuils en flottant, arrondi `Math.round(x*100)/100` — P-RUL-14 | **Amélioré** | Décimal exact, `arrondi_affichage` (affichage seulement) | Golden tests G7, G8 |

## 3. Bulletins, appel, enseignants, classes

| ID | Fonction legacy (réf.) | Sort en v2 | Cible | Remarque |
|---|---|---|---|---|
| PR-20 | Bulletin PDF d'une classe ou d'un élève (`RT/semester-averages.ts` `POST /report-cards/pdf`, `report-card-template.service.ts`) — P-RC-03 | **Amélioré** | `reportcards` : gabarit `report-primary` (instantané signé, QR, version) | Rubriques officielles à fournir (§2.6 de `regulatory-sources-needed.md`) |
| PR-21 | Absences de période saisies à la main (`student_period_attendance_summaries`) — `AT-018`/`R-17` de 010 | **Amélioré** | Récapitulatif **dérivé** d'`attendance` + surcharge tracée | Entrée de `cas_absences` |
| PR-22 | Appel par séance horaire uniquement (`attendance_sessions`, `session_instances`) — 010 | **Amélioré** | Séance `DAILY` (une par classe et par jour), politique d'appel du pack | Le legacy ne connaît pas l'appel journalier du primaire |
| PR-23 | Affectation enseignant ↔ classe/cours (`teacher_assignments`) — `A-168` | **Hors module → 009** | `teaching_assignments` `HOMEROOM` + `covers_all_subjects` | « Titulaire de classe » **absent du legacy** (009, N-05) |
| PR-24 | Capacité de classe dure (`programmes.capacity`) — T-02 | **Conservé** | `classrooms.capacity` + `capacity_is_hard` (004) | |
| PR-25 | Clôture d'une année (`DELETE /academic-years/:id`) — `A-010` | **Abandonné** | `closeAcademicYear` puis `archiveAcademicYear` (004) puis **archive d'année** (005) | La suppression physique est interdite |
| PR-26 | Années académiques, pivot au 1er septembre — T-05 | **Hors module → 004** | `academic_years` (donnée) | |
| PR-27 | Rôles génériques (`teacher`) — S-007 | **Amélioré** | Rôle système `instituteur` (permissions `primary.*`) | Aucun contrôle de rôle en dur |

## 4. Amont du primaire : admissions, statistiques

| ID | Fonction legacy | Sort en v2 | Cible |
|---|---|---|---|
| PR-30 | Demandes d'inscription publiques (`registration_requests`) | **Hors module → 007** | `admissions` |
| PR-31 | Tableaux de bord scolarité du propriétaire (`owner-scolarite.service.ts`) | **Hors module → 025** | `analytics` (indicateurs direction) ; rapports R2 et R7 du primaire pour les besoins de l'école |
| PR-32 | Provenance des élèves, commissions (`student_provenances`) | **Hors module → 007** | Canal d'acquisition de la candidature |

## 5. Fonctions NOUVELLES (sans équivalent legacy)

| ID | Fonction | Où |
|---|---|---|
| N-01 | Niveaux PS/MS/GS/CP1…CM2, plans de trimestres, politique d'appel `DAILY` — **en données** | Modèle de pack (`pack-template.md`), 004/010 |
| N-02 | Évaluation par compétences : échelles, référentiels versionnés, saisie en lot, validation, révisions | `primary_school` |
| N-03 | Banque d'appréciations | `primary_school.appreciation_phrases` |
| N-04 | Conseil des maîtres : dossier de séance, présence, quorum par règle, PV signé | `primary_school` + `results` + `reportcards` |
| N-05 | Bilan annuel scellé et versionné | `primary_school.annual_reviews` + `reportcards` |
| N-06 | Archivage d'année gelé avec manifeste | `primary_school.year_archives` |
| N-07 | Rapports R1–R8 (liste de classe, effectifs, registre d'appel, redoublants, couverture des compétences, dossier de conseil, avancement, états administratifs) | `primary_school` (lecture) |
| N-08 | Contrats de règles `coef-period@1` et `competency-period@1`, RuleSet fictif, filigrane | 012 / 005 |
| N-09 | Rôle `instituteur`, garde « classe active ⇒ titulaire » | 002/009/004 |

## 6. Défauts du legacy explicitement NON reproduits (applicables au primaire)

1. Moyennes de matière saisies à la main, écrasées sans historique (PR-10).
2. Arithmétique flottante aux seuils et cascade d'arrondis (PR-18).
3. Classement à tolérance chaînée et plafond silencieux à 300 (PR-12).
4. Détection par motifs textuels (« REDOUBL », « 2ᵉ semestre » dans un libellé) (PR-13, PR-15).
5. Dix champs d'inscription dupliqués sur la fiche élève et l'inscription ; `affectation_*` en texte libre (PR-05).
6. Suppression physique d'une année académique (PR-25).
7. Constantes de seuils (mentions, décisions) codées en dur et dupliquées dans le web ; elles ne sont **pas** transposées au primaire (PR-14, PR-17).

## 7. Synthèse

| Statut | Nombre | IDs |
|---|---|---|
| Conservé | 3 | PR-01, PR-24, PR-14 (mécanisme) |
| Amélioré | 13 | PR-02, PR-04, PR-05, PR-10 à PR-13, PR-16, PR-18, PR-20 à PR-22, PR-27 |
| Abandonné | 3 | PR-07, PR-15, PR-25 |
| Hors module | 7 | PR-03, PR-06, PR-23, PR-26, PR-30, PR-31, PR-32 |
| Non transposé (question ouverte) | 1 | PR-17 |
| Nouveau | 9 | N-01 à N-09 |

Total : 27 lignes d'inventaire (PR-01 à PR-32) + 9 fonctions nouvelles.

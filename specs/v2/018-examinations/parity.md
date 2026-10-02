# Parité legacy — 018-examinations

**Périmètre** : ce que le legacy contient en matière d'examens (nationaux ou internes) et son sort en v2 : **reproduit** (conservé), **amélioré**, **abandonné** (justifié), **hors module → NNN**, **nouveau**.

**Constat fondateur.** Le legacy n'a **aucun module d'examens nationaux** : pas de type d'examen, de session, de candidat, de numéro, de centre, de résultat officiel, d'admission, de statistique, d'export ni de document d'examen. Il ne connaît que : (a) deux champs d'inscription libres (`cepe_code`, `affectation_*`) ; (b) un **emploi du temps des épreuves internes** (`exam_schedules`) ; (c) les **sessions d'examen d'UE/ECUE** du supérieur (session 1 / session 2), qui relèvent de `assess`, `results` et `higher` ; (d) un indicateur d'examen terminal pour les classes BTS détecté par le **nom de la classe**. Le CEPE et, plus généralement, `ExaminationManagement` du PRD §21 sont donc **nouveaux** ; la parité porte sur les quelques éléments existants.

Références : `MIG` = `infra/scripts/migrations`, `RT` = `apps/api/src/routes`. `SC-*` renvoie à `specs/v2/017-scheduling/parity.md`, `P-RUL-*` à `012-rules-engine/parity.md`.

## 1. Champs et tables du legacy touchant aux examens

| ID | Élément legacy (réf.) | Comportement | Sort | Cible v2 | Remarque |
|---|---|---|---|---|---|
| EX-01 | `student_enrollments.cepe_code` (`MIG/0059_add_per_enrollment_fields.sql`, `RT/enrollments.ts:73,242,416,685,1103,1139,1247`) | Texte libre (100 caractères) saisi sur l'**inscription** ; aucun contrôle de format ni d'unicité ; recopié dans les lectures | **Amélioré** | `examinations.candidate_identifiers` (nature `CEPE_CODE`), **unique par session et nature**, rattaché au **candidat** (pas à l'inscription) | Un code CEPE n'a de sens que pour une session d'examen ; l'unicité est désormais garantie. Chargement des données de test : `source = MIGRATION` |
| EX-02 | `student_enrollments.affectation_status` (`affecte`, `non_affecte`, `prise_en_charge`), `affectation_decision` (`RT/enrollments.ts:71-72,414-415`) | Texte libre ; suit probablement le résultat du CEPE (affectation en 6e) | **Hors module → 004 / 006 / 007** | `enrollments.funding_type` + `assignment_reference` (004) ; **l'admission en 6e** consomme `examinations.result.published` (résultat seul) | L'**affectation n'est pas** un résultat d'examen : le module n'en porte aucune donnée (Q-E18) |
| EX-03 | `exam_schedules` (`MIG/0033_exam_schedules.sql`) : nom, type (`midterm`, `final`, `quiz`, `assignment`, `other`), date, heure, durée, lieu, cours, année | Emploi du temps des évaluations **internes** d'un cours | **Hors module → 017** | `scheduling` : occurrences `kind = EXAM` (SC-055 à SC-058) | « Gestion avancée des épreuves → 018 » (SC-056) : les épreuves **d'un examen national** sont `session_papers` ; la planification horaire d'une épreuve peut référencer une occurrence 017 (facultatif) |
| EX-04 | Routes `RT/exam-schedules.ts` (liste, création, modification, suppression) et côté parent (`RT/parent-academic.ts:658`) | CRUD d'épreuves internes | **Hors module → 017** | SC-055 à SC-058 | |
| EX-05 | Sessions d'examen d'UE/ECUE du supérieur (session 1 / session 2, note d'examen S1 remplacée par S2) — `professional-results.service.ts` | Examens **de cours** | **Hors module → 011 / 012 / 019** | `assess` (types à rattrapage), contrat `credit-semester@1` | Ce ne sont pas des examens **nationaux** ; aucun lien avec ce module |
| EX-06 | Examen terminal du BTS 2ᵉ année détecté par `isSecondYearBtsClass` (nom de la classe) — P-RUL-23 | Décision « redouble en cas d'échec au BTS » | **Hors module → 012 / 020** | Variable `examen_terminal_requis` (donnée de curriculum) ; BTS = spec 020 | La détection par nom est abandonnée (012) |
| EX-07 | `PHASE5_RSO_FEATURES.md` / docs : aucune fonction d'examen national | — | — | — | Aucune documentation legacy sur le CEPE, le BEPC, le BAC |

## 2. Défauts du legacy explicitement NON reproduits

1. `cepe_code` en texte libre **dupliqué** sur la fiche et l'inscription, sans unicité ni format (EX-01).
2. `affectation_*` en texte libre, mêlant résultat d'examen, décision d'État et prise en charge (EX-02).
3. Planification d'épreuves **sans conflit de salle ni de surveillant** (SC-056, traité en 017).
4. Détection d'un examen terminal par le **nom d'une classe** (EX-06).

## 3. Fonctions NOUVELLES (sans équivalent legacy)

| ID | Fonction |
|---|---|
| N-01 | Types d'examens, séries, épreuves, pièces exigées, formats d'export **en données** |
| N-02 | Sessions officielles et blanches, **définition figée** par session |
| N-03 | Candidats : identité figée, éligibilité par règle journalisée, dérogation motivée, pièces |
| N-04 | Numéro de candidat **sans trou**, numéro officiel distinct, unicité des identifiants |
| N-05 | Centres, salles, répartition des places, convocations |
| N-06 | Examens blancs liés à `assess`, résultats calculés et tracés |
| N-07 | Notes d'épreuves, import de résultats officiels, publication, **révisions approuvées** |
| N-08 | Statistiques par établissement, série, sexe ; taux de réussite par règle |
| N-09 | Exports officiels paramétrables, exécutions tracées |
| N-10 | Attestations de réussite, convocations, relevés scellés (QR) |
| N-11 | Historique du candidat en ajout seul |
| N-12 | Contrat `exam-national@1`, RuleSet fictif, golden tests de mécanisme |
| N-13 | CEPE fictif comme première instance (données marquées) |

## 4. Synthèse

| Statut | Nombre | IDs |
|---|---|---|
| Amélioré | 1 | EX-01 |
| Hors module | 5 | EX-02, EX-03, EX-04, EX-05, EX-06 |
| Sans objet | 1 | EX-07 |
| Nouveau | 13 | N-01 à N-13 |

Total : 7 éléments d'inventaire + 13 fonctions nouvelles.

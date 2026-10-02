# Contrats de règles (012-rules-engine) — catalogue normatif

**Statut** : Rédigée — annexe normative de `spec.md` §5 (contrat module ↔ moteur). Le code des contrats vit dans `apps/api/src/modules/rules/contracts/` (constantes TypeScript en anglais) ; ce document en est la référence fonctionnelle.

## 1. Qu'est-ce qu'un contrat de règles

Le moteur (`@ecoledigitale/rules-engine`, ADR-003) **ne chaîne pas** : il évalue une règle sur un contexte immuable fourni par l'appelant. Le **chaînage** (quelle règle alimente quelle autre, dans quel ordre, sur quelles données) est de la **structure**, pas de la valeur ; il est donc écrit en code par le module consommateur, une fois, et **versionné** par un identifiant de contrat.

Un **contrat** = `{ id: "<nom>@<n>", rules: [...], pipeline }` où :

- chaque entrée de `rules` fixe, pour une **clé de règle**, son **type** (`RULE_TYPES` du moteur), son **schéma d'entrée** (`RuleSchemaSpec`), son **type de résultat** (`ResultTypeSpec`) et son caractère **obligatoire / optionnel** ;
- `pipeline` est l'ordre d'appel (graphe orienté acyclique) tel que décrit en §4 et 5, implémenté par `results` (calcul des périodes) et `higher` (capitalisation, diplomation).

Une **RuleVersion** déclare `contract_id`. À la **proposition** (`simulated → proposed`) puis à l'**approbation**, `rules` vérifie par `validate()` que la version **satisfait le contrat** : toutes les clés obligatoires présentes, schémas d'entrée **compatibles** (mêmes champs, mêmes types, nullité au plus aussi stricte que le contrat), type de résultat conforme, paramètres sans valeur hors bornes. Une version qui ne satisfait pas son contrat **ne peut pas être proposée**.

> Règle d'or : **changer une valeur, un seuil, une formule ou un arrondi = nouvelle RuleVersion (donnée)**. **Changer le chaînage ou l'ensemble des variables d'entrée = nouveau contrat (`@2`) = livraison de code**.

Les identifiants de règles, de variables, de paramètres et de lookups sont en **français** (public cible : rédacteurs de règles non techniciens, ADR-003 « Formation des rédacteurs »). Les constantes TypeScript qui les référencent sont en anglais. Les **résultats textuels** sont des **codes anglais en majuscules** (stables, utilisables par la logique) ; les libellés affichés viennent de la table `label_map` de la version (`rules.rule_definitions.label_map`, locale → texte). Aucune logique ne s'appuie sur un libellé (défaut hérité : `buildAssignmentFlagsFromDecision`, `semester-averages.ts:209`, déduisait « redoublant » en cherchant « REDOUBL » dans un texte).

Convention de schéma : `n?` = nombre pouvant être absent (note non saisie ⇒ `null`, **jamais 0**) ; `liste<…>` = `{ list: … }` du moteur.

## 2. Contrat `credit-semester@1` (supérieur à crédits : UE / ECUE)

RuleSet de départ : **`CI-HIGHER-LMD`**. Colonne « fixture » = clé de `packages/rules-engine/test/fixtures/rulesets.ts` (`BTS_LMD_RULES`) ; « NOUVELLE » = règle à ajouter aux fixtures (le code historique la portait hors du moteur, voir `parity.md`).

### 2.1 Niveau ECUE

| Clé | Type moteur | Entrées | Résultat | Fixture / origine legacy | Expression de départ (principe) |
|---|---|---|---|---|---|
| `note_sur_20` | `grading_scale` | `note: number`, `bareme: number` | `number` | NOUVELLE — `normaliserNote`, `bulletin-calc.ts:73` | `note / bareme * 20` (bareme > 0 garanti par `assess`) |
| `moyenne_devoirs` | `assessment_aggregation` | `devoirs: liste<{note, bareme, poids}>` | `number?` | NOUVELLE — `moyenneDevoirs`, `:79` (moyenne **simple**, coefficient d'évaluation ignoré) | `if(len(devoirs)==0, null, avg(map(devoirs, d => d.note / d.bareme * 20)))` ; variante pondérée disponible par `wavg` (Q-08) |
| `note_examen_retenue` | `assessment_aggregation` | `note_s1: number?`, `note_s2: number?` | `number?` | NOUVELLE — `computeEcueBreakdown`, `professional-results.service.ts:231-257` (« la Session 2 REMPLACE la Session 1 ») | `if(is_null(note_s2), note_s1, note_s2)` (Q-02) |
| `session_examen_retenue` | `assessment_aggregation` | `note_s2: number?` | `number` | NOUVELLE — `:249` | `if(is_null(note_s2), 1, 2)` |
| `note_ecue` | `assessment_aggregation` | `moyenne_devoirs: number?`, `note_examen: number?` | `number?` | `note_ecue` | `if(is_null(note_examen), null, coalesce(moyenne_devoirs,0)*params.poids_devoirs + note_examen*params.poids_examen)` ; `poids_devoirs=0.4`, `poids_examen=0.6` (bornes 0..1) |
| `note_ecue_directe` | `assessment_aggregation` | `note_examen: number?` | `number?` | NOUVELLE — conduite : « vaut sa note brute », `professional-bulletin.service.ts:1740-1742` | `note_examen` (pour les nœuds `grading_mode = DIRECT`) |
| `ecue_eliminee` | `eliminatory_grade` | `note: number?`, `validation_manuelle: boolean` | `boolean` | `ecue_eliminee` | `!is_null(note) && note < params.seuil_eliminatoire` (`seuil_eliminatoire = 5`) |
| `ecue_validee` | `credit_validation` | `note: number?`, `validation_manuelle: boolean` | `boolean` | `ecue_validee` | `(!is_null(note) && note >= params.seuil_validation) || validation_manuelle` (`seuil_validation = 10`) |
| `eligible_rattrapage` | `promotion` | `note: number?`, `validee: boolean`, `session2_tentee: boolean`, `rattrapage_autorise: boolean` | `boolean` | NOUVELLE — `RATTRAPAGE_PREDICATE`, `professional-results.service.ts:57-64` | `rattrapage_autorise && !is_null(note) && !validee && !session2_tentee` |

### 2.2 Niveau UE

| Clé | Type | Entrées | Résultat | Fixture | Remarque |
|---|---|---|---|---|---|
| `moyenne_ue` | `period_average` | `ecues: liste<{note: number?, credits: number, validation_manuelle: boolean}>` | `number?` | `moyenne_ue` | `wavg(ecues.note, ecues.credits)` ; **valeur non arrondie** |
| `credits_ue` | `credit_validation` | idem | `number` | `credits_ue` | `sum(ecues.credits)` |
| `ue_validee` | `credit_validation` | `moyenne: number?`, `ecues: …` | `boolean` | `ue_validee` | moyenne ≥ `seuil_validation`, aucune ECUE éliminatoire non validée manuellement, toutes les ECUE notées |
| `statut_ecue` | `compensation` | `note: number?`, `ue_validee: boolean` | `string` ∈ `PENDING, ELIMINATORY, VALIDATED, COMPENSATED, INSUFFICIENT` | `statut_ecue` | codes anglais (fixture : `en_cours`, `eliminatoire`, `valide`, `compense`, `insuffisant`) |
| `etat_ue` | `credit_validation` | `validee: boolean`, `session2_tentee: boolean` | `string` ∈ `VALIDATED, RESIT, DEBT` | NOUVELLE — `professional-bulletin.service.ts:1717-1722` | `if(validee,"VALIDATED", if(session2_tentee,"DEBT","RESIT"))` |
| `session_validation_ue` | `credit_validation` | `validee: boolean`, `sessions: liste<number>` (session d'obtention de chaque ECUE validée) | `number?` | NOUVELLE — `:1705-1714` | `if(!validee, null, max(1, max(sessions)))` |

### 2.3 Niveau semestre

| Clé | Type | Entrées | Résultat | Fixture | Remarque |
|---|---|---|---|---|---|
| `moyenne_session` | `period_average` | `ues: liste<{moyenne: number?, credits: number, validee: boolean}>` | `number?` | `moyenne_session` | `wavg(ues.moyenne, ues.credits)` sur les moyennes UE **non arrondies** (défaut hérité : `professional-bulletin.service.ts:1803-1807` passait des moyennes déjà arrondies à 2 décimales, cascade d'arrondis) |
| `credits_valides` | `credit_validation` | `ues` | `number` | `credits_valides` | `sum(map(filter(ues, u => u.validee), u => u.credits))` |
| `credits_total` | `credit_validation` | `ues` | `number` | `credits_total` | `sum(ues.credits)` |
| `semestre_valide` | `promotion` | `ues: liste<{validee: boolean}>` | `boolean` | **diverge de la fixture** | Comportement **réellement appliqué** par le relevé (`computeStudentBulletin`, `:1812`) : `len(ues) > 0 && all(ues, u => u.validee)` — aucune compensation entre UE. La fixture porte `credits >= 20`, constante exportée par `bulletin-calc.ts:28,198` mais **jamais appelée** par un service (Q-01). |
| `semestre_valide_par_credits` | `promotion` | `credits: number` | `boolean` | fixture `semestre_valide` | **Optionnelle** ; `credits >= params.credits_requis` (20). Fournie pour le jour où l'établissement choisit la règle documentée (Q-01). |
| `decision_semestre` | `promotion` | `semestre_valide: boolean`, `ue_en_rattrapage: number` | `string` ∈ `ADMITTED, RESIT, ADJOURNED` | NOUVELLE — `:1824` (`admis / rattrapage / ajourne`) ; `statut_etudiant` (`valide / session2 / dette`) en est isomorphe | `if(semestre_valide,"ADMITTED", if(ue_en_rattrapage>0,"RESIT","ADJOURNED"))` |
| `mention_releve` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, INSUFFICIENT, PASSABLE, FAIRLY_GOOD, GOOD, VERY_GOOD, EXCELLENT` | NOUVELLE — `appreciation`, `apps/web/src/lib/bulletin-format.ts:65-72` et `loadMentionForFilieres`, `professional-cycle-groups.ts:244-249` | seuils paramétrés : 10 / 12 / 14 / 16 / 18 (bornes inférieures incluses) |
| `appreciation_generale` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, WORK_INSUFFICIENT … WORK_EXCELLENT` | NOUVELLE — `bulletin-format.ts:186-195` | seuils 8 / 10 / 12 / 14 / 16 / 18 |
| `distinction_semestre` | `mention` | `moyenne: number?` | `string` ∈ `NONE, HONOR_ROLL, HONOR_ROLL_ENCOURAGEMENT` + `WARNING` | NOUVELLE — `professional-bulletin.service.ts:629-636` | `12 ≤ m < 15` tableau d'honneur ; `m ≥ 15` + encouragement ; `m < 10` avertissement (Q-19) |
| `arrondi_affichage` | `rounding` | `valeur: number?` | `number?` | `arrondi_affichage` | `round_half_up(valeur, 2)` — **affichage uniquement, jamais en entrée d'une autre règle** |
| `rang` | `ranking` | `moyenne: number?`, `cohorte: liste<number?>` | `number?` | `rang` | `rank(moyenne, cohorte, 4)` — compétition (ex æquo, rang suivant sauté), égalité à 4 décimales (ADR-003 §Conséquences) |

### 2.4 Niveau année / cycle / diplôme

| Clé | Type | Entrées | Résultat | Fixture | Remarque |
|---|---|---|---|---|---|
| `moyenne_annuelle` | `annual_average` | `semestres: liste<{moyenne: number?, credits: number}>` | `number?` | NOUVELLE — `getBulletinBts`, `professional-bulletin.service.ts:704-711` | `wavg(semestres.moyenne, semestres.credits)` ; sert aussi de moyenne de cycle pour la mention de diplôme (`:244-249`) |
| `annee_validee_par_credits` | `promotion` | `credits: number` | `boolean` | fixture `passage_annee_superieure` | **Optionnelle** ; `credits > params.credits_exclusifs` (48, strictement supérieur) ; jamais appliquée en production (Q-01) |
| `diplome_eligible` | `promotion` | `exigences: liste<{valide: boolean, obligatoire: boolean, uv: number}>`, `uv_requises: number` | `boolean` | NOUVELLE — `evaluateDiplomaEligibility`, `professional-diplomas.service.ts:64-109` | toutes les exigences obligatoires validées ET Σ UV des exigences validées ≥ `uv_requises` ; le contexte est **dédoublonné par UE** (obligatoire prioritaire) |
| `mention_diplome` | `mention` | `moyenne: number?` | idem `mention_releve` | NOUVELLE | mêmes seuils que `mention_releve` mais **règle distincte** (un établissement peut vouloir une échelle de diplôme différente, Q-05) |

### 2.5 Ordonnancement (pipeline `credit-semester@1`)

Par `(inscription, période-semestre, session)` — implémenté par `results` :

```
pour chaque ECUE de l'inscription dans le semestre :
   si mode = COMPOSED :
        moyenne_devoirs(devoirs)                                  # devoirs = notes publiées de la période, session 1 (type 'continu')
        note_examen_retenue(note_s1, note_s2) ; session_examen_retenue(note_s2)
        note_ecue(moyenne_devoirs, note_examen_retenue)
   sinon (DIRECT) : note_ecue_directe(note_examen)
   surcharge éventuelle (results.overrides) appliquée ici, tracée
pour chaque UE :
   moyenne_ue(ecues) → ue_validee(moyenne, ecues) → pour chaque ECUE : ecue_eliminee, ecue_validee, statut_ecue(note, ue_validee)
   credits_ue ; etat_ue ; session_validation_ue ; eligible_rattrapage (par ECUE)
pour le semestre :
   moyenne_session(ues) → credits_valides, credits_total, semestre_valide, decision_semestre
   mention_releve, appreciation_generale, distinction_semestre, arrondi_affichage (valeurs d'affichage)
   rang(moyenne, cohorte)          # 2e phase : après calcul de tous les étudiants de la classe
pour l'année / le cycle (si ≥ 2 semestres FINAL) :
   moyenne_annuelle(semestres) → mention_diplome
```

## 3. Contrat `coef-semester@1` (matières à coefficients)

RuleSets de départ : **`CI-CLASSIC-SEMESTRE`** (pile classique) et **`CI-HIGHER-BTS`** (classes BTS). Même contrat, deux RuleSets (sources et évolutions distinctes, voir `rulesets-de-depart.md`).

| Clé | Type | Entrées | Résultat | Fixture / origine legacy |
|---|---|---|---|---|
| `moyenne_matiere` | `assessment_aggregation` | `notes: liste<{note, bareme, poids, type}>` | `number?` | NOUVELLE — **aucune formule en legacy** : la moyenne de matière était **saisie à la main** (`PUT /matrix`, `semester-averages.ts:611-700`). Défaut proposé : moyenne des notes /20 pondérée par `poids` (Q-23). |
| `moyenne_ponderee` | `period_average` | `matieres: liste<{score: number?, coef: number}>` | `number?` | `moyenne_ponderee` (`computeWeightedAverage`, `semester-averages.ts:363-386`) |
| `moyenne_section` | `period_average` | idem, par type de bilan | `number?` | NOUVELLE — `coursesBySection` / `sectionStatsByName`, `:1015-1050` (sous-moyennes par type de bilan) ; même expression que `moyenne_ponderee` |
| `moyenne_annuelle` | `annual_average` | `s1: number?`, `s2: number?`, `second_semestre: boolean` | `number?` | `moyenne_annuelle` — `(s1·poids_s1 + s2·poids_s2)/(poids_s1+poids_s2)` (1 et 2) quand S2 et S1 existent, sinon `s2`. **`second_semestre` vient du type/rang de la période (`academic.academic_periods`), plus d'une recherche de « SEMESTRE 2 » dans le nom** (`:1105-1107`) |
| `mention` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, INSUFFICIENT, PASSABLE, FAIRLY_GOOD, GOOD, VERY_GOOD, EXCELLENT` | `mention` — seuils 16 / 14 / 12 / 10 / 8 |
| `decision_conseil` | `promotion` | `moyenne: number?` | `string` ∈ `INCOMPLETE, PERIOD_VALIDATED, REINFORCEMENT_ADVISED, PERIOD_NOT_VALIDATED` | `decision_conseil` — seuils 10 et 8 |
| `decision_fin_annee` | `repetition` | `moyenne: number?`, `second_semestre: boolean`, `examen_terminal_requis: boolean` | `string` ∈ `PENDING, EXAM_REFERRAL, PROMOTED, REPEAT` | `decision_fin_annee` — la variable fixture `bts_deuxieme_annee` (déduite du **nom de la classe**, `isSecondYearBtsClass`, `:188-195`) devient `examen_terminal_requis`, attribut de la **donnée** programme/niveau (`academic.curriculum_nodes`), fourni par `results` |
| `distinction` | `mention` | `moyenne: number?` | `string` ∈ `NONE, HONOR_ROLL, HONOR_ROLL_ENCOURAGEMENT, HONOR_ROLL_CONGRATS` | `distinction` — 12 / 15 / 17 |
| `appreciation_conseil` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, WORK_INSUFFICIENT, WORK_FRAGILE, WORK_PASSABLE, WORK_FAIRLY_GOOD, WORK_GOOD, WORK_VERY_GOOD, WORK_EXCELLENT` | NOUVELLE — `buildCouncilAppreciationFromAverage`, `:228-236` — seuils 8 / 10 / 12 / 14 / 16 / 18 |
| `arrondi_affichage` | `rounding` | `valeur: number?` | `number?` | NOUVELLE (la pile classique n'arrondissait que dans le rendu HTML, `report-card-template.service.ts:177-192`) |
| `rang` | `ranking` | `moyenne: number?`, `cohorte: liste<number?>` | `number?` | `rang` — appliqué par matière, par section, global, annuel (`:1015-1160`) |

Pipeline : `moyenne_matiere` (par matière) → `moyenne_section` / `moyenne_ponderee` (global) → `rang` (matière, section, global) → `mention`, `decision_conseil` → (2ᵉ semestre) `moyenne_annuelle` → `rang` annuel → `decision_fin_annee`, `distinction`, `appreciation_conseil`. L'indicateur « affecté / redoublant » (`buildAssignmentFlagsFromDecision`) disparaît : il est **déduit du code** `decision_fin_annee` par le contrat (`REPEAT` → redoublant ; `PROMOTED` → passe ; `PENDING`/`EXAM_REFERRAL` → ni l'un ni l'autre).

## 4. Contexte typé : ce que `results` et `higher` fournissent

| Donnée | Source (via port) | Règles de constitution du contexte |
|---|---|---|
| Notes d'évaluation | `assess` — **uniquement** les notes au statut `PUBLISHED` (et `entry_status = ENTERED`) | Ordre déterministe (date, puis id). `bareme`, `poids`, `type` copiés de l'évaluation. Une évaluation sans note publiée ne produit **aucune** ligne (≠ 0). |
| Structure du curriculum | `academic.curriculum_nodes` (004) | Attributs lus : type de nœud, parent, `credits`, `coefficient`, `grading_mode`, `resit_allowed`, `counts_in_average`, `category`, `ordre`. **Aucune** détection par libellé. |
| Période | `academic.academic_periods` (004) | Type, rang dans l'année, dates : fournissent `second_semestre`, les bornes de pin. |
| Validation manuelle / surcharge | `results.overrides` approuvées | Booléen `validation_manuelle` ou valeur de substitution ; chaque usage est tracé. |
| Session 2 | `assess` (`session_no = 2`) | `note_s1`, `note_s2` séparées ; `session2_tentee` = existence d'une note S2 publiée. |
| Cohorte (rang) | `results` (phase 2) | Liste des valeurs de tous les inscrits du groupe de classement (classe × période, ou classe × matière) ; `null` pour les non notés. |
| Exigences de diplôme | `higher.diploma_requirements` | Dédoublonnées par UE, `obligatoire` prioritaire ; `valide` lu dans `higher.credit_ledger`. |

Contraintes de contexte (moteur) : tailles de listes bornées par le budget (100 000 nœuds par évaluation) ; `rang` sur une cohorte ≤ 5 000 valeurs par évaluation (au-delà : découpage du groupe de classement, voir spec §13) ; aucune donnée personnelle superflue (le contexte ne contient **ni nom ni identifiant d'élève**, seulement les nombres et booléens utiles ; l'élève est repéré par la clé d'appel, pas par le contexte).

## 5. Contrats des packs Primaire, Secondaire et Examens (livrés — Phase 4-5)

Les contrats ci-dessous sont des **structures** (clés, types, entrées, codes de sortie, chaînage) ; **aucune valeur officielle** n'y figure. Leur définition normative est dans `specs/v2/005-primary/rule-contract.md` (`coef-period@1`, `competency-period@1`), `specs/v2/006-secondary/spec.md` §6.4 (`secondary-annual@1`) et `specs/v2/018-examinations/rule-contract.md` (`exam-national@1`) ; leur code est dans `apps/api/src/modules/rules/contracts/`.

| Contrat | Spec | Livré | Jeu fictif livré |
|---|---|---|---|
| `coef-period@1` (primaire : N périodes pondérées, moyenne générale annuelle, décision en 4 codes dont `COUNCIL_REVIEW`, cas à examiner, quorum) | 005-primary | oui | `CI-PRIMARY-PLACEHOLDER` v1 |
| `competency-period@1` (maternelle : évaluation par compétences sans note ; la règle ne décide jamais seule) | 005-primary | oui | `CI-PRIMARY-PLACEHOLDER` v2 |
| `secondary-annual@1` (secondaire : même pipeline que `coef-semester@1` pour un nombre quelconque de périodes pondérées) | 006-secondary | oui | `CI-SECONDARY-PLACEHOLDER` v2 (v1 : copie de démonstration de `coef-semester@1`) |
| `exam-national@1` (éligibilité, examen blanc, taux de réussite) | 018-examinations | oui | `CI-EXAM-PLACEHOLDER` v1 |

**Adaptations par rapport aux textes des specs 005 et 006** (décisions d'implémentation, à confirmer) :

- le DSL n'a que des paramètres scalaires : le paramètre `poids_par_type` (objet code → poids) de `moyenne_matiere` n'existe pas ; une version qui pondère par type d'évaluation le fait **dans l'expression** (`if(n.type == "CODE", …)`), sans nouveau contrat ;
- `poids_periodes` (006) est la **donnée** `poids` de chaque période (champ `average_weight` de `academic.academic_periods`, copié du créneau de plan `slots[].averageWeight`, défaut 1), pas un paramètre : le poids de **répartition des dates** d'un créneau (`slots[].weight`) est une autre notion ;
- `secondary-annual@1` : `decision_fin_annee` reçoit `derniere_periode` (donnée de calendrier) à la place de `second_semestre` ; les codes de sortie sont ceux de `coef-semester@1` (`PENDING`, `EXAM_REFERRAL`, `PROMOTED`, `REPEAT`).

Aucune règle réglementaire ivoirienne officielle n'est inventée : les jeux `*-PLACEHOLDER` sont des jeux de **démonstration**, et les autres contrats sont issus de **formules déjà en production** dans le code legacy.

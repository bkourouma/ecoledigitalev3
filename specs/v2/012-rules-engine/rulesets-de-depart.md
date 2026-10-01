# RuleSets de départ (012-rules-engine) — `CI-HIGHER-LMD`, `CI-HIGHER-BTS`, `CI-CLASSIC-SEMESTRE`

**Statut** : Rédigée — annexe normative de `spec.md` §5.3 et §12. Ces trois RuleSets sont le **portage fidèle des formules déjà en production** (ADR-003, tâche 0.8 ; `packages/rules-engine/test/fixtures/rulesets.ts`). Ils **ne prétendent pas** être des règles officielles ivoiriennes : leur `source.kind` est `platform`, leur `reference` est le fichier legacy porté. Les textes officiels sont des QUESTIONS MÉTIER (`regulatory-sources-needed.md`).

## 1. Fiche commune

| Champ | Valeur |
|---|---|
| Portée | `national` (catalogue plateforme), tables `rules.national_*` |
| Pays | `CI` |
| Statut au seed | `published` (seed de la baseline v2, version 1, `effective_from = 2024-09-01` ; date de la fixture) |
| Seed | migration de données `rules` (jeu déterministe), idempotente, signée du hash de définition |
| Variante tenant | un établissement peut dériver une variante de **n'importe quel** de ces RuleSets (spec US1, US3) |
| Tests | les golden tests du package (`golden-bts-lmd`, `golden-classique`) sont **la** recette ; ils sont étendus aux règles NOUVELLES (voir plan §T-GOLD) |

## 2. `CI-HIGHER-LMD`

| Attribut | Valeur |
|---|---|
| Contrat | `credit-semester@1` |
| `educationSystem` | `HIGHER` ; `level` absent (s'applique à tout niveau Higher non spécialisé) |
| Équivalent fixture | `BTS_LMD` (renommé : la fixture portait « BTS / LMD » car le même service servait les deux ; aucun code legacy ne distingue BTS de LMD dans le calcul à crédits) |
| Sources legacy | `bulletin-calc.ts:24-213` ; `professional-bulletin.service.ts:1621-1909` ; `professional-results.service.ts:195-380` ; `professional-cycle-groups.ts:227-253` ; `apps/web/src/lib/bulletin-format.ts:65-72,186-195` |

### Paramètres (toutes les « constantes » du legacy deviennent des données)

| Règle | Paramètre | Défaut | Bornes | Origine |
|---|---|---|---|---|
| `note_ecue` | `poids_devoirs` | 0,4 | 0..1 | `POIDS_DEVOIRS`, `bulletin-calc.ts:24` |
| `note_ecue` | `poids_examen` | 0,6 | 0..1 | `:25` |
| `ecue_validee`, `ue_validee`, `statut_ecue` | `seuil_validation` | 10 | 0..20 | `SEUIL_VALIDATION`, `:26` |
| `ecue_eliminee`, `ue_validee`, `statut_ecue` | `seuil_eliminatoire` | 5 | 0..20 | `SEUIL_ELIMINATOIRE`, `:27` |
| `semestre_valide_par_credits` (optionnelle) | `credits_requis` | 20 | ≥ 0 | `SEMESTRE_CREDITS_REQUIS`, `:28` |
| `annee_validee_par_credits` (optionnelle) | `credits_exclusifs` | 48 | ≥ 0 | `ANNEE_SUP_CREDITS`, `:29` |
| `mention_releve`, `mention_diplome` | `passable`, `assez_bien`, `bien`, `tres_bien`, `excellent` | 10, 12, 14, 16, 18 | 0..20 croissants | `appreciation()`, `bulletin-format.ts:65-72` ; `professional-cycle-groups.ts:244-249` |
| `appreciation_generale` | 6 seuils | 8, 10, 12, 14, 16, 18 | croissants | `bulletin-format.ts:186-195` |
| `distinction_semestre` | `honneur`, `encouragement`, `avertissement` | 12, 15, 10 | | `professional-bulletin.service.ts:629-636` |
| `rang` | décimales d'égalité | 4 (littéral de l'expression) | | ADR-003 |
| `arrondi_affichage` | décimales | 2 | | `arrondi()`, `:210` |

### Comportement fonctionnel figé (version 1)

1. Note d'ECUE = `moyenne des devoirs × 0,4 + examen × 0,6` ; sans examen ⇒ pas de note (`en attente`) ; sans devoir ⇒ le continu compte pour 0.
2. Moyenne d'UE = moyenne des notes d'ECUE pondérée par les crédits d'ECUE, ECUE notées seulement. UE validée si moyenne ≥ 10 **non arrondie**, aucune ECUE < 5 (sauf validation manuelle), toutes les ECUE notées.
3. Une ECUE entre 5 et 10 est « compensée » si l'UE est validée, « insuffisante » sinon. **Pas de compensation entre UE**.
4. Semestre validé = **toutes les UE validées** (comportement réel du relevé). Décision : `ADMITTED` / `RESIT` (au moins une UE en rattrapage, session 2 non tentée) / `ADJOURNED` (dette).
5. Session 2 : la note de session 2 **remplace** celle de session 1 (Q-02).
6. Moyenne du semestre = moyenne des moyennes d'UE (non arrondies) pondérée par les crédits d'UE ; moyenne annuelle/cycle = moyenne des moyennes de semestre pondérée par les crédits de semestre.
7. Mention de relevé et de diplôme : échelle 10 / 12 / 14 / 16 / 18.

### Écarts volontaires avec le comportement legacy (à faire valider : `open-questions.md`)

| # | Legacy | v2 | Justification |
|---|---|---|---|
| E1 | Seuils testés en flottant : 24 couples (devoirs, examen) sur la grille à 2 décimales donnent 10 exactement mais jugés `< 10`, et des cas symétriques franchissent à tort le seuil de 5 (ADR-003 §Contexte) | Arithmétique décimale exacte | Une admission ne peut pas dépendre d'un `0.1+0.2`. Les cas sont des tests de régression nommés. |
| E2 | Moyenne de semestre calculée sur des moyennes d'UE **arrondies** à 2 décimales (`professional-bulletin.service.ts:1803`) | Calcul exact, arrondi **à l'affichage seulement** | Cascade d'arrondis. Écart maximal observable : 0,005 point sur la moyenne affichée (Q-06). |
| E3 | Classement : tolérance de 0,0001 **chaînée** entre voisins triés (`semester-averages.ts:147-168`), non transitive ; plafond 300 étudiants (`professional-bulletin.service.ts:512,1525`) | `rank(x, cohorte, 4)` (égalité à 4 décimales, transitive) ; plafond 5 000 par évaluation | ADR-003 §Conséquences ; le plafond de 300 faisait disparaître silencieusement les rangs. |
| E4 | Conduite = UE/ECUE repérée par `libelle ILIKE 'conduite%' OR code ILIKE '%EC-CON%'` (`professional-bulletin.service.ts:1755`, `professional-results.service.ts:36`) | Attributs de nœud `grading_mode = DIRECT`, `resit_allowed = false` | Aucune heuristique textuelle. |
| E5 | « Licence 1 / Licence 2 » reconnu par expression régulière sur le nom de la filière pour choisir la mise en page (`:478`, `bulletin-format.ts:199`) ; cycles « Licence n / Master n » reconstitués par le nom (`professional-cycle-groups.ts:29-81`) | Structure explicite du curriculum (nœud « cycle » / diplôme) ; modèle de mise en page = donnée du gabarit | Le nom est un libellé, pas une structure. |
| E6 | Année académique déduite de la date de début de session (septembre) (`:1826-1838`) | `academic.academic_years.id` | Référence stable. |
| E7 | `semestreValide(≥ 20)` et `peutPasserAnneeSuperieure(> 48)` exportés mais jamais appelés | Règles optionnelles `*_par_credits` portées, **inactives** tant que Q-01 n'est pas tranchée | Ne pas laisser une règle morte devenir silencieusement active, ni la perdre. |

## 3. `CI-CLASSIC-SEMESTRE`

| Attribut | Valeur |
|---|---|
| Contrat | `coef-semester@1` |
| `educationSystem` | `CLASSIC` (profil « pile classique » historique : classes, matières, coefficients, semestres) |
| Équivalent fixture | `CLASSIQUE` |
| Sources legacy | `apps/api/src/routes/semester-averages.ts:147-386,1100-1160` ; `report-card-template.service.ts` (libellés) |

| Règle | Paramètre | Défaut | Origine |
|---|---|---|---|
| `moyenne_annuelle` | `poids_s1`, `poids_s2` | 1, 2 | `:1151` |
| `mention` | `excellent`, `tres_bien`, `bien`, `assez_bien`, `passable` | 16, 14, 12, 10, 8 | `buildAverageMention`, `:171-179` |
| `decision_conseil` | `validation`, `renforcement` | 10, 8 | `buildCouncilDecision`, `:181-186` |
| `decision_fin_annee` | `passage` | 10 | `buildEndYearDecision`, `:197-207` |
| `distinction` | `felicitations`, `encouragement`, `honneur` | 17, 15, 12 | `:220-226` |
| `appreciation_conseil` | 6 seuils | 8, 10, 12, 14, 16, 18 | `:228-236` |
| `moyenne_matiere` | `poids_par_type` | `1` pour tous les types | NOUVELLE (Q-23) |

Écarts : mêmes E1, E3 ; E8 — « 2ᵉ semestre » déduit du **nom** de la période (`SEMESTRE 2` / `DEUXIEME SEMESTRE`, `:1105-1107`) remplacé par le rang/type de période ; E9 — `isSecondYearBtsClass` (nom de classe) remplacé par `examen_terminal_requis` (donnée de curriculum) ; E10 — `coef` absent ou nul remplacé par `1` (`Number(row.coef) || 1`, `:105,322`) : la v2 **refuse** un coefficient nul sans intention explicite (la règle `moyenne_ponderee` ignore un coefficient 0, comme le fixture) ; E11 — absences saisies à la main (`student_period_attendance_summaries`) remplacées par le module `attendance` (010).

## 4. `CI-HIGHER-BTS`

| Attribut | Valeur |
|---|---|
| Contrat | `coef-semester@1` |
| `educationSystem` | `HIGHER` ; `level` = `BTS` |
| Origine | **copie** de `CI-CLASSIC-SEMESTRE` v1 avec `examen_terminal_requis` activé pour le 2ᵉ semestre de la 2ᵉ année : décision `EXAM_REFERRAL` (« Redouble en cas d'échec au BTS », `buildEndYearDecision`, `:197-207`) |
| Pourquoi un RuleSet distinct | Le BTS relève de textes distincts (examen national, admissibilité — spec 020, après V1) ; il doit pouvoir évoluer sans toucher la pile classique. Une copie n'est pas un héritage : le moteur n'en connaît pas (ADR-003). |
| Question ouverte | **Q-15** : en production, les BTS sont gérés par la pile classique (seule à connaître `isSecondYearBtsClass`) *et* leur mise en page « BTS » sert aux Licences 1-2 du module Professionnel. Le propriétaire confirme quelle logique de calcul s'applique réellement aux BTS (coefficients ou UE/ECUE) et fournit les textes officiels. |

## 5. Valeurs fournies mais non reprises

| Valeur | Raison |
|---|---|
| `POIDS_*`, `SEUIL_*`, `SEMESTRE_CREDITS_REQUIS`, `ANNEE_SUP_CREDITS` de `bulletin-calc.ts` | Ne subsistent **nulle part en code** : paramètres des règles ci-dessus (garde-fou CI : lint R2 de la spec 000). |
| Libellés « Insuffisant », « Très Bien », « Periode validee »… | Codes + `label_map` (français) ; aucun libellé n'est comparé. |
| Signataires par défaut (`SIGNATAIRES_DEFAULTS`, `professional-signataires.service.ts:29-54`) | Hors RuleSets ; **supprimés** (voir 013/019). |

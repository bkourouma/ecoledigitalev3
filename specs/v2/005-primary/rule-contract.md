# Contrats de règles du primaire et RuleSet FICTIF (005-primary)

**Statut** : Rédigée — annexe normative de `spec.md` §5 (US4, US8, US10, US13). Même cadre que `specs/v2/012-rules-engine/rule-contracts.md` : un **contrat** fixe les clés de règles, leurs entrées, leurs résultats et le chaînage ; un **RuleSet** fournit les valeurs (données versionnées, gouvernées par 012).

> **Aucune règle réglementaire ivoirienne officielle n'est écrite ici.** Les noms des règles (MGA, passage, redoublement, conseil des maîtres) viennent du PRD §13 ; leurs **formules et seuils officiels sont inconnus** et sont des questions métier (`regulatory-sources-needed.md` §2). Le RuleSet `CI-PRIMARY-PLACEHOLDER` ci-dessous est un **jeu fictif** (`source.kind = placeholder`) qui sert uniquement à exercer le mécanisme. Chaque valeur y est marquée `placeholder: true` ; aucune n'est sourcée.

Rappel de la règle d'or (012) : **changer une valeur, un seuil, une formule ou un arrondi = nouvelle RuleVersion (donnée)** ; **changer le chaînage ou l'ensemble des variables d'entrée = nouveau contrat (`@2`) = livraison de code**. Le contrat ci-dessous est volontairement **générique** (N périodes pondérées, MGA, décision en quatre codes, cas à examiner, quorum) pour qu'un texte officiel s'y loge sans nouveau code dans la plupart des cas ; dans le cas contraire, la différence se traite à la réception des textes.

Convention (012) : `n?` = nombre pouvant être absent (note non saisie ⇒ `null`, **jamais 0**) ; `liste<…>` = `{ list: … }` ; résultats textuels = **codes anglais en majuscules**, libellés français dans `label_map` ; identifiants de règles et de paramètres en français.

## 1. Contrat `coef-period@1` (primaire : matières à coefficients, N périodes)

`educationSystem = PRIMARY` ; liaison par `level_code = PRIMARY`. Distinct de `coef-semester@1` : celui-ci connaît « semestre 1 » et « semestre 2 » (`(S1 + 2·S2)/3` en production aujourd'hui) ; le primaire a un nombre de périodes **paramétrable** (trois trimestres, deux semestres…) et un **poids par période** (donnée du plan de périodes), d'où un contrat propre. Un RuleSet peut toujours reproduire `(S1 + 2·S2)/3` en fournissant les poids 1 et 2.

### 1.1 Niveau matière

| Clé | Type moteur | Entrées | Résultat | Remarque |
|---|---|---|---|---|
| `note_sur_20` | `grading_scale` | `note: number`, `bareme: number` | `number` | `note / bareme * 20` (`bareme > 0` garanti par `assess`) |
| `moyenne_matiere` | `assessment_aggregation` | `notes: liste<{note, bareme, poids, type}>` | `number?` | Moyenne des notes ramenées à 20, pondérée par `poids × params.poids_par_type[type]` ; liste vide ⇒ `null` (**pas 0**). Défaut du contrat : `poids_par_type` = 1 pour tout type |

### 1.2 Niveau période (trimestre, semestre…)

| Clé | Type | Entrées | Résultat | Remarque |
|---|---|---|---|---|
| `moyenne_periode` | `period_average` | `matieres: liste<{score: number?, coef: number}>` | `number?` | `wavg(score, coef)` ; une matière sans score est **ignorée** (ni 0, ni coefficient compté) ; **valeur non arrondie** |
| `moyenne_section` | `period_average` | idem, par groupe de matières (`section_key` du nœud) | `number?` | **Optionnelle** (bulletins qui présentent des sous-moyennes) |
| `rang_matiere` | `ranking` | `moyenne: number?`, `cohorte: liste<number?>` | `number?` | `rank(moyenne, cohorte, 4)` : classement « compétition » (ex æquo, rang suivant sauté), égalité à 4 décimales (ADR-003) |
| `rang_periode` | `ranking` | idem | `number?` | idem ; rang **calculé**, son **affichage** est un réglage de gabarit : **affiché par défaut** (décision Q-P04, 2026-10-05), jamais à la maternelle |
| `mention_periode` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, INSUFFICIENT, PASSABLE, FAIRLY_GOOD, GOOD, VERY_GOOD, EXCELLENT` | **Optionnelle** (désactivable) ; **définie par `CI-PRIMARY-PLACEHOLDER` v3** : seuils réglables par l'établissement, valeurs de départ fictives non officielles (décision Q-P05, 2026-10-05) |
| `appreciation_periode` | `mention` | `moyenne: number?` | `string` (7 codes `WORK_*`, comme `appreciation_conseil` de 012) | **Optionnelle** ; suggestion de texte, jamais appliquée sans validation |
| `arrondi_affichage` | `rounding` | `valeur: number?` | `number?` | `round_half_up(valeur, params.decimales)` — **affichage uniquement, jamais en entrée d'une autre règle** |

### 1.3 Niveau année

| Clé | Type | Entrées | Résultat | Remarque |
|---|---|---|---|---|
| `moyenne_generale_annuelle` | `annual_average` | `periodes: liste<{moyenne: number?, poids: number}>` | `number?` | « MGA » du PRD : `wavg(moyenne, poids)` sur les périodes **notées** ; `poids` vient du plan de périodes (`academic.period_plans.slots[].weight`, défaut 1) ; **non arrondie**. La définition officielle de la MGA est **inconnue** : cette expression est une hypothèse de mécanisme |
| `rang_annuel` | `ranking` | `moyenne: number?`, `cohorte: liste<number?>` | `number?` | idem `rang_periode` |
| `cas_limite` | `promotion` | `mga: number?` | `boolean` | `!is_null(mga) && abs(mga - params.seuil_passage) <= params.marge_conseil` : l'élève est proche du seuil → le conseil examine |
| `cas_absences` | `promotion` | `absences_journees: number`, `jours_ouverts: number` | `boolean` | `jours_ouverts > 0 && absences_journees * 100 > params.pourcentage_absences * jours_ouverts` (aucune division : arithmétique décimale exacte) ; entrées fournies par `attendance` |
| `cas_deja_redoublant` | `promotion` | `redoublements_cycle: number` | `boolean` | `redoublements_cycle >= params.redoublements_alerte` ; entrée fournie par `academic` (inscriptions `is_repeating` du cycle) |
| `cas_a_examiner` | `promotion` | `limite: boolean`, `absences: boolean`, `redoublant: boolean` | `boolean` | `limite \|\| absences \|\| redoublant` ; les trois entrées deviennent les `reason_codes` du dossier (`BORDERLINE`, `LONG_ABSENCE`, `ALREADY_REPEATED`) |
| `decision_fin_annee` | `repetition` | `mga: number?`, `periodes_notees: number`, `periodes_attendues: number`, `cas_examen: boolean` | `string` ∈ `PENDING, PROMOTED, REPEAT, COUNCIL_REVIEW` | `if(is_null(mga) \|\| periodes_notees < periodes_attendues, "PENDING", if(cas_examen, "COUNCIL_REVIEW", if(mga >= params.seuil_passage, "PROMOTED", "REPEAT")))`. `COUNCIL_REVIEW` = « la règle ne tranche pas, le conseil décide ». Les codes se correspondent aux issues de `academic.enrollment_outcomes` : `PROMOTED` → `PROMOTED` (ADVANCE), `REPEAT` → `REPEATED` (REPEAT) |
| `quorum_conseil` | `promotion` | `convoques: number`, `presents: number` | `boolean` | `convoques > 0 && presents * 100 >= params.quorum_pourcent * convoques` ; **le quorum officiel est inconnu** (Q-P14) |

### 1.4 Ordonnancement (pipeline `coef-period@1`, implémenté par `results`)

```
par (inscription, période) :
   pour chaque matière suivie : moyenne_matiere(notes publiées de la période)         # pas de note ⇒ null
   moyenne_periode(matieres) ; (option) moyenne_section
   rangs : rang_matiere par matière, rang_periode sur la classe       # 2e phase, après le calcul de toute la classe
   (option) mention_periode, appreciation_periode ; arrondi_affichage (valeurs d'affichage)
par (inscription, année), à la clôture de la dernière période :
   moyenne_generale_annuelle(periodes) ; rang_annuel
   cas_limite, cas_absences, cas_deja_redoublant → cas_a_examiner
   decision_fin_annee(...) → proposition (results.decisions, status PROPOSED)
par séance du conseil (primary_school → results) :
   quorum_conseil(convoques, presents)
```

Données de contexte fournies par `results` / `primary_school` (jamais de nom ni d'identifiant d'élève dans le contexte) : notes **publiées** d'`assess` ; coefficients et sections du curriculum (`academic.getResultsStructure`) ; poids et rang des périodes ; absences et jours ouverts (`attendance`) ; redoublements du cycle (`academic`) ; convoqués et présents (`primary_school.council_attendance`).

### 1.5 Paramètres (toutes les « constantes » sont des données)

| Règle | Paramètre | Bornes | Valeur du RuleSet fictif (`placeholder`) |
|---|---|---|---|
| `moyenne_matiere` | `poids_par_type` | objet code → `0..10` | `{}` (tout à 1) |
| `arrondi_affichage` | `decimales` | `0..4` | 2 |
| `cas_limite`, `decision_fin_annee` | `seuil_passage` | `0..20` | **10** (milieu du barème /20, **choisi pour exercer le mécanisme**, aucune valeur réglementaire) |
| `cas_limite` | `marge_conseil` | `0..5` | 1 |
| `cas_absences` | `pourcentage_absences` | `0..100` | 20 |
| `cas_deja_redoublant` | `redoublements_alerte` | `0..10` | 1 |
| `quorum_conseil` | `quorum_pourcent` | `0..100` | 50 |

## 2. Contrat `competency-period@1` (maternelle : sans note)

`educationSystem = PRESCHOOL` ; liaison par `level_code = PRESCHOOL`. Aucune note, aucune moyenne, aucun rang : `results` n'exécute que les deux règles ci-dessous (pipeline minimal, demande de changement 011).

| Clé | Type | Entrées | Résultat | Remarque |
|---|---|---|---|---|
| `decision_fin_annee` | `repetition` | `competences_evaluees: number`, `competences_attendues: number`, `redoublements_cycle: number` | `string` ∈ `PENDING, COUNCIL_REVIEW` | Fictif : `if(competences_evaluees < competences_attendues, "PENDING", "COUNCIL_REVIEW")` — **la règle ne décide jamais seule** ; le conseil décide ; `competences_*` viennent des **compteurs** de `primary_school` (nombre de compétences évaluées vs attendues), pas d'un niveau de maîtrise |
| `quorum_conseil` | `promotion` | `convoques: number`, `presents: number` | `boolean` | comme ci-dessus |

## 3. RuleSet FICTIF `CI-PRIMARY-PLACEHOLDER`

| Attribut | Valeur |
|---|---|
| Portée | `national` (catalogue plateforme), pays `CI`, `educationSystem = PRIMARY` |
| Contrats | `coef-period@1` et `competency-period@1` (deux versions d'un même code de jeu) |
| `source.kind` | **`placeholder`** (valeur ajoutée à l'énumération de 012, demande de changement) |
| `source.reference` | « Jeu de démonstration 005-primary — aucune valeur officielle » |
| Nom et libellés | « Primaire — jeu de démonstration (fictif) » ; chaque `label_map` suffixé « (fictif) » |
| Statut au seed | `published`, `effective_from = 2026-09-01` (date de démonstration) |
| Visibilité | Environnements de démonstration, de test et d'intégration ; en production, liaison **refusée** sans accusé (`rules.placeholder_requires_ack`) |
| Variante tenant | Possible (le tenant peut dériver une variante, simuler, la proposer) — la variante hérite de `placeholder` tant que le texte officiel n'est pas cité |
| Marquage de sortie | Tout résultat, bulletin, bilan et PV calculé avec une version `placeholder` porte « Règles de démonstration — document sans valeur officielle » (filigrane + champ `ruleSourceKind` du snapshot) |

Le passage au **réglementaire** se fait par : réception du texte et d'exemples chiffrés → note d'interprétation signée du validateur (012, `regulatory-sources-needed.md` §8) → RuleVersion `source_kind = regulation` avec `source_reference` du texte (contrainte SQL) → golden tests **officiels** (3 à 10 bulletins réels anonymisés) → publication nationale par le super-admin → rattachement des tenants. Les golden tests du mécanisme restent comme tests de non-régression du moteur.

## 4. Golden tests de MÉCANISME (`golden-primary-mechanism`)

Ils vérifient la plomberie (décimal exact, valeur absente, ex æquo, chaînage), **pas** la conformité réglementaire. Valeurs fictives, paramètres du §1.5.

| # | Règle | Entrées | Sortie attendue |
|---|---|---|---|
| G1 | `moyenne_matiere` | `[{note 12, bareme 20, poids 1}, {note 15, bareme 20, poids 1}]` | `13.5` |
| G2 | `moyenne_matiere` | `[{note 8, bareme 10, poids 2}, {note 10, bareme 20, poids 1}]` | `(16×2 + 10×1)/3 = 14` |
| G3 | `moyenne_matiere` | `[]` | `null` (jamais 0) |
| G4 | `moyenne_periode` | `[{score null, coef 2}, {score 14, coef 1}]` | `14` (matière sans score ignorée) |
| G5 | `moyenne_generale_annuelle` | `[{12,1}, {null,1}, {14,1}]` | `13` |
| G6 | `moyenne_generale_annuelle` | `[{12,1}, {14,2}]` | `13.3333…` (non arrondie) puis `arrondi_affichage` = `13.33` |
| G7 | `arrondi_affichage` | `13.335` ; `13.325` | `13.34` ; `13.33` (`round_half_up` décimal exact) |
| G8 | `moyenne_matiere` puis `decision_fin_annee` | notes `9.9/20` et `10.1/20`, poids 1 | `10` exactement (pas `9.999…`) ; avec `mga = 10`, `cas_limite = true` ⇒ `COUNCIL_REVIEW` |
| G9 | `rang_periode` | `15` dans `[15, 15, 12, null]` ; `12` ; `null` | `1` ; `3` ; `null` |
| G10 | `decision_fin_annee` | `mga 11.2`, 3/3 périodes, `cas_examen false` | `PROMOTED` |
| G11 | `decision_fin_annee` | `mga 7`, 3/3, `false` | `REPEAT` |
| G12 | `decision_fin_annee` | `mga null` ; ou `mga 12` avec 2/3 périodes | `PENDING` |
| G13 | `cas_absences` | `absences 4`, `jours_ouverts 20` ; `absences 5`, `jours_ouverts 20` | `false` (20 % non dépassé) ; `true` (25 %) |
| G14 | `cas_a_examiner` | `(false, false, true)` | `true` |
| G15 | `quorum_conseil` | `convoques 6, presents 3` ; `presents 2` | `true` (3×100 ≥ 50×6) ; `false` |
| G16 | `competency-period@1.decision_fin_annee` | `evaluees 20/20` ; `18/20` | `COUNCIL_REVIEW` ; `PENDING` |
| G17 | Chaînage | élève sans aucune note de période | `moyenne_periode = null`, aucun rang, décision `PENDING` — jamais d'erreur, jamais 0 |
| G18 | Reproductibilité | même entrées, même version | mêmes `inputs_hash` et `outputs_hash` (011) |

Les valeurs ci-dessus se recalculent à la main ; un écart entre cette table et l'implémentation est un défaut de l'une ou de l'autre, jamais une « règle ».

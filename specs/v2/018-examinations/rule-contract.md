# Contrat de règles `exam-national@1` et RuleSet FICTIF (018-examinations)

**Statut** : Rédigée — annexe normative de `spec.md` §5 (US3, US6, US8). Même cadre que `specs/v2/012-rules-engine/rule-contracts.md` (annoncé en §5 de ce document : « `exam-national@1` — 018-examinations — textes officiels à obtenir »).

> **Aucune règle d'examen officielle n'est écrite ici** (conditions d'éligibilité du CEPE, du BEPC, du BAC ; épreuves ; coefficients ; seuil d'admission ; mentions ; définition du taux de réussite). Les noms viennent du PRD §21 ; **les formules et seuils officiels sont inconnus** (`regulatory-sources-needed.md`). Le RuleSet `CI-EXAM-PLACEHOLDER` est un **jeu fictif** (`source.kind = placeholder`) qui sert à exercer le mécanisme et à calculer les **examens blancs**. Pour un examen **officiel**, l'admission est **prononcée par l'autorité** et importée ou saisie ; le module ne la calcule jamais (déclencheur `official_not_computed`).

Rappel (012) : changer une valeur = nouvelle RuleVersion (donnée) ; changer le chaînage ou les variables d'entrée = nouveau contrat (`@2`). Convention : `n?` = nombre pouvant être absent (jamais 0) ; résultats textuels = codes anglais majuscules, libellés dans `label_map`.

## 1. Où les règles servent (et où elles ne servent pas)

| Besoin | Règle | Régime |
|---|---|---|
| Un élève peut-il être candidat ? | `eligibilite` (+ `motif_eligibilite`) | Examens officiels **et** blancs (le blanc peut ignorer l'éligibilité par réglage) |
| Moyenne et issue d'un candidat d'**examen blanc** | `note_epreuve_sur_20`, `moyenne_candidat`, `resultat_candidat`, `mention_examen`, `rang_candidat` | **Blanc uniquement** (`source = COMPUTED`, version de règle et empreinte d'entrées obligatoires) |
| Taux de réussite d'un groupe | `taux_reussite` | Officiel et blanc (affichage, jamais une décision) |
| Admission officielle | — | **Aucune règle** : importée ou saisie (autorité) |

## 2. Contrat `exam-national@1`

| Clé | Type moteur | Entrées | Résultat | Remarque |
|---|---|---|---|---|
| `eligibilite` | `promotion` | `en_classe_examen: boolean`, `age_annees: number?`, `annee_session: number`, `pieces_completes: boolean`, `nombre_tentatives: number` | `string` ∈ `ELIGIBLE, INELIGIBLE, NEEDS_REVIEW` | Fictif : `if(!en_classe_examen, "INELIGIBLE", if(!pieces_completes, "NEEDS_REVIEW", "ELIGIBLE"))`. Les **vraies** conditions (âge, nombre de tentatives, durée de scolarité…) sont **inconnues** : elles s'ajoutent comme **expression** de la version de règle (les entrées ci-contre sont déjà fournies), sans code |
| `motif_eligibilite` | `promotion` | mêmes entrées | `string` ∈ `NONE, NOT_IN_EXAM_GRADE, AGE_NOT_MET, DOCUMENTS_MISSING, ATTEMPTS_EXCEEDED, OTHER` | Premier motif bloquant ; alimente `eligibility_checks.reasons` |
| `note_epreuve_sur_20` | `grading_scale` | `note: number`, `bareme: number` | `number` | `note / bareme * 20` |
| `moyenne_candidat` | `period_average` | `epreuves: liste<{note: number?, coef: number, bareme: number, facultative: boolean, absent: boolean}>` | `number?` | Moyenne des notes ramenées à 20, pondérée par `coef` ; épreuve absente ⇒ voir `params.absence_vaut_zero` (0/1, **fictif : 0** = épreuve ignorée) ; `null` si aucune épreuve notée ; **non arrondie** |
| `resultat_candidat` | `promotion` | `moyenne: number?`, `epreuves_absentes: number`, `epreuves_eliminatoires_echouees: number` | `string` ∈ `ADMITTED, FAILED, ABSENT, DEFERRED` | Fictif : `if(is_null(moyenne), "ABSENT", if(epreuves_eliminatoires_echouees > 0, "FAILED", if(moyenne >= params.seuil_admission, "ADMITTED", "FAILED")))` ; `DEFERRED` reste réservé à la saisie manuelle |
| `mention_examen` | `mention` | `moyenne: number?` | `string` ∈ `PENDING, NONE, PASSABLE, FAIRLY_GOOD, GOOD, VERY_GOOD, EXCELLENT` | **Optionnelle** (les examens ont-ils des mentions ? Q-E09) |
| `rang_candidat` | `ranking` | `moyenne: number?`, `cohorte: liste<number?>` | `number?` | `rank(moyenne, cohorte, 4)` ; cohorte ≤ 5 000 |
| `taux_reussite` | `period_average` | `admis: number`, `presents: number`, `inscrits: number` | `number?` | `if(params.denominateur == 1, ratio(admis, presents), ratio(admis, inscrits))` ×100 avec **arrondi exact** ; dénominateur nul ⇒ `null`. **La définition officielle du taux est inconnue** (Q-E08) : le paramètre choisit « présents » (1) ou « inscrits » (0) |
| `arrondi_affichage` | `rounding` | `valeur: number?` | `number?` | `round_half_up(valeur, params.decimales)` — affichage seul |

### Paramètres

| Règle | Paramètre | Bornes | RuleSet fictif (`placeholder`) |
|---|---|---|---|
| `moyenne_candidat` | `absence_vaut_zero` | `0..1` | 0 |
| `resultat_candidat` | `seuil_admission` | `0..20` | **10** (milieu du barème /20, **choisi pour exercer le mécanisme**, aucune valeur réglementaire) |
| `taux_reussite` | `denominateur` | `0..1` | 1 (présents) |
| `arrondi_affichage` | `decimales` | `0..4` | 2 |

## 3. Ordonnancement

```
Éligibilité (par candidat, à l'inscription et à chaque changement de dossier) :
   eligibilite(...) → motif_eligibilite(...) → eligibility_checks (ajout seul) → candidates.eligibility_status
Examen BLANC (une fois les notes publiées d'assess liées aux épreuves) :
   par candidat : note_epreuve_sur_20 (par épreuve) → moyenne_candidat → resultat_candidat → (option) mention_examen
   2e phase : rang_candidat sur la cohorte de la session
   écriture : candidate_results (source COMPUTED, rule_version_ref, inputs_hash)
Statistiques (lecture) :
   result_counts(session, groupe) → taux_reussite(admis, présents, inscrits) → arrondi_affichage
```

Contexte fourni par le module (sans nom ni identifiant d'élève) : appartenance à la classe d'examen (`academic`), âge à une date de référence **fournie par la règle** (`people`), pièces complètes (`missing_required_documents`), nombre de tentatives (candidatures antérieures du même élève et du même type), notes de session (`paper_scores`), effectifs (`result_counts`).

## 4. RuleSet FICTIF `CI-EXAM-PLACEHOLDER`

| Attribut | Valeur |
|---|---|
| Portée | `national` (catalogue plateforme), pays `CI`, `educationSystem = EXAM` |
| Contrat | `exam-national@1` |
| `source.kind` | **`placeholder`** (demande de changement 012, voir 005) |
| `source.reference` | « Jeu de démonstration 018-examinations — aucune valeur officielle » |
| Libellés | Tous suffixés « (fictif) » |
| Statut au seed | `published`, `effective_from = 2026-09-01` |
| Usage | Démonstrations, tests, **examens blancs** ; en production, liaison refusée sans accusé (`rules.placeholder_requires_ack`) |
| Marquage de sortie | Tout résultat **calculé** avec une version `placeholder` (examen blanc) porte « Règles de démonstration » ; les documents officiels (convocation, attestation) n'utilisent **jamais** un résultat calculé |

Passage au réglementaire (par examen) : texte + exemples chiffrés → note d'interprétation → RuleVersion `source_kind = regulation` avec `source_reference` → golden tests officiels → publication nationale → liaison.

## 5. Golden tests de MÉCANISME (`golden-exam-mechanism`)

Valeurs fictives, paramètres du §2.

| # | Règle | Entrées | Sortie attendue |
|---|---|---|---|
| G1 | `note_epreuve_sur_20` | `(7, 10)` ; `(15, 20)` | `14` ; `15` |
| G2 | `moyenne_candidat` | `[{note 14, coef 2, bareme 20}, {note 8, coef 1, bareme 10}]` | `(14×2 + 16×1)/3 = 14,666…` (non arrondie) puis `14,67` après `arrondi_affichage` |
| G3 | `moyenne_candidat` | une épreuve absente, `absence_vaut_zero = 0` | épreuve ignorée : moyenne des autres |
| G4 | `moyenne_candidat` | `absence_vaut_zero = 1`, même cas | l'absente compte 0 |
| G5 | `moyenne_candidat` | aucune épreuve notée | `null` |
| G6 | `resultat_candidat` | `moyenne 10` (exactement) ; `9,99` ; `null` | `ADMITTED` (≥) ; `FAILED` ; `ABSENT` |
| G7 | `resultat_candidat` | `moyenne 15`, `epreuves_eliminatoires_echouees 1` | `FAILED` |
| G8 | `rang_candidat` | `14` dans `[14, 14, 9, null]` ; `9` | `1` ; `3` |
| G9 | `taux_reussite` | `admis 3, presents 4, inscrits 5`, `denominateur 1` ; `0` | `75` ; `60` |
| G10 | `taux_reussite` | `presents 0` | `null` (jamais d'erreur ni 100 %) |
| G11 | `eligibilite` | `en_classe_examen false` ; `true` + `pieces_completes false` ; `true` + `true` | `INELIGIBLE` ; `NEEDS_REVIEW` ; `ELIGIBLE` |
| G12 | `motif_eligibilite` | cas G11 | `NOT_IN_EXAM_GRADE` ; `DOCUMENTS_MISSING` ; `NONE` |
| G13 | Reproductibilité | mêmes entrées et même version | mêmes `inputs_hash` et `outputs_hash` |
| G14 | Décimal exact | notes `9,9/20` et `10,1/20`, coefficients 1 | moyenne `10` exactement, `ADMITTED` (pas `9,999…`) |

Un écart entre cette table et l'implémentation est un défaut de l'une ou de l'autre, jamais une « règle ».

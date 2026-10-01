# Parité legacy — 012-rules-engine

**Périmètre** : les formules, seuils, arrondis, mentions et décisions aujourd'hui codés en dur, devenus des **règles** (`rule-contracts.md`, `rulesets-de-depart.md`). Les fonctions d'orchestration/persistance associées sont dans `011` (calcul), `013` (documents), `019` (supérieur).

Statuts : **Conservé** (même résultat, mêmes entrées) ; **Amélioré** (résultat identique sauf défaut corrigé, listé) ; **Abandonné** (non reproduit, justification).

Numéros de ligne : état du dépôt au 2026-10-01 (`feat/v2-phase-0`).

## 1. `apps/api/src/services/bulletin-calc.ts` (module Professionnel, feature 030)

| ID | Fonction / constante (ligne) | Comportement legacy | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-RUL-01 | `POIDS_DEVOIRS` 0,4 / `POIDS_EXAMEN` 0,6 (`:24-25`) | Constantes de code | **Amélioré** | Paramètres `poids_devoirs`, `poids_examen` de `note_ecue` (bornés 0..1) | Plus aucune constante en code. |
| P-RUL-02 | `SEUIL_VALIDATION` 10 (`:26`) | Constante | **Amélioré** | Paramètre `seuil_validation` (0..20) | |
| P-RUL-03 | `SEUIL_ELIMINATOIRE` 5 (`:27`) | Constante | **Amélioré** | Paramètre `seuil_eliminatoire` (0..20) | |
| P-RUL-04 | `SEMESTRE_CREDITS_REQUIS` 20 (`:28`), `semestreValide` (`:198`) | Exportée, **jamais appelée** (le relevé valide le semestre quand **toutes** les UE sont validées, `professional-bulletin.service.ts:1812`) | **Conservé** (inactif) | Règle optionnelle `semestre_valide_par_credits` (`credits_requis = 20`) | Q-01 : rendre active ou supprimer. |
| P-RUL-05 | `ANNEE_SUP_CREDITS` 48 (`:29`), `peutPasserAnneeSuperieure` (`:203`) | Idem, jamais appelée | **Conservé** (inactif) | Règle optionnelle `annee_validee_par_credits` (`credits_exclusifs = 48`) | Q-01. |
| P-RUL-06 | `normaliserNote` (`:73`) | `(note/noteMax)*20`, **0 si `noteMax ≤ 0`** | **Amélioré** | Règle `note_sur_20` ; `bareme > 0` garanti par `assess` (CHECK) | Le 0 silencieux masquait une donnée invalide. |
| P-RUL-07 | `moyenneDevoirs` (`:79`) | Moyenne arithmétique simple ; `null` si aucun devoir | **Conservé** | Règle `moyenne_devoirs` (variante pondérée possible, Q-08) | Le coefficient d'évaluation (`professional_assignments.coefficient`) était ignoré. |
| P-RUL-08 | `noteEcue` (`:90`) | `null` sans examen ; devoirs absents = 0 | **Conservé** | Règle `note_ecue` | Q-09. |
| P-RUL-09 | `evaluerEcue` (`:99`) : éliminée, validée (≥ 10 ou manuel) | Seuils en flottant | **Amélioré** | Règles `ecue_eliminee`, `ecue_validee` en **décimal exact** | 24 cas d'égalité corrigés (ADR-003). |
| P-RUL-10 | `moyenneUe` (`:118`) | Σ(note × crédits)/Σ crédits sur ECUE notées ; crédits ≤ 0 ⇒ poids 0 | **Conservé** | Règle `moyenne_ue` (`wavg`) | |
| P-RUL-11 | `evaluerUe` (`:136`) : motifs, validation, statuts compensé/insuffisant | Verrou éliminatoire, compensation interne à l'UE | **Conservé** | Règles `ue_validee`, `statut_ecue` ; `motifs` dérivés de la trace | Les motifs (`NOTE_ELIMINATOIRE`, `MOYENNE_INSUFFISANTE`, `INCOMPLET`) sont recalculables depuis les sorties des règles. |
| P-RUL-12 | `moyenneSession` (`:174`) | Σ(moyenneUE × crédits)/Σ crédits | **Conservé** | Règle `moyenne_session` | Entrée : moyennes UE **non arrondies** (voir §6 point 2). |
| P-RUL-13 | `creditsValides` / `creditsTotal` (`:188-195`) | Sommes de crédits | **Conservé** | Règles `credits_valides`, `credits_total` | |
| P-RUL-14 | `arrondi` (`:210`) : `Math.round(x*100)/100` | Arrondi flottant, demi vers +∞ en binaire | **Amélioré** | Règle `arrondi_affichage` = `round_half_up(x, 2)` exact | Affichage seulement (jamais un seuil). |

## 2. `apps/api/src/routes/semester-averages.ts` (pile classique)

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Remarque |
|---|---|---|---|---|---|
| P-RUL-20 | `computeCompetitionRanks` (`:147-168`) | Classement de compétition ; égalité si `|Δ| < 0,0001` **avec le voisin trié précédent** (chaîné, non transitif) | **Amélioré** | Règle `rang` = `rank(x, cohorte, 4)` | Divergence assumée (ADR-003) : transitive ; identique sur des moyennes à 2 décimales. |
| P-RUL-21 | `buildAverageMention` (`:171-179`) | Seuils 16/14/12/10/8 ; `null` ⇒ « En attente » | **Conservé** | Règle `mention` (`coef-semester@1`) | Codes + `label_map`. |
| P-RUL-22 | `buildCouncilDecision` (`:181-186`) | ≥10 validée ; ≥8 renforcement ; sinon non validée ; `null` ⇒ « Notes incomplètes » | **Conservé** | Règle `decision_conseil` | |
| P-RUL-23 | `isSecondYearBtsClass` (`:188-195`) | Détecte « BTS » + « 2 »/« DEUXIEME » **dans le nom de la classe** | **Abandonné** (la détection) | Variable `examen_terminal_requis`, donnée du curriculum | Une classe renommée « Groupe B » n'est plus un BTS 2ᵉ année : défaut. |
| P-RUL-24 | `buildEndYearDecision` (`:197-207`) | 2ᵉ semestre + BTS 2ᵉ année ⇒ « Redouble en cas d'échec au BTS » ; ≥10 admis ; sinon redoublement | **Conservé** | Règle `decision_fin_annee` (`CI-HIGHER-BTS`) | Codes `PROMOTED/REPEAT/EXAM_REFERRAL/PENDING`. |
| P-RUL-25 | `buildAssignmentFlagsFromDecision` (`:209-218`) | Déduit « redoublant »/« affecté » en cherchant « REDOUBL »/« ATTENTE » dans le **texte** | **Abandonné** | Le code de décision porte l'issue (contrat) | Défaut : dépendance à la langue et à l'orthographe. |
| P-RUL-26 | `buildDistinctionSanctionsFromAverage` (`:220-226`) | ≥17 félicitations ; ≥15 encouragement ; ≥12 honneur | **Conservé** | Règle `distinction` | Q-19. |
| P-RUL-27 | `buildCouncilAppreciationFromAverage` (`:228-236`) | 7 phrases par seuils 8/10/12/14/16/18 | **Conservé** | Règle `appreciation_conseil` | |
| P-RUL-28 | `computeWeightedStats` (`:363-386`) | Σ(note × coef)/Σ coef ; matières sans note ignorées ; `coef` retombe à 1 si 0/absent (`:105,322`) | **Amélioré** | Règle `moyenne_ponderee` ; coefficient 0 = ignoré | Le repli silencieux sur 1 est supprimé : un coefficient doit être explicite. |
| P-RUL-29 | Moyenne annuelle `(sem1 + 2·sem2)/3` (`:1151`) ; 2ᵉ semestre détecté par le **nom** de la période (`:1105-1107`) | Formule sur S1/S2 ; sinon moyenne S2 | **Amélioré** | Règle `moyenne_annuelle` (poids 1 et 2 paramétrés) ; `second_semestre` issu du type/rang de période | Détection par nom abandonnée. |
| P-RUL-30 | Sous-moyennes par type de bilan (`:1015-1050`) | Moyenne pondérée par section | **Conservé** | Règle `moyenne_section` | |
| P-RUL-31 | Moyennes de matière **saisies** (`GET/PUT /manual`, `/matrix` `:389-700`) | Table `student_period_course_averages`, `DELETE`+`INSERT`, aucun historique | **Amélioré** | Calcul (`moyenne_matiere`) à partir des notes ; surcharge justifiée et auditée ; type d'évaluation « moyenne saisie » pour les établissements qui continuent à saisir (011) | Plan §3.7 : « les moyennes ne sont plus saisies ». |

## 3. Doublons côté web (à supprimer, plan §2 « quatre doublons »)

| ID | Fichier:ligne | Contenu | Statut |
|---|---|---|---|
| P-RUL-40 | `apps/web/src/lib/bulletin-format.ts:65-72` (`appreciation`) | Seuils 10/12/14/16/18 | **Abandonné** → règle `mention_releve` (API) ; le web affiche le code/libellé fourni |
| P-RUL-41 | `bulletin-format.ts:186-195` (`appreciationGenerale`) | Seuils 8…18 | **Abandonné** → `appreciation_generale` |
| P-RUL-42 | `bulletin-format.ts:76-82,174-180,199` (`gradeOf`, `niveauOf`, `isLicenceUnOuDeux`) | Grade/niveau déduits par regex du nom de filière | **Abandonné** → attributs structurés du curriculum |
| P-RUL-43 | `apps/web/src/lib/diplome-format.ts:191` ; `bulletin-pdf.ts`, `bulletin-pdf-bts.ts` (« Moyenne annuelle », `bulletin-pdf-bts.ts:308-339`) | Recalculs/affichage de moyennes côté client | **Abandonné** → snapshot serveur (013) |

## 4. Mentions et seuils dans les services « cycle / diplôme »

| ID | Fichier:ligne | Contenu | Statut | Cible |
|---|---|---|---|---|
| P-RUL-50 | `professional-cycle-groups.ts:227-253` (`loadMentionForFilieres`) | Moyenne des bulletins pondérée par crédits de semestre, puis seuils 10/12/14/16/18 | **Conservé** (fond) / **Amélioré** (source) | Règles `moyenne_annuelle` + `mention_diplome` ; lues sur les résultats `FINAL`, plus sur le JSON des bulletins |
| P-RUL-51 | `professional-bulletin.service.ts:629-636` | `distinction` : honneur 12–15, encouragement ≥15, avertissement <10 | **Conservé** | Règle `distinction_semestre` |
| P-RUL-52 | `professional-bulletin.service.ts:1812-1824` | `semValide = tous UE validées` ; `decision = admis/rattrapage/ajourne` ; `statut_etudiant` | **Conservé** | Règles `semestre_valide`, `decision_semestre` |
| P-RUL-53 | `professional-diplomas.service.ts:64-109` (`evaluateDiplomaEligibility`) | Obligatoires validées ET Σ UV ≥ `uv_required`, dédoublonnage par UE | **Conservé** | Règle `diplome_eligible` |
| P-RUL-54 | `professional-results.service.ts:57-64` (`RATTRAPAGE_PREDICATE`) | Résultat calculé, non validé, inscription confirmée/terminée, hors conduite | **Conservé** | Règle `eligible_rattrapage` + attribut de nœud `resit_allowed` |

## 5. Fonctions du moteur déjà livrées (rien à faire côté 012)

`compile/validate/evaluate`, `resolveRuleSet`, `findEffectiveOverlaps`, `canTransition`, `simulate` : **repris tels quels** (ADR-003 ; 293 tests). Ce que 012 ajoute et qui n'existait pas dans le legacy : persistance, gouvernance, simulation sur données réelles, contrat avec les modules, rejeu de reproductibilité, écrans.

## 6. Défauts du legacy explicitement NON reproduits (récapitulatif)

1. Arithmétique flottante aux seuils (ADR-003 : 24 couples de 10 exact jugés `< 10`).
2. Cascade d'arrondis (moyenne de semestre calculée sur des moyennes d'UE arrondies).
3. Classement à tolérance chaînée non transitive et plafond silencieux à 300 étudiants.
4. Conduite, BTS, Licence 1/2, cycles, « 2ᵉ semestre » et « redoublant » détectés par motifs textuels dans des libellés.
5. Constantes réglementaires dans le code et dupliquées dans le web.
6. Fonctions de règle mortes (`semestreValide`, `peutPasserAnneeSuperieure`) devenues règles actives en silence ou perdues en silence.
7. Moyennes écrasées sans historique ni justification.
8. Repli silencieux `coef || 1`, `noteMax ≤ 0 ⇒ 0`.

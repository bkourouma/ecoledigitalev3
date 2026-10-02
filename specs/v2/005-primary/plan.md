# Plan d'implémentation — 005-primary

**Statut** : Rédigé. Les tâches sont **parallélisables** par vagues ; la taille suit le plan §4 (S ≈ 1–2 semaines, M ≈ 3–5, L ≈ 6–10, pour un développeur). **Le calendrier réel dépend de la capacité de l'équipe**, qui n'est pas connue (plan §8, point 1).

Prérequis livrés ou spécifiés : 000 à 004, 008 à 013, 016. Le pack Primary est la **première** consommation de bout en bout des briques de la Phase 2 par un pack autre que Higher : sa valeur de test est aussi de **vérifier** que ces briques sont réellement génériques.

## 1. Principe d'exécution

1. **Aucun code de règle** : tout passe par des contrats et des RuleSets (données). Si une tâche exige une constante, elle s'arrête et pose une question (`open-questions.md`).
2. **Tout se démontre avec le jeu fictif** (`CI-PRIMARY-PLACEHOLDER`) : le chantier ne dépend pas de la réception des textes officiels ; seul le passage « en production réglementaire » en dépend.
3. **Demandes de changement d'abord** (T0) : elles touchent 004, 002, 003, 010, 011, 012 et 013, qui ont chacun leur rythme.

## 2. Tâches

| ID | Tâche | Détail | Dépend de | Taille | Parallèle avec |
|---|---|---|---|---|---|
| 005-T0 | Demandes de changement (spec §14.2) | Faire acter par les propriétaires de specs : `placeholder` dans `source_kind` (012), contrats `coef-period@1` et `competency-period@1`, pipeline minimal de `results`, natures `COUNCIL_MINUTES` / `ANNUAL_REVIEW` et filigrane (013), `calculationContract` et `ClassroomActivationGuard` (004), rôle `instituteur` (002/009), section de modèle `primary_school` (003), plage `1800–1899` | — | S | tout |
| 005-T1 | Migrations `1800`–`1802` | Fichiers SQL **identiques** à `data-model.md` (contrôle `--check-doc`) ; test de conformité colonnes ↔ types de ligne (ADR-005) ; allowlist d'isolation **vide** ; test d'application de zéro | — | S | T0 |
| 005-T2 | Squelette de module | `pnpm module:new primary_school --range 1800` ; `manifest.ts` (permissions §10, features, menus, événements) ; `index.ts` (API publique) ; schémas Zod `packages/contracts/src/v2/primary-school.ts` ; codes `primary_school.*` | T1 | S | T3 |
| 005-T3 | Échelles et référentiels | `createScale`, `createFramework`, `setFrameworkStructure`, `publishFramework` (liste des manques), `newFrameworkVersion` (copie), import d'un référentiel (JSON, via 031 plus tard) | T2 | M | T4, T5, T7 |
| 005-T4 | Évaluation par compétences | `getCompetencySheet`, `bulkRecordCompetencies` (idempotent, `rowVersion`, ≤ 500 lignes, tout ou rien), `validateCompetencies`, `reviseCompetencyAssessment` (trace avant correction), `summarizeCompetencies` (parité TS ↔ SQL), `PeriodStatePort` | T2, T3 | M | T3 (après le modèle), T5 |
| 005-T5 | Conseil des maîtres | `prepareCouncil` (délibération `results` + dossiers + `reason_codes` par les règles), `recordCouncilAttendance`, quorum par la règle, `confirmCouncilDecision` (→ `results.confirmDecision` → `recordEnrollmentOutcome`), `requestCouncilMinutes` (`reportcards.requestOfficialDocument`) | T2, T7, T8 | M | T4 |
| 005-T6 | Bilan annuel | `prepareAnnualReviews`, `sealAnnualReview` (empreinte canonique partagée avec `reportcards/domain/canonical`), `reissueAnnualReview`, abonné `reportcards.report_card.rendered` → `reportcard_id`, lectures famille | T2, T4, T5 | M | T9 |
| 005-T7 | **Contrats de règles et RuleSet fictif** | `coef-period@1` et `competency-period@1` dans `apps/api/src/modules/rules/contracts/` ; seed `CI-PRIMARY-PLACEHOLDER` (`placeholder`) ; `validate()` du contrat ; `golden-primary-mechanism` G1 à G18 (`rule-contract.md` §4) | T0 | M | T3, T4, T9 |
| 005-T8 | Pipeline `results` pour `coef-period@1` et `competency-period@1` | Chaînage par étape (matière → période → rang → année → décision), entrées d'assiduité et de redoublements, `ruleSourceKind` dans le bundle FINAL | T0, T7 | M | T5 |
| 005-T9 | Modèle de pack Primary | Compléments `academic` (`calculationContract`, `weight` des périodes), `templates/CI/primary.json` de `primary_school` + `PrimarySchoolPackTemplateSchema`, `instantiatePrimaryReferenceData` (idempotent), test de cohérence des modèles (aucun nombre sans origine), liaisons de règle, call policy `DAILY` | T1, T7 | M | T6 |
| 005-T10 | Rôle `instituteur` et garde d'activation | Modèle de rôle (`rbac`), `ClassroomActivationGuard` (port `academic`, adaptateur `people` : `HOMEROOM` actif), réglage `require_homeroom_for_activation` | T0 | S | tout |
| 005-T11 | Gabarits `reportcards` | `report-primary`, `annual-review-primary`, `council-minutes` ; filigrane conditionnel ; aperçu dans `template-configs/preview` | T0, T6 | M | T12 |
| 005-T12 | Rapports R1–R8 | Lectures par ports ; exports CSV et PDF ; formats d'export configurables pour R8 | T4, T5, T6 | M | T11 |
| 005-T13 | Plugin HTTP | Routes §8 ; `requirePermission` ; limiteur sur la saisie en lot ; réponses 404 pour les ressources hors périmètre ; audit des opérations sensibles | T3–T6 | M | T14 |
| 005-T14 | Jobs et abonnés | `period_locks` ← `academic.classroom_period.*` ; `results.decision.confirmed` ; `academic.year.closed` ; purge des brouillons de bilan > 90 jours ; job de préparation en masse des bilans (> 500) | T4, T6 | S | T13 |
| 005-T15 | Écrans web | Instituteur (mobile d'abord : appel, évaluations, grille de compétences à bascule rapide, appréciations avec banque, dossiers de conseil), direction (avancement, conseil, bilans, archivage, rapports), parent (bulletins, bilans, compétences) ; bandeau « Règles de démonstration » | T13 | L | T16 |
| 005-T16 | Seeds de démonstration et E2E | Seeds déterministes (`pack-template.md` §9) ; Playwright « une classe, une année simulée » ; mesures de performance (grille, bilans, rapports) | T9, T13 | M | T15 |
| 005-T17 | Qualité et exploitation | Lint R2 (aucune constante), allowlist, test d'isolation générique, test « aucun contenu pédagogique dans les événements et l'audit », documentation du module (README), plage inscrite dans `module-conventions.md` | T1–T14 | S | — |
| 005-T18 | Suppression du legacy (tranche 4) | Aucun code primaire legacy n'existe ; vérifier que `student_enrollments.cepe_code`, `lv2`, `affectation_*` sont bien repris par 004 et 018 (parité) ; retirer les menus/pages legacy qui y renvoient | T16 | S | — |

## 3. Vagues

```
Vague 1 (3 semaines)  : T0, T1, T2, T10                    # cadre, base, rôle
Vague 2 (parallèle)   : T3, T4, T7, T9                     # référentiels, compétences, contrats de règles, pack
Vague 3 (parallèle)   : T5, T6, T8, T14                    # conseil, bilan, pipeline results, abonnés
Vague 4 (parallèle)   : T11, T12, T13                      # gabarits, rapports, HTTP
Vague 5               : T15, T16, T17, T18                 # écrans, e2e, qualité, nettoyage
```

Chemin critique : T0 → T7 → T8 → T5 → T6 → T16. T3/T4 (compétences) sont **indépendantes** du chemin critique des règles et peuvent livrer la maternelle (sans note) avant le primaire chiffré.

## 4. Stratégie de test

| Niveau | Contenu | Bloquant en CI |
|---|---|---|
| DDL | `ddl/run.mjs` (104 tests) rejoué sur les migrations réelles ; `--check-doc` | Oui |
| Unitaires | Zod, synthèse TS ↔ SQL, banque de phrases, avancement | Oui |
| Golden de mécanisme | `golden-primary-mechanism` G1–G18 | Oui |
| Intégration | Activation idempotente ; garde « titulaire » ; flux complet avec RuleSet fictif ; refus de liaison `placeholder` en production sans accusé ; isolation A/B de chaque table | Oui |
| Sécurité | Parent ne lit que les bilans scellés et publiés de ses enfants liés ; instituteur limité à ses classes ; aucun contenu pédagogique dans événements/audit | Oui |
| E2E | Une classe de 40 élèves, une année, trois portails | Sur `main` et avant release |
| Performance | Grille 40 × 30 : p95 < 300 ms ; 1 000 bilans en < 60 s ; rapport R2 d'une école de 600 élèves < 2 s | Mesuré, objectif |

## 5. Risques et mitigations

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | **Les textes officiels n'arrivent pas** | Pas de production « réglementaire » du primaire | Tout est livré avec le jeu fictif ; le périmètre « règlement » est une **donnée** ; relance périodique via le propriétaire (`regulatory-sources-needed.md`) |
| R2 | Un RuleSet fictif est utilisé **en production** par erreur | Bulletins sans valeur réglementaire diffusés | Refus de liaison sans accusé (`rules.placeholder_requires_ack`) ; filigrane + bandeau permanent ; événement d'alerte à la direction à chaque émission |
| R3 | Le contrat `coef-period@1` ne couvre pas le texte réel (variable d'entrée manquante) | Livraison de code (`@2`) à la réception des textes | Contrat générique par construction (N périodes, poids en données, quatre codes de décision) ; décision à la réception ; coût borné (un contrat, un pipeline) |
| R4 | Volume de la grille de compétences (≈ 54 000 lignes/an/école) | Lenteur sur mobile | Saisie en lot, index dédié, pagination par classe, synthèse par compteurs SQL ; mesure en T16 |
| R5 | Divergence entre le conseil des maîtres (005) et le conseil de classe (006) | Deux modèles pour la même idée | Les deux réutilisent `results.deliberations/decisions` ; `council_cases` / `council_attendance` seront proposés à 006 comme patron commun (voir §6) |
| R6 | Le pipeline `results` pour `competency-period@1` retarde | Maternelle sans décision automatique | Repli : la décision de la maternelle se saisit directement au conseil (`results.decisions` créée manuellement) en attendant le pipeline |
| R7 | Modèle officiel de bulletin très différent du gabarit générique | Rework de présentation | Gabarits **versionnés en données** : une nouvelle version, pas du code ; maquette soumise au propriétaire avant les écrans |
| R8 | Collision de plage de migrations avec un autre module | Journaux ambigus | Plage `1800–1899` inscrite dans `module-conventions.md` à la création (T17) ; `pnpm module:new` la réserve |
| R9 | Fuite de données d'enfants (appréciations, listes) | Atteinte à la vie privée des mineurs | RLS forcée, 404 hors périmètre, aucun contenu dans événements/audit/notifications, téléchargements famille journalisés (013), tests de sécurité T17 |

## 6. Ce que 006 (secondary) peut réutiliser

`council_cases` / `council_attendance` (patron du dossier et de la présence de séance), `period_locks` (miroir des états de période), le patron « instantané scellé versionné » (`annual_reviews`) pour un bulletin annuel, l'échelle d'appréciation. Ces tables sont **spécifiques au primaire** aujourd'hui ; si 006 les adopte, elles seront déplacées dans un module commun (`councils`) par une migration de renommage — décision à prendre avec 006, hors de ce plan.

## 7. Sortie de phase (Phase 4, volet primaire)

Reprise des critères de `spec.md` §15 : migrations et 104 tests ; établissement `PRIMARY` provisionné sans intervention ; flux annuel complet avec le jeu fictif, bulletins marqués ; lint R2 vert ; demandes de changement acquittées ; textes transmis. **Le passage au réglementaire** (RuleSet officiel, golden tests officiels, gabarits officiels) est un **second jalon**, déclenché par la réception des textes, et ne bloque pas la sortie de phase technique.

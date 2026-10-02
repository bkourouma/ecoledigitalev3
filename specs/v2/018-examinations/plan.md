# Plan d'implémentation — 018-examinations

**Statut** : Rédigé. Tâches **parallélisables** par vagues ; tailles du plan §4 (S ≈ 1–2 semaines, M ≈ 3–5, L ≈ 6–10, pour un développeur). **Le calendrier réel dépend de la capacité de l'équipe**, inconnue (plan §8, point 1).

Prérequis : 000–004, 008, 011, 012, 013 ; 005 (classe de CM2) pour le CEPE ; 006 pour BEPC/BAC. Le moteur est livrable **avant** les textes officiels : il se démontre avec le CEPE fictif.

## 1. Principe d'exécution

1. **Aucune règle d'examen en code** : épreuves, coefficients, seuils, éligibilité, taux = données ou règles. Une tâche qui exige une constante s'arrête et pose une question (`open-questions.md`).
2. **Le DDL est livré et testé** (166 tests dont concurrence) : les migrations sont la copie du `data-model.md`.
3. **Officiel ≠ blanc** : le code ne calcule **jamais** une admission officielle ; les deux chaînes (import/saisie vs règle) sont développées et testées séparément.
4. **Demandes de changement d'abord** (T0) : 012 (contrat), 013 (natures de document), 004 (faits d'éligibilité), 008 (âge), 003 (modèle de pack).

## 2. Tâches

| ID | Tâche | Détail | Dépend de | Taille | Parallèle avec |
|---|---|---|---|---|---|
| 018-T0 | Demandes de changement (spec §16) | 012 : `exam-national@1`, `placeholder`, seed `CI-EXAM-PLACEHOLDER` ; 013 : natures et gabarits ; 004 : `getEligibilityFacts` ; 008 : âge ; 003 : section `examinations` ; 031 : importeur de résultats ; plage `2000–2099` | — | S | tout |
| 018-T1 | Migrations `2000`–`2002` | Copie exacte de `data-model.md` (`--check-doc`) ; conformité colonnes ↔ types de ligne ; allowlist **vide** ; test d'application de zéro ; rejeu de `ddl/run.mjs` sur les migrations réelles | — | S | T0 |
| 018-T2 | Squelette de module | `pnpm module:new examinations --range 2000` ; `manifest.ts` (permissions §11, features, menus, événements) ; `index.ts` ; schémas Zod `packages/contracts/src/v2/examinations.ts` ; codes `examinations.*` | T1 | S | T3 |
| 018-T3 | Types et données | CRUD types, séries, épreuves, pièces ; motif de numéro ; modèle de pack (`templates/CI/primary.json` : CEPE fictif, 3 épreuves fictives, pièce fictive) + instanciation idempotente + test de cohérence (aucun nombre sans origine) | T2 | M | T4, T5 |
| 018-T4 | Sessions | `createSession`, `instantiateSessionDefinition`, transitions (messages listant les manques), sessions blanches (`mock_of`), `rule_version_ref` épinglé | T2 | M | T3, T5 |
| 018-T5 | Candidats | Création depuis une classe d'examen (`academic.getRoster`), éligibilité (port `EligibilityFacts` + règle ; saisie manuelle en repli), dérogation, pièces, inscription, numéro, identifiants officiels, retrait, historique | T2 | L | T3, T4 |
| 018-T6 | Centres et répartition | Centres, salles, centres de la session, répartition manuelle et automatique (capacités, séparation facultative), figement | T4, T5 | M | T7 |
| 018-T7 | Notes et résultats | Saisie en lot idempotente, absences, résultats saisis, publication, révisions (note et résultat) avec approbateur ≠ demandeur | T5 | M | T6, T8 |
| 018-T8 | Imports | Lots (empreinte, lignes, validation, application sans erreur) ; analyse de fichier **via 031** ou analyseur de formats CSV en données ; rapport d'erreurs ligne à ligne ; formats fictifs | T4, T5 | M | T7 |
| 018-T9 | Examens blancs | Liens `assess` (une évaluation = une épreuve), import des notes **publiées** (`assess.listPublishedGrades`), calcul par règle (`exam-national@1`), classement, comparaison avec l'officiel | T7, T0 | L | T10 |
| 018-T10 | Exports | Formats (brouillon → publié), validation des colonnes (liste blanche, aussi côté Zod), exécution, empreinte, stockage ; transformations (`date_iso`, `decimal_comma`…) en TypeScript **identiques** à la liste SQL | T4 | M | T9 |
| 018-T11 | Documents | `issueDocument` (convocation, attestation, relevé) via `reportcards.requestOfficialDocument`, révocation, versions, accès famille ; abonné `reportcards.official_document.rendered` | T5, T6, T7, T0 | M | T12 |
| 018-T12 | Statistiques | `result_counts` + règle `taux_reussite` ; comparaisons (année précédente, blanc) ; export CSV | T7 | S | T11 |
| 018-T13 | Plugin HTTP | Routes §9 ; `requirePermission` ; limiteur sur la saisie en lot ; 404 hors périmètre ; audit des opérations sensibles | T3–T12 | M | T14 |
| 018-T14 | Jobs et abonnés | `academic.enrollment.withdrawn` → retrait du candidat (motif) ; `assess.grade.published` (notes d'examen blanc) ; `reportcards` (identifiant du document) ; purge des lots anciens | T5, T9 | S | T13 |
| 018-T15 | Écrans web | Types et sessions, liste des candidats (éligibilité, pièces, numéro), centres et plan de répartition, convocations en lot, examens blancs, import (aperçu, erreurs), publication, révisions, statistiques, exports ; bandeau « Règles de démonstration » | T13 | L | T16 |
| 018-T16 | Seeds, E2E, charge | Seeds déterministes (CEPE fictif, session blanche, session officielle de 40 candidats) ; Playwright « de la classe de CM2 à l'attestation et à l'export » ; charge : 1 000 candidats, import de 1 000 lignes, exports | T13, T15 | M | — |
| 018-T17 | Qualité et nettoyage | Lint R2 (aucune constante), allowlist, test d'isolation générique, test « aucune note ni identité dans événements/audit/logs », README du module, plage inscrite dans `module-conventions.md` ; retrait des champs legacy `cepe_code`/`affectation_*` des écrans (parité EX-01, EX-02) | T1–T16 | S | — |

## 3. Vagues

```
Vague 1 (2 semaines) : T0, T1, T2
Vague 2 (parallèle)  : T3, T4, T5
Vague 3 (parallèle)  : T6, T7, T8, T10
Vague 4 (parallèle)  : T9, T11, T12, T14
Vague 5              : T13, T15, T16, T17
```

Chemin critique : T0 → T5 → T7 → T9 / T11 → T15 → T16. Le **parcours officiel** (T5 → T7 → T8 → T11) est indépendant du contrat de règles : il peut livrer d'abord, l'examen blanc (T9) et l'éligibilité automatique suivent la livraison du contrat `exam-national@1`.

## 4. Stratégie de test

| Niveau | Contenu | Bloquant en CI |
|---|---|---|
| DDL | `ddl/run.mjs` (166 tests, dont concurrence réelle) rejoué sur les migrations réelles ; `--check-doc` | Oui |
| Unitaires | `format_number` (parité TS ↔ SQL), validation des colonnes d'export (parité TS ↔ SQL), transformations, Zod, avancement | Oui |
| Golden de mécanisme | `golden-exam-mechanism` G1–G14 | Oui |
| Intégration | Parcours CEPE complet sur modules réels ; refus de calculer un résultat officiel ; refus d'importer un résultat de blanc ; reprise après échec d'import ; publication partielle refusée ; isolation A/B ; révisions (approbateur ≠ demandeur) | Oui |
| Sécurité | Famille : documents de ses enfants liés seulement ; aucune note ni identité dans événements, audit, logs ; champ d'export hors liste blanche refusé ; accès à une session d'un autre tenant : 404 | Oui |
| E2E | De la classe de CM2 à l'attestation et à l'export, données fictives | Sur `main` et avant release |
| Performance | 1 000 candidats : inscription par lot < 30 s ; import de 1 000 lignes < 10 s ; `result_counts` < 300 ms ; export de 1 000 lignes < 5 s | Mesuré, objectif |

## 5. Risques et mitigations

| # | Risque | Impact | Mitigation |
|---|---|---|---|
| R1 | Les textes et fichiers officiels n'arrivent pas | Pas de production « officielle » | Moteur livré et démontré avec le CEPE **fictif** ; formats et règles = données ajoutées à réception (`regulatory-sources-needed.md`) |
| R2 | Un résultat **calculé** est pris pour un résultat officiel | Fausse admission communiquée | Déclencheurs `official_not_computed` / `mock_not_imported` ; documents officiels exigent un résultat **officiel publié** ; bandeau et filigrane « règles de démonstration » ; examens blancs jamais visibles comme officiels |
| R3 | Format d'échange officiel très différent (largeur fixe, encodage ancien, colonnes composées) | Rework | `export_formats` couvre CSV/XLSX/largeur fixe/JSON, encodages, séparateurs, transformations de liste blanche ; un besoin hors liste = **nouvelle transformation** (livraison de code **minimale**, jamais d'expression libre) |
| R4 | Course à l'inscription (numéros) | Doublons ou trous | Compteur transactionnel ; test à 4 sessions réelles (livré) |
| R5 | Identité d'un candidat corrigée après transmission de la liste | Écart avec le fichier remis à l'autorité | Identité **figée** à l'inscription ; correction = retrait + nouvelle inscription motivée, ou procédure de rectification (Q-E17) |
| R6 | Charge d'inscription à la clôture (centaines d'écoles en simultané) | Lenteur | Inscription par lot en transaction par candidat ; index dédiés ; mesure en T16 |
| R7 | Divergence 006 (BEPC/BAC) : séries et épreuves plus complexes | Moteur insuffisant | Séries et épreuves par série déjà modélisées ; options et compensation = règle (`@2` si une variable manque) |
| R8 | Fuite de données d'enfants (listes, résultats) | Atteinte à la vie privée de mineurs | RLS forcée, 404 hors périmètre, événements sans note ni identité, lignes d'import sans nom, téléchargements journalisés |
| R9 | Mélange d'usages des champs `assess` (examen blanc vs évaluation normale) | Notes publiées à tort aux familles | L'évaluation d'un blanc est de type `EXAMEN_BLANC` (non visible aux élèves, 011) ; le lien est exclusif (`UNIQUE (assessment_id)`) |

## 6. Ce que 006, 007 et 020 réutilisent

006 : types BEPC/BAC (données), séries, épreuves par série, examens blancs, éligibilité par règle, statistiques. 007 : résultat du CEPE publié (événement, sans note) pour l'admission en 6e. 020 : types BTS (admissibilité, stage, soutenance) au-dessus des sessions, candidats, résultats et documents de ce moteur.

## 7. Sortie de phase (Phase 4, volet examens)

Reprise de `spec.md` §17 : migrations et 166 tests ; parcours E2E CEPE fictif ; 20 inscriptions concurrentes → 20 numéros distincts sans trou ; aucune admission officielle jamais calculée ; aucune constante réglementaire ; demandes de changement acquittées ; textes transmis. **Le passage au réglementaire** (types, épreuves, règles, formats et gabarits officiels) est un **second jalon**, déclenché par la réception des textes et fichiers, et ne bloque pas la sortie de phase technique.

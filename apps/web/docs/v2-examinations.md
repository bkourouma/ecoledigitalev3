# Écrans web des examens (`/v2/examinations/*`)

Spec : `specs/v2/018-examinations`. Module API : `apps/api/src/modules/examinations`. Client typé : `src/platform/v2/examinations.ts`
(schémas Zod de `packages/contracts/src/v2/examinations.ts`). Libellés : `messages/fr-CI.json`, espace `v2Examinations`.

## Principe

Le web **n'affiche que ce que l'API décide** et envoie des actions. Il ne code aucune règle d'examen : éligibilité (règle
`exam-national@1`), moyenne et issue d'un examen blanc (règle versionnée), taux de réussite (dénominateur paramétré), numéro de candidat
(sans trou, attribué par la base), transitions autorisées et leurs manques viennent des réponses. `usePermission` / `useFeature` ne
servent qu'à afficher ou masquer ; l'API reste la barrière. Les nombres exacts (notes, moyennes, coefficients) restent des chaînes
décimales ; ils ne sont jamais convertis en flottant pour décider. Un test (`examinations-coverage.test.ts`) refuse tout seuil ou calcul
de coefficient codé dans un écran.

## Écrans

| Route | Permission (garde serveur) | Contenu |
|---|---|---|
| `/v2/examinations` | `exam.session.read` | Liste des sessions (officielles, blanches), filtres, création |
| `/v2/examinations/sessions/[id]` | `exam.session.read` | Parcours, effectifs, épreuves figées, points bloquants, transitions, confirmation de publication |
| `/v2/examinations/types` | `exam.type.read` | Types d'examens, filières, épreuves, pièces ; chargement du pack du primaire (CEPE FICTIF) |
| `/v2/examinations/centers` | `exam.center.manage` | Centres et salles |
| `/v2/examinations/candidates` (+ `/[id]`) | `exam.candidate.read` ou `.manage` | Candidats d'une session ; dossier : éligibilité (règle, saisie manuelle, dérogation motivée), pièces, identifiants, place, notes, documents, historique |
| `/v2/examinations/assignments` | `exam.center.manage` ou `exam.session.read` | Centres de la session, répartition automatique, changement de place |
| `/v2/examinations/mock` | `exam.mock.manage` | Liaison aux évaluations `assess`, reprise des notes, calcul par la règle (version de règle tracée) |
| `/v2/examinations/results` | `exam.result.read`, `.enter` ou `exam.score.enter` | Résultats (saisie, publication) et matrice des notes |
| `/v2/examinations/imports` | `exam.import.manage` | Dépôt (base64), analyse, lignes en erreur, application atomique (`exam.result.release`) |
| `/v2/examinations/corrections` | `exam.result.read` ou `.revise` | Demandes de correction approuvées par UNE AUTRE personne (quatre yeux) |
| `/v2/examinations/statistics` | `exam.statistics.read` | Effectifs et taux par établissement, filière, sexe, niveau ; comparaison |
| `/v2/examinations/exports` | `exam.export.run` ou `exam.document.issue` | Exports paramétrables (URL signée courte, jamais affichée), documents scellés, révocation motivée |
| `/v2/examinations/family` | `exam.document.child.read` ou `.self.read` | « Examen de mon enfant » / « Mon examen » : inscription, place, issue PUBLIÉE, documents ; jamais de notes ni de moyenne |

Les écrans rattachés à une session lisent `?session=<id>` (partageable, survit au rechargement) ; une session unique est retenue d'office.

## Données de démonstration

Tant que la session ou le type porte des données FICTIVES (`demoRules` / `placeholder`), un bandeau « Règles de démonstration » est
affiché. Le CEPE livré (3 épreuves EP1 à EP3, jeu de règles `CI-EXAM-PLACEHOLDER`) n'est pas officiel.

## Tests

`src/app/v2/examinations/_components/Examinations.test.tsx` (Vitest + RTL, corps de requête exacts, permissions, états d'erreur de l'API)
et `examinations-coverage.test.ts` (clés i18n statiques, énumérations du contrat, absence de règle codée).

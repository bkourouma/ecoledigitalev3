# Écrans v2 : évaluations, notes, résultats, règles, bulletins, supérieur

Tout est additif : aucune page legacy n'est touchée. Les pages `src/app/v2/<section>/**` sont minces (garde serveur + écran) ;
la logique est dans `_components/` (testée) et les hooks typés dans `src/platform/v2/{assess,results,rules,reportcards,higher}.ts`
(contrats Zod de `packages/contracts/src/v2/*`, un hook par ressource, mutations via `useApiAction`).

## Règle d'or : aucun calcul côté web

Moyennes, rangs, mentions, décisions, crédits, éligibilité au diplôme : **valeurs renvoyées par l'API** (chaînes décimales exactes +
valeur d'affichage), affichées telles quelles (l'infobulle montre la valeur exacte). Les libellés des codes (mention, décision, état d'UE)
viennent du `label_map` de la version de règle (`GET /rules/rule-versions/:id`), jamais d'une comparaison de libellé.
Le web n'applique que des contrôles de **forme** (nombre décimal, barème, précision, longueur d'un motif) pour éviter un aller-retour ;
l'API revalide tout. Le test `src/app/v2/grades-messages-coverage.test.ts` garde aussi les libellés de tous les états des contrats.

## Routes

| Section | Routes | Garde serveur (permission) |
|---|---|---|
| Évaluations | `/v2/assessments` (liste), `new` (simple et par lot de classes), `[id]` (circuit + historique), `[id]/grades` (**grille de saisie**), `revisions`, `types` (+ réglages) | `assessment.read`/`grade.read`/`grade.enter` ; `assessment.create` ; `grade.revise.request`/`approve` ; `assessment.type.read` |
| Résultats | `/v2/results` (période : verrouillage, délibération, clôture, réouverture, re-pin), `matrix`, `[id]/explain`, `decisions` (décisions, délibérations, appréciations), `overrides`, `year/[enrollmentId]/[yearId]`, `resit` | `result.read`, `period.*`, `decision.*`, `result.override.*`, `result.explain`, `higher.resit.manage` |
| Règles | `/v2/rules` (catalogue), `versions/[id]` (règles, simulation, journal) | `rules.ruleset.read` |
| Bulletins | `/v2/reportcards` (liste), `issue` (lot), `[id]`, `family`, `templates`, `identity`, `signatories` | `reportcard.read`/`generate`/`self.read`/`child.read`/`template.manage`/`branding.manage`/`signatory.manage` |
| Vérification publique | `/v2/verify`, `/v2/verify/[code]`, `/v2/verify/v/[code]` | **aucune** (page publique, non indexée) |
| Supérieur | `/v2/higher/diplomas`, `diplomas/[id]`, `attestations`, `documents`, `credits`, `resit`, `signatories` | `higher.diploma.read`, `higher.document.read`, `higher.credits.read`, `higher.resit.manage`, `higher.slot.manage` |

Boutons et onglets sont masqués par `usePermission` / `useFeature` (fail-closed) ; la barrière réelle reste l'API, dont le message
d'erreur (403 séparation des tâches, 409 version périmée, 422 diagnostic…) est affiché tel quel.

## Grille de saisie des notes (`/v2/assessments/[id]/grades`)

Modèle pur testé : `_components/grid-model.ts`. Une cellule = un texte : une note (`12,5` ou `12.5`), un code d'état
(`ABS` absent non justifié, `ABJ` absent justifié, `DISP` dispensé, `NN` non évalué) ou vide. **Une absence ou une dispense n'est jamais un
zéro** (états `ABSENT_*`, `EXEMPT`, `NOT_GRADED` distincts, sans note).

- clavier : Entrée / flèche bas = élève suivant, Maj+Entrée / flèche haut = précédent, Ctrl+S enregistre ; la liste « État » est l'équivalent
  tactile des codes ; saisie décimale (`inputMode="decimal"`), cibles de 44 px, noms et état empilés pour tenir à 375 px ;
- collage depuis un tableur : une colonne à partir de la cellule active, ou plusieurs colonnes dont la première est le **matricule**
  (la dernière colonne est la note) ; lignes non placées signalées ;
- contrôle de forme en direct (format, décimales du réglage `maxScoreDecimals`, barème) : une ligne invalide **bloque** l'enregistrement ;
- enregistrement par lot **tout ou rien** (`PUT .../grades`, ≤ 500 lignes) : en-tête `Idempotency-Key` (une clé par lot), `rowVersion` par ligne
  existante ; après un échec réseau / 5xx le **même lot (même clé)** est rejoué (résultat `replayed`, rien n'est doublé) ; 409 `assess.stale_grade` :
  « recharger la feuille », saisies non écrasées ; erreurs 400 par ligne rattachées à la bonne cellule ;
- indicateur annoncé (`aria-live`) : « N modifications non enregistrées » / « Enregistré à … » ; enregistrement automatique après 6 s d'inactivité (désactivable),
  reprise au retour du réseau, avertissement avant de quitter avec des saisies en attente ;
- feuille PUBLIÉE : lecture seule ; « Corriger » (demande motivée ≥ 10 caractères, approbation par un tiers), « Historique », ajout d'un élève absent de la feuille.

## Cycle d'une période (`/v2/results`)

`OPEN → GRADING_LOCKED → DELIBERATED → CLOSED`, boutons selon l'état et les permissions. Verrouillage **forcé** (évaluations non publiées) avec motif,
clôture avec exclusion tracée des inscriptions en erreur (motif), réouverture `CORRECTION` ou `RESIT_SESSION` (motif), **retard de version de règle**
(`ruleLag`) avec bannière et re-pin (période ouverte) suivi du rapport d'impact (rejeu sans écriture : résultats modifiés, premières différences).
Surcharges à quatre yeux (demande ≥ 20 caractères, approbation/rejet/révocation par un tiers, message de l'API si le demandeur approuve).
Décisions : confirmer la proposition ou en retenir une autre avec motif de 20 caractères (les deux sont conservées côté API).

## Règles (`/v2/rules`)

Jeux nationaux **en lecture seule** ; variante d'établissement par copie d'une version nationale publiée ; édition des paramètres bornés ;
éditeur d'expressions : l'API valide à l'enregistrement et renvoie des diagnostics (message français, `ligne/colonne`, aide) affichés avec un extrait et
un repère `^` ; banc d'essai (`/evaluate`) ; simulation asynchrone (progression relue toutes les 2 s, rapport : compteurs, effet par règle, transitions,
différences, % de décisions modifiées) ; workflow `draft → simulated → proposed` (confirmation explicite de l'impact sur les décisions) ;
**approbation et publication restent à l'opérateur de la plateforme** (console `/v2/platform`), jamais proposées à l'établissement.

## Bulletins et vérification publique

Contrôle préalable (manques bloquants avec lien de correction), lot idempotent (rejouer = reprendre les inscriptions non émises), progression,
publication / retrait / réémission / révocation motivées, téléchargement **contrôlé** (URL signée de 5 minutes demandée à l'API puis ouverte, jamais affichée ;
accès des familles journalisé côté API), vue famille (`/v2/reportcards/family`, publiés uniquement), détail avec QR du lien de vérification (SVG local),
identité versionnée, signataires, gabarits (options lues du schéma du modèle, signataire par emplacement, aperçu dans un `iframe sandbox=""`).

`/v2/verify` : saisie du code (espaces, tirets et casse ignorés), verdicts `AUTHENTIC / SUPERSEDED / REVOKED / INVALID / UNKNOWN`, comparaison d'un PDF téléversé
(corps brut `application/pdf`). Aucune donnée personnelle, aucun jeton, aucun en-tête d'établissement. Le QR imprimé par l'API encode
`<REPORTCARDS_VERIFICATION_BASE_URL>/v/<code>` : avec `REPORTCARDS_VERIFICATION_BASE_URL=https://<domaine>/v2/verify`, l'adresse `/v2/verify/v/<code>` répond.
`fetch-interceptor.ts` ne redirige plus vers `/login` les appels `/api/v1/public/*` et `/api/v1/reportcards/public/*` (corrigé : sans cela la page publique
renvoyait tout visiteur non connecté vers la connexion).

## Supérieur

Diplômes créés **depuis un cycle du curriculum** (programme → année → version → nœud), exigences synchronisables, candidats avec éligibilité décidée par la règle
(version de règle affichée), octroi, **octroi forcé** (droit `higher.award.force` + motif ≥ 20 caractères), **ré-octroi** d'un diplôme révoqué sur décision écrite
(≥ 20 caractères), révocation motivée, émission du diplôme / duplicata / attestation d'authenticité, attestations de réussite, documents émis (publication, révocation, détail),
registre de crédits et dettes d'UE, fenêtres de rattrapage (la session 2 **remplace** la session 1), signataires par emplacement avec périodes.

## Tests

```bash
pnpm --filter @ecoledigitale/web test                                        # Vitest/RTL (API simulée) : grille, workflow, tous les écrans
PW_CHANNEL=msedge pnpm --filter @ecoledigitale/web exec playwright test -c playwright.grades.config.ts   # smoke : /v2/verify (375 px et bureau) + gardes
```

Le smoke Playwright démarre Next seul (ni API ni base). Les parcours authentifiés (grille, clôture, bulletins) exigent NextAuth + API réels : couverts par Vitest.

## Écarts avec le legacy et points ouverts

- **Pas de portail élève/parent « Mes notes / Mes résultats »** : les hooks `useMyPublishedGrades`, `useChildPublishedGrades`, `useMyResults`, `useChildResults`
  sont écrits et typés, les écrans ne le sont pas (hors liste de la mission, sauf « bulletins de mes enfants » livré).
- **Pas de téléchargement des PDF d'un diplôme/attestation** : `higher` ne propose pas de route de téléchargement (le rendu passe par `reportcards`) ; l'écran liste l'état
  (scellé, rendu) et le code de vérification.
- **Re-pin sans simulation préalable** : l'API ne propose pas de « dry-run » ; la simulation (rejeu sans écriture) est jointe à la réponse du re-pin et affichée ensuite.
- **Liaisons règle ↔ programme/niveau** (`/rules/bindings`) : hooks écrits, écran non livré.
- **Prérequis entre UE** (`/higher/ue/:id/prerequisites`) : non livré.
- **Dépôt d'images (logo, emblème, signature)** : le navigateur envoie directement le fichier à l'URL signée du stockage ; la CSP de `middleware.ts`
  (`connect-src 'self' http://localhost:…`) bloquera un stockage externe tant que son origine n'y est pas ajoutée.
- **Enseignant sans `academic.classroom.read`** : la liste de classes de la création d'évaluation dépend de cette permission (repli « mes classes » non livré).
- Noms d'élèves de la grille et du registre : `GET /people/students?classroomId=` (200 maximum) ; au-delà, des numéros s'affichent (avertissement).
- Pas de file hors ligne persistante (squelette 029) : les saisies restent en mémoire et sont renvoyées au retour du réseau, pas après rechargement de la page.

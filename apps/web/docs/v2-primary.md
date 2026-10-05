# Pack Primary (maternelle et primaire) — écrans web `/v2/primary/*`

Spec : `specs/v2/005-primary/spec.md` §9. API : module `primary_school` (`/api/v1/primary_school/*`, voir
`apps/api/src/modules/primary_school/README.md`). Contrats Zod : `packages/contracts/src/v2/primary_school.ts`
(importés par `@ecoledigitale/contracts/v2/primary_school`, jamais recopiés).

## Règles d'or (non négociables)

- **Aucun calcul côté web** : ni moyenne, ni rang, ni pourcentage de réussite, ni décision de passage, ni seuil. Le web affiche des
  **comptages** renvoyés par l'API et des **codes** traduits par table de libellés (`useCodeLabels`, espace `v2PrimaryCommon`) ; il ne
  compare jamais un libellé. Seuls des contrôles de **forme** sont faits (motif ≥ 10 caractères, justification ≥ 20, lot ≤ 500 lignes).
- **Bandeau permanent « Règles de démonstration — document sans valeur officielle »** (texte = constante `PRIMARY_PLACEHOLDER_NOTICE`
  du contrat) : `RuleBanner` (`GET /rule-banner` → `isPlaceholder`) sur tous les écrans du personnel ; `PlaceholderNotice` sur les
  bilans (`ruleSourceKind = placeholder`) côté famille et direction. Si l'état des règles est illisible, on le dit (jamais de masquage).
- **La vraie barrière est l'API** : `usePermission` / `useFeature` MASQUENT les boutons non permis (fail-closed : tant que les droits ne
  sont pas connus, rien n'est proposé) ; les messages d'erreur de l'API (`code`, `message` français) sont affichés **tels quels**
  (`PrimaryError`), avec une piste d'action pour les codes connus (`v2PrimaryCommon.errorHints.*`). Un 404 hors périmètre affiche un
  message **neutre**. `primary_school.port_unavailable` (500) affiche « document non disponible », pas une erreur brute.
- **Actions sensibles** (révision, scellement, réémission, gel, application du modèle, publication d'un référentiel) : dialogue de
  confirmation (`ConfirmActionDialog`, focus piégé par Radix) ; le **gel** exige en plus une case « je comprends que c'est irréversible ».
- **Jamais de perte silencieuse** : après un échec réseau, les saisies restent affichées et le même lot est rejoué avec la même clé.
- **Accessibilité** : un `<main>` (layout racine) et un `<h1>` par page, champs étiquetés, erreurs `role="alert"`, cibles ≥ 44 px
  (mobile), statuts jamais portés par la couleur seule (texte + icône), `aria-live` sur les compteurs, tableaux dans une région
  focusable (`tabIndex=0`) pour le défilement horizontal interne (jamais de défilement horizontal de la page à 375 px).
- Aucun texte français en dur dans un composant : tout passe par `useTranslations("v2Primary…")` (espaces `v2PrimaryNav`,
  `v2PrimaryCommon`, `v2PrimaryClass`, `v2PrimaryCompetencies`, `v2PrimaryAppreciations`, `v2PrimaryCouncil`, `v2PrimaryDirection`,
  `v2PrimaryReviews`, `v2PrimaryArchives`, `v2PrimaryReports`, `v2PrimarySettings`, `v2PrimaryParent`).

## Routes et gardes

Chaque section a une garde SERVEUR (`layout.tsx` : `requireAnyPermission`, source unique des permissions dans
`_components/guards.ts`, partagée avec `PrimaryNav`) ; le layout racine exige au moins une permission du pack et pose `<main>` + navigation.
Les pages sont minces (`page.tsx` = garde du layout + un écran de `_components/`).

| Route | Écran | Permissions (une suffit) | Fonctionnalité de l'offre |
|-------|-------|--------------------------|---------------------------|
| `/v2/primary` | redirige vers l'écran du profil (direction, famille, instituteur) | — | — |
| `/v2/primary/classe` | « Ma classe » + appel du jour (`DailyCall`) | `primary.competency.read|record`, `primary.council.read|prepare`, `primary.class.read_all` | — |
| `/v2/primary/competences` | grille de compétences | `primary.competency.read|record` | `primary.competencies` |
| `/v2/primary/appreciations` | banque de phrases | `primary.phrase.read|manage` | — |
| `/v2/primary/conseil` | liste des conseils, préparation, séance | `primary.council.read|prepare|manage` | `primary.council` |
| `/v2/primary/direction` | avancement des classes (feux) | `primary.report.read` | `primary.reports` |
| `/v2/primary/bilans` | bilans annuels | `primary.bilan.read|prepare` | `primary.annual-review` |
| `/v2/primary/archives` | archives d'année | `primary.archive.prepare|freeze`, `primary.bilan.read` | `primary.year-archive` |
| `/v2/primary/etats` | les 7 rapports + CSV | `primary.report.read` | `primary.reports` |
| `/v2/primary/parametres` | réglages, modèle, échelles, référentiels | `primary.settings.manage` | — |
| `/v2/primary/mon-enfant` | bulletin et compétences (parent / élève) | `primary.bilan.child.read|self.read`, `primary.competency.child.read|self.read` | — |

`?classe=<id>` pré-sélectionne une classe sur `/competences` et `/conseil` (liens de « Ma classe » ; une classe hors périmètre est ignorée).

## Client typé : `src/platform/v2/primary.ts`

Un hook par ressource, clés de cache `["primary", <ressource>, …]` (le tenant est ajouté par `platformHooks`), mutations par
`useApiAction`, réponses validées par les schémas du contrat. Trois réponses n'ont pas de schéma dédié (formes lues dans
`http/plugin.ts`) et sont déclarées dans le client : résultat du `PATCH` d'un dossier, résultat de `decide`, et `POST …/minutes`
(`documentId` peut être `null` tant que le document n'est pas rendu, alors que `primaryMinutesResultDtoSchema` l'exige).

## Grille de compétences (`CompetencyGrid.tsx`, modèle pur `competency-grid-model.ts`)

- **Mobile d'abord** : une **fiche élève** à la fois (sélecteur d'élève + précédent / suivant), compétences groupées par domaine
  (`fieldset`), une rangée de boutons de niveaux ≥ 44 px (libellé **et** code, `aria-pressed`, coche : jamais la couleur seule).
  **Tableau** (bouton « Tableau », grand écran) : une liste déroulante par cellule, en-têtes de domaines et de compétences, légende.
- **Non évaluée ≠ 0** : une cellule sans saisie reste « Non évaluée » (aucun niveau par défaut). Une ligne enregistrée ne se « décoche »
  pas (l'API n'a pas de suppression).
- **« Tous au niveau X sauf… »** : applique X à toutes les cellules **non saisies** (toute la classe, ou l'élève affiché) ; les cellules
  déjà renseignées ou validées ne changent pas ; on corrige ensuite les exceptions une à une. « Annuler mes saisies » efface les brouillons.
- **Complétude** (`aria-live`) : « N sur M compétences renseignées · K en attente · V validées » — comptages dérivés des lignes de l'API
  et des saisies locales. La **synthèse d'un élève** (`GET /enrollments/:id/competency-summary`) est un tableau de **compteurs**
  domaine × niveau (lignes validées seulement), jamais de moyenne, de pourcentage « acquis » ni de seuil.
- **Enregistrement différé** (5 s après la dernière saisie, case « Enregistrement automatique », bouton « Enregistrer »), par lots
  `PUT /competency-assessments/bulk` de **500 lignes au plus**, tout ou rien **par lot** ; au-delà de 500 lignes, tranches successives,
  chacune avec **sa** clé `Idempotency-Key` (une clé par lot). Une ligne existante part avec sa `rowVersion`.
  - **Échec réseau, délai, 429, 5xx** : le lot en attente est **conservé** et rejoué avec la **même clé** (bouton « Réessayer maintenant »,
    nouvel essai automatique, reprise au retour de la connexion) ; aucune saisie ne s'efface.
  - **409 `row_version_conflict`** : message de l'API, erreur sur la bonne cellule, bouton « Recharger sans écraser mes saisies »
    (`rebase` : les saisies sont conservées, la valeur enregistrée et la `rowVersion` sont mises à jour).
  - **409 `validated_frozen`** : idem ; au rechargement, les saisies visant une ligne devenue validée sont **annoncées** (jamais perdues
    en silence). **409 `period_locked`** : la grille passe en lecture seule, les saisies restent affichées.
  - **400** : erreurs `lines.<i>` rattachées à la cellule de la ligne `i` du lot ; rien n'a été enregistré.
- **Verrou** : grille en lecture seule si `locked` ou sans `primary.competency.record`. Avertissement `beforeunload` s'il reste des
  saisies ; les sélecteurs de classe / période sont verrouillés tant que des saisies attendent.
- **Valider la grille** (`primary.competency.validate`) : confirmation, désactivé tant que des saisies ne sont pas enregistrées ; résultat
  « validées / non évaluées restantes ». **Réviser** une ligne validée (`primary.competency.revise`, sensible) : nouveau niveau + motif
  ≥ 10 caractères (schéma du contrat), historique `GET …/revisions` dans la fenêtre.

## Prêt pour les familles (Q-P18, `ClassScreen.tsx` : `ReadyControl`)

Dans « Ma classe », chaque période affiche son état (verrouillée / ouverte, **« Prête pour les familles »**) et, avec `primary.competency.validate`, un bouton **Marquer prête** (confirmation explicite : les familles verront les compétences et le **rang provisoire**, la saisie est gelée) ou **Retirer le marquage** (motif de 10 caractères au moins ; l'API refuse si un bulletin de la période est publié et son message est affiché tel quel). Le web n'évalue rien : il envoie l'ordre (`useMarkPrimaryPeriodReady`, `useWithdrawPrimaryReady`) et affiche la réponse. Côté famille, `FamilyResults` montre un résultat `provisional` avec le seul rang, signalé « Rang provisoire », sans moyenne, mention ni crédits ; la synthèse de compétences (`/v2/primary/mon-enfant`) suit les périodes prêtes, validées ou publiées renvoyées par l'API. Espaces de messages : `v2PrimaryClass.ready`, `v2Portal.family.results.official.provisional*`, `v2PrimaryCommon.errorHints.period_ready|period_published`.

## Appel du jour (`DailyCall.tsx`)

Réutilise les hooks de `platform/v2/attendance.ts` (`useOpenAttendanceSession`, `useAttendanceSession`, `useMarkRecords`,
`useSubmitAttendanceSession`) et les utilitaires purs de `attendance/_components/call-utils.ts` : séance `DAILY` de la date du jour,
tous présents par défaut, un geste pour marquer un absent (`aria-pressed`), un geste pour transmettre (`allPresent`). La séance n'est
ouverte qu'au geste « Appel du jour ». **Limite** : pas de file hors ligne dans cette page (disponible sur `/v2/attendance/call`).

## Conseil des maîtres (`CouncilScreen.tsx`, modèle pur `council-model.ts`)

Même route pour l'instituteur (préparer, sa proposition, report) et la direction (présence, décisions, procès-verbal), selon les
permissions. Séance : bandeau de démonstration si `ruleSourceKind = placeholder` ; **feuille de présence** (convoqués, présence,
rôle dont président et secrétaire — le contrat refuse deux présidents —, signature qui exige la présence ; une présence **signée est
figée** et ne part pas dans la requête) ; **quorum tel que renvoyé** (`met = null` ou `source = none` → « aucun quorum bloquant ») ;
**dossiers un par un** avec la **proposition de la règle (code)** et la **décision** côte à côte ; décision = « confirmer la proposition »
(aucun code envoyé) ou « retenir un autre code » avec **justification ≥ 20 caractères** ; **procès-verbal** (date réelle de séance
obligatoire ; `port_unavailable` → message explicatif).

## Autres écrans

- **Direction** : feux calculés à l'affichage (`direction-model.ts`) — rouge : rien de saisi ; vert : tout saisi et validé et bilans
  existants scellés ; orange : le reste ; « sans objet » si aucune compétence attendue. Règle d'affichage **sans valeur réglementaire**,
  toujours accompagnée d'un texte, d'une icône et des comptages.
- **Bilans** : préparation, statut (DRAFT / READY / SEALED / SUPERSEDED), empreinte et version, sceller (manques `details.blockers`
  affichés), réémettre (motif ≥ 10). **Archives** : préparation, manifeste, manques, gel irréversible avec case à cocher.
- **États** : 7 rapports ; `class-list`, `attendance-register`, `competency-coverage`, `council-pack` demandent leurs paramètres ;
  `enrollment-stats`, `repeaters`, `progress` sont **réservés à la direction** (`primary.class.read_all`) et masqués sinon ; aperçu en
  tableau (`ResponsiveTable`), paramètres rappelés, export CSV par téléchargement (`format=csv`, jamais d'URL affichée).
- **Paramètres** : réglages (`PUT /settings`), modèle de pack (sensible), échelles (liste + création), référentiels (brouillon →
  structure → publication ; un référentiel **publié est immuable** : « Créer une nouvelle version »).
- **Mon enfant** : un parent choisit un enfant lié (`useMyChildren`), voit ses bilans **scellés et publiés** et la synthèse par compteurs
  des périodes publiées ; élève : `/me/annual-reviews`. Rien de publié : message clair. Hors lien de tutelle : 404 → message neutre.

## Tests

`pnpm --filter @ecoledigitale/web test` (Vitest, API simulée, aucun appel réseau) :

- modèles purs : `competency-grid-model.test.ts` (cellules, « tous au niveau X sauf… », lots ≤ 500, `rowVersion`, fusion, rechargement
  sans écrasement, erreurs par ligne), `models.test.ts` (conseil, quorum, présence, feux, catalogue des états) ;
- écrans : `CompetencyGrid.test.tsx` (lot idempotent rejoué avec la même clé, 409 / 400 par ligne, lecture seule verrouillée, droits,
  enregistrement différé, validation, révision), `Council.test.tsx`, `Reviews.test.tsx` (bilans + archives), `Parent.test.tsx`
  (rien de publié, 404 neutre, bandeau), `Screens.test.tsx` (classe + appel du jour, direction, états, paramètres, appréciations) ;
- client : `src/platform/v2/primary.test.tsx` ; i18n : `messages-coverage.test.ts` (aucune clé manquante ni valeur vide, tous les statuts
  et codes des contrats, ICU valide). Fixtures : `_test/fixtures.ts` (données FICTIVES, conformes aux contrats), `_test/helpers.ts`.

## Limites connues

- Navigation interne (liens Next) : l'avertissement de saisies en attente ne couvre que la fermeture / le rechargement de l'onglet ;
  les sélecteurs de classe et de période sont verrouillés tant que des saisies attendent.
- L'enregistrement automatique réessaie toutes les 5 s en cas d'échec réseau ; le brouillon n'est pas persistant (perdu si l'onglet se ferme).
- Pas de « bascule rapide » par colonne dans le tableau (le geste équivalent est « tous au niveau X sauf… » et les boutons de niveau).
- Échelles : création seulement (modification des niveaux / archivage via l'API) ; référentiels : pas d'import ; pas de suppression
  d'une phrase (désactivation seulement).
- Procès-verbal et PDF de bilan : dépendent de `reportcards` (natures `COUNCIL_MINUTES` / `ANNUAL_REVIEW`) ; tant qu'elles ne sont pas
  livrées, l'API répond `port_unavailable` et l'écran l'explique.
- Les propositions de la règle (`ruleProposalCode`) dépendent des contrats `coef-period@1` / `competency-period@1` (module `rules`) : sans
  eux, le dossier n'a pas de proposition et la décision exige un code explicite.

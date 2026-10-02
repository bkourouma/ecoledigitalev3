# Écrans v2 : reconduction annuelle, paramètres académiques, liaisons de règles, prérequis, « Mon dossier »

Complète `v2-academic-people.md` et `v2-grades-results.md` (mêmes conventions : hooks typés `platform/v2/*`, contrats Zod
`packages/contracts/src/v2/*`, gardes serveur dans `page.tsx`, **aucune règle métier côté client** : l'écran affiche ce que l'API renvoie
et lui envoie les actions ; l'API reste la barrière et ses messages d'erreur sont affichés tels quels).

| Route | Écran | Permission (page) | Fonction (offre) |
|---|---|---|---|
| `/v2/academic/rollover` | assistant de reconduction (années, étapes, aperçu, confirmation) | `academic.year.rollover` | `academic.rollover` |
| `/v2/academic/rollover/runs` | historique des reconductions d'une année source, reprise d'une exécution vivante | `academic.year.rollover` | `academic.rollover` |
| `/v2/academic/rollover/runs/[id]` | suivi (progression par étape, relance, rapport) | `academic.year.rollover` | `academic.rollover` |
| `/v2/academic/settings` (`?tab=`) | paramètres académiques à onglets | `academic.read` (écriture : `academic.settings.manage`) | |
| `/v2/student/me` | « Mon dossier » (élève) | `student.self.read` (coordonnées : `student.self.update`) | |
| `/v2/rules/bindings` | liaisons règle <-> périmètre, par contrat | `rules.ruleset.read` (écriture : `rules.binding.manage`) | |
| `/v2/higher/prerequisites` | prérequis entre UE, contrôle d'un étudiant | `higher.credits.read` ou `higher.prerequisite.manage` | `higher.prerequisites` |

Les écrans portent aussi leur propre garde d'affichage (`RequirePermission`, `RolloverGate`, `Can`, `Feature`) : un utilisateur sans droit voit un
message explicite, jamais un écran vide ; les boutons d'écriture sont masqués (fail-closed).

## Organisation

- Hooks : `platform/v2/rollover.ts` (aperçu, lancement, historique, suivi avec relecture toutes les 2 s tant que `PENDING` / `RUNNING`,
  relance, calendrier de l'établissement), `platform/v2/settings.ts` (upsert des référentiels par code, paramètres d'établissement,
  paramètres des personnes), `platform/v2/prerequisites.ts`, `platform/v2/self.ts` (mise à jour des coordonnées de l'élève).
  Lectures déjà existantes réutilisées : `useReference`, `useAcademicSettings`, `useBindings` / `usePutBinding` / `useDeleteBinding`,
  `useMyStudentRecord`, `useMyEnrollments`.
- Écrans : `app/v2/academic/_components/rollover/` (`RolloverWizard`, `RolloverPlanView`, `RolloverRunView`, `RolloverHistory`, `RolloverGate`),
  `app/v2/academic/_components/settings/` (`SettingsScreen` + un fichier par onglet), `app/v2/rules/_components/BindingsScreen.tsx`
  (+ `bindings-model.ts`, `RulesNav.tsx`), `app/v2/higher/_components/PrerequisitesScreen.tsx` (+ `prerequisites-model.ts`),
  `app/v2/student/` (layout, `StudentNav`, `MyRecord`).
- Navigation : `AcademicNav` (Reconduction, Paramètres), `RulesNav` (nouveau : catalogue, liaisons), `HigherNav` (Prérequis), `PeopleNav` et
  `StudentNav` (Mon dossier).
- i18n : espaces de noms `v2Rollover`, `v2AcademicSettings`, `v2RulesBindings`, `v2HigherPrerequisites`, `v2StudentSelf`.

## Reconduction annuelle

1. **Années** : source (toute année de l'établissement) et cible (brouillon ou ouverte, postérieure à la source : filtre d'affichage, l'API revalide).
2. **Étapes** : calendrier / périodes, jours fériés, curriculum, classes, offres à la carte (masquée sans la fonction `academic.a-la-carte`),
   réinscriptions (+ « créer les classes manquantes »). Le corps n'envoie que les étapes retenues.
3. **Aperçu** (`GET .../rollover/plan`, aucune écriture) : compteurs et listes par étape, **avertissements en tête** (`role="alert"`, message du serveur,
   lien vers l'écran de correction : calendrier, curriculum, classes, décisions de passage…), anomalies de réinscription **groupées par code** avec lien
   vers l'inscription ou la classe, répartition par issue. Une exécution vivante (`liveRunId`) est signalée avec un lien de reprise.
4. **Confirmation** : récapitulatif + case obligatoire « j'ai vérifié l'aperçu » ; le lancement (`POST .../rollover/runs`) porte un en-tête
   `Idempotency-Key` rejoué tel quel après un échec réseau ; si une exécution vivante existe, l'API la renvoie (200) et l'écran la suit.
5. **Suivi** : `PENDING` = « en attente du worker » (on peut quitter la page), barre de progression par étape (`done` / `total`, état, message),
   `FAILED` = message du serveur + « Relancer » (`POST .../retry`, reprise sans doublon), `COMPLETED` = rapport (créés par étape, réinscriptions déjà
   présentes, éléments ignorés, avertissements, anomalies avec liens), bouton « Actualiser ». La relecture automatique s'arrête à la fin.

## Paramètres académiques

Onglets : **Périodes** (types de périodes, plans à lignes de périodes), **Niveaux** (cycles, niveaux : libellés, ordre, niveau suivant, niveau final,
examen terminal), **Statuts et financements** (types de financement, issues de fin d'année par nature ; états d'inscription et d'élève en lecture seule),
**Inscriptions** (politique de confirmation des inscriptions et des cours à la carte, expliquée option par option ; durée de réservation),
**Numérotation** (motif et préfixe du numéro d'inscription ; matricules élève / personnel, doublons, alerte d'expiration, conservation), **Calendrier**
(jours fériés, vacances, fermetures par année, « se répète chaque année », plusieurs jours).

- Les référentiels sont des **upserts par code** : jamais de bouton supprimer, on active / désactive. Chaque envoi ne contient que l'entrée touchée.
- L'aperçu d'un motif de numérotation ne montre que sa **forme** (texte fixe, jetons reconnus et leur sens, jetons inconnus signalés) : aucun numéro n'est
  calculé côté écran. Les accolades littérales des aides sont échappées en ICU (`'{'PREFIX'}'`).
- Cartes empilées (pas de tableaux larges) ; onglets au clavier (flèches, Début, Fin) ; champs étiquetés ; erreurs de champ reliées (`aria-describedby`).
- Les erreurs de contrat sont montrées par champ ; l'erreur serveur (code `academic.*`, `people.*`) l'est toujours par le composant d'erreurs existant.

## Liaisons de règles

Groupées par contrat de calcul (`GET /rules/contracts`) : jeu de règles, périmètre (établissement entier, établissement, **programme** par `curriculumNodeId`
= identifiant du programme académique, niveau par `levelCode`), dates d'effet avec état (en vigueur, à venir, échue). PUT = upsert : à la modification,
contrat, périmètre et date de début sont verrouillés (ils forment la clé) ; pour les changer, créer une nouvelle liaison puis supprimer l'ancienne.
L'alerte « aucune règle active » croise les programmes actifs (contrat du programme, sinon celui de son cycle) avec les liaisons en vigueur ; c'est un
**indicateur de vigilance**, la résolution réelle est celle de l'API.

## Prérequis entre UE

Programme -> année -> version du curriculum, liste des UE (éléments dont le type de nœud porte des crédits ; case « afficher tous les éléments »),
prérequis lus à la demande pour l'UE choisie (`GET .../ue/:nodeId/prerequisites`), édition (`PUT`, corps validé par `higherSetPrerequisitesBodySchema`,
`minAverage` exigé avec le mode « moyenne minimale »), erreurs du serveur affichées (cycle, hors programme, soi-même), inscrits qui ne satisferaient plus
les prérequis signalés après l'enregistrement, contrôle « un étudiant satisfait-il les prérequis » (`GET .../prerequisites-check?nodeId=`).

## « Mon dossier » et fiche enfant

Lecture seule de l'identité, du matricule, de la classe, des coordonnées, du tuteur principal et des inscriptions de l'élève connecté ; ce que l'API n'envoie
pas est masqué (jamais de « null »). **Jamais affichés** : identifiants techniques, référence externe, état du compte de portail, niveau d'accès, dates d'audit.
Seule modification : les coordonnées autorisées (`PATCH /people/me/student`, champs modifiés seulement, champ vidé = `null`). La fiche enfant du parent
(`/v2/students/children/[id]`, existante) n'expose plus le bouton « Corriger » sans `student.child.update`.

## Tests

`pnpm --filter @ecoledigitale/web test` : `Rollover.test.tsx`, `Settings.test.tsx`, `Bindings.test.tsx`, `Prerequisites.test.tsx`, `MyRecord.test.tsx`
(faux client API, réponses validées par les schémas Zod, corps vérifiés à l'octet près, polling avec temps simulé, accès refusé, états chargement / erreur / vide),
`rollover-settings-messages-coverage.test.ts` (libellés des énumérations et espaces de noms).

## Écarts connus et points à arbitrer

- **Suppression d'une liaison de règle** : l'API (`DELETE /rules/bindings/:id`) n'accepte pas de motif ; la confirmation est explicite mais sans motif conservé.
- **Menu du portail** : le menu est piloté par les manifestes d'API (`/api/v1/rbac/me/navigation`) ; les nouvelles routes sont atteignables par les navigations
  de section, mais les entrées de portail (`/v2/academic/rollover`, `/v2/academic/settings`, `/v2/student/me`, `/v2/rules/bindings`,
  `/v2/higher/prerequisites`) sont à déclarer dans les manifestes (ou dans `platform/admin/menu.ts`, `LEGACY_TO_V2_HREF` / `V2_ADMIN_ENTRIES`).
- **Types de personnes** (relations de parenté, catégories de personnel, types de contrat : `PUT /people/reference/*`) : hors de la liste demandée, non livrés.
- **Statuts** d'inscription et d'élève : aucune route de lecture ; libellés pris des énumérations des contrats (lecture seule).
- **Prérequis** : l'API ne propose qu'une lecture par UE (une requête par UE choisie) ; il n'existe pas de vue d'ensemble des prérequis d'un programme.
- **Tuteur principal** dans « Mon dossier » : le lien de parenté n'est pas libellé (le référentiel des liens exige une permission que l'élève n'a pas).
- Pas de smoke Playwright : écrans derrière NextAuth + API réels (couverts par Vitest).

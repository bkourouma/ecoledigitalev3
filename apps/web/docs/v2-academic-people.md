# Écrans v2 : cœur académique et personnes

Routes `/v2/...` (nouvelle arborescence `src/app/v2/`, pages legacy intactes). Tout passe par `platform/api` (client typé, schémas Zod de
`packages/contracts/src/v2/{academic,people}.ts`), `usePermission` / `useFeature` et les gardes serveur ; aucune règle métier ni calcul
côté client (les écrans affichent ce que l'API renvoie et lui transmettent les actions ; les boutons proposés selon l'état sont une simple
affordance, la transition est décidée par le serveur).

| Route | Écran | Permission (page) |
|---|---|---|
| `/v2/academic/years` | années, périodes typées, frise, plan de périodes, ouverture / clôture / réouverture | `academic.year.read` |
| `/v2/academic/programs` | arbre des programmes, niveaux couverts | `academic.program.read` |
| `/v2/academic/curriculum` | éditeur d'arbre (nœuds, coefficients, crédits, prérequis, publication, amendement, clonage avec aperçu) | `curriculum.read` |
| `/v2/academic/classrooms`, `/[id]` | classes, fiche (élèves, enseignants, actions d'état) | `academic.classroom.read` |
| `/v2/academic/offerings` | offres d'une classe, assistant « ouvrir un semestre » (fonction `academic.a-la-carte`) | `academic.classroom.read` |
| `/v2/enrollments`, `/new`, `/[id]` | liste filtrable, assistant, fiche (historique, transfert, financement, cours) | `enrollment.read` / `.create` |
| `/v2/students`, `/new`, `/[id]` | liste, création (doublons), fiche à onglets | `student.list` ou `student.class.read` |
| `/v2/students/children`, `/[id]` | « mes enfants » (parent) | `student.child.read` |
| `/v2/guardians`, `/[id]` | tuteurs | `guardian.read` |
| `/v2/staff`, `/new`, `/[id]`, `/me` | personnel, fiche à onglets, espace enseignant | `staff.read` / `.create` / `staff.own.read` |
| `/v2/staff/assignments` | matrice matière × rôle par classe, vue par enseignant | `teaching.read` |

## Organisation

- `src/platform/ui/` : composants partagés (`DataTable`, `SelectAsync`, `FormField` + `validateWith`, `TreeEditor`, `Wizard`, `ModalDialog` /
  `ReasonDialog` / `FormDialog`, états de chargement / erreur / vide, `SectionNav`, `Can` / `Feature`).
- `src/platform/v2/` : hooks typés `academic.ts`, `people.ts`, `lookups.ts` (sources de `SelectAsync`), `actions.ts` (mutations avec corps distinct
  des variables, les contrats d'entrée étant `strict()`).
- `src/app/v2/<section>/_components` : écrans ; `page.tsx` = garde serveur (`requirePermission`, ou `requireAnyPermission` pour « l'une ou l'autre »).
- `layout.tsx` de chaque section : habillage TEMPORAIRE (session + navigation de section) tant que `app/v2/layout.tsx` n'existe pas.
- i18n : espaces de noms `v2Ui`, `v2Academic`, `v2Enrollments`, `v2Students`, `v2Guardians`, `v2Staff` ; `src/app/v2/messages-coverage.test.ts`
  vérifie que chaque clé statique et chaque énumération a sa traduction.

## Tests

`pnpm --filter @ecoledigitale/web test` (Vitest + Testing Library). Les écrans sont testés contre un faux client API
(`platform/test/api-mock.ts`, `render.tsx`) : les réponses sont validées par les vrais schémas Zod, les corps envoyés sont vérifiés à l'octet près.

Playwright : pas de parcours de fumée ajouté. Les écrans exigent une session NextAuth, le RBAC et l'API v2 (Postgres + Redis) ; le fumet PWA
existant (`playwright.pwa.config.ts`) tourne sans infrastructure et n'est pas adapté. À écrire avec l'infra complète : inscription d'un élève
(`/v2/enrollments/new`), publication d'un curriculum, affectation d'un enseignant.

## Écarts connus

- Glisser-déposer du curriculum : remplacé par des actions accessibles (déplacer vers un parent, monter / descendre).
- Documents / pièces de l'élève : message d'indisponibilité (aucun fournisseur de stockage dans la plateforme).
- Fusion de dossiers en double : non disponible côté API (O-07) ; avertissement et confirmation motivée uniquement.
- Statut des frais d'inscription : politique de confirmation et état affichés ; le détail des paiements relève de Finance.
- « Mon dossier » (élève) et disponibilités propres de l'enseignant : l'API n'expose pas la lecture de ses propres disponibilités sans `staff.read`.
- Reconduction annuelle et paramètres académiques / référentiels : hors périmètre de cette livraison.

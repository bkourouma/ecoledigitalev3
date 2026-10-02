# Écrans v2 : pilotage de la direction et du propriétaire

Routes `/v2/direction/*` et `/v2/owner/*` (arborescence `src/app/v2/`, **pages legacy `/owner/*` intactes**). Tout passe par `platform/api` (client typé `platform/v2/analytics.ts`, schémas Zod de `packages/contracts/src/v2/analytics.ts`), `usePermission` / `useFeature` et les gardes serveur. **Aucun calcul de moyenne, de taux, de rang, de solde ni de décision côté client** : les écrans affichent ce que l'API a lu des read-models du module `analytics` (spec `specs/v2/025-analytics/`).

## Règles de présentation

- **Fraîcheur** : chaque écran affiche « Données au JJ/MM à HH:MM » (`meta.asOf`), une alerte quand `meta.stale`, et la liste des **manques** déclarés (`meta.gaps` : source jamais lue, non branchée, en échec, module absent).
- **« Non mesuré » ≠ 0** : un indicateur sans mesure (`measured: false`, taux `null`, source absente) affiche « Non mesuré », jamais 0 ni 0 %.
- **L'état se dit en toutes lettres** : « Bon », « À surveiller », « Critique », « Non évalué » (jamais la couleur seule). Les seuils viennent de l'API (réglages d'affichage de l'établissement).
- **Montants** : entiers (F CFA), `useMoney()` ; **taux** : points de base mis en forme par `useMoney().bps`.
- **Graphiques accessibles** (`owner/_components/charts.tsx`) : `<figure>` nommé, valeurs en texte dans chaque ligne, `role="img"` + résumé pour les colonnes SVG, **alternative tableau** (`<details>`) avec les mêmes données ; couleurs du thème (clair et sombre). La proportion des barres est un calcul de présentation (plus grande valeur = 100 %).
- **Mobile-first** : colonnes secondaires masquées sous `md`, tableaux défilants, cibles tactiles de 44 px (briques `platform/ui`).

## Routes

| Route | Écran | Permission (page) | Données |
|---|---|---|---|
| `/v2/direction` | tableau de bord : effectifs, présence du jour, moyenne générale, validation, enseignants présents, scolarité recouvrée, créances | `analytics.read` (+ `analytics.finance.read` pour la partie financière, demandée seulement si détenue) | `overview`, `finance/summary` |
| `/v2/direction/effectifs` | effectifs, répartitions (statut, sexe, niveau, financement, campus, classe), redoublants, admissions, présences élèves et personnel | `analytics.read` (+ `analytics.attendance.read` pour les présences) | `enrollment`, `attendance` |
| `/v2/owner/pedagogie` | résultats FINAL par classe, matière, période ; distribution ; décisions ; charge d'enseignement | `analytics.pedagogy.read` | `pedagogy/results`, `pedagogy/teaching-load` |
| `/v2/owner/scolarite` | facturé, encaissé, restant dû, recouvrement ; créances par classe et par apprenant | `analytics.finance.read` | `finance/summary`, `finance/receivables` |
| `/v2/owner/tresorerie` | encaissements, créances âgées, écarts de caisse | `analytics.treasury.read` | `treasury/*` |
| `/v2/owner/paie` | masse salariale par période et statut (sensible : MFA, lecture auditée) | `analytics.payroll.read` + feature `analytics.payroll-insights` | `payroll/mass` |
| `/v2/owner/charges` | charges et résultat : **module absent**, le manque est dit | `analytics.charges.read` | `charges` |
| `/v2/owner` | fraîcheur de chaque source, file de mise à jour, reconstruction à la demande, réglage des seuils de lecture et du délai de fraîcheur | `analytics.read` (+ `analytics.rebuild`, `analytics.settings.manage`) | `freshness`, `rebuild`, `settings` |

Filtres (`_components/kit.tsx`, `ScopeFilters`) : établissement, campus, année, période, classe ; les valeurs vides ne sont pas envoyées (l'API choisit l'année courante et la dernière période clôturée) ; les listes se restreignent au périmètre de l'utilisateur.

Exports : `ExportButton` appelle `GET /analytics/export/<jeu>.csv` (CSV **produit par l'API**, audité) et l'enregistre tel quel ; le BOM UTF-8 retiré par `fetch().text()` est remis ; bouton masqué sans `analytics.export`.

## Organisation

- `src/platform/v2/analytics.ts` : hooks typés, `scopeQuery`.
- `src/app/v2/owner/_components/` : `kit.tsx` (navigation, filtres, fraîcheur, cartes, export, garde de fonctionnalité), `charts.tsx`, écrans `Pedagogy`, `Finance` (scolarité, trésorerie), `PayrollCharges` (paie, charges, fraîcheur) ; `src/app/v2/direction/_components/` : `Dashboard`, `Enrollment`.
- `page.tsx` = garde serveur (`requirePermission`) ; `layout.tsx` = session + navigation.
- i18n : espaces de noms `v2Owner` et `v2Direction` ; `src/app/v2/owner/messages-coverage.test.ts` vérifie chaque clé statique et chaque énumération.

## Tests

`pnpm --filter @ecoledigitale/web test` (Vitest + Testing Library, faux client API validant les réponses avec les vrais schémas Zod et consignant les paramètres envoyés). Couvert : montants et taux formatés, état en texte, « Non mesuré » et manques déclarés, données périmées, filtres transmis sans valeurs vides, créances par apprenant, export (BOM, nom de fichier, permission), absence de requête sans permission ni fonctionnalité, erreurs de l'API (dont MFA exigée), alternative tableau des graphiques.

## Écarts connus

- Pas de smoke Playwright (les gardes serveur exigent NextAuth + API) ; parité fonctionnelle et manques : `specs/v2/025-analytics/parity.md`.
- PDF du rapport financier non repris (CSV seulement).

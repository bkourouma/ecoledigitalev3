# Diplômes Professionnels — Document de besoin métier

> **Public cible** : l'agent IA chargé d'implémenter la feature `029-professional-diplomas` dans le code existant d'EcoleDigitale (`apps/api`, `apps/web`, `packages/contracts`, `infra/scripts/migrations`), avec relecture humaine.
> **Statut** : v1 — décisions D1–D11 validées (voir §3).
> **Périmètre** : extension **additive** du Module Professionnel (feature `028`), **sans casser** `028`, le module académique classique, ni les autres modules.
> **Référence** : spécification fonctionnelle `specs/029-professional-diplomas/spec.md` ; conception `specs/029-professional-diplomas/` (`plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`).

---

## 1) Contexte

Le Module Professionnel (`028`) permet aux étudiants de s'inscrire **à la carte** à des matières professionnelles et de mener leurs inscriptions jusqu'au statut final **`terminee`**. Aujourd'hui, rien ne **capitalise** ces achèvements : un étudiant accumule des matières terminées sans qu'aucune **qualification globale** ne soit reconnue.

La feature **Diplômes Professionnels** comble ce manque :

- Un **administrateur** définit des **diplômes** rattachés à **un programme**.
- Chaque diplôme exige qu'un étudiant valide un certain **nombre d'UV** réparties sur un **ensemble de matières précises** du programme.
- Certaines matières exigées peuvent être déclarées **obligatoires**.
- Le système **détecte automatiquement** l'éligibilité d'un étudiant à chaque achèvement d'inscription et lui **octroie** le diplôme.
- L'administrateur garde un **contrôle manuel** : octroi (y compris forcé), révocation motivée, recalcul de masse.
- L'**étudiant** visualise sa progression précise ; le **parent** consulte les diplômes de son enfant en lecture seule.

---

## 2) Glossaire

| Terme | Définition dans cette feature |
|---|---|
| **Diplôme professionnel** | Qualification définie par l'établissement, rattachée à **un** programme, exigeant un cumul d'UV sur un ensemble de matières. |
| **Exigence** | Élément de la liste des matières requises par un diplôme : une matière + un drapeau « obligatoire » + un ordre d'affichage. |
| **UV** | Unité de Valeur (crédit académique) portée par chaque matière professionnelle (`professional_subjects.nb_uv`). Base du calcul d'éligibilité. |
| **Matière validée** | Matière pour laquelle l'étudiant possède **au moins une** inscription `028` au statut `terminee` (granularité matière, pas session — D1). |
| **Éligibilité** | État d'un étudiant satisfaisant **toutes** les conditions d'un diplôme (matières obligatoires + cumul d'UV). |
| **Octroi** | Reconnaissance d'un diplôme à un étudiant. Automatique (déclenché par l'achèvement) ou manuel (admin). |
| **Snapshot** | Instantané JSONB des exigences figé au moment de l'octroi, pour traçabilité. |
| **Attestation** | Représentation structurée des données d'un diplôme obtenu. Rendu PDF = Phase 2 (D9). |

---

## 3) Décisions métier (Decision Log — appliquées par défaut)

| # | Question | Décision retenue |
|---|---|---|
| **D1** | Granularité des exigences. | **Niveau matière** (pas session). Une matière compte dès que l'étudiant a ≥ 1 inscription `terminee` sur cette matière. |
| **D2** | Matières obligatoires. | Drapeau `est_obligatoire` par exigence. Si `true` : la matière doit être terminée pour obtenir le diplôme. Si `false` : elle compte seulement dans le total d'UV. |
| **D3** | Cumul d'UV. | Somme des UV des matières exigées **distinctes** terminées par l'étudiant. Doit être ≥ `uv_required`. |
| **D4** | Octroi. | **Automatique** dès la détection d'éligibilité (hook sur transition d'inscription → `terminee`). Octroi/révocation **manuels** par l'admin également possibles. |
| **D5** | Snapshot. | Au moment de l'octroi, instantané JSONB des exigences. Modifier le diplôme ensuite ne révoque **pas** les diplômes déjà octroyés. |
| **D6** | Référence. | `DIP-{année}-{séquence}`, unique par établissement. |
| **D7** | Programme. | Un diplôme appartient à **un** programme. Toutes ses exigences portent sur des matières du **même** programme. |
| **D8** | Lecture parent. | Lecture seule des diplômes de l'enfant. |
| **D9** | Attestation PDF. | **Hors périmètre MVP**. Le MVP expose les données structurées de l'attestation ; le rendu PDF est Phase 2. |
| **D10** | Multi-tenant. | Toutes les tables portent `tenant_id` + RLS, patron identique à `028`. |
| **D11** | Statut `en_cours`. | Réservé à un futur cas d'usage de pré-création. **MVP** : aucune ligne d'octroi tant que le diplôme n'est pas obtenu ; la progression est calculée à la volée. |

---

## 4) Modèle de données (résumé)

3 nouvelles tables (migration `0064_professional_diplomas.sql`, RLS multi-tenant) — détail complet dans `data-model.md` :

- **`professional_diplomas`** — diplôme : `programme_id`, `code` (unique/tenant), `libelle`, `description`, `uv_required` (> 0), `statut` (`actif`/`inactif`), `created_by`.
- **`professional_diploma_requirements`** — exigence : `diploma_id` (CASCADE), `subject_id`, `est_obligatoire`, `ordre` ; unique `(diploma_id, subject_id)`.
- **`student_professional_diplomas`** — octroi : `diploma_id`, `student_id`, `reference` (unique/tenant), `statut` (`en_cours`/`obtenu`/`revoque`), `uv_total_validees`, `requirements_snapshot` (JSONB), dates et auteurs d'octroi/révocation, `motif_revocation`. Un seul octroi non révoqué par couple `(diploma_id, student_id)`.

Aucune table existante n'est modifiée. Les concepts de programme, matière (`professional_subjects`) et inscription `terminee` (`professional_enrollments`) sont réutilisés tels quels depuis `028`.

---

## 5) Règles métier

1. **Programme cohérent** : toute matière d'une exigence doit appartenir au programme du diplôme → sinon `CROSS_PROGRAMME_REQUIREMENT` (422).
2. **Code unique par tenant** → `DUPLICATE_DIPLOMA_CODE` (409).
3. **`uv_required` > 0** → sinon `VALIDATION_ERROR` (422).
4. **Éligibilité** : (a) toutes les matières `est_obligatoire = true` ont une inscription `terminee` ; **et** (b) la somme des UV des matières exigées distinctes terminées ≥ `uv_required`.
5. **Octroi unique** : un seul `student_professional_diplomas` non révoqué par couple (étudiant, diplôme).
6. **Diplôme inactif** : plus d'octroi automatique ; les diplômes déjà obtenus restent valides.
7. **Suppression** : refusée (`DIPLOMA_HAS_AWARDS`, 409) s'il existe un octroi non révoqué ; sinon CASCADE sur les exigences.
8. **Modification des exigences** : autorisée à tout moment ; les diplômes octroyés conservent leur snapshot ; les étudiants en cours sont réévalués à la prochaine inscription terminée.
9. **Révocation** : admin uniquement, motif obligatoire ; statut `revoque` terminal ; un nouvel octroi redevient possible ensuite.
10. **Vérifications serveur** : toutes les règles appliquées côté API, pas seulement côté UI.
11. **Isolation multi-tenant** : RLS sur toutes les requêtes.
12. **Robustesse du hook** : une défaillance du recalcul de diplômes ne doit jamais empêcher ni annuler l'achèvement d'une inscription `028`.

---

## 6) Machine à états — `student_professional_diplomas.statut`

```text
(octroi automatique ou manuel) → obtenu
                                    │
                                    └─→ revoque  (admin only, motif requis, terminal)
```

Le statut `en_cours` est réservé à la Phase 2 (D11). Au MVP, aucune ligne n'est créée tant que le diplôme n'est pas `obtenu` ; la progression d'un étudiant non titulaire est calculée à la volée à partir de ses inscriptions et des exigences courantes.

---

## 7) API (préfixe `/api/v1/professional`)

Détail complet dans `contracts/diplomas-api.md`.

- **Admin** (`requireAdmin`) : `GET/POST /diplomas`, `GET/PATCH/DELETE /diplomas/:id`, `GET/PUT /diplomas/:id/requirements`, `GET /diplomas/:id/awarded`, `POST /diplomas/:id/award`, `POST /diplomas/:id/revoke`, `POST /diplomas/:id/recompute`.
- **Étudiant** (`requireStudent`) : `GET /student/diplomas`, `GET /student/diplomas/:id/progress`, `GET /student/diplomas/:id/attestation`.
- **Parent** (`requireParent`, lecture seule) : `GET /parent/diplomas?child_id=`.
- **Enseignant** : aucun accès.

Codes d'erreur normalisés : `DIPLOMA_NOT_FOUND` (404), `DUPLICATE_DIPLOMA_CODE` (409), `CROSS_PROGRAMME_REQUIREMENT` (422), `DIPLOMA_HAS_AWARDS` (409), `DIPLOMA_ALREADY_AWARDED` (409), `DIPLOMA_NOT_ELIGIBLE` (422), `DIPLOMA_NOT_AWARDED` (404), `INVALID_DIPLOMA_STATUS_TRANSITION` (422).

---

## 8) Écrans web (Next.js 15 App Router)

- **Admin** — `professionnel/admin/diplomes/` : liste (filtres programme/statut/recherche), création, détail, édition, éditeur d'exigences (matières du programme, drapeau obligatoire, total UV en live).
- **Étudiant** — `professionnel/etudiant/diplomes/` : mes diplômes (cards, % d'avancement), progression détaillée (barre de progression, compteur `X / Y UV`, listes validées/à valider).
- **Parent** — `parent/professionnel/diplomes/` : sélection enfant + affichage lecture seule.

Réutilisation des composants et patterns visuels de `028` (tables shadcn, formulaires Zod + react-hook-form, hooks TanStack Query).

---

## 9) Hors périmètre (Phase 2)

- Rendu PDF de l'attestation (MVP : données structurées uniquement).
- Notification email/SMS à l'étudiant lors de l'octroi.
- Validation des prérequis par seuil de note.
- Diplômes multi-programmes (un diplôme = un programme au MVP).
- Versioning des exigences avec migration des étudiants en cours.
- Tableau de bord analytique des diplômes obtenus.

---

## 10) Critères d'acceptation (definition of done)

- Migration `0064` appliquée sans erreur sur une base avec données `028` existantes.
- RLS active et testée (impossible de lire/écrire un diplôme d'un autre tenant).
- Tous les endpoints répondent avec les codes d'erreur normalisés.
- Un admin peut créer un diplôme, ajouter des exigences, désactiver et supprimer (si pas d'octroi).
- À la transition d'une inscription vers `terminee`, les diplômes éligibles sont créés automatiquement, sans doublon.
- Un étudiant voit sa progression précise (UV cumulées, % d'avancement, matières manquantes).
- Un parent ne voit que les données de son enfant.
- Un enseignant n'a aucun accès aux endpoints diplômes.
- `pnpm --filter @ecoledigitale/api exec jest professional` passe ≥ 100 tests verts (72 existants + nouveaux).
- Aucun écran existant du module `028` n'est cassé (non-régression catalogue / panier / inscription).

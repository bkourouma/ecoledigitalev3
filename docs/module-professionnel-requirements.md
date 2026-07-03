# Module Professionnel — Document de spécifications pour intégration

> **Public cible de ce document** : l'agent IA chargé d'implémenter le module dans le code existant d'EcoleDigitale (`apps/api`, `apps/web`, `packages/contracts`, `infra/scripts/migrations`), avec relecture humaine.
> **Statut** : v1 — à valider (voir §3 *Décisions d'architecture*).
> **Périmètre** : ajout d'un module **sans casser** le module académique « classique » existant ni le module « formations professionnelles » existant.

---

## 1) Contexte

EcoleDigitale gère aujourd'hui une scolarité **académique classique** (BTS / post-BTS) :

- L'étudiant s'inscrit à un **programme**.
- Il paie un **prix forfaitaire** pour l'ensemble du programme.
- Il suit, **en cohorte**, les mêmes cours que les autres au même moment.

Le **Module Professionnel** introduit un mode **à la carte** :

- L'offre est **organisée par programme** : chaque matière appartient à un **programme**. L'étudiant **choisit d'abord un programme**, puis les **matières** de ce programme.
- Chaque **matière** porte une **valeur en UV** et un **prix propre**.
- Chaque matière est proposée via des **sessions datées** (date de début / date de fin), appelées **cours**.
- Une matière peut avoir des **prérequis** : une ou plusieurs matières à valider **avant** de pouvoir s'y inscrire.
- À l'inscription, l'étudiant **choisit librement** les cours qu'il veut suivre, **dans la limite des prérequis satisfaits**.
- Le **montant à payer = somme des montants des matières choisies**.
- L'étudiant peut s'inscrire à **n'importe quelle matière, à n'importe quel moment**, dès lors qu'une **session est disponible** et que les **prérequis sont satisfaits**. Il n'y a **pas de cohorte** : chacun a son propre parcours.

---

## 2) Glossaire (vocabulaire imposé)

| Terme | Définition dans ce module |
|---|---|
| **Programme** | Regroupement métier des matières. L'étudiant choisit un programme **avant** d'accéder aux matières. Réutilise la table `programmes` existante (voir **D8**). |
| **Matière professionnelle** | Unité d'enseignement vendue à la carte, **rattachée à un programme**. Porte un **code**, un **libellé**, un **nombre d'UV** et un **prix**. |
| **Prérequis** | Matière(s) qu'un étudiant doit avoir **validée(s)** avant de pouvoir s'inscrire à une matière donnée (voir **D9** pour la définition de « validée »). |
| **Session / Cours professionnel** | Instance datée d'une matière (`date_debut`, `date_fin`) ouvrant à l'inscription pendant une **fenêtre d'inscription**, avec une **capacité** et un **enseignant**. C'est ce que l'utilisateur appelle « le cours ». |
| **Panier / Commande** | Regroupement des matières sélectionnées en une seule fois par un étudiant, donnant lieu à **un paiement**. |
| **Inscription professionnelle** | Lien confirmé entre un étudiant et **une session**, débloquant l'accès au contenu pédagogique. |
| **UV** | Unité de Valeur (crédit académique). **Information académique** ; n'est pas, par défaut, la base de calcul du prix (voir D2). |

> ⚠️ **Ne pas confondre** avec le module **« Formations professionnelles »** déjà présent (`formations_professionnelles`, `sessions_professionnelles`, `inscriptions_professionnelles`, `paiements_professionnels`, `formateurs`, endpoints `/formations-pro`, `/sessions-pro`, …). Ce sont **deux modules distincts**. Voir **D1**.

---

## 3) Décisions d'architecture à valider (Decision Log)

Ces points conditionnent l'implémentation. Les recommandations ci-dessous sont **appliquées par défaut dans le reste du document** ; toute modification doit être répercutée globalement.

| # | Question | Recommandation appliquée | Alternative |
|---|---|---|---|
| **D1** | Collision de nommage avec le module « formations professionnelles » existant. | **Espace de noms dédié et distinct** : tables préfixées `professional_*`, endpoints sous `/api/v1/professional/*`. Aucun réemploi des tables `*_professionnelles` ni des routes `/…-pro`. | Fusionner avec le module existant (déconseillé : sémantique différente — crédits UV, rattachement académique). |
| **D2** | Le prix d'une matière est-il **saisi explicitement** ou **dérivé des UV** ? | **Prix explicite** stocké sur la matière (`prix`), `nb_uv` purement académique. Optionnel : config tenant `prix_par_uv` servant uniquement de **valeur suggérée** à la saisie. | Prix calculé = `nb_uv × prix_par_uv` (rigide ; à éviter au MVP). |
| **D3** | Réutiliser l'infrastructure pédagogique/financière existante (présences, supports, notes, reçus) ou créer des tables parallèles ? | **Réutiliser** : présences, supports de cours, notes et reçus sont rattachés à la **session professionnelle** via les mécanismes existants. On n'ajoute que ce qui est structurellement nouveau (matière à la carte, session datée, inscription à la carte, facturation par matière). | Pile pédagogique/finance dupliquée (déconseillé : dette technique). |
| **D4** | Modèle de paiement. | **Panier → 1 commande → 1 paiement**. L'étudiant peut revenir plus tard pour une **nouvelle commande** (nouvelles matières). Échéanciers / remboursements = **Phase 2**. | Paiement strictement par matière, ou échéancier dès le MVP. |
| **D5** | Un étudiant peut-il être simultanément en parcours classique **et** professionnel ? | **Oui.** Le même `user`/`student_profile` peut avoir des inscriptions classiques (`enrollments`) **et** professionnelles (`professional_enrollments`), indépendantes. | Cloisonnement strict (déconseillé : limite l'usage métier). |
| **D6** | Qui enseigne les sessions professionnelles ? | **`teachers`** (rôle `teacher`), cohérent avec le caractère académique BTS/post-BTS et la réutilisation D3. | Réutiliser `formateurs` (réservé au module formations-pro). |
| **D7** | Politique RLS / contexte tenant des nouvelles tables. | **Calquer exactement** le patron des migrations existantes (`tenant_id` + RLS activée + policy d'isolation identique aux tables sensibles actuelles). Ne pas inventer un nouveau mécanisme. | — |
| **D8** | Le « programme » du module professionnel : nouvelle table ou réutilisation de `programmes` ? | **Réutiliser la table `programmes` existante** (`professional_subjects.programme_id` → `programmes.id`). Le catalogue professionnel ne fait **remonter que les programmes ayant ≥ 1 matière professionnelle inscriptible** : aucun changement sur `programmes`, pas de pollution du parcours classique. | Table dédiée `professional_programs` (duplication du concept programme ; à éviter). |
| **D9** | Définition de « prérequis validé ». | Au MVP : un prérequis est satisfait si l'étudiant possède une `professional_enrollment` de la matière prérequise avec **`statut = terminee`**. La validation par **note/seuil** est renvoyée en Phase 2. | Accepter `confirmee` (inscription suffit, sans achèvement) — moins strict ; à activer via config si besoin. |

---

## 4) Modèle de données

Toutes les tables ci-dessous : colonne `tenant_id` obligatoire, **RLS activée**, policy d'isolation identique au patron existant (D7), `created_at`/`updated_at`, soft-delete si c'est la convention du projet.

### 4.1 `professional_subjects` — Matière professionnelle
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `programme_id` | fk programmes | **obligatoire** — rattachement au programme (D8) |
| `code` | text | **unique par tenant** |
| `libelle` | text | obligatoire |
| `description` | text | optionnel |
| `nb_uv` | int/numeric | ≥ 0, information académique |
| `prix` | numeric | ≥ 0, en **FCFA** (devise par défaut tenant) |
| `statut` | enum | `actif` \| `inactif` (une matière inactive n'accepte plus de nouvelles sessions ouvertes) |

### 4.2 `professional_subject_sessions` — Session / Cours
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `professional_subject_id` | fk professional_subjects | |
| `libelle` | text | ex. « Session Janvier 2026 » |
| `date_debut` | date | obligatoire |
| `date_fin` | date | `date_fin >= date_debut` |
| `inscription_ouverte_le` | date/timestamptz | début fenêtre d'inscription |
| `inscription_fermee_le` | date/timestamptz | `>= inscription_ouverte_le` |
| `capacite_max` | int | nullable = illimité ; sinon > 0 |
| `enseignant_id` | fk teachers | optionnel au MVP (D6) |
| `classroom_id` | fk classrooms | optionnel (réutilisation D3) |
| `statut` | enum | `brouillon` \| `ouvert` \| `complet` \| `en_cours` \| `termine` \| `annule` |

### 4.3 `professional_orders` — Commande / Panier
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `student_id` | fk users / student_profiles | conforme au modèle étudiant existant |
| `reference` | text | unique par tenant, lisible (ex. `PRO-2026-000123`) |
| `montant_total` | numeric | = Σ `professional_enrollments.prix_unitaire` de la commande |
| `devise` | text | FCFA par défaut |
| `statut` | enum | `brouillon` (panier) \| `en_attente_paiement` \| `payee` \| `annulee` |

### 4.4 `professional_enrollments` — Inscription (ligne de commande)
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `order_id` | fk professional_orders | |
| `student_id` | fk users / student_profiles | dénormalisé pour requêtes |
| `session_id` | fk professional_subject_sessions | |
| `prix_unitaire` | numeric | figé = prix de la matière au moment de l'ajout au panier |
| `statut` | enum | `en_attente_paiement` \| `confirmee` \| `annulee` \| `terminee` |
| | | **Unicité** : `(tenant_id, student_id, session_id)` quand `statut ≠ annulee` |

### 4.5 `professional_payments` — Paiement
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `order_id` | fk professional_orders | 1 paiement par commande au MVP (D4) |
| `montant` | numeric | = `montant_total` de la commande |
| `mode` | enum | `especes` \| `mobile_money` \| `virement` \| `autre` (aligner sur l'existant finance) |
| `reference_transaction` | text | idempotence |
| `statut` | enum | `initie` \| `confirme` \| `echoue` \| `rembourse` (remboursement = Phase 2) |
| `paid_at` | timestamptz | |

> **Reçus / rapports** : réutiliser `receipts` et `financial_reports` existants en y rattachant le `professional_payment` (D3). Créer `professional_receipts` uniquement si le modèle `receipts` est incompatible.

### 4.6 `professional_subject_prerequisites` — Prérequis entre matières
| Champ | Type | Règle |
|---|---|---|
| `id` | uuid/pk | |
| `tenant_id` | fk tenants | RLS |
| `professional_subject_id` | fk professional_subjects | la matière **qui exige** un prérequis |
| `prerequisite_subject_id` | fk professional_subjects | la matière **prérequise** |
| | | **Unicité** : `(tenant_id, professional_subject_id, prerequisite_subject_id)` |
| | | **Contraintes** : `professional_subject_id ≠ prerequisite_subject_id` ; les deux matières du **même programme** (cohérent avec D8) ; **interdiction de cycle** dans le graphe de prérequis (validation applicative). |

> Une matière peut avoir **0, 1 ou plusieurs** prérequis ; tous doivent être satisfaits (logique **ET**).

### 4.7 Réutilisation (pas de nouvelles tables — D3)
- **Présences** : rattacher l'appel à `session_id` (table de présence existante).
- **Supports de cours** : rattacher les supports à la session professionnelle via `/courses/*/materials` ou équivalent.
- **Notes / évaluations** : rattacher les notes à la session professionnelle via le mécanisme d'évaluation existant.
- **Relevé par UV capitalisées** : **Phase 2** (édition d'un relevé listant les matières validées et le cumul d'UV).

---

## 5) Règles métier

1. **Éligibilité à l'inscription** — une session est inscriptible si **toutes** les conditions sont vraies (validées **côté serveur**, pas seulement en UI) :
   - `statut = ouvert`
   - `now ∈ [inscription_ouverte_le, inscription_fermee_le]`
   - `capacite_max` nulle **ou** `nb_inscriptions_actives < capacite_max`
   - l'étudiant n'a pas déjà une inscription non annulée sur cette session
   - **tous les prérequis** de la matière sont **satisfaits** par l'étudiant (voir règle 2 et D9)
2. **Prérequis** : pour chaque ligne de `professional_subject_prerequisites` de la matière visée, l'étudiant doit posséder une `professional_enrollment` de la matière prérequise au statut `terminee` (D9). Si un seul prérequis manque, l'ajout au panier et l'inscription sont **refusés** (logique **ET**). Contrôle **côté serveur** au moment de l'ajout au panier **et** revérifié à la validation de la commande.
3. **Sélection par programme** : le catalogue est filtré par **programme** ; un panier peut contenir des matières de **plusieurs programmes**, mais chaque matière reste rattachée à son programme d'origine.
4. **Calcul du montant** : `professional_orders.montant_total = Σ` des **montants** (`prix_unitaire`) des matières choisies ; `prix_unitaire` est **figé** au moment de l'ajout au panier (un changement de prix de la matière n'impacte pas les commandes existantes).
5. **Cycle de vie d'une commande** :
   `brouillon` → (validation panier) → `en_attente_paiement` → (paiement confirmé) → `payee`.
   À `payee`, toutes ses `professional_enrollments` passent `en_attente_paiement → confirmee`.
6. **Accès au contenu pédagogique** : conditionné par `professional_enrollments.statut = confirmee`.
7. **Achèvement** : le passage d'une inscription à `terminee` (manuel admin/enseignant au MVP, ou en fin de session — D9) débloque les matières qui en dépendent comme prérequis.
8. **Capacité** : passage automatique de la session à `complet` quand la capacité est atteinte ; retour à `ouvert` si une place se libère (annulation) et que la fenêtre est encore valide.
9. **Pas de cohorte** : aucun planning partagé imposé ; chaque étudiant a son ensemble de sessions selon ses choix.
10. **Indépendance des parcours** (D5) : les inscriptions professionnelles n'interfèrent pas avec `enrollments` classiques.
11. **Annulation** : annulation possible tant que le paiement n'est pas confirmé. Remboursement après paiement = **Phase 2** (politique à définir, non implémentée au MVP).
12. **Multi-tenant** : toute lecture/écriture filtrée par `tenant_id` + RLS ; en-tête `X-Tenant` obligatoire (convention existante).

---

## 6) Parcours utilisateurs

**Administration (`admin`)**
1. Créer/éditer des matières en les **rattachant à un programme** (`programme_id`, `code`, `libellé`, `nb_uv`, `prix`).
2. Définir les **prérequis** d'une matière (0..n matières du même programme), sans créer de cycle.
3. Créer des sessions pour une matière (dates, fenêtre d'inscription, capacité, enseignant, salle).
4. Faire passer une session `brouillon → ouvert` ; marquer une inscription `terminee` (débloque les matières dépendantes).
5. Suivre inscrits, paiements, taux de remplissage ; éditer les reçus / rapports financiers (réutilisation D3).

**Étudiant (`student`)**
1. **Choisir un programme** parmi ceux ayant une offre professionnelle inscriptible.
2. Parcourir les **matières du programme** : sessions inscriptibles, prix, UV, et **état des prérequis** (satisfait / manquant).
3. Ajouter au **panier** uniquement les matières dont les **prérequis sont satisfaits** (les autres sont visibles mais **verrouillées**, avec la liste des prérequis manquants).
4. Valider le panier → `en_attente_paiement`, **somme des montants** affichée.
5. **Payer** → inscriptions `confirmee`, reçu disponible.
6. Accéder aux supports / présences / notes des matières confirmées.
7. Revenir plus tard pour une **nouvelle commande** (autres matières / autres programmes).

**Enseignant (`teacher`, D6)** — voir ses sessions professionnelles, faire l'appel, déposer des supports, saisir des notes (mécanismes existants).

**Parent (`parent`)** — consulter les inscriptions et paiements professionnels de l'enfant (lecture seule).

---

## 7) API — endpoints à créer

Base : `/api/v1`. Conventions existantes obligatoires : `X-Tenant`, `Authorization: Bearer <jwt>`, validation zod, RLS, blacklist de tokens.

**Catalogue / administration**
- `GET|POST /professional/subjects`
- `GET|PATCH|DELETE /professional/subjects/:id`
- `GET|PUT /professional/subjects/:id/prerequisites` (liste / définition des prérequis ; rejette les cycles et les matières hors programme)
- `GET|POST /professional/subjects/:id/sessions`
- `GET|PATCH /professional/sessions/:id`
- `POST /professional/sessions/:id/status` (transitions d'état contrôlées)
- `POST /professional/enrollments/:id/complete` (marquer `terminee` — admin/enseignant, D9)
- `GET /professional/enrollments` (vue admin, filtres : programme, session, matière, étudiant, statut)
- `GET /professional/payments` (vue admin)

**Espace étudiant**
- `GET /student/professional/programmes` — programmes ayant ≥ 1 matière professionnelle inscriptible (D8)
- `GET /student/professional/catalog?programme_id=…` — matières du programme + sessions **inscriptibles** + **état des prérequis** par matière (`satisfait` / liste des prérequis manquants)
- `GET|POST /student/professional/cart` — panier (commande `brouillon`) : ajouter/retirer des sessions (refuse si prérequis non satisfaits)
- `POST /student/professional/orders` — valider le panier → `en_attente_paiement` (revérifie prérequis + éligibilité)
- `POST /student/professional/orders/:id/payment` — déclencher/confirmer le paiement (idempotent)
- `GET /student/professional/enrollments` — mes inscriptions et leur statut
- `GET /student/professional/receipts/:id` — reçu (réutilisation `/receipts` si possible)

**Espace parent**
- `GET /parent/professional/enrollments`
- `GET /parent/professional/payments`

**Espace enseignant** — réutiliser les routes existantes (`/teacher/...`) en exposant les sessions professionnelles parmi les cours de l'enseignant (D3/D6).

> ⚠️ **Ne pas réutiliser** `/formations-pro`, `/sessions-pro`, `/inscriptions-pro`, `/paiements-pro` (module distinct, D1).

---

## 8) Contrats partagés (`packages/contracts/src`)

Ajouter les schémas zod et types correspondants :
- `ProfessionalSubject` (avec `programme_id`), `CreateProfessionalSubject`, `UpdateProfessionalSubject`
- `ProfessionalSubjectPrerequisites` (liste de `prerequisite_subject_id`), `SetPrerequisites`
- `ProfessionalSession`, `CreateProfessionalSession`, `UpdateProfessionalSession`, `SessionStatusTransition`
- `ProfessionalCartItem`, `ProfessionalOrder`, `ProfessionalEnrollment`
- `ProfessionalPayment`, `ProfessionalProgrammeOption`, `ProfessionalCatalogItem` (vue étudiant agrégée, incluant `prerequisites_status`)

Valider notamment : `programme_id` requis, `date_fin >= date_debut`, fenêtre d'inscription cohérente, `prix ≥ 0`, `nb_uv ≥ 0`, `capacite_max > 0` si fournie, prérequis `≠` matière elle-même, prérequis dans le **même programme**, **absence de cycle** dans le graphe de prérequis.

---

## 9) Sécurité & multi-tenant

- `tenant_id` sur **toutes** les nouvelles tables ; **RLS activée** ; policy identique au patron existant (D7).
- Contrôle de rôle par endpoint (`admin`, `student`, `parent`, `teacher`).
- Toutes les règles d'éligibilité **et de prérequis** (§5.1–5.2), de capacité et de fenêtre **vérifiées côté serveur** (revérifiées à la validation de la commande).
- Idempotence du paiement via `reference_transaction` (rejouer un paiement ne double pas la commande).
- Aucune fuite inter-tenant dans le catalogue et les agrégats.

---

## 10) Plan d'intégration incrémental

**Phase 1 — MVP**
1. Migrations : tables §4.1 → §4.6 (dont `professional_subject_prerequisites`) + FK `programme_id` + RLS (annexe A).
2. Contrats zod (§8), incluant validation des prérequis (anti-cycle, même programme).
3. API catalogue/admin (matières, **prérequis**, sessions) + espace étudiant (**programme → catalogue**, panier, commande, paiement, mes inscriptions).
4. Application **côté serveur** des prérequis et de l'éligibilité (ajout panier + validation commande).
5. Rattachement présences / supports / notes à la session (réutilisation D3).
6. Reçu + intégration au rapport financier existant.
7. Vues parent (lecture seule).

**Phase 2 — Extensions**
- Relevé d'UV capitalisées / attestation par matière ; validation des prérequis **par note/seuil** (au lieu de `terminee`, D9).
- Échéanciers professionnels & remboursements.
- Listes d'attente, notifications automatiques.

**Contraintes d'intégration**
- Migrations **ordonnées, idempotentes, non destructives**.
- **Aucun breaking change** sur le module classique ni sur le module formations-pro.
- Suivre les conventions du dépôt (structure `apps/api/src`, `apps/web/src/app`, `packages/contracts/src`, migrations dans `infra/scripts/migrations`).

---

## 11) Critères d'acceptation (testables)

1. Un admin crée une matière **rattachée à un programme** avec `nb_uv` et `prix` ; elle apparaît au catalogue **de ce programme** dès qu'une session est `ouvert` **et** dans sa fenêtre d'inscription.
2. L'étudiant doit **choisir un programme** avant de voir des matières ; seuls les programmes ayant ≥ 1 matière inscriptible sont proposés.
3. Une matière dont un prérequis n'est **pas** satisfait apparaît **verrouillée** (avec liste des prérequis manquants) et **ne peut pas** être ajoutée au panier ; la tentative est rejetée côté serveur.
4. Une matière dont **tous** les prérequis sont au statut `terminee` devient inscriptible ; marquer le prérequis `terminee` débloque la matière dépendante.
5. La définition d'un prérequis créant un **cycle**, ou pointant vers une matière d'un **autre programme**, ou vers **elle-même**, est **rejetée**.
6. Une session hors fenêtre, `complet`, `brouillon` ou `annule` **n'apparaît pas** comme inscriptible côté étudiant.
7. Un étudiant ajoute 3 matières au panier → `montant_total` = **somme exacte des montants** (prix figés) des 3 matières.
8. La validation du panier crée une commande `en_attente_paiement` (revérifie prérequis + éligibilité) ; le paiement confirmé bascule la commande en `payee` et les inscriptions en `confirmee`.
9. Tant que le paiement n'est pas confirmé, l'étudiant **n'accède pas** aux supports/notes des matières concernées.
10. Une 2ᵉ tentative d'inscription à une session déjà inscrite (non annulée) est **refusée**.
11. À capacité atteinte, la session passe `complet` et n'accepte plus d'inscription.
12. Un étudiant ayant déjà une inscription classique (`enrollments`) peut créer une commande professionnelle sans conflit (D5).
13. Aucune donnée d'un tenant A n'est visible/écrite depuis un contexte tenant B (RLS).
14. Rejouer le même paiement (même `reference_transaction`) ne crée pas de doublon.
15. Les endpoints `/formations-pro*` existants et le module classique restent inchangés et fonctionnels (non-régression).

---

## 12) Hors périmètre (MVP)

Relevé/attestation d'UV, validation des prérequis par note/seuil, échéanciers et remboursements, listes d'attente, notifications automatiques, tarification dégressive, panier multi-étudiants. → **Phase 2** ou ultérieur.
*(Les prérequis entre matières sont désormais **dans le MVP** ; seule leur validation par note est reportée — D9.)*

---

## Annexe A — Esquisse de migration SQL (à adapter au patron existant)

> L'agent IA doit **calquer** le style RLS/tenant des migrations déjà présentes dans `infra/scripts/migrations` (mécanisme de contexte tenant, nommage des policies, types `id`). Le bloc ci-dessous est un **squelette** indicatif, non définitif.

```sql
-- 00XX_professional_module.sql  (idempotent, non destructif)

CREATE TABLE IF NOT EXISTS professional_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  programme_id  uuid NOT NULL REFERENCES programmes(id),   -- rattachement programme (D8)
  code          text NOT NULL,
  libelle       text NOT NULL,
  description   text,
  nb_uv         integer NOT NULL DEFAULT 0 CHECK (nb_uv >= 0),
  prix          numeric(14,2) NOT NULL DEFAULT 0 CHECK (prix >= 0),
  statut        text NOT NULL DEFAULT 'actif',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Prérequis entre matières (graphe ; anti-cycle validé côté application)
CREATE TABLE IF NOT EXISTS professional_subject_prerequisites (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  professional_subject_id  uuid NOT NULL REFERENCES professional_subjects(id),
  prerequisite_subject_id  uuid NOT NULL REFERENCES professional_subjects(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (professional_subject_id <> prerequisite_subject_id),
  UNIQUE (tenant_id, professional_subject_id, prerequisite_subject_id)
);

CREATE TABLE IF NOT EXISTS professional_subject_sessions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  professional_subject_id  uuid NOT NULL REFERENCES professional_subjects(id),
  libelle                  text NOT NULL,
  date_debut               date NOT NULL,
  date_fin                 date NOT NULL,
  inscription_ouverte_le   timestamptz NOT NULL,
  inscription_fermee_le    timestamptz NOT NULL,
  capacite_max             integer CHECK (capacite_max IS NULL OR capacite_max > 0),
  enseignant_id            uuid REFERENCES teachers(id),
  classroom_id             uuid REFERENCES classrooms(id),
  statut                   text NOT NULL DEFAULT 'brouillon',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut),
  CHECK (inscription_fermee_le >= inscription_ouverte_le)
);

CREATE TABLE IF NOT EXISTS professional_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  student_id    uuid NOT NULL REFERENCES users(id),
  reference     text NOT NULL,
  montant_total numeric(14,2) NOT NULL DEFAULT 0,
  devise        text NOT NULL DEFAULT 'XOF',
  statut        text NOT NULL DEFAULT 'brouillon',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE TABLE IF NOT EXISTS professional_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  order_id      uuid NOT NULL REFERENCES professional_orders(id),
  student_id    uuid NOT NULL REFERENCES users(id),
  session_id    uuid NOT NULL REFERENCES professional_subject_sessions(id),
  prix_unitaire numeric(14,2) NOT NULL,
  statut        text NOT NULL DEFAULT 'en_attente_paiement',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Unicité : une seule inscription active par (étudiant, session)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prof_enroll_active
  ON professional_enrollments (tenant_id, student_id, session_id)
  WHERE statut <> 'annulee';

CREATE TABLE IF NOT EXISTS professional_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  order_id              uuid NOT NULL REFERENCES professional_orders(id),
  montant               numeric(14,2) NOT NULL,
  mode                  text NOT NULL,
  reference_transaction text,
  statut                text NOT NULL DEFAULT 'initie',
  paid_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference_transaction)
);

-- RLS : activer + créer la policy d'isolation EN REPRENANT EXACTEMENT
-- le mécanisme de contexte tenant des migrations existantes.
-- Exemple de squelette (à aligner sur l'existant) :
-- ALTER TABLE professional_subjects ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation_professional_subjects ON professional_subjects
--   USING (tenant_id = current_setting('app.current_tenant')::uuid);
-- (Idem pour chaque table ci-dessus.)
```

---

*Fin du document — v1. Confirmer ou ajuster les décisions §3 avant implémentation ; toute modification d'une décision doit être propagée aux §4–§11 et à l'annexe A.*

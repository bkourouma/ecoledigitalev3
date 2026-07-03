# Module Professionnel — Vue d'ensemble

> Feature `028-professional-module` — Inscription à la carte
> Document de synthèse — généré le 2026-05-22

---

## 1. À quoi sert ce module

Le **Module Professionnel** ajoute à EcoleDigitale un mode d'inscription **à la carte**, distinct
de la scolarité académique classique (prix forfaitaire, cohorte) et **distinct** du module
« formations professionnelles » existant.

Principe :

- L'offre est organisée par **programme**.
- Chaque **matière** porte une valeur en **UV**, un **prix propre** et un **statut** (actif/inactif).
- Une matière est proposée via des **sessions datées** (fenêtre d'inscription, capacité, enseignant, salle).
- L'étudiant choisit un programme, sélectionne librement les matières dont les **prérequis** sont
  satisfaits, les met dans un **panier**, valide une **commande** et la **paie**.
- Pas de cohorte : chaque étudiant a son propre parcours et s'inscrit dès qu'une session est ouverte.

Le module se greffe **sans casser** le module académique classique ni le module
« formations professionnelles ». Un même étudiant peut suivre les deux parcours indépendamment.

---

## 2. Les écrans (espace web)

Chaque rôle dispose de sa propre zone Next.js (App Router).

### 2.1 Espace administrateur — `/professionnel/admin/*`

| Écran | URL | Rôle |
|---|---|---|
| Matières | `/professionnel/admin/matieres` | Liste du catalogue des matières professionnelles, filtrable par programme |
| Créer une matière | `/professionnel/admin/matieres/new` | Code, libellé, programme, UV, prix, type de bilan |
| Détail matière | `/professionnel/admin/matieres/[id]` | Fiche matière + sessions + prérequis |
| Éditer une matière | `/professionnel/admin/matieres/[id]/edit` | Modification / désactivation |
| Sessions | `/professionnel/admin/sessions` | Liste des sessions datées, filtrable par matière / statut |
| Créer une session | `/professionnel/admin/sessions/new` | Dates, fenêtre d'inscription, capacité, enseignant, salle |
| Éditer une session | `/professionnel/admin/sessions/[id]/edit` | Modification + transitions de statut |
| Suivi | `/professionnel/admin/suivi` | Inscriptions + paiements ; achèvement des inscriptions |
| Présences | `/professionnel/admin/presences` | Consultation des présences enregistrées par les enseignants, par session |

### 2.2 Espace étudiant — `/professionnel/etudiant/*`

| Écran | URL | Contenu |
|---|---|---|
| Catalogue | `/professionnel/etudiant` | Choix du programme → matières inscriptibles, prix, UV, état des prérequis, panier, commande, paiement |
| Mes inscriptions | `/professionnel/etudiant/inscriptions` | Inscriptions confirmées/terminées, accès au contenu pédagogique, reçus |

### 2.3 Espace parent — `/parent/professionnel`

Consultation **en lecture seule** des inscriptions et paiements professionnels de son enfant.

### 2.4 Espace enseignant — `/teacher/professionnel`

L'enseignant retrouve ses sessions professionnelles, y fait l'appel, dépose des supports
et accède aux mécanismes pédagogiques existants.

---

## 3. Parcours fonctionnels (User Stories)

| # | Story | Priorité | Résumé |
|---|---|---|---|
| US1 | Catalogue professionnel administré | P1 | L'admin crée matières et sessions datées |
| US2 | Inscription à la carte de l'étudiant | P1 | Programme → matières → panier → commande → paiement → contenu |
| US3 | Prérequis entre matières | P2 | Verrouillage tant que tous les prérequis ne sont pas validés |
| US4 | Cycle de vie des sessions et achèvement | P2 | Transitions de statut, capacité, marquage « terminée » |
| US5 | Suivi parent | P3 | Lecture seule des inscriptions/paiements de l'enfant |
| US6 | Accès enseignant aux sessions pro | P3 | Appel, supports, notes via les mécanismes existants |

### Parcours étudiant (chemin nominal)

```
Choix programme → Catalogue (matières + sessions inscriptibles)
   → Ajout au panier (prix figé)
   → Validation de la commande (revérification éligibilité + prérequis)
   → Paiement (idempotent)
   → Inscriptions « confirmée » → accès supports / présences / notes
```

---

## 4. Règles métier clés

- **Prix figé** : le prix de la matière est figé dans la ligne de panier au moment de l'ajout ;
  une modification ultérieure du prix n'impacte ni les paniers ni les commandes existants.
- **Prérequis** : logique **ET** — toutes les matières prérequises doivent avoir une inscription
  « terminée ». Un prérequis ne peut pas pointer vers la matière elle-même, vers une matière d'un
  autre programme, ni introduire un cycle dans le graphe.
- **Session inscriptible** uniquement si : statut `ouvert` + date courante dans la fenêtre
  d'inscription + capacité non atteinte (ou illimitée) + pas d'inscription active de l'étudiant
  sur la session + tous les prérequis satisfaits.
- **Capacité** : passage automatique `ouvert → complet` quand la capacité est atteinte ; retour
  `complet → ouvert` si une place se libère et que la fenêtre est encore valide. Capacité `NULL`
  = illimitée.
- **Paiement idempotent** : rejouer la même `reference_transaction` ne crée pas de doublon.
- **Accès au contenu** conditionné au statut `confirmée` de l'inscription.
- **Annulation** possible uniquement tant que le paiement n'est pas confirmé ; le remboursement
  est hors périmètre MVP.
- **Vérification serveur** : toutes les règles (éligibilité, prérequis, capacité, fenêtre) sont
  appliquées côté serveur, pas seulement dans l'interface.
- **Isolation multi-établissement** : toutes les données sont cloisonnées par établissement (RLS).

---

## 5. Modèle de données

Migrations : `infra/scripts/migrations/0061_professional_module.sql`,
`0062_professional_pedagogy.sql`, `0063_professional_subject_bilan_type.sql`.

| Table | Rôle |
|---|---|
| `professional_subjects` | Matière professionnelle (code unique/tenant, libellé, UV, prix, statut) |
| `professional_subject_prerequisites` | Graphe des prérequis entre matières d'un même programme |
| `professional_subject_sessions` | Session datée d'une matière (dates, fenêtre, capacité, enseignant, salle, statut) |
| `professional_orders` | Commande / panier (référence `PRO-{année}-{séquence}`, montant total, devise, statut) |
| `professional_enrollments` | Inscription = ligne de commande (prix unitaire figé, statut) |
| `professional_payments` | Paiement d'une commande (mode, référence transaction, reçu, statut) |
| `professional_session_materials` | Supports de cours rattachés à une session |
| `professional_session_attendance` | Présences saisies par l'enseignant |

Toutes les tables portent `tenant_id` et la **Row-Level Security** (GUC `app.tenant_id`).

### Relations

```
programmes ──< professional_subjects ──< professional_subject_sessions ──< professional_enrollments >── professional_orders ──< professional_payments
                   │  ▲                          │                                │
                   └──┴ prerequisites            ├─ enseignant_id → teachers       └─ student_id → student_profiles
                                                  ├─ classroom_id  → classrooms
                                                  ├─ session_materials
                                                  └─ session_attendance
```

### Machines à états

| Entité | Statuts |
|---|---|
| Session | `brouillon → ouvert ⇄ complet → en_cours → termine` ; `annule` (terminal) |
| Commande | `brouillon → en_attente_paiement → payee` ; `annulee` (avant paiement) |
| Inscription | `en_attente_paiement → confirmee → terminee` ; `annulee` (avant paiement) |
| Paiement | `initie → confirme` ou `initie → echoue` ; `rembourse` = Phase 2 |

---

## 6. API

Préfixe : **`/api/v1/professional`** — routes définies dans `apps/api/src/routes/professional.ts`,
enregistrées après `authMiddleware`. Chaque endpoint est protégé par une garde de rôle
(`requireAdmin`, `requireStudent`, `requireParent`, `requireTeacher`, `requireAdminOrTeacher`).

### Administration (admin)

| Méthode | Endpoint | Action |
|---|---|---|
| GET/POST | `/subjects` | Lister / créer une matière |
| GET/PATCH/DELETE | `/subjects/:id` | Détail / éditer / supprimer une matière |
| GET/PUT | `/subjects/:id/prerequisites` | Lire / définir les prérequis |
| GET/POST | `/subjects/:id/sessions` | Lister / créer les sessions d'une matière |
| GET | `/sessions` | Lister toutes les sessions (filtrable) |
| GET/PATCH/DELETE | `/sessions/:id` | Détail / éditer / supprimer une session |
| POST | `/sessions/:id/status` | Transition de statut |
| GET | `/sessions/:id/attendance` | Présences d'une session |
| GET | `/enrollments` | Lister les inscriptions (suivi) |
| GET | `/payments` | Lister les paiements (suivi) |
| POST | `/enrollments/:id/complete` | Marquer une inscription « terminée » (admin ou enseignant) |

### Étudiant

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/student/programmes` | Programmes ayant ≥ 1 matière inscriptible |
| GET | `/student/catalog?programme_id=` | Catalogue d'un programme |
| GET | `/student/cart` | Panier courant |
| POST/DELETE | `/student/cart/items[/:enrollmentId]` | Ajouter / retirer du panier |
| GET/POST | `/student/orders` | Lister / valider une commande |
| GET | `/student/orders/:id` | Détail d'une commande |
| POST | `/student/orders/:id/payment` | Payer une commande |
| GET | `/student/enrollments` | Mes inscriptions |
| GET | `/student/receipts/:paymentId` | Reçu d'un paiement |

### Parent

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/parent/children` | Enfants du parent |
| GET | `/parent/enrollments?child_id=` | Inscriptions d'un enfant (lecture seule) |
| GET | `/parent/payments?child_id=` | Paiements d'un enfant (lecture seule) |

### Enseignant

| Méthode | Endpoint | Action |
|---|---|---|
| GET | `/teacher/sessions` | Mes sessions professionnelles |
| GET/POST | `/teacher/sessions/:id/materials` | Lister / déposer un support |
| GET/POST | `/teacher/sessions/:id/attendance` | Lire / saisir les présences |

Sonde de santé : `GET /api/v1/professional/_health`.

### Codes d'erreur normalisés

`VALIDATION_ERROR` (422), `NOT_FOUND` (404), `DUPLICATE_CODE` / `SESSION_FULL` /
`DUPLICATE_ENROLLMENT` / `ALREADY_PAID` (409), `PREREQUISITE_NOT_MET` /
`CROSS_PROGRAMME_PREREQUISITE` / `PREREQUISITE_CYCLE` / `SESSION_NOT_ENROLLABLE` /
`INVALID_TRANSITION` (422), `FORBIDDEN` (403), `INTERNAL_ERROR` (500).

---

## 7. Architecture technique

Monorepo pnpm — TypeScript, Node 18+.

| Couche | Emplacement |
|---|---|
| Routes API (Fastify) | `apps/api/src/routes/professional.ts` |
| Services métier | `apps/api/src/services/professional-{base,catalog,enrollment,payment,teacher}.service.ts` |
| Gardes de rôle | `apps/api/src/middlewares/professional-guards.ts` |
| Contrats Zod partagés | `packages/contracts/src/professional.ts` |
| Web (Next.js 15) | `apps/web/src/app/{professionnel,parent/professionnel,teacher/professionnel}/` |
| Hooks TanStack Query | `apps/web/src/lib/hooks/use-professional-*.ts` |
| Migrations SQL | `infra/scripts/migrations/0061-0063_professional_*.sql` |

- **Base** : PostgreSQL 14+, Row-Level Security par tenant.
- **Validation** : schémas Zod dans `@ecoledigitale/contracts`, partagés API ↔ web.
- **Sécurité** : `authMiddleware` global + gardes RBAC ; toutes les règles côté serveur.
- **Devise** : FCFA / XOF par défaut.

---

## 8. État du périmètre

**Inclus (MVP / Phase 1)** : catalogue administré, inscription à la carte, prérequis, panier,
commande, paiement idempotent, cycle de vie des sessions, suivi parent, accès enseignant.

**Hors périmètre (Phase 2)** : relevé/attestation d'UV capitalisées, validation des prérequis
par note ou seuil, échéanciers et remboursements, listes d'attente, notifications automatiques,
tarification dégressive, panier multi-étudiants, notation des sessions professionnelles.

### Tests

Tests unitaires Jest (logique pure + Zod) :
`pnpm --filter @ecoledigitale/api exec jest professional` → ~72 tests.
L'intégration base de données et le smoke test authentifié de bout en bout sont couverts
manuellement (voir `specs/028-professional-module/quickstart.md` et `guide-test-e2e.md`).

---

## 9. Références

- Spécification : `specs/028-professional-module/spec.md`
- Plan d'implémentation : `specs/028-professional-module/plan.md`
- Modèle de données : `specs/028-professional-module/data-model.md`
- Décisions techniques : `specs/028-professional-module/research.md`
- Contrats d'API : `specs/028-professional-module/contracts/`
- Mise en route / QA : `specs/028-professional-module/quickstart.md`
- Document de besoin d'origine : `docs/module-professionnel-requirements.md`
</content>
</invoke>

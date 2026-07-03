# Phase 1 — API Contracts: Module Professionnel

**Feature**: 028-professional-module | **Date**: 2026-05-20

> **Errata d'implémentation (T051)** — Préfixe **unique** réel : toutes les routes sont sous `/api/v1/professional`. Les espaces étudiant / parent / enseignant sont des **sous-chemins** : `/api/v1/professional/student/*`, `/api/v1/professional/parent/*`, `/api/v1/professional/teacher/*` (et non `/api/v1/student/professional/*`). L'espace enseignant dispose bien d'un arbre d'endpoints dédié (`/teacher/sessions`, `/teacher/sessions/:id/materials`, `/teacher/sessions/:id/attendance`). Les chemins relatifs des sections ci-dessous restent corrects sous ce préfixe.

Base : préfixe **unique** `/api/v1/professional` (un seul fichier de routes). Sous-espaces : `/professional/{subjects,sessions,enrollments,payments}` (admin), `/professional/student/*`, `/professional/parent/*`, `/professional/teacher/*`. Toutes les routes sont enregistrées **après `authMiddleware`** (JWT obligatoire) ; `"/api/v1/professional"` est ajouté à `tenantRequiredPrefixes` (contexte tenant obligatoire).

**En-têtes obligatoires** : `Authorization: Bearer <jwt>`, `X-Tenant: <slug|uuid>`, `Content-Type: application/json`.

**Enveloppe de réponse** (convention du dépôt) :
- Succès : `{ "success": true, "data": <payload> }`
- Erreur : `{ "success": false, "error": "<CODE>", "message": "<texte>" }`

**Codes d'erreur** : `TENANT_REQUIRED` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (422), `PREREQUISITE_NOT_MET` (422), `PREREQUISITE_CYCLE` (422), `CROSS_PROGRAMME_PREREQUISITE` (422), `SESSION_NOT_ENROLLABLE` (422), `SESSION_FULL` (409), `DUPLICATE_ENROLLMENT` (409), `ALREADY_PAID` (409), `INTERNAL_ERROR` (500).

---

## A. Catalogue & administration — `/api/v1/professional/*` (rôle `admin`)

### Matières

| Méthode & route | Rôle | Description |
|---|---|---|
| `GET /subjects` | admin | Liste des matières. Query : `programme_id?`, `statut?`, `q?`, `page?`, `pageSize?`. |
| `POST /subjects` | admin | Crée une matière. Body : `CreateProfessionalSubject`. → `201`. |
| `GET /subjects/:id` | admin | Détail d'une matière (avec ses prérequis). |
| `PATCH /subjects/:id` | admin | Met à jour une matière. Body : `UpdateProfessionalSubject`. |
| `DELETE /subjects/:id` | admin | Désactive la matière (`statut='inactif'` — soft). `409` si des sessions ouvertes existent. |

`CreateProfessionalSubject` : `{ programme_id: uuid, code: string, libelle: string, description?: string, nb_uv: int>=0, prix: number>=0, statut?: 'actif'|'inactif' }`
Erreurs : `VALIDATION_ERROR`, `409 DUPLICATE_CODE` (code déjà pris dans le tenant).

### Prérequis

| Méthode & route | Rôle | Description |
|---|---|---|
| `GET /subjects/:id/prerequisites` | admin | Liste des matières prérequises de `:id`. |
| `PUT /subjects/:id/prerequisites` | admin | Définit l'ensemble des prérequis. Body : `{ prerequisite_subject_ids: uuid[] }`. |

Règles de rejet du `PUT` : `CROSS_PROGRAMME_PREREQUISITE` (prérequis hors programme), `PREREQUISITE_CYCLE` (cycle détecté), `VALIDATION_ERROR` (auto-référence, id inconnu).

### Sessions

| Méthode & route | Rôle | Description |
|---|---|---|
| `GET /subjects/:id/sessions` | admin | Sessions d'une matière. |
| `POST /subjects/:id/sessions` | admin | Crée une session. Body : `CreateProfessionalSession`. `409` si matière `inactif`. → `201`. |
| `GET /sessions/:id` | admin | Détail d'une session (+ nb d'inscriptions actives). |
| `PATCH /sessions/:id` | admin | Met à jour une session. Body : `UpdateProfessionalSession`. |
| `POST /sessions/:id/status` | admin | Transition de statut contrôlée. Body : `{ statut: 'brouillon'|'ouvert'|'en_cours'|'termine'|'annule' }`. `422` si transition invalide. |

`CreateProfessionalSession` : `{ libelle: string, date_debut: date, date_fin: date, inscription_ouverte_le: datetime, inscription_fermee_le: datetime, capacite_max?: int>0|null, enseignant_id?: uuid, classroom_id?: uuid }`
Règles : `date_fin >= date_debut`, `inscription_fermee_le >= inscription_ouverte_le`.

### Suivi (admin)

| Méthode & route | Rôle | Description |
|---|---|---|
| `GET /enrollments` | admin | Inscriptions. Query : `programme_id?`, `session_id?`, `subject_id?`, `student_id?`, `statut?`, `page?`, `pageSize?`. |
| `POST /enrollments/:id/complete` | admin, teacher | Marque l'inscription `terminee` (débloque les matières dépendantes — D9). `422` si l'inscription n'est pas `confirmee`. |
| `GET /payments` | admin | Paiements professionnels. Query : `statut?`, `order_id?`, `date_from?`, `date_to?`, `page?`, `pageSize?`. |

---

## B. Espace étudiant — `/api/v1/student/professional/*` (rôle `student`)

| Méthode & route | Description |
|---|---|
| `GET /programmes` | Programmes ayant ≥ 1 matière professionnelle inscriptible (D8, FR-010). → `ProfessionalProgrammeOption[]`. |
| `GET /catalog?programme_id=` | Matières du programme + sessions **inscriptibles** + **état des prérequis** par matière. → `ProfessionalCatalogItem[]`. |
| `GET /cart` | Panier courant (commande `brouillon`) avec ses lignes et le total. → `ProfessionalOrder`. |
| `POST /cart/items` | Ajoute une session au panier. Body : `{ session_id: uuid }`. Rejets : `PREREQUISITE_NOT_MET`, `SESSION_NOT_ENROLLABLE`, `SESSION_FULL`, `DUPLICATE_ENROLLMENT`. |
| `DELETE /cart/items/:enrollmentId` | Retire une ligne du panier. |
| `POST /orders` | Valide le panier → commande `en_attente_paiement` (revérifie éligibilité + prérequis de **toutes** les lignes). Rejets identiques à l'ajout panier. → `ProfessionalOrder`. |
| `GET /orders` | Mes commandes (toutes statuts). |
| `GET /orders/:id` | Détail d'une commande. |
| `POST /orders/:id/payment` | Déclenche/confirme le paiement (**idempotent**). Body : `{ mode: 'especes'|'mobile_money'|'virement'|'autre', reference_transaction?: string }`. Rejeu de la même `reference_transaction` → renvoie le paiement existant (`200`, pas de doublon). `409 ALREADY_PAID` si la commande est déjà `payee` via une autre transaction. |
| `GET /enrollments` | Mes inscriptions et leur statut. |
| `GET /receipts/:paymentId` | Reçu d'un paiement confirmé (`receipt_number`, `receipt_url`). `404` si non confirmé. |

**`ProfessionalCatalogItem`** (vue agrégée étudiant) :
```jsonc
{
  "subject": { "id": "uuid", "code": "...", "libelle": "...", "nb_uv": 3, "prix": 50000, "programme_id": "uuid" },
  "sessions": [
    { "id": "uuid", "libelle": "...", "date_debut": "2026-01-10", "date_fin": "2026-03-10",
      "inscription_ouverte_le": "...", "inscription_fermee_le": "...",
      "capacite_max": 30, "places_restantes": 12, "statut": "ouvert", "inscriptible": true }
  ],
  "prerequisites_status": {
    "satisfait": false,
    "manquants": [ { "id": "uuid", "code": "...", "libelle": "..." } ]
  },
  "verrouille": true
}
```
Une matière dont `prerequisites_status.satisfait = false` est `verrouille: true` → non ajoutable au panier (FR-013).

---

## C. Espace parent — `/api/v1/parent/professional/*` (rôle `parent`, lecture seule)

| Méthode & route | Description |
|---|---|
| `GET /enrollments?child_id=` | Inscriptions professionnelles d'un enfant rattaché au parent (via `student_parents`). |
| `GET /payments?child_id=` | Paiements professionnels d'un enfant rattaché au parent. |

`403 FORBIDDEN` si `child_id` n'est pas un enfant du parent authentifié. Aucune route d'écriture (FR-030).

---

## D. Espace enseignant (story P3)

Pas de nouvel arbre d'endpoints dédié : les sessions professionnelles dont `enseignant_id` = l'enseignant authentifié sont exposées **parmi ses cours** via les routes enseignant existantes (`/api/v1/teacher/...`), une fois le rattachement présences/supports/notes réalisé (research R3, US6).

---

## Matrice rôles × opérations

| Opération | admin | student | parent | teacher |
|---|:--:|:--:|:--:|:--:|
| CRUD matières / prérequis / sessions | ✅ | — | — | — |
| Transition de statut de session | ✅ | — | — | — |
| Marquer une inscription `terminee` | ✅ | — | — | ✅ |
| Suivi inscriptions / paiements (tous) | ✅ | — | — | — |
| Catalogue, panier, commande, paiement | — | ✅ (les siens) | — | — |
| Consulter ses inscriptions / reçus | — | ✅ (les siens) | — | — |
| Consulter inscriptions / paiements d'un enfant | — | — | ✅ (lecture) | — |
| Voir ses sessions professionnelles | — | — | — | ✅ |

Toutes les règles d'éligibilité, de prérequis, de capacité, de fenêtre et d'idempotence sont **revérifiées côté serveur** (FR-032), y compris à la validation de la commande (`POST /orders`).

# Phase 1 — API Contracts: Diplômes Professionnels

**Feature**: 029-professional-diplomas | **Date**: 2026-05-22

Base : préfixe **existant** `/api/v1/professional` (routes ajoutées au fichier `apps/api/src/routes/professional.ts`). Toutes les routes sont enregistrées **après `authMiddleware`** (JWT obligatoire) ; `/api/v1/professional` est déjà dans `tenantRequiredPrefixes` (contexte tenant obligatoire — research R12).

**En-têtes obligatoires** : `Authorization: Bearer <jwt>`, `X-Tenant: <slug|uuid>`, `Content-Type: application/json`.

**Enveloppe de réponse** (convention du dépôt) :
- Succès : `{ "success": true, "data": <payload> }`
- Erreur : `{ "success": false, "error": "<CODE>", "message": "<texte>" }`

**Codes d'erreur** — existants : `TENANT_REQUIRED` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (422), `INTERNAL_ERROR` (500). **Nouveaux** (à ajouter à la table `ERROR_STATUS` de `professional.ts`) :

| Code | HTTP | Sens |
|---|---|---|
| `DIPLOMA_NOT_FOUND` | 404 | Diplôme inexistant dans le tenant |
| `DUPLICATE_DIPLOMA_CODE` | 409 | `code` déjà utilisé dans le tenant |
| `CROSS_PROGRAMME_REQUIREMENT` | 422 | Exigence pointant vers une matière d'un autre programme |
| `DIPLOMA_HAS_AWARDS` | 409 | Suppression refusée — octrois non révoqués existants |
| `DIPLOMA_ALREADY_AWARDED` | 409 | L'étudiant détient déjà un octroi non révoqué |
| `DIPLOMA_NOT_ELIGIBLE` | 422 | Octroi manuel sans `force` sur un étudiant non éligible |
| `DIPLOMA_NOT_AWARDED` | 404 | Révocation d'un diplôme non obtenu par l'étudiant |
| `INVALID_DIPLOMA_STATUS_TRANSITION` | 422 | Transition de statut d'octroi non permise |

---

## A. Administration des diplômes — `/api/v1/professional/diplomas/*` (rôle `admin`)

| Méthode & route | Description |
|---|---|
| `GET /diplomas` | Liste des diplômes. Query : `programme_id?`, `statut?`, `q?` (recherche code/libellé). → `DiplomaDto[]`. |
| `POST /diplomas` | Crée un diplôme. Body : `DiplomaCreateInput`. → `201` `DiplomaDto`. Erreurs : `VALIDATION_ERROR`, `DUPLICATE_DIPLOMA_CODE`. |
| `GET /diplomas/:id` | Détail : diplôme + exigences + nombre d'étudiants diplômés. → `DiplomaDetailDto`. Erreur : `DIPLOMA_NOT_FOUND`. |
| `PATCH /diplomas/:id` | Met à jour `libelle`, `description`, `uv_required`, `statut`. Body : `DiplomaUpdateInput`. → `DiplomaDto`. Erreurs : `DIPLOMA_NOT_FOUND`, `VALIDATION_ERROR`. |
| `DELETE /diplomas/:id` | Supprime le diplôme (CASCADE sur les exigences). → `204`. Erreurs : `DIPLOMA_NOT_FOUND`, `DIPLOMA_HAS_AWARDS` (octroi non révoqué existant). |
| `GET /diplomas/:id/requirements` | Liste des exigences. → `DiplomaRequirementDto[]`. |
| `PUT /diplomas/:id/requirements` | Remplace **atomiquement** les exigences. Body : `DiplomaRequirementsReplaceInput`. → `DiplomaRequirementDto[]`. Erreurs : `DIPLOMA_NOT_FOUND`, `CROSS_PROGRAMME_REQUIREMENT`, `VALIDATION_ERROR`. |
| `GET /diplomas/:id/awarded` | Étudiants ayant obtenu ce diplôme. Query : `statut?` (`obtenu`/`revoque`). → `StudentDiplomaDto[]`. |
| `POST /diplomas/:id/award` | Octroi manuel. Body : `DiplomaAwardManualInput` (`student_id`, `force?`). → `201` `StudentDiplomaDto`. Erreurs : `DIPLOMA_NOT_FOUND`, `DIPLOMA_ALREADY_AWARDED`, `DIPLOMA_NOT_ELIGIBLE` (si non éligible et `force` absent/false). |
| `POST /diplomas/:id/revoke` | Révoque un octroi. Body : `DiplomaRevokeInput` (`student_id`, `motif`). → `StudentDiplomaDto`. Erreurs : `DIPLOMA_NOT_FOUND`, `DIPLOMA_NOT_AWARDED`, `VALIDATION_ERROR` (motif vide). |
| `POST /diplomas/:id/recompute` | Recalcule l'éligibilité de tous les étudiants ayant des inscriptions terminées sur les matières du diplôme. **Idempotent** — ne crée que les octrois manquants. → `{ awarded: number }`. |

### Schémas d'entrée

`DiplomaCreateInput` :
```jsonc
{
  "programme_id": "uuid",          // requis
  "code": "string(1..50)",         // requis, unique par tenant
  "libelle": "string(1..255)",     // requis
  "description": "string|null",    // optionnel
  "uv_required": 12,               // entier > 0
  "statut": "actif|inactif"        // optionnel, défaut "actif"
}
```

`DiplomaUpdateInput` (tous champs optionnels ; `programme_id` et `code` non modifiables) :
```jsonc
{ "libelle": "string(1..255)?", "description": "string|null?", "uv_required": "int>0?", "statut": "actif|inactif?" }
```

`DiplomaRequirementsReplaceInput` :
```jsonc
{
  "requirements": [
    { "subject_id": "uuid", "est_obligatoire": true, "ordre": 0 },
    { "subject_id": "uuid", "est_obligatoire": false, "ordre": 1 }
  ]
}
```
Règles : chaque `subject_id` doit appartenir au programme du diplôme (`CROSS_PROGRAMME_REQUIREMENT` sinon) ; pas de `subject_id` en double (`VALIDATION_ERROR`).

`DiplomaAwardManualInput` : `{ "student_id": "uuid", "force": false }` — `force` optionnel, défaut `false`.

`DiplomaRevokeInput` : `{ "student_id": "uuid", "motif": "string(1..)" }` — `motif` non vide requis.

---

## B. Espace étudiant — `/api/v1/professional/student/diplomas/*` (rôle `student`)

| Méthode & route | Description |
|---|---|
| `GET /student/diplomas` | Diplômes disponibles dans les programmes de l'étudiant + diplômes obtenus + progression résumée. → `StudentDiplomaSummaryDto[]`. |
| `GET /student/diplomas/:id/progress` | Progression détaillée vers un diplôme. → `DiplomaProgressDto`. Erreur : `DIPLOMA_NOT_FOUND`. |
| `GET /student/diplomas/:id/attestation` | Données structurées de l'attestation si le diplôme est obtenu. → `DiplomaAttestationDto`. Erreur : `DIPLOMA_NOT_AWARDED` (404) si non obtenu. |

**`DiplomaProgressDto`** (vue agrégée étudiant — calculée à la volée, research R6) :
```jsonc
{
  "diploma": { "id": "uuid", "code": "...", "libelle": "...", "programme_id": "uuid", "uv_required": 12, "statut": "actif" },
  "uv_validees": 9,
  "uv_required": 12,
  "pourcentage": 75,                       // round(uv_validees / uv_required * 100), borné à 100
  "matieres_validees": [
    { "subject_id": "uuid", "code": "PRO-A", "libelle": "...", "nb_uv": 4, "est_obligatoire": true }
  ],
  "matieres_restantes": [
    { "subject_id": "uuid", "code": "PRO-C", "libelle": "...", "nb_uv": 3, "est_obligatoire": false }
  ],
  "matieres_obligatoires_manquantes": [
    { "subject_id": "uuid", "code": "PRO-D", "libelle": "...", "nb_uv": 5, "est_obligatoire": true }
  ],
  "eligible": false,
  "diplome_obtenu": null                   // StudentDiplomaDto si déjà obtenu, sinon null
}
```

**`DiplomaAttestationDto`** (MVP — données structurées, rendu PDF en Phase 2, D9) :
```jsonc
{
  "reference": "DIP-2026-000007",
  "diplome": { "code": "...", "libelle": "...", "programme_libelle": "..." },
  "etudiant": { "id": "uuid", "nom_complet": "..." },
  "date_obtention": "2026-05-22T10:00:00.000Z",
  "uv_total_validees": 12,
  "matieres_validees": [ { "code": "...", "libelle": "...", "nb_uv": 4 } ]
}
```

---

## C. Espace parent — `/api/v1/professional/parent/diplomas` (rôle `parent`, lecture seule)

| Méthode & route | Description |
|---|---|
| `GET /parent/diplomas?child_id=` | Diplômes (en cours + obtenus) d'un enfant rattaché au parent (via `student_parents`). → `StudentDiplomaSummaryDto[]`. |

`403 FORBIDDEN` si `child_id` n'est pas un enfant du parent authentifié. Aucune route d'écriture (FR-032).

---

## DTO communs

**`DiplomaDto`** :
```jsonc
{
  "id": "uuid", "tenant_id": "uuid", "programme_id": "uuid",
  "code": "...", "libelle": "...", "description": "string|null",
  "uv_required": 12, "statut": "actif|inactif",
  "created_by": "uuid|null", "created_at": "iso", "updated_at": "iso"
}
```

**`DiplomaDetailDto`** = `DiplomaDto` + `{ "requirements": DiplomaRequirementDto[], "uv_total_atteignable": 18, "nb_diplomes_octroyes": 5 }`.
`uv_total_atteignable` = Σ `nb_uv` des matières exigées ; si `< uv_required`, l'UI avertit que la cible est inatteignable (FR-009).

**`DiplomaRequirementDto`** :
```jsonc
{
  "id": "uuid", "diploma_id": "uuid", "subject_id": "uuid",
  "subject_code": "...", "subject_libelle": "...", "subject_nb_uv": 4,
  "est_obligatoire": true, "ordre": 0
}
```

**`StudentDiplomaDto`** :
```jsonc
{
  "id": "uuid", "diploma_id": "uuid", "student_id": "uuid",
  "reference": "DIP-2026-000007", "statut": "obtenu|revoque|en_cours",
  "uv_total_validees": 12, "requirements_snapshot": { /* objet figé, research R7 */ },
  "date_obtention": "iso|null", "date_revocation": "iso|null", "motif_revocation": "string|null",
  "octroye_par": "uuid|null", "revoque_par": "uuid|null",
  "created_at": "iso", "updated_at": "iso"
}
```

**`StudentDiplomaSummaryDto`** (liste étudiant/parent) :
```jsonc
{
  "diploma": DiplomaDto,
  "pourcentage": 75,
  "eligible": false,
  "statut_octroi": "obtenu|null",          // null si non encore obtenu
  "reference": "DIP-2026-000007|null",
  "date_obtention": "iso|null"
}
```

---

## Matrice rôles × opérations

| Opération | admin | student | parent | teacher |
|---|:--:|:--:|:--:|:--:|
| CRUD diplômes + exigences | ✅ | — | — | — |
| Octroi manuel / révocation / recompute | ✅ | — | — | — |
| Lister les étudiants diplômés d'un diplôme | ✅ | — | — | — |
| Consulter ses diplômes + progression + attestation | — | ✅ (les siens) | — | — |
| Consulter les diplômes d'un enfant | — | — | ✅ (lecture) | — |
| **Tout endpoint diplôme** | — | — | — | ❌ (FR-036, SC-011) |

Toutes les règles d'éligibilité, de cohérence de programme, d'unicité de code et d'octroi sont **revérifiées côté serveur** (FR-037). L'octroi automatique est déclenché hors de cette surface d'API, depuis le hook `recomputeForStudent` branché sur l'achèvement d'inscription (research R5).

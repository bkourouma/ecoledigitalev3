# API Contract — Rémunération professionnelle (031)

Deux surfaces :

1. **Nouvelle** — `/api/v1/professional/remuneration` : cycle de vie des séances
   et tarification ECUE (propre au module professionnel).
2. **Étendue** — routes de paie existantes (`/api/v1/teacher-payments`,
   `/api/v1/payment-reports`) : **aucune rupture**, uniquement des paramètres et
   des champs optionnels ajoutés.

RBAC via `professional-guards.ts` (administration pour la validation et la
tarification ; enseignant borné à ses propres données). Toutes les règles sont
vérifiées côté serveur. Isolation RLS par tenant sur chaque requête.

Légende : ➕ nouveau · 🔧 étendu (rétrocompatible) · = inchangé.

## 1. Validation des séances professionnelles ➕

Base : `/api/v1/professional/remuneration`

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/seances` | admin | Liste des séances avec leur payabilité |
| PATCH | `/seances/:id/statut` | admin | `planifiee` \| `realisee` \| `annulee` |
| POST | `/seances/validate` | admin | Validation / dévalidation **en lot** |
| GET | `/seances/overlaps` | admin | Chevauchements d'horaires par enseignant |

### GET `/seances`

**Query** : `enseignantId?`, `ueSessionId?`, `ecueId?`, `fromDate?`, `toDate?`,
`statut?` (`planifiee|realisee|annulee`), `validated?` (bool),
`payable?` (bool — applique le prédicat complet FR-003),
`hasAttendance?` (bool — séances passées avec présences saisies, aide au
rattrapage D-R12), `limit?` (défaut 100, max 500), `offset?`.

**200**

```jsonc
{
  "data": [
    {
      "id": "uuid",
      "date": "2026-08-12",
      "heureDebut": "08:00",
      "heureFin": "11:00",
      "dureeHeures": 3,                  // null si horaires incomplets
      "statut": "realisee",
      "validatedAt": "2026-08-13T09:12:00Z",
      "validatedBy": { "id": "uuid", "nom": "A. Diallo" },
      "payable": true,
      "blockers": [],                    // ex. ["horaires_incomplets","sans_enseignant"]
      "enseignant": { "id": "uuid", "nom": "K. Traoré" },
      "ecue": { "id": "uuid", "code": "INF101", "libelle": "Algorithmique" },
      "cohorte": { "id": "uuid", "libelle": "Promo 2026 - S1" },
      "presencesSaisies": 18,
      "paiement": { "id": "uuid", "statut": "approved" }  // null si non payée
    }
  ],
  "pagination": { "total": 240, "limit": 100, "offset": 0, "hasMore": true }
}
```

> `blockers` est le **motif** de non-payabilité, pas un simple booléen : c'est
> ce qui permet à l'écran de dire pourquoi une séance ne peut pas être validée.

### PATCH `/seances/:id/statut`

**Body** : `{ "statut": "realisee" }`

| Code | Cas |
|---|---|
| 200 | Statut modifié ; `statut_modifie_par`/`_le` renseignés |
| 409 `SEANCE_ALREADY_PAID` | Séance rattachée à un paiement `approved`/`paid` et passage à `annulee` demandé (FR-006) |
| 404 | Séance inconnue dans le tenant |

### POST `/seances/validate`

**Body**

```jsonc
{ "seanceIds": ["uuid", "..."], "validated": true }
```

**200**

```jsonc
{
  "data": {
    "updated": 12,
    "rejected": [
      { "seanceId": "uuid", "reason": "STATUT_NON_REALISEE" },
      { "seanceId": "uuid", "reason": "HORAIRES_INCOMPLETS" },
      { "seanceId": "uuid", "reason": "SANS_ENSEIGNANT" },
      { "seanceId": "uuid", "reason": "DEJA_PAYEE" }
    ]
  }
}
```

Le lot est **partiellement appliqué** : les séances valides sont traitées, les
autres rejetées avec leur motif. Un rejet ne fait pas échouer les autres — sinon
un lot de 200 séances serait bloqué par une seule anomalie.

### GET `/seances/overlaps`

**Query** : `fromDate`, `toDate`, `enseignantId?`

**200** — paires de séances du même enseignant dont les créneaux se recoupent
(FR-007), à traiter avant validation.

## 2. Tarifs horaires ECUE ➕

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/ecue-rates` | admin | Liste (filtres `ecueId`, `enseignantId`, `activeOn`) |
| POST | `/ecue-rates` | admin | Crée un tarif |
| GET | `/ecue-rates/:id` | admin | Détail |
| PUT | `/ecue-rates/:id` | admin | Édite (mêmes règles de chevauchement) |
| DELETE | `/ecue-rates/:id` | admin | Supprime |
| GET | `/ecue-rates/resolve` | admin | Simule la résolution pour un couple donné |

### POST `/ecue-rates`

**Body**

```jsonc
{
  "ecueId": "uuid",
  "enseignantId": "uuid",   // optionnel — absent = tarif générique de l'ECUE
  "montantHoraire": 12000,
  "devise": "XOF",
  "valideDu": "2026-09-01",
  "valideAu": null,
  "notes": "Tarif intervenant vacataire"
}
```

| Code | Cas |
|---|---|
| 201 | Créé |
| 409 `RATE_OVERLAP` | Chevauchement sur le même couple (ECUE, enseignant) — FR-011 |
| 400 `INVALID_RANGE` | `valideAu < valideDu` |

### GET `/ecue-rates/resolve`

**Query** : `ecueId`, `enseignantId`, `date`

**200**

```jsonc
{
  "data": {
    "montantHoraire": 12000,
    "devise": "XOF",
    "origine": "ecue_enseignant",   // ecue_enseignant | ecue_generique | config_defaut
    "rateId": "uuid"                // null si origine = config_defaut
  }
}
```

**404 `NO_RATE_RESOLVED`** si aucun tarif ni tarif par défaut n'est résoluble
(FR-013) — jamais un montant nul silencieux.

## 3. Espace enseignant ➕

| Méthode | Chemin | Rôle | Notes |
|---|---|---|---|
| GET | `/my/seances` | enseignant | Ses séances validées de la période |
| GET | `/my/payments` | enseignant | Ses paiements, toutes origines |

Le `teacher_id` est **dérivé du jeton** côté serveur ; aucun paramètre
d'enseignant n'est accepté sur ces routes (FR-032).

## 4. Calcul des paiements 🔧

`POST /api/v1/teacher-payments/calculate` — **extension rétrocompatible**.

**Body**

```jsonc
{
  "periodId": "uuid",
  "teacherIds": ["uuid"],       // = inchangé
  "recalculate": false,         // = inchangé
  "scope": "all"                // ➕ "all" (défaut) | "academique" | "professionnel"
}
```

Un appel existant sans `scope` se comporte comme `"all"` : il inclut désormais
les heures professionnelles. C'est le **changement de comportement voulu** de la
feature ; il est signalé comme tel dans le quickstart.

**200** — compte rendu enrichi (FR-026) :

```jsonc
{
  "data": {
    "calculated": 12,
    "skipped": 3,
    "errors": 0,
    "results": [
      {
        "teacherId": "uuid",
        "teacherName": "K. Traoré",
        "status": "calculated",
        "paymentId": "uuid",
        "paymentType": "hourly",
        "totalAmount": 96000,
        "currency": "XOF",
        "regularHours": 8,
        "overtimeHours": 0,
        "hoursBySource": {                 // ➕
          "academique": 5,
          "professionnel": 3
        }
      },
      {
        "teacherId": "uuid",
        "teacherName": "M. Camara",
        "status": "skipped",
        "skipReason": "NO_CONFIG",         // ➕ NO_CONFIG | NO_HOURS | OUT_OF_SCOPE
                                           //    | PAYMENT_LOCKED | NO_RATE_RESOLVED
        "message": "Aucune configuration de paie valide sur la période"
      }
    ]
  }
}
```

> `teacherName` est désormais **réellement renseigné** — l'implémentation
> actuelle renvoie la chaîne `"Unknown"` pour chaque ligne, ce qui rend le
> compte rendu inexploitable.

`skipReason = PAYMENT_LOCKED` couvre FR-025 : un paiement `approved` / `paid` /
`cancelled` n'est jamais écrasé par un recalcul.

## 5. Consultation d'un paiement 🔧

`GET /api/v1/teacher-payments/:id` — le détail horaire gagne l'origine :

```jsonc
{
  "hourDetails": [
    {
      "id": "uuid",
      "source": "professionnel",          // ➕
      "sessionDate": "2026-08-12",        // ➕
      "intitule": "Algorithmique",        // ➕ libellé ECUE ou nom du cours
      "code": "INF101",                   // ➕
      "cohorteLibelle": "Promo 2026 - S1",// ➕ null en académique
      "seanceId": "uuid",                 // ➕ null en académique
      "hoursCount": 3,
      "hourlyRate": 12000,
      "amount": 36000,
      "isOvertime": false
    }
  ]
}
```

Les champs `hoursCount` et `hourlyRate` sont ceux **figés au calcul** (FR-023) :
ils ne sont jamais recalculés à la lecture.

## 6. Rapports 🔧

Toutes les routes de `payment-reports.ts` acceptent un paramètre commun :

| Paramètre | Valeurs | Défaut |
|---|---|---|
| `source` | `all` \| `academique` \| `professionnel` | `all` |

Routes concernées : `GET /summary`, `GET /teacher/:teacherId`,
`GET /period/:periodId`, `GET /list`, `GET /export/:format`.

**Invariant vérifié en test** (SC-007) :
`total(source=academique) + total(source=professionnel) === total(source=all)`.

Le filtre s'applique au **détail** (`payment_hour_details.source`), jamais au
paiement : un paiement mixte apparaît dans les deux filtres, avec des montants
partiels.

## 7. Bulletins PDF 🔧

`GET /api/teacher-payments/:id/pdf` et `/statement` (routes Next.js) : le tableau
détaillé gagne une colonne **Origine** et, pour les lignes professionnelles, le
libellé de la cohorte. Aucun changement de contrat d'appel.

## 8. Codes d'erreur

| Code | HTTP | Signification |
|---|---|---|
| `SEANCE_NOT_FOUND` | 404 | Séance inconnue dans le tenant |
| `SEANCE_ALREADY_PAID` | 409 | Rattachée à un paiement `approved`/`paid` (FR-006) |
| `SEANCE_NOT_PAYABLE` | 422 | Prédicat FR-003 non satisfait ; `blockers` détaille |
| `RATE_OVERLAP` | 409 | Tarif chevauchant sur le même couple (FR-011) |
| `NO_RATE_RESOLVED` | 422 | Aucun tarif ni défaut applicable (FR-013) |
| `PAYMENT_LOCKED` | 409 | Recalcul refusé sur paiement figé (FR-025) |
| `PERIOD_CLOSED` | 400 | = inchangé (période `closed`/`archived`) |
| `TENANT_REQUIRED` | 400 | = inchangé |
| `ACADEMIC_YEAR_REQUIRED` | 400 | = inchangé |

# Quickstart — Restructuration pédagogique Filière → UE → ECUE (030)

## Pré-requis

- Monorepo pnpm installé (`pnpm install`).
- PostgreSQL 14+ accessible ; variables d'environnement de la base (cf. 028/029).
- Branche `030-pedagogie-ue-ecue`.

## 1. Appliquer la migration

```bash
# Applique 0069 (DESTRUCTIVE : supprime les tables professional_subject*/session*)
node scripts/apply-migration-0069-pedagogie-ue-ecue.js
# (ou via le runner SQL du projet sur infra/scripts/migrations/0069_pedagogie_ue_ecue.sql)
```

> ⚠️ `0069` est destructive et à passage unique (D13 : aucune reprise de
> données). À n'exécuter qu'en dev/seed.

## 2. Construire les contrats puis l'API

```bash
pnpm --filter @ecoledigitale/contracts build
pnpm --filter @ecoledigitale/api build
```

## 3. Réensemencer les données de démonstration

```bash
node scripts/seed-professional-module-029.js          # Filière → UE → ECUE, cohortes, séances
node scripts/seed-professional-session-evaluations.js # évaluations/résultats sur le nouveau modèle
```

## 4. Lancer et vérifier

```bash
pnpm --filter @ecoledigitale/api dev   # API :8011
pnpm --filter @ecoledigitale/web dev   # Web
```

### Parcours de validation manuelle

1. **Admin** : créer une Filière (programme existant) → une UE (prix/UV) → deux ECUE → composer l'UE (coefficient/obligatoire/ordre). Vérifier qu'une ECUE peut être rattachée à une 2ᵉ UE d'une autre filière.
2. **Admin** : créer une cohorte d'UE (fenêtre d'inscription ouverte) ; planifier deux séances par ECUE.
3. **Étudiant** : catalogue → l'UE apparaît ; ajouter au panier (prix = prix UE) ; payer ; vérifier l'accès aux **deux** ECUE.
4. **Prérequis** : définir UE-B prérequis = UE-A ; tenter l'inscription à UE-B sans valider UE-A → refus.
5. **Enseignant** : déposer un support sur l'ECUE ; créer un devoir ; marquer la présence sur une séance.
6. **Validation** : noter l'étudiant ≥ 10 sur toutes les ECUE obligatoires → l'UE se valide → UV capitalisées ; vérifier la progression du diplôme (UE de la même filière).
7. **Override** : sur une ECUE en échec (< 10), valider manuellement → l'ECUE devient validée (tracé `valide_par`).

## 5. Tests

```bash
pnpm --filter @ecoledigitale/api test -- professional
```

Suites à mettre à jour : `professional-subjects` → `professional-ecue`,
`professional-prerequisites`, `professional-sessions`, `professional-cart`,
`professional-capacity`, `professional-eligibility`, `professional-completion`,
`professional-catalog-student`, `professional-diplomas.service`.

## Points d'attention

- **Rupture directe** : les endpoints `/subjects*` et `/sessions*` n'existent
  plus ; utiliser `/ecue*`, `/ue*`, `/ue-sessions*`, `/seances*`.
- **Prix/UV** : uniquement sur l'UE ; l'ECUE n'a plus ces champs.
- **Présence** : par **séance** ECUE, pas par session.
- **Visio** : `live_sessions.professional_ecue_seance_id` (l'ancienne colonne
  `professional_subject_session_id` est supprimée).

# S09 — Attestation de réussite

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S07 (UE validées), S02 (signataire d'attestation) |
| **Produit** | Attestation de réussite pour A et B |
| **Budget** | ~35 appels d'outils · **1 capture autorisée** |

> L'attestation n'est pas un petit diplôme. Elle se calcule sur une **filière et une année**,
> là où le diplôme se calcule sur un **cycle entier**. Un étudiant peut donc légitimement avoir
> son attestation sans avoir encore son diplôme. Les deux écrans peuvent diverger sans que ce
> soit un bug : ce qui compte, c'est que chacun soit cohérent avec sa propre règle.

---

## Étapes

### 1. Liste
`/professionnel/admin/attestations`, filtrer sur la classe `L1 TESTOLOGIE <TAG>`.

Relever, pour chacun des trois étudiants, les colonnes **Étudiant**, **Matricule**,
**Année scolaire**, **Crédits validés**, **Statut**.

| Étudiant | Statut attendu |
|---|---|
| A | Validés — toutes les UE de la filière sont acquises |
| B | Validés — idem, après rattrapage |
| C | `N UE restante(s)`, avec **1** UE restante (Comptabilité) |

**Contrôles** :
- Le décompte des UE restantes de C doit valoir **1**, pas 2 : son UE Droit a été validée en
  session 2. Un décompte figé sur les résultats de session 1 est une anomalie **MAJEURE**.
- La colonne **Crédits validés** : relever le chiffre et le pourcentage. Même remarque qu'en
  S07 — préciser s'il s'agit des crédits d'ECUE ou des UV d'UE. Un `0 %` pour un étudiant qui a
  tout validé est **MAJEUR**.
- Le matricule doit être celui saisi en S03 (`<TAG>-A`). Un matricule vide ou remplacé par un
  identifiant technique est **MINEUR**, mais il figurera sur le document officiel : le noter.

### 2. Générer l'attestation de A
Bouton **Générer** sur la ligne d'Aminata. **Une capture** du document.

| Point | Attendu |
|---|---|
| Identité et matricule | conformes à S03 |
| Filière et année scolaire | celles du run |
| Signataire | `Koffi Signataire <TAG>` — qualité `Enseignant Chercheur`, fonction `Directeur des études` |
| Liste des UE | les UE validées de la filière |
| Zones vides | aucune |

La **qualité** du signataire n'existe que sur ce document : si elle est absente alors que le nom
est présent, c'est **MAJEUR** — le champ est renseigné en S02 et se perd donc entre les deux.

### 3. Générer l'attestation de B
Même geste, sans capture. Objectif : confirmer qu'un parcours passé par le rattrapage donne
bien droit à l'attestation.

### 4. Cas négatif
Vérifier que C ne peut **pas** obtenir d'attestation : bouton absent ou désactivé. Une
attestation de réussite délivrable à un étudiant ajourné est une anomalie **MAJEURE**.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Attestation ≠ diplôme | Portées différentes (filière/année vs cycle). Une divergence n'est pas par elle-même une anomalie. |
| Quatrième signataire | Celui de l'attestation est distinct de ceux du diplôme. Vérifier le bon. |
| Document produit côté navigateur | En cas d'échec, regarder la console. |

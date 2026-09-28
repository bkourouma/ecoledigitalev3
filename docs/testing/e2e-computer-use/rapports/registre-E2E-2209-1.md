# Registre de données de campagne

> Unique canal de transmission entre scénarios. Un scénario qui crée un objet **écrit sa ligne
> ici** ; un scénario aval ne devine jamais un identifiant, il le lit ici.
>
> Campagne en cours. Tenant `ecoledigitale`. Web :3000, API :4000.

**Tag de run** : `E2E-2209-1`
**Date** : 22/09/2026

---

## Comptes utilisés

| Rôle | E-mail | Origine | Scénario qui l'a créé |
|---|---|---|---|
| Administrateur | | compte existant / créé | — |
| Enseignant | | | |
| Étudiant | | | |
| Parent | | | |
| Commercial | | | |

## Objets créés

| # | Type | Libellé (porte le tag) | UUID | Scénario | URL de la fiche |
|---|---|---|---|---|---|
| 1 | Cycle | LICENCE E2E-2209-1 | cd818dac-109b-4b7c-9cd5-9afb2790bc68 | S01 | /academic/cycles |
| 2 | Filière | TESTOLOGIE E2E-2209-1 | 4a054d66-5a35-444e-a324-38ff209f3f3d | S01 | /academic/programmes |
| 3 | Classe (programmes) | LICENCE 1 TESTOLOGIE E2E-2209-1 / L1TST01 | 58eafe7d-35a1-4b2f-8062-f69bd9794ffb | S01 | /academic/classes |
| 4 | UE 1 | Comptabilité E2E-2209-1 (UE-COMPTA) — **7 UV OK** | 6baef66e-b5dc-4d9f-9383-f2423cd5ee2c | S01 | /professionnel/admin/ue/6baef66e-... |
| 5 | UE 2 | Droit E2E-2209-1 (UE-DROIT) — **5 UV OK** | b8fd17b5-cc88-4b3b-958b-74ad5b95c16c | S01 | /professionnel/admin/ue/b8fd17b5-... |
| 6 | UE 3 | Conduite E2E-2209-1 (UE-CONDUITE) — **UV à 0, à reprendre (cible 1)** | 7017bd0c-8b62-4e28-9a31-335561d197ff | S01 | /professionnel/admin/ue/7017bd0c-... |
| 7 | ECUE 1-4 | — non créées (S01 interrompu) | | S01 | |
| 8 | Semestre | — non créé (S01 interrompu) | | S01 | |

> L'UUID se lit dans l'URL après création (`/professionnel/admin/ue/<uuid>`), ou dans la
> réponse de la requête de création via `read_network_requests`. Ne va pas le chercher en base.

## Valeurs de référence attendues

> Renseignées par le scénario qui les produit, vérifiées par le scénario qui les consomme.
> C'est ce tableau qui permet de dire qu'un calcul est **faux** plutôt que « surprenant ».

| Grandeur | Valeur attendue (calcul à la main) | Valeur constatée | Écart |
|---|---|---|---|
| Moyenne ECUE 1 de l'étudiant témoin | | | |
| Moyenne UE (pondérée par coefficients) | | | |
| Crédits acquis | | | |
| Taux de présence | | | |
| Montant total dû | | | |
| Solde après paiements | | | |
| Commission commerciale | | | |
| Heures du formateur / montant du bulletin de paie | | | |

## Nettoyage

Tout objet de ce registre porte le tag `E2E-2209-1`. Suppression en fin de campagne dans
l'ordre inverse de création (inscriptions → sessions → semestres → ECUE → UE → classe →
filière), sinon les contraintes de clé étrangère bloquent.

**Aucun objet sans tag ne doit être supprimé**, quelle qu'en soit l'apparence.

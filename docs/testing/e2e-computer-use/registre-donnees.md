# Registre de données de campagne

> Unique canal de transmission entre scénarios. Un scénario qui crée un objet **écrit sa ligne
> ici** ; un scénario aval ne devine jamais un identifiant, il le lit ici.
>
> À dupliquer par campagne : `rapports/registre-<TAG_RUN>.md`.

**Tag de run** : `E2E-JJMM-N`
**Date** : JJ/MM/AAAA

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
| 1 | Filière | | | S01 | |
| 2 | Classe (programme) | | | S01 | |
| 3 | UE | | | S02 | |
| 4 | ECUE | | | S02 | |
| 5 | Semestre | | | S02 | |
| 6 | Ouverture de classe (sessions) | | | S03 | |
| 7 | Créneau d'emploi du temps | | | S03 | |
| 8 | Étudiant | | | S04 | |
| 9 | Inscription | | | S04 | |

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

Tout objet de ce registre porte le tag `E2E-JJMM-N`. Suppression en fin de campagne dans
l'ordre inverse de création (inscriptions → sessions → semestres → ECUE → UE → classe →
filière), sinon les contraintes de clé étrangère bloquent.

**Aucun objet sans tag ne doit être supprimé**, quelle qu'en soit l'apparence.

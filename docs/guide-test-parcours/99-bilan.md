[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](24-actes-de-fin.md)

# Bilan de la recette

## Synthèse à remplir

| Phase | Module | Étapes OK | Étapes KO | Remarques |
| :--- | :--- | :---: | :---: | :--- |
| 1-2 | Connexion, abonnement, rôles, structure | | | |
| 3 | Personnes et imports | | | |
| 4-5 | Admissions, finance | | | |
| 6-7 | Emploi du temps, appel | | | |
| 8-9 | Notes, résultats, bulletins | | | |
| 10-12 | Vie scolaire, conseil de classe, élèves affectés | | | |
| 13-14 | Examens, paie | | | |
| 15-18 | Documents, messagerie, tableaux de bord, portails | | | |
| 19-21 | Sécurité, console, accessibilité | | | |
| 22-23 | Primaire, supérieur | | | |
| 24 | Actes de fin de recette | | | |

## Consigner une anomalie

| Rubrique | Contenu |
| :--- | :--- |
| Étape | numéro et titre (ex. étape 87) |
| Gravité | **Bloquant** (parcours inutilisable, fuite de données, faille de droits) · **Majeur** (fonction qui échoue ou résultat faux, contournable) · **Mineur** (affichage, libellé anglais ou technique, message peu clair) · **Suggestion** |
| Compte / fenêtre | rôle, établissement |
| Résultat obtenu | message recopié mot pour mot |
| Résultat attendu | ce que dit l'étape |
| Console / réseau | erreurs de console ; requêtes en 4xx/5xx (méthode, adresse, code) |
| Reproductible | à chaque fois / parfois / une fois |

Un refus de droit attendu (« Accès refusé », "introuvable") n'est **pas** une anomalie ; une erreur 500 n'est jamais attendue. La première visite d'une page peut être lente en mode développement : rechargez une fois avant de signaler.

## Pour aller plus loin

- Les **chapitres de référence** par module (tous les écrans, cas invalides, droits, écarts constatés) : [`docs/guide-test/README.md`](../guide-test/README.md).
- L'**inventaire des 301 écrans** : [`guide-test/00-inventaire-ecrans.md`](../guide-test/00-inventaire-ecrans.md).
- L'**index de toutes les données fictives créées** (pour le nettoyage) : [`guide-test/jeux-de-donnees/annexe-donnees.md`](../guide-test/jeux-de-donnees/annexe-donnees.md).
- Contrôle automatique des routes et libellés cités : `node scripts/check-guide-test.mjs`.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](24-actes-de-fin.md)

# Modèle de rapport de session

Copier ce modèle dans `docs/qa/e2e/rapports/NN-<rôle>-<pack>.md` (même numéro et même nom que le fichier de session) et le remplir. **Aucun mot de passe, code MFA, jeton ou lien d'invitation** dans ce rapport. Données fictives uniquement. Voir [README.md](README.md) pour le workflow.

---

# Rapport de session NN : <rôle> / <établissement>

## En-tête

| Rubrique | Valeur |
|---|---|
| Compte (rôle affiché dans « Mon compte » ; jamais le mot de passe) | |
| Établissement (nom affiché dans l'en-tête) | |
| Date de la session | AAAA-MM-JJ |
| Heure de début / de fin / durée | |
| Version de l'application (commit ou version affichée ; sinon « non affichée ») | |
| Navigateur et version | |
| Mode hors ligne activé ? | oui / non / non vérifié |
| Session de reprise (passe 2) faite ? | oui / non |

## Parcours exécutés

Résultat : ✅ conforme · ⚠️ conforme avec réserve (constat mineur ou contournement) · ❌ non conforme ou impossible · ⏭️ non testé (voir « Points non testés »).

| Parcours | Intitulé | Réf. guide | Résultat | Constats liés | Remarque |
|---|---|---|---|---|---|
| P1 | | | | | |
| P2 | | | | | |

## Constats

Un constat par anomalie. Numérotation `C-<NN session>-<numéro à deux chiffres>`.

### C-NN-01 : <titre court et précis>

| Rubrique | Contenu |
|---|---|
| Sévérité | Bloquant / Majeur / Mineur / Suggestion |
| Écran / URL | titre de la page et adresse (sans identifiant sensible) |
| Compte / établissement | rôle affiché ; établissement |
| Parcours concerné | P? |
| Étapes pour reproduire | 1. … 2. … 3. … (depuis la connexion si nécessaire) |
| Résultat obtenu | texte exact des messages |
| Résultat attendu | avec la référence du guide si elle existe (Cxx.y) |
| Capture / référence | nom de la capture, ou description de ce qui est visible |
| Console | erreurs de console (texte) |
| Réseau | requêtes en 4xx/5xx : méthode, adresse, code, message |
| Reproductibilité | à chaque fois / parfois / une seule fois |
| Connu ? | non / oui (voir la liste du README `7) |
| Suggestion de correction | |

### C-NN-02 : …

## Contrôles transverses

| Contrôle | Résultat | Détail |
|---|---|---|
| Isolation entre établissements (aucune donnée d'un autre établissement vue) | | |
| Accès interdits refusés (liste des adresses essayées) | | |
| Libellés tous en français | | |
| États vides lisibles | | |
| Clavier (focus visible, aucun piège) | | |
| Aucune erreur 5xx rencontrée | | |

## Données créées (fictives)

| Type | Libellé / référence | Écran | Réversible ? |
|---|---|---|---|

## Actions irréversibles effectuées

| Action | Heure | Cible |
|---|---|---|

## Points non testés et pourquoi

| Parcours / point | Raison (donnée absente, fonction désactivée, bloqué par le constat C-NN-xx, hors ligne non activé, etc.) |
|---|---|

## Reprise (passe 2)

(Si le fichier de session a une section « 5 bis » : mêmes tableaux pour les parcours de reprise.)

## Synthèse (3 lignes)

- Bloquant : n · Majeur : n · Mineur : n · Suggestion : n
- Principal risque :
- Recommandation :

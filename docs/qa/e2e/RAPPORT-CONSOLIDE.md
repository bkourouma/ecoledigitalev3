# Rapport consolidé de la QA de bout en bout

Fichier de collecte **unique**, alimenté par la session « Claude web consolidation » à partir des rapports individuels de [rapports/](rapports/). Il sert ensuite de liste de travail au développeur. Voir [README.md](README.md) pour le workflow et [MODELE-RAPPORT.md](MODELE-RAPPORT.md) pour le format d'un rapport.

> Aucun mot de passe, code MFA, jeton ou lien d'invitation dans ce fichier. Données fictives uniquement.

## 0. Consigne pour la session « Claude web consolidation » (à coller)

> Tu es chargé de **consolider** les rapports de QA de l'application EcoleDigitale v2. Entrées : tous les fichiers `docs/qa/e2e/rapports/NN-<rôle>-<pack>.md` (si tu ne peux pas lire le dépôt, la personne qui te lance te colle leur contenu). Sortie : le contenu **complet et mis à jour** de `docs/qa/e2e/RAPPORT-CONSOLIDE.md` (écris le fichier si tu peux, sinon réponds avec le Markdown complet dans un seul bloc).
>
> Règles :
> 1. **Rien d'inventé** : n'ajoute aucun constat qui ne soit pas dans un rapport source ; ne change pas un fait ; ne déduis pas une cause technique sans le dire (« hypothèse »).
> 2. **Aucun secret** : supprime tout mot de passe, code MFA, jeton, lien d'invitation ou de réinitialisation qui aurait été collé par erreur ; n'en reproduis aucun.
> 3. **Dédoublonne** : deux constats sont le même problème si leur symptôme est identique sur le même écran ou la même fonction (même si les comptes ou les établissements diffèrent). Garde UNE ligne, liste tous les comptes et établissements concernés, garde la **sévérité la plus haute** (en expliquant si elle varie selon le rôle), garde toutes les références d'origine (`C-12-03`, `C-27-01`...). Un même symptôme sur des écrans différents reste deux constats liés (« voir aussi »).
> 4. **Numérote** les constats consolidés `K-001`, `K-002`... (ordre : sévérité décroissante, puis module). Renseigne les sections 2 (sévérité), 3 (tableau récapitulatif), 4 (corrections à faire) et 5 (couverture), sans supprimer les constats déjà présents : mets à jour leur statut.
> 5. **Statut** : À trier (nouveau) / Confirmé (vu dans plusieurs rapports ou reproduit) / Connu (déjà dans la liste « défauts déjà connus » du README) / En cours / Corrigé / Non reproduit / Hors périmètre. Colonne **Correctif** : la suggestion des rapports (reformulée, sans inventer), vide si aucune.
> 6. **Sécurité d'abord** : toute fuite d'isolation (donnée d'un autre établissement ou d'une autre famille) ou de droits est classée **Bloquant** et mise en tête de la section 4.
> 7. Section 5 : liste ce qui n'a PAS été testé (par session) et pourquoi, en fusionnant les « Points non testés » ; signale les sessions dont le rapport est absent.
> 8. Termine par une synthèse de 5 lignes : nombre de constats par sévérité, trois risques principaux, ce qu'il reste à tester.

## 1. Synthèse

| Indicateur | Valeur |
|---|---|
| Date de consolidation | |
| Version de l'application (commit) | |
| Sessions prévues / rapports reçus | 35 / |
| Constats bruts (avant dédoublonnage) | |
| Constats consolidés | |
| Bloquant / Majeur / Mineur / Suggestion | / / / |
| Fuites d'isolation ou de droits constatées | |

## 2. Constats par sévérité

### 2.1 Bloquant

(Un bloc par constat consolidé.)

#### K-001 : <titre>
- Sévérité : Bloquant
- Comptes / établissements : …
- Écrans / URL : …
- Résumé et étapes : …
- Résultat obtenu / attendu : …
- Console / réseau : …
- Références d'origine : C-NN-xx, …
- Statut : À trier
- Correctif suggéré : …

### 2.2 Majeur

### 2.3 Mineur

### 2.4 Suggestion

## 3. Tableau récapitulatif

| Constat | Compte | Écran | Sévérité | Statut | Correctif |
|---|---|---|---|---|---|
| K-001 : … | rôle / établissement | titre ou adresse | Bloquant | À trier | |

## 4. Corrections à faire (liste de travail pour le développeur)

Ordre : sécurité et isolation, puis Bloquant, Majeur, Mineur, Suggestion. Cocher quand corrigé et re-testé.

### 4.1 Sécurité, isolation et droits

- [ ] K-… : …

### 4.2 Bloquant

- [ ] K-… : … (fichier ou module probable : à confirmer par le développeur)

### 4.3 Majeur

- [ ] K-… : …

### 4.4 Mineur

- [ ] K-… : …

### 4.5 Suggestions

- [ ] K-… : …

### 4.6 Re-tests à demander après correction

| Constat | Session à rejouer | Parcours |
|---|---|---|

## 5. Couverture

### 5.1 Rapports reçus

| Session | Rapport | Date | Parcours ✅ / ⚠️ / ❌ / ⏭️ |
|---|---|---|---|

### 5.2 Points non testés (fusionnés) et raisons

| Point | Sessions concernées | Raison |
|---|---|---|

### 5.3 Isolation croisée entre établissements (partie C)

| Établissement testeur | Identifiants des autres établissements utilisés | Résultat |
|---|---|---|

## 6. Annexes

- Défauts connus rencontrés (non comptés comme nouveaux) : …
- Questions métier soulevées (à ne pas trancher ici ; voir `specs/v2/QUESTIONS-A-VALIDER.md`) : …

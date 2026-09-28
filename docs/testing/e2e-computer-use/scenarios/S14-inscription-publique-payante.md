# S14 — Tunnel d'inscription publique et paiement en ligne

| | |
|---|---|
| **Rôle** | Visiteur public, puis Administrateur (étape 5) |
| **Prérequis** | Une formation publiée au catalogue des formations professionnelles |
| **Produit** | Un état des lieux du tunnel public — inscription, paiement, facture |
| **Budget** | ~50 appels d'outils · **2 captures** |

> **Ce scénario ne validera probablement pas un paiement de bout en bout, et ce n'est pas son
> but.** Son but est d'établir précisément **où** le tunnel s'arrête en environnement de
> développement, et si ce qu'il affiche avant de s'arrêter est juste. Un tunnel de paiement qui
> montre un montant faux est plus dangereux qu'un tunnel qui ne marche pas.

**Aucun paiement réel.** Si l'un des moyens de paiement conduit à un vrai formulaire bancaire ou
à une vraie page d'opérateur demandant un numéro de téléphone réel, **s'arrêter immédiatement**
et le signaler comme point bloquant à trancher par un humain.

---

## Étapes

### 1. Catalogue public
`/formations-professionnelles/catalogue` — relever une formation disponible avec une session
ouverte, son intitulé et **son prix affiché**. Le noter : c'est la référence de tout le
scénario.

Si le catalogue est vide, créer au préalable une formation et une session depuis
`/formations-professionnelles/catalogue/new` (rôle administrateur), en la taguant `<TAG>`, puis
revenir ici.

### 2. Inscription
`/formations-professionnelles/inscription/catalogue/<slug>` ou
`/formations-professionnelles/inscription/session/<sessionId>` → remplir le formulaire avec
l'identité `Public Testeur <TAG>`, e-mail `public.<tag>@example.test`.

Relever `INSCRIPTION_ID` dans l'URL de redirection.

### 3. Page de paiement — **le contrôle central**
`/formations-professionnelles/inscription/paiement/<INSCRIPTION_ID>`. **Une capture.**

| Contrôle | Attendu | Si l'écart existe |
|---|---|---|
| Montant affiché | **celui de l'étape 1** | anomalie **BLOQUANTE** — préciser les deux montants |
| Numéro d'inscription | celui de l'étape 2 | anomalie **BLOQUANTE** — préciser les deux valeurs |
| Moyens proposés | Orange Money, MTN Money, Wave, Carte Bancaire, TresorPay | relever la liste réelle |

> Soupçon à vérifier explicitement : cette page pourrait afficher des valeurs **codées en dur**,
> identiques quelle que soit la formation choisie. Le test qui tranche : refaire les étapes 1-3
> avec **une autre formation, de prix différent**, et comparer. Si les deux affichent le même
> montant, l'anomalie est établie — c'est alors le point le plus grave de la chaîne financière,
> puisque le client voit un prix qui n'est pas le sien. La formuler avec les deux formations,
> leurs deux prix catalogue, et le montant unique affiché.

### 4. Initier un paiement
Choisir **TresorPay**, bouton **Procéder au paiement**.

Résultats possibles, tous à documenter tels quels :

| Ce qui se passe | Lecture |
|---|---|
| Redirection vers une URL `/payments/mock?...` qui aboutit à une **page inexistante** | anomalie **MAJEURE** : le mode simulé de développement renvoie vers un écran qui n'existe pas — le tunnel est intestable en local |
| Redirection vers un vrai prestataire | **s'arrêter**, ne rien saisir, le signaler |
| Erreur immédiate | relever le code HTTP et le message de `POST /api/v1/paiements-pro/initier` |

Ne pas insister au-delà de deux tentatives, et ne pas essayer les autres opérateurs un par un :
une tentative sur un second moyen suffit à établir si le comportement est général ou propre à
TresorPay.

### 5. État côté administration
Se connecter en administrateur et retrouver l'inscription publique dans la liste des
inscriptions professionnelles.

| Contrôle | Attendu |
|---|---|
| L'inscription existe | oui, même si le paiement n'a pas abouti |
| Statut | cohérent avec un paiement non abouti (`en_attente_paiement`) |
| Montant | celui du catalogue, **pas** celui de l'écran de paiement s'ils divergent |

Ce dernier point est décisif : si la base porte le bon montant et que seul l'écran ment, le
correctif est superficiel. Si la base porte le mauvais montant, le défaut est structurel. Dire
lequel des deux cas on observe.

### 6. Facture
Tenter `Télécharger la facture` depuis la page de confirmation
(`/formations-professionnelles/inscription/confirmation/<INSCRIPTION_ID>`). **Une capture** si
elle sort. Une facture émise pour un paiement non abouti serait une anomalie **MAJEURE** :
préciser si elle porte une mention d'impayé.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Tunnel public ≠ inscription admin | Ce sont deux chemins distincts vers le même module. Ne pas confondre avec S03. |
| Mode simulé partiel | Le repli de développement existe côté serveur mais l'écran d'arrivée peut manquer. |
| Aucun paiement réel | Règle absolue. Au moindre doute, arrêt et signalement. |
| Deux formations pour trancher | C'est le seul moyen de prouver un montant codé en dur. Ne pas sauter cette comparaison. |

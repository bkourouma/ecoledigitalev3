# Prompt — sixième passe, campagne `E2E-2209-1`

> À coller dans Claude (web, extension navigateur). **Autonome : rien à joindre.** Les cinq
> scénarios sont intégrés plus bas, chacun précédé d'un encadré **Ajustements** qui
> **prime sur le texte du scénario** en cas de contradiction.

---

Tu reprends la campagne de test d'EcoleDigitale en local (`http://localhost:3000`, tenant
`ecoledigitale`). Le parcours programme → diplôme est terminé et validé. Cette passe couvre ce
qui **n'a jamais été joué** : la fin du volet financier et le parcours académique classique.

**Ordre imposé, du plus risqué au moins risqué.** Si le temps ou l'attention manquent,
arrête-toi après le Temps 2 et rends ton rapport : les deux premiers temps sont ceux où la
lecture du code signale déjà des défauts probables.

| Temps | Scénario | Pourquoi dans cet ordre |
|---|---|---|
| 1 | **S14** — inscription publique et paiement en ligne | Soupçon de **montant codé en dur** sur la page de paiement : un client verrait un prix qui n'est pas le sien |
| 2 | **S15 puis S16** — parcours académique | Soupçon de **bulletins impossibles** hors cycle « BTS » ; jamais joué |
| 3 | **S12** — commissions de prospection | Données de paiement déjà en place |
| 4 | **S13** — rémunération du formateur | **Périmètre réduit**, voir ses ajustements |

---

## Comptes

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → cliquer la
ligne du compte → **Se connecter**.

| Rôle | Compte | Mot de passe |
|---|---|---|
| Admin | `admin@ecoledigitale.local` | `Password@2025` |
| Enseignante des séances du run | `adjoua.brou@ecoledigitale.test` | `qvP2KbaeV%Dr` *(propre à ce compte ; le panneau le remplit seul)* |
| Enseignante créée par le run | `awa.formatrice.e2e22091@example.test` | `zQmU?jXJGW9m` |
| Étudiante (Aminata) | `aminata.e2e22091@example.test` | `%hR5ae@@QXyb` |

---

## Règles de prudence — non négociables

Cette base contient de **vraies données** d'établissement à côté des données de test.

1. **Aucun paiement réel.** Devant un vrai formulaire bancaire ou une page d'opérateur
   demandant un vrai numéro : arrêt immédiat, et tu le signales.
2. **Tout ce que tu crées porte le tag `E2E-2209-1`.** Tu ne modifies ni ne supprimes jamais un
   objet qui ne le porte pas.
3. **Tu n'actives jamais une année académique.** L'activation bascule tout l'établissement
   (voir S15).
4. **Tu ne génères, n'archives ni ne marques « versé » aucun bulletin de paie.** Ces gestes
   sont collectifs : ils toucheraient la paie d'enseignants réels (voir S13).

Pièges d'environnement, déjà connus : première compilation d'une page jusqu'à une minute ; une
page qui a échoué reste figée sur l'erreur même une fois l'API revenue — **recharge avant de
conclure** ; champs remplis au clavier, validation par clic ; un clic sur un champ **fichier**
ouvre une fenêtre Windows que tu ne peux pas piloter : fais-toi aider plutôt que de rester
bloqué.

---

## Temps 1 — S14, inscription publique et paiement en ligne

> **Ajustements**
> - Le point central est l'étape 3 : **comparer deux formations de prix différents**. Si la page
>   de paiement affiche le même montant pour les deux, le défaut est établi — c'est la
>   constatation la plus importante de toute cette passe.
> - L'étape 5 décide de la gravité : si la **base** porte le bon montant et que seul l'**écran**
>   ment, le correctif est superficiel ; sinon il est structurel. Dis lequel des deux.
> - Identités à utiliser : `Public Testeur E2E-2209-1`, e-mails en `@example.test`.

*Scénario complet en annexe : S14.*

---

## Temps 2 — S15 puis S16, parcours académique classique

> **Ajustements — S15**
> - **Étape 7 : ne crée PAS d'année académique et n'en active aucune.** L'année active est
>   **2025-2026** : utilise-la. Ajoute-lui seulement une période `Semestre 1 E2E-2209-1`.
>   Activer une nouvelle année basculerait tout l'établissement, vraies données comprises. Si
>   l'ajout d'une période à l'année active t'est refusé, arrête-toi et signale-le.
> - Étape 1 : le nommage du cycle `BTS E2E-2209-1` est le seul contournement autorisé, et il
>   sert précisément à documenter le filtre qui l'impose. Signale ce filtre, puis joue le reste.
> - Étape 9 : l'upload du dernier diplôme est obligatoire.
>
> **Ajustements — S16**
> - Pour l'affectation, utilise l'enseignante **Awa Formatrice E2E-2209-1**.
> - La moyenne attendue est **12,00** : un écart vaut anomalie majeure, avec les notes, les
>   coefficients et la valeur obtenue.

*Scénarios complets en annexe : S15, S16.*

---

## Temps 3 — S12, commissions de prospection

> **Ajustements — ils corrigent le scénario sur deux points**
>
> **Les montants attendus.** Aminata a réglé 250 000 en passe 4 : **50 000**, puis un solde de
> 200 000 réparti sur deux UE, soit **deux paiements de 100 000** (reçus `000004` et `000005`).
> Une commission naît **par paiement de scolarité**, arrondie paiement par paiement. Avec un
> taux de 10 % :
>
> | Paiement | Montant | Commission attendue |
> |---|---|---|
> | `REC-PRO-2026-000003` | 50 000 | **5 000** |
> | `REC-PRO-2026-000004` | 100 000 | **10 000** |
> | `REC-PRO-2026-000005` | 100 000 | **10 000** |
> | | | **Total 25 000** |
>
> **Le test du taux figé (étape 5) — le scénario teste le mauvais geste.** Dans ce projet, le
> taux figé est celui **porté par la fiche de l'étudiant** au moment de la saisie de sa
> provenance. Ce qui ne doit rien réécrire, c'est la **renégociation avec le commercial**.
> Donc : modifie le **taux par défaut du commercial** (passe-le à 20 %), puis vérifie que les
> commissions d'Aminata restent à **25 000**. Si elles passent à 50 000, c'est une anomalie
> majeure : la rémunération du passé se réécrirait toute seule. Remets ensuite le taux du
> commercial à 10 %.
>
> **Autres précisions.**
> - Seul le canal **commercial** ouvre droit à commission. L'écran « Amenés par un commercial »
>   ne liste que ce canal ; la provenance des autres étudiants se saisit sur **la fiche de
>   l'étudiant**.
> - Le contrôle sur Bakary est faible par construction : il n'a rien payé, il ne peut donc rien
>   générer. Note-le quand même, sans en tirer de conclusion.
> - Le montant de scolarité de l'étudiant n'est volontairement pas affiché sur les écrans de
>   commission : son absence n'est pas une anomalie.

*Scénario complet en annexe : S12.*

---

## Temps 4 — S13, rémunération du formateur — périmètre réduit

> **Ajustements — lis-les AVANT le scénario, ils en retirent la moitié**
>
> **La génération des bulletins de paie est collective** : le bouton « Générer les bulletins de
> cette période » calcule la paie de **tous** les enseignants de la période, pas seulement celle
> du test. « Tout archiver » et « Marquer versé » suivent. Dans une base qui contient de vrais
> enseignants, ces gestes toucheraient leur paie réelle.
>
> **Tu joues donc uniquement :**
> - **Étape 1** — le tarif horaire sur `Comptabilité générale E2E-2209-1`, et le **refus du
>   chevauchement** (c'est le test le plus utile de ce scénario) ;
> - **Étape 2** — la validation des trois séances du run. Attention : elles ont été tenues par
>   **Adjoua Brou**, pas par Awa Formatrice (effet de bord d'une passe précédente). Six heures au
>   total, les 07, 14 et 21/09/2026 ;
> - **Étape 3** — le calcul du montant attendu (6 h × 5 000 = **30 000**), à porter dans ton
>   rapport.
>
> **Tu ne joues PAS les étapes 4 à 6** (génération, archivage, versement, vue enseignant sur un
> bulletin versé). Note-les « non jouées — geste collectif, à tester sur une copie isolée de la
> base ». Ce n'est pas une anomalie de l'application, c'est une limite de l'environnement.
>
> Les séances appartiennent à un semestre **clôturé** : si leur validation est refusée pour
> cette raison, relève le message exact — c'est une information, pas forcément un défaut.

*Scénario complet en annexe : S13.*

---

## Ce que j'attends en retour

Pour chaque scénario : le tableau de ses étapes (OK, KO, non jouée), et une fiche par
anomalie — URL, geste, attendu, constaté, requête en cause si tu la vois.

Puis, dans cet ordre :

1. **Le verdict sur le paiement en ligne (S14)** : montant codé en dur, oui ou non ; et si oui,
   écran seulement ou base aussi.
2. **Le verdict sur les bulletins académiques (S16)** : se génèrent-ils, et avec la bonne
   moyenne ?
3. Les anomalies classées bloquante / majeure / mineure.
4. **Ce que tu n'as pas pu vérifier.**
5. **Les données créées**, y compris la période ajoutée à l'année 2025-2026, pour qu'on sache
   quoi nettoyer.

---
---

# Annexe — les cinq scénarios

Rappel : en cas de contradiction, **les encadrés Ajustements ci-dessus priment.**

### S14 — Tunnel d'inscription publique et paiement en ligne

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


---

### S15 — Parcours académique : socle, année, classe, inscription

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | Aucun — chaîne indépendante, peut tourner en parallèle de la chaîne A |
| **Produit** | `CYCLE_BTS_ID`, `PROG_ACA_ID`, `ANNEE_ID`, `PERIODE_ID`, `CLASSE_ANNEE_ID`, une inscription académique |
| **Budget** | ~60 appels d'outils |

> **Le parcours académique ne délivre pas de diplôme.** Il s'arrête aux bulletins et aux relevés
> de notes ; le diplôme n'existe que dans le module professionnel. Ce n'est pas une anomalie à
> signaler : c'est la conception actuelle. Ce que cette chaîne vérifie, c'est que le parcours va
> bien jusqu'à **son** terme à lui.

---

## Un choix de nommage à comprendre avant de commencer

Le cycle de cette chaîne doit s'appeler **`BTS <TAG>`** — le mot `BTS` est obligatoire.

Raison : l'écran de saisie des moyennes et de génération des bulletins ne liste que les classes
dont le **cycle contient « bts »** dans son nom ou son code. Avec un cycle nommé autrement, le
sélecteur de classe reste vide et la chaîne s'arrête sans message d'erreur.

Ce filtre est **lui-même une anomalie MAJEURE à signaler une fois** (« un établissement qui
n'ouvre pas de BTS ne peut générer aucun bulletin »), mais on le contourne ici sciemment —
c'est le seul contournement autorisé de toute la campagne, et il est documenté comme tel. Le
signaler dès l'étape 1, puis jouer le reste normalement.

---

## Étapes

### 1. Cycle
`/academic/cycles/new` → *Nom du cycle* `BTS <TAG>`, *Type* **Académique**,
*Niveau de certification* `Bac+2`. **Enregistrer**.

### 2. Filière
`/academic/programmes/new` → `GESTION <TAG>`. **Enregistrer**.

### 3. Type de bilan
`/annee-academique/types-de-bilan` → libellé `Semestriel <TAG>`. **Ajouter**.

> Cette page n'est accessible que par URL directe (absente du menu). Son absence du menu se
> signale en **MINEURE**, une fois : c'est pourtant un prérequis obligatoire de la création des
> matières, donc un administrateur non guidé se retrouve bloqué sans savoir pourquoi.

### 4. Classe (au sens « programme »)
`/academic/classes/new` → *Cycle* `BTS <TAG>`, *Filière* `GESTION <TAG>`,
*Nom de la classe* `BTS 1 GESTION <TAG>`, *Code* `B1G<NN>`. **Enregistrer**.
Relever `PROG_ACA_ID`.

### 5. Matières
`/academic/courses/new` → *Programme* `BTS 1 GESTION <TAG>`, *Type de bilan* `Semestriel <TAG>`.

| Matière | COEF |
|---|---|
| `Mathématiques <TAG>` | 3 |
| `Économie <TAG>` | 2 |

**Enregistrer**. Les coefficients sont choisis pour rendre la moyenne pondérée vérifiable en
S16 : les saisir exactement.

### 6. Salle
`/academic/classrooms/new` → `Salle ACA <TAG>`, code `SA<NN>`. **Créer**.

### 7. Année académique et période
`/annee-academique/demarrer` :
1. *Nom* de l'année : `<année en cours>-<année+1> <TAG>` → **Créer**, puis **Activer**.
2. Période : *Nom* `Semestre 1 <TAG>`, dates couvrant le mois en cours et le suivant → valider.

**Contrôle** : l'activation est un prérequis de tout le reste. Si l'année n'est pas activable,
c'est **BLOQUANT**. Noter aussi ce qu'il advient de l'année précédemment active — bascule
silencieuse ou avertissement.

### 8. Classe d'année
`/annee-academique/ajouter-classe/new` → *Programme* `BTS 1 GESTION <TAG>`,
*Nom de la classe* `BTS1-G-<TAG>`. **Créer la classe**. Relever `CLASSE_ANNEE_ID`.

> Deux objets portent le nom de « classe » dans ce parcours : celui de l'étape 4 (un programme)
> et celui-ci (une classe rattachée à une année). Le registre doit distinguer les deux sans
> ambiguïté, sinon S16 se trompera de cible.

### 9. Étudiant
`/academic/students/new` → `Diallo Academique <TAG>`, matricule `<TAG>-ACA`, e-mail
`diallo.<tag>@example.test`. Mêmes réserves qu'en S03 sur l'**upload obligatoire** du dernier
diplôme : en cas d'impossibilité, s'arrêter et le signaler plutôt que de contourner.

### 10. Inscription
`/annee-academique/inscription/new` → *Étudiant* celui de l'étape 9, *Classe* `BTS1-G-<TAG>`,
date d'inscription du jour, frais laissés à leurs valeurs par défaut. Valider.

**Contrôle** : vérifier dans `/annee-academique/classes/<CLASSE_ANNEE_ID>` (onglet Étudiants)
que l'étudiant y figure. Une inscription enregistrée mais invisible dans sa classe est
**BLOQUANTE** pour S16.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Filtre « BTS » codé en dur | Signalé en étape 1, puis contourné par le nommage. Seul contournement autorisé de la campagne. |
| Deux sens de « classe » | Programme (étape 4) vs classe d'année (étape 8). À distinguer au registre. |
| Type de bilan hors menu | Prérequis invisible des matières. MINEURE, mais à signaler. |
| Année non activée | Bloque `ajouter-classe`, `inscription` et `moyennes-semestre` d'un coup, avec un simple bandeau. |


---

### S16 — Parcours académique : présences, moyennes, bulletins, relevé

| | |
|---|---|
| **Rôle** | Administrateur (et Enseignant si l'affectation l'exige) |
| **Prérequis** | S15 (année active, classe d'année, étudiant inscrit, deux matières) |
| **Produit** | Créneaux, présences, moyennes semestrielles, bulletin académique, relevé de notes |
| **Budget** | ~60 appels d'outils · **1 capture** (le bulletin) |

---

## Étapes

### 1. Affectation enseignant ↔ matière ↔ classe
`/academic/assignments/new` → *Classe* `BTS1-G-<TAG>`, *Cours* `Mathématiques <TAG>`,
*Enseignant* (celui du run ou un enseignant existant), *Type de contrat*, dates couvrant la
période, *Montant* renseigné. **Enregistrer**. Répéter pour `Économie <TAG>`.

### 2. Générer les créneaux
`/academic/assignments` → bouton **Générer les créneaux**.

Attendu : des séances apparaissent ensuite dans `/attendance`.

**Contrôle** : c'est le seul prérequis réel de la saisie de présence — sans créneau, la liste
des séances reste vide. Si aucun créneau n'est produit alors que les deux affectations existent,
c'est **BLOQUANT** : relever le retour de l'appel et le nombre de créneaux annoncé.

> Il existe une seconde voie, la génération d'emploi du temps (`/simple-schedule`). Elle n'est
> **pas** obligatoire : ne pas la jouer ici, et ne pas signaler son absence d'usage.

### 3. Présences
`/attendance` → ouvrir la première séance de `Mathématiques <TAG>`.
Passer l'étudiant à **Absent**, **Enregistrer**. Rouvrir une fois : le statut doit tenir.

Ouvrir une seconde séance, le laisser **Présent**, **Enregistrer**.

**Contrôle** : une séance qui s'ouvre sur « Session introuvable » alors qu'elle figure dans la
liste est une anomalie **MAJEURE**.

### 4. Moyennes semestrielles
`/annee-academique/moyennes-semestre` → *Semestre* `Semestre 1 <TAG>`, *Classe* `BTS1-G-<TAG>`.

Si le sélecteur de classe est vide, c'est que le cycle ne contient pas « BTS » : revoir S15
étape 1. Autrement dit, ce vide-là n'est pas un bug ici, c'en est la conséquence.

Saisir :

| Matière | COEF | Note |
|---|---|---|
| `Mathématiques <TAG>` | 3 | **14** |
| `Économie <TAG>` | 2 | **9** |

Assiduité : la renseigner conformément à l'étape 3 (une absence sur deux séances).

**Moyenne générale attendue** : `(14 × 3 + 9 × 2) / 5 = 60 / 5 = **12,00**`.

Enregistrer la grille, puis relever la moyenne affichée. Un écart est une anomalie **MAJEURE** :
donner les notes, les coefficients et la moyenne obtenue — c'est presque toujours un
coefficient ignoré (qui donnerait 11,50) ou un arrondi non documenté.

### 5. Bulletin
Bouton **Générer les bulletins** pour la classe, puis bouton **Bulletin** sur la ligne de
l'étudiant. **Une capture.**

| Point | Attendu |
|---|---|
| Identité et matricule | `<TAG>-ACA` |
| Les deux matières, leurs coefficients, leurs notes | conformes à l'étape 4 |
| Moyenne générale | **12,00** |
| Assiduité | cohérente avec les présences saisies |
| Année et période | celles du run |

### 6. Attestations
Bouton **Générer les attestations** depuis le même écran. Relever ce qui est produit et à quel
titre. Si le document sort vide ou identique au bulletin, le signaler en **MAJEURE** avec la
différence attendue.

### 7. Relevé de notes (saisie manuelle)
`/annee-academique/releves-de-notes` — accessible uniquement par URL directe.

Créer un relevé : *Étudiant* du run, *Année académique* du run, *Date du relevé* du jour,
*Total crédits* `30`, *Moyenne générale (GPA)/20* `12`, fichier PDF si l'upload est possible.

**Deux constats à porter au rapport :**
1. Le lien de cette page est **retiré du menu** : une fonctionnalité en service mais
   inatteignable sans connaître l'URL. **MINEURE** d'ergonomie, à signaler une fois — de même
   pour `/annee-academique/rapports-de-presence`.
2. Ce relevé est **entièrement manuel** : ni la moyenne ni les crédits ne sont repris du
   bulletin de l'étape 5. Vérifier qu'aucun pré-remplissage n'existe, puis poser la question au
   rapport, dans les points à trancher : *un relevé ressaisi à la main peut contredire le
   bulletin calculé — est-ce voulu ?*

### 8. Rapport de présence
`/annee-academique/rapports-de-presence` — également hors menu. Créer un rapport pour
l'étudiant : *Total jours* `2`, *Jours présents* `1`, *Jours absents* `1`.

**Contrôle** : tenter une saisie incohérente (présents + absents **supérieurs** au total). Un
refus est attendu ; une acceptation est une anomalie **MAJEURE**.

Comparer ensuite ces chiffres à ce que l'application a réellement enregistré à l'étape 3 : là
encore, saisie manuelle contre données calculées. Noter si les deux peuvent diverger sans que
rien ne l'indique.

### 9. Contrôle de fin de chaîne
Vérifier explicitement qu'**aucun écran de ce parcours ne propose de délivrer un diplôme**, et
le consigner. C'est la réponse factuelle à la question de départ : dans l'état actuel du
produit, « de la création du programme à la délivrance du diplôme » n'est réalisable que par le
module professionnel (chaîne A).

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux systèmes de notes | Les devoirs/évaluations (`/academic/evaluations`) sont distincts de la grille des moyennes semestrielles. Seule la grille alimente le bulletin. Ne pas mélanger. |
| `/annee-academique/bulletins` | Cette URL n'a pas de page : ne pas y aller, le bulletin se génère depuis `moyennes-semestre`. Un 404 y est attendu. |
| Pages hors menu | Relevés et rapports de présence : MINEURES d'ergonomie, signalées une fois. |
| Saisies manuelles | Relevé et rapport de présence ne calculent rien. Le signaler comme question de conception, pas comme bug. |


---

### S12 — Prospection : commercial, provenance, commission

| | |
|---|---|
| **Rôle** | Administrateur |
| **Prérequis** | S11 (au moins un paiement confirmé sur Aminata) |
| **Produit** | `COMMERCIAL_ID`, provenance rattachée à A, une commission calculée puis réglée |
| **Budget** | ~50 appels d'outils |

> Une commission n'est **jamais stockée** : elle se recalcule à chaque affichage, à partir des
> paiements confirmés et du taux **figé sur la provenance de l'étudiant** au moment où elle a
> été saisie. D'où l'ordre de ce scénario : le commercial et la provenance d'abord, le contrôle
> du montant ensuite, et surtout un test explicite de ce qui se passe quand on change le taux
> après coup.

---

## Étapes

### 1. Créer un commercial
`/professionnel/admin/prospection/commerciaux` → nom `Moussa Commercial <TAG>`,
taux de commission par défaut **10 %**. Enregistrer. Relever `COMMERCIAL_ID`.

### 2. Rattacher une provenance à Aminata
`/professionnel/admin/prospection/provenances` → pour Aminata (A) : canal **commercial**,
commercial `Moussa Commercial <TAG>`, taux **10 %**.

**Contrôle** : vérifier qu'un canal **autre que « commercial »** n'ouvre pas droit à commission —
sélectionner un autre canal sur Bakary (B), sans commercial, et vérifier en étape 4 qu'aucune
commission n'apparaît pour lui. Une commission attribuée hors canal commercial est une anomalie
**MAJEURE**.

### 3. Calcul attendu
Aminata a réglé en S11 : 50 000 puis le solde. La commission attendue vaut
**10 % de chaque paiement confirmé**, arrondi à l'unité :

| Paiement | Montant | Commission attendue |
|---|---|---|
| 1 | 50 000 | **5 000** |
| 2 | solde relevé en S11 | **10 % du solde, arrondi** |
| | | **Total : 10 % du total encaissé** |

Reporter ces trois valeurs au registre **avant** de regarder l'écran. Comparer ensuite.

### 4. Vérifier les lignes de commission
`/professionnel/admin/prospection/commissions` puis
`/professionnel/admin/prospection/commissions/historique` (titre : « Commissions à payer »).

| Contrôle | Attendu |
|---|---|
| Une ligne par paiement confirmé d'Aminata | oui |
| Montant de chaque ligne | conforme au tableau ci-dessus |
| Bakary | aucune ligne (canal non commercial) |
| Chantal | aucune ligne (aucun paiement) |

Tout écart de montant est **MAJEUR** : donner l'assiette retenue par l'application (montant du
paiement ? montant de la commande ? total dû ?) telle qu'on peut la déduire du chiffre affiché.
C'est la question la plus utile de ce scénario : une commission assise sur autre chose que le
paiement encaissé se paie en argent réel.

### 5. Test du taux figé
Revenir sur la provenance d'Aminata et porter le taux à **20 %**. Enregistrer, puis rouvrir
l'écran des commissions.

Attendu : les commissions **déjà nées** des paiements antérieurs **ne bougent pas** — le taux
est figé au moment de la saisie de la provenance. Si elles passent rétroactivement à 20 %, c'est
une anomalie **MAJEURE** : la rémunération du passé se réécrit toute seule.

Remettre ensuite le taux à 10 % et noter si ce retour en arrière a, lui aussi, un effet
rétroactif.

### 6. Règlement
Sur « Commissions à payer » : sélectionner la première ligne → bouton
**Marquer payé — 1 ligne(s), {montant} FCFA**.

Attendu : la ligne quitte cet écran et se retrouve dans
`/professionnel/admin/prospection/commissions/historique/payees`, avec le même montant.

**Contrôles** :
- Le montant annoncé sur le bouton doit être exactement celui de la ligne sélectionnée.
- Une ligne déjà payée ne doit pas pouvoir l'être deux fois. Vérifier qu'elle n'est plus
  proposée. Un double règlement possible est **MAJEUR**.
- Utiliser ensuite **Tout marquer payé (N)** pour le reste, et vérifier la cohérence du total.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Commission recalculée, jamais stockée | Un montant qui change d'un écran à l'autre vient d'une assiette différente, pas d'un cache. |
| Taux figé sur la provenance | Le taux du commercial n'est qu'un défaut ; c'est celui de la provenance qui compte. |
| Seul le canal « commercial » commissionne | Contrôle de l'étape 2, à ne pas sauter. |
| Versement = pièce comptable | Un règlement ne se supprime pas à la légère. Ne pas tester la suppression sans y être invité. |


---

### S13 — Rémunération du formateur : séances, tarifs, bulletin de paie

| | |
|---|---|
| **Rôle** | Administrateur, puis Enseignant (étape 6) |
| **Prérequis** | S04 (trois séances tenues par l'enseignante du run) |
| **Produit** | Tarif horaire, séances validées, un bulletin de paie archivé puis versé |
| **Budget** | ~60 appels d'outils · **1 capture** (le bulletin PDF) |

> Attention au vocabulaire : ici, « bulletin » désigne le **bulletin de paie de l'enseignant**,
> pas le bulletin de notes de l'étudiant. Les deux mots cohabitent dans l'application. Dans le
> rapport, toujours préciser lequel.

---

## Étapes

### 1. Tarif horaire
`/professionnel/admin/remuneration` → section des tarifs ECUE. Créer un tarif pour
`Comptabilité générale <TAG>` : **5 000 FCFA/heure**, période couvrant le mois en cours.

**Contrôle du chevauchement** : créer un second tarif sur la **même ECUE** et une période qui
**recouvre** la première. Attendu : refus explicite (erreur de chevauchement). Relever le
message. Deux tarifs concurrents acceptés sur une même période sont une anomalie **MAJEURE** —
le montant à payer devient indéterminé.

Tester aussi la priorité : un tarif **nominatif** (pour cette enseignante) doit l'emporter sur
un tarif **générique**. Si l'écran le permet, créer un tarif nominatif à **6 000** sur une
période **disjointe**, et noter lequel s'applique à la période des séances.

### 2. Validation des séances
`/professionnel/admin/remuneration/seances`. Retrouver les trois séances de S04
(2 h chacune, soit **6 heures**).

| Contrôle | Attendu |
|---|---|
| Les trois séances sont listées | oui |
| Chacune porte une durée de 2 h | oui |
| Aucun motif de non-payabilité | sinon relever le blocage affiché mot pour mot |

Valider les trois séances.

> Une séance planifiée n'est **jamais** payée tant qu'elle n'est pas validée. Si des séances
> apparaissent déjà validées sans geste de l'administrateur, c'est une anomalie **MAJEURE**.

### 3. Montant attendu
`6 heures × 5 000 = **30 000 FCFA**`. Le porter au registre **avant** de générer le bulletin.

### 4. Générer le bulletin de la période
`/professionnel/admin/remuneration/bulletins` → bouton
**Générer les bulletins de cette période**.

| Contrôle | Attendu |
|---|---|
| Un bulletin pour `Awa Formatrice <TAG>` | oui |
| Montant | **30 000** |
| Détail des heures | 6 h, origine **professionnelle** |
| Colonne d'origine | présente — le calcul agrège heures académiques et professionnelles ; ici seules les professionnelles existent |

Un montant différent est **MAJEUR** : donner le nombre d'heures retenu et le tarif appliqué tels
que l'écran les affiche, pour distinguer une erreur de durée d'une erreur de tarif.

**Idempotence** : relancer la génération une seconde fois. Attendu : le bulletin n'est ni
dupliqué, ni doublé en montant. Un doublon est **MAJEUR**.

### 5. Archiver puis verser
1. Bouton **Tout archiver (N)** → le bulletin passe au statut **Impayé** dans l'historique.
2. `/professionnel/admin/remuneration/historique` : tenter d'éditer le PDF du bulletin
   **impayé**. Attendu : action **indisponible** — un bulletin impayé ne s'imprime pas.
   Si le PDF sort quand même, c'est une anomalie **MAJEURE** (une pièce de paie non versée
   circulerait comme si elle l'était).
3. Bouton **Marquer versé** → statut **Payé**, date de versement figée.
4. Éditer le PDF. **Une capture** : identité de l'enseignante, période, 6 h, 30 000, et la date
   de versement.

### 6. Vue enseignant
Se connecter avec le compte de `Awa Formatrice <TAG>` (mêmes réserves d'identifiants qu'en S10)
et ouvrir `/teacher/remuneration/historique`.

| Contrôle | Attendu |
|---|---|
| Le bulletin **versé** est visible | oui |
| Aucun bulletin d'un autre enseignant | vérifier — une fuite ici est **BLOQUANTE** |
| Un bulletin archivé mais impayé | **ne doit pas** apparaître |

Pour vérifier le dernier point : revenir en administrateur, générer et archiver un bulletin sur
une période sans versement, puis reprendre la vue enseignant. S'il y apparaît, c'est **MAJEUR** :
l'enseignant verrait comme acquis un montant qui ne lui a pas été versé.

---

## Pièges connus

| Piège | Conduite à tenir |
|---|---|
| Deux sens du mot « bulletin » | Paie vs notes. Toujours préciser dans le rapport. |
| Séance validée ≠ séance tenue | La validation est un geste administratif distinct. |
| Verrou après approbation | Un bulletin approuvé peut refuser toute modification (`PAYMENT_LOCKED`). C'est attendu : relever le message, ne pas forcer. |
| Tarif figé dans l'historique | Un tarif modifié après coup ne doit pas réécrire un bulletin déjà produit. Si l'occasion se présente, le vérifier et le signaler. |

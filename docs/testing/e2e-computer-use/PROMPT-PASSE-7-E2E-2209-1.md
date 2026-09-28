# Prompt — septième passe, campagne `E2E-2209-1`

> À coller dans Claude (web, extension navigateur). **Autonome : rien à joindre.**

---

Tu reprends la campagne de test d'EcoleDigitale en local (`http://localhost:3000`, tenant
`ecoledigitale`). Le périmètre est désormais **le module professionnel IPAM uniquement**. Cette
passe teste ses deux derniers volets jamais joués jusqu'au bout : les **commissions de
prospection** et la **rémunération des formateurs**.

Connexion : `/login` → panneau **Comptes par tenant** → tenant **ecoledigitale** → ligne
`admin@ecoledigitale.local` → **Se connecter**. Toute la passe se joue en **administrateur**.

Pièges d'environnement, déjà connus : première compilation d'une page jusqu'à une minute ; une
page qui a échoué reste figée sur l'erreur même une fois l'API revenue — **recharge avant de
conclure** ; champs remplis au clavier, validation par clic.

---

## Règles de prudence — non négociables

Cette base contient de **vraies données** à côté des données de test.

1. **Tu ne génères, n'archives ni ne marques « versé » aucun bulletin de paie.** Ces gestes sont
   collectifs : ils calculent la paie de **tous** les enseignants de la période, réels compris.
2. **Sur l'écran de validation des séances, tu ne coches jamais la case d'en-tête** (« tout
   cocher »). Tu coches les séances du test **une par une**, et tu vérifies que le bouton affiche
   **« Valider (3) »** avant de cliquer. Le compte d'Adjoua Brou est un compte de démonstration
   partagé : elle a d'autres séances, réelles, qu'il ne faut pas toucher.
3. Tu ne modifies ni ne supprimes aucun objet qui ne porte pas le tag `E2E-2209-1`, et tu ne
   supprimes aucun règlement de commission (c'est une pièce comptable).

---

## État des données sur lesquelles tu t'appuies

| Objet | Valeur |
|---|---|
| Commercial | **`Moussa Commercial E2E-2209-1`**, taux par défaut **10 %** — déjà créé en passe 6, **ne le recrée pas** |
| Aminata (`E2E-2209-1-A`) | fiche `/academic/students/cb5feb91-01a2-45bb-82ed-78a931e2ab85` |
| Bakary (`E2E-2209-1-B`) | fiche `/academic/students/a267b8e4-6678-4016-8a0c-daabdde396bc` |
| Paiements de scolarité d'Aminata | `REC-PRO-2026-000003` **50 000** · `000004` **100 000** · `000005` **100 000** |
| Séances du run | 3 séances de 2 h, ECUE **`Comptabilité générale E2E-2209-1`**, les **07, 14 et 21/09/2026**, tenues par **Adjoua Brou** |

---

## 0. Deux vérifications rapides de la passe 6

> **a.** `/professionnel/admin/prospection/commerciaux` : le compteur doit afficher
> **« N commerciaux »** au pluriel, et non plus « commercialaux ».
>
> **b.** La fenêtre de création d'un commercial semblait ne pas se refermer après
> l'enregistrement. Tu la testeras sans rien créer, au point 1.4, en **modifiant** Moussa : la
> fenêtre doit se refermer d'elle-même après l'enregistrement.

---

## 1. Commissions de prospection

Règles du module, **tranchées et à ne pas confondre avec des défauts** :
- seul le canal **commercial** ouvre droit à commission ;
- l'assiette est la **scolarité** encaissée, jamais le dû ; **une commission par paiement**,
  arrondie paiement par paiement ;
- le taux est **figé sur la fiche de l'étudiant** au moment où sa provenance est saisie :
  renégocier ensuite le taux du commercial ne réécrit rien de ce qui est déjà dû ;
- le montant de scolarité n'est volontairement pas affiché sur les écrans de commission.

### 1.1 — Provenance d'Aminata : canal commercial

> Fiche d'Aminata → carte **Provenance** → canal **Commercial** → commercial
> **Moussa Commercial E2E-2209-1**. Le taux doit se **pré-remplir à 10 %**, celui du
> commercial : vérifie-le avant d'enregistrer. **Enregistrer.**
>
> Attendu : la carte affiche le canal Commercial, Moussa, **10 %**.

### 1.2 — Provenance de Bakary : un autre canal

> Fiche de Bakary → carte **Provenance** → un canal **autre que commercial** (par exemple
> « Connaissance »). **Enregistrer.**
>
> Ce contrôle est faible par construction : Bakary n'a rien payé, il ne peut donc générer aucune
> commission de toute façon. Note le résultat sans en tirer de conclusion.

### 1.3 — Les commissions nées

**Porte d'abord ce tableau dans ton rapport, avant de regarder l'écran :**

| Paiement | Montant | Commission attendue (10 %) |
|---|---|---|
| `REC-PRO-2026-000003` | 50 000 | **5 000** |
| `REC-PRO-2026-000004` | 100 000 | **10 000** |
| `REC-PRO-2026-000005` | 100 000 | **10 000** |
| | | **Total 25 000** |

> Puis `/professionnel/admin/prospection/commissions/historique` (titre : « Commissions à
> payer »). Attendu : **trois lignes pour Aminata**, aux montants ci-dessus ; **aucune** pour
> Bakary ni Chantal.
>
> Tout écart de montant est une anomalie **majeure**. Dans ce cas, déduis du chiffre affiché
> l'assiette que l'application a retenue (le paiement ? la commande ? le total dû ?) : c'est
> l'information la plus utile de ce point.

### 1.4 — Le taux figé

C'est le test central de ce volet.

> `/professionnel/admin/prospection/commerciaux` → **modifier** Moussa → taux par défaut
> **20 %** → **Enregistrer**. *(Vérifie au passage que la fenêtre se referme : point 0.b.)*
>
> Retourne sur « Commissions à payer ». Attendu : les commissions d'Aminata restent à
> **5 000 · 10 000 · 10 000 = 25 000**, et sa fiche affiche toujours **10 %**.
>
> Si elles passent à 50 000 (soit 20 %), c'est une anomalie **majeure** : la rémunération du
> passé se réécrirait toute seule.
>
> **Remets ensuite le taux de Moussa à 10 %.**

### 1.5 — Le règlement

> Sur « Commissions à payer », coche **une seule ligne**, celle de **5 000** → bouton
> **« Marquer payé — 1 ligne(s), 5 000 FCFA »**. Vérifie que le montant annoncé sur le bouton est
> exactement celui de la ligne.
>
> Attendu : la ligne quitte cet écran et apparaît dans
> `/professionnel/admin/prospection/commissions/historique/payees`, au même montant. Elle ne
> doit plus être proposée au règlement — un double règlement possible serait **majeur**.
>
> Puis **« Tout marquer payé (2) »**. Attendu : 20 000 réglés. L'historique des commissions
> payées doit totaliser **25 000** pour Aminata.
>
> ⚠️ « Tout marquer payé » porte sur **toutes** les lignes affichées. Avant de cliquer, vérifie
> que l'écran ne liste **que** les deux lignes restantes d'Aminata. S'il affiche des commissions
> d'autres commerciaux, réelles, **ne clique pas** : règle les deux lignes une par une.

---

## 2. Rémunération du formateur — périmètre réduit

### 2.1 — Les tarifs horaires : ne les cherche pas

> **Il n'existe pas d'écran de gestion des tarifs par ECUE.** L'API sait les créer et refuser un
> chevauchement, mais aucune page ne le propose et le menu Rémunération n'a pas d'entrée
> « Tarifs ». C'est déjà connu et signalé : **ne le cherche pas et ne l'ouvre pas comme
> anomalie.** Le test du refus de chevauchement est donc impossible dans cette passe.
>
> Seul contrôle utile ici : ouvre le sous-menu **Rémunération** et note ses entrées, pour
> confirmer qu'aucune ne mène à des tarifs.

### 2.2 — Validation des trois séances du run

> `/professionnel/admin/remuneration/seances` → filtre **Enseignant : Adjoua Brou**.
>
> La liste contient **aussi ses vraies séances**. Repère les trois séances du test :
> ECUE `Comptabilité générale E2E-2209-1`, les **07, 14 et 21/09/2026**, **2 h** chacune.
>
> Coche-les **une par une** — **jamais la case d'en-tête**. Vérifie que le bouton affiche
> **« Valider (3) »**, puis clique.
>
> Attendu : les trois séances passent en validées, sans motif de blocage.
>
> Les séances appartiennent à un semestre **clôturé**. Si leur validation est refusée pour
> cette raison, relève le message exact : c'est une information, pas forcément un défaut. Si
> un autre motif de blocage apparaît (durée, horaires, annulation), relève-le mot pour mot.

### 2.3 — Le tarif appliqué, s'il apparaît

> L'ECUE du run n'a **aucun tarif propre** : le montant dépendra d'un tarif par défaut de
> l'enseignante, ou d'aucun. Il n'y a donc **pas de montant attendu** à vérifier.
>
> Si l'écran de validation ou le détail d'une séance affiche un tarif ou un montant pour ces
> trois séances, **relève-le tel quel**. Ne va pas le chercher en générant un bulletin de paie
> (règle de prudence n° 1).

### 2.4 — Ce que tu ne joues pas

> Génération des bulletins de paie, archivage, versement, et vue de l'enseignante sur un
> bulletin versé : **non joués**. Note-les « non jouées — geste collectif, à tester sur une
> copie isolée de la base ». Ce n'est pas une anomalie de l'application, c'est une limite de
> l'environnement.

---

## Ce que j'attends en retour

1. Le tableau des étapes (0.a, 0.b, 1.1 à 1.5, 2.1 à 2.3) : OK, KO ou non jouée.
2. **Le verdict sur les commissions** : les montants sont-ils justes, et le taux est-il bien figé ?
3. **Le verdict sur la rémunération** : les trois séances du run se valident-elles, sans
   toucher aux séances réelles d'Adjoua Brou ?
4. Une fiche par anomalie — URL, geste, attendu, constaté, requête en cause si tu la vois —,
   classées bloquante / majeure / mineure.
5. **Ce que tu n'as pas pu vérifier.**
6. **Les données créées** : provenances d'Aminata et de Bakary, règlements de commission,
   validations de séances.

# Module « Rémunération » — spécification portable

> **Objet.** Décrire le module Rémunération tel qu'il fonctionne réellement
> aujourd'hui (fonctionnalités, tables, propriétés, règles), sous une forme
> **indépendante de la technologie**, afin de le réimplémenter dans un projet et
> une stack encore inconnus.
>
> **Source.** Rétro-ingénierie du code en production : `apps/api/src/routes/professional-remuneration.ts`,
> `apps/api/src/services/payment-calculator.ts`, `professional-seance-validation.service.ts`,
> `teacher-payroll-overview.service.ts`, `professional-ecue-rates.service.ts`,
> `hour-collectors/*`, `teacher-payslip*.service.ts`, migrations `0011` et `0103`→`0114`,
> écrans `apps/web/src/app/professionnel/admin/remuneration/*` et `apps/web/src/app/payments/teacher-configs`.
>
> **Ce document ne suppose ni PostgreSQL, ni REST, ni React.** Chaque contrainte
> technique est traduite en *exigence fonctionnelle*, avec en annexe ce que la
> plateforme cible doit savoir faire.

---

## 1. Ce que fait le module, en une page

Le module répond à une seule question : **combien doit-on à chaque enseignant
pour une période donnée, et pourquoi ?**

Il repose sur quatre écrans, qui sont les quatre étapes du parcours :

| # | Écran | Question à laquelle il répond |
|---|---|---|
| 1 | **Configuration** | Qui est payable, et selon quel mode (salaire / horaire / mixte) ? |
| 2 | **Validation des séances** | Quelles heures ont réellement été faites et sont payables ? |
| 3 | **Bulletin de paiement** | Combien pour chacun sur la période ouverte, et arrêté du montant |
| 4 | **Historique des paiements** | Qu'a-t-on arrêté, versé, à qui, et quand ? |

Deux principes structurent tout le reste :

1. **On ne paie jamais un planning.** Une séance existe en base *avant* d'avoir
   lieu. Elle ne devient payable qu'après deux actes distincts : un **constat
   pédagogique** (« la séance a eu lieu ») et un **acte de gestion** (« cette
   séance est payable »). Les confondre transformerait tout constat pédagogique
   en engagement financier.
2. **Un seul bulletin par enseignant et par période**, quelles que soient les
   origines de ses heures. L'origine vit sur la **ligne de détail**, jamais sur
   le bulletin. Raison : le seuil d'heures supplémentaires porte sur le temps de
   travail réel d'une personne ; le scinder par origine permettrait de faire
   30 h ici et 30 h là sans jamais le déclencher.

### Les deux origines d'heures

Le système agrège **deux chaînes de collecte** distinctes en un seul bulletin :

```
Origine « académique »     : séance de présence enseignant → affectation → cours de classe
Origine « professionnel »  : séance d'ECUE → cohorte d'UE → filière
                             ───────────────────────────────────────────
                                        UN SEUL BULLETIN
```

L'abstraction clé est le **collecteur d'heures** (`HourCollector`) : chaque
origine implémente la même interface et renvoie une liste normalisée d'« heures
rémunérables ». Le moteur de calcul ne connaît que cette interface. **Une
troisième origine s'ajouterait sans toucher au calcul.**

---

## 2. Vocabulaire (à conserver tel quel)

| Terme | Définition opérationnelle |
|---|---|
| **Période de paie** | Fenêtre de dates de l'établissement. Peut être *collective* (tous les enseignants) ou *ciblée* (liste explicite). |
| **Configuration de paie** | Mode de rémunération d'un enseignant, avec date de prise d'effet et date de fin optionnelle. Trois types : `salaire`, `horaire`, `mixte`. |
| **Séance** | Créneau daté rattaché à une matière et à une cohorte, avec un enseignant et des horaires. |
| **Statut de réalisation** | Fait pédagogique : `planifiee` \| `realisee` \| `annulee`. |
| **Validation paie** | Acte de gestion : horodatage + identité du valideur. Indépendante du statut. |
| **Durée planifiée** | `heure_fin − heure_debut`. Registre pédagogique, **jamais réécrit**. |
| **Durée payée** | Dérogation comptable optionnelle. Si présente, elle l'emporte. |
| **Heure payable** | Séance `realisee` **ET** validée **ET** avec bénéficiaire **ET** avec durée connue. |
| **Heure consommée** | Heure déjà portée au détail d'un bulletin non annulé. Elle ne sera plus jamais repayée. |
| **Bulletin** | Un enregistrement de paiement par enseignant et par période. |
| **Arrêter / archiver** | Figer le montant dû. Ne verse rien. |
| **Verser** | Constater le décaissement réel. Seul acte qui remplit la date de paiement. |

> ⚠️ **Distinction critique, apprise en production** : l'archivage marquait
> autrefois les bulletins comme « payés ». 35 bulletins ont ainsi été déclarés
> payés sans qu'aucun décaissement ne soit enregistré. **Classer un papier n'est
> pas sortir de l'argent.** Trois actes, trois traces : *calculer*, *arrêter*,
> *verser*.

---

## 3. Modèle de données

### 3.1 Carte relationnelle

```
                         ┌──────────────┐
                         │  ENSEIGNANT  │  identité unique, partagée par les 2 origines
                         └──────┬───────┘
        ┌───────────────────────┼────────────────────────────┐
        ▼                       ▼                            ▼
 CONFIG_PAIE          TARIF_HORAIRE_MATIERE        TARIF_HORAIRE_MATIERE
 (salaire/horaire       (origine académique)         (origine professionnelle)
  /mixte)
        │                       │                            │
        └───────────┬───────────┴────────────────────────────┘
                    ▼
              BULLETIN ◄──── PERIODE_PAIE ────► PERIODE_CIBLES (0..N enseignants)
                    │                     └────► ANNEE_SCOLAIRE (optionnel)
                    ▼
         LIGNE_DETAIL_HEURE  (porte l'origine + 1 seule référence source)
              │                          │
              ▼                          ▼
      SEANCE_ACADEMIQUE            SEANCE_PROFESSIONNELLE
                                    (+ statut, validation, durée payée)
                    │
                    ▼
              JOURNAL_AUDIT (identité de l'auteur FIGÉE)
```

### 3.2 `periode_paie` — fenêtre de paie

| Propriété | Type | Règle |
|---|---|---|
| `id` | identifiant | |
| `tenant_id` | identifiant | Cloisonnement multi-établissement, obligatoire partout |
| `nom` | texte (100) | Ex. « Août 2026 » |
| `description` | texte | optionnel |
| `date_debut` | date | bornes **incluses** |
| `date_fin` | date | bornes **incluses** |
| `statut` | énum | `brouillon` \| `active` \| `close` \| `archivee` |
| `annee_scolaire_id` | identifiant | nullable — sert au regroupement dans l'historique |
| `cree_par`, `cree_le`, `modifie_le` | | |

**Règles :**
- **Une seule période « en attente de calcul » à la fois.** Tant que la dernière
  créée n'a produit aucun bulletin, on ne peut pas en ouvrir une autre. Deux
  exercices ouverts simultanément laisseraient le gestionnaire sans savoir lequel
  alimente quel bulletin. L'écran interroge cet état **avant** d'afficher le
  formulaire, plutôt que de laisser tout saisir pour opposer un refus à la fin.
- **Le chevauchement de dates est autorisé** (décision assumée). L'unicité du
  paiement d'une heure n'est plus garantie par le calendrier mais par la notion
  d'**heure consommée** (§5.3). *Attention : c'est un renversement par rapport à
  la conception initiale ; ne pas réintroduire une contrainte d'exclusion de
  plages sans supprimer d'abord la logique des heures consommées.*
- Une période archivée ne bloque plus rien.

### 3.3 `periode_cibles` — périmètre de la période

| Propriété | Type |
|---|---|
| `periode_id` + `enseignant_id` | clé composite |
| `tenant_id`, `cree_le` | |

**Règle :** *aucune ligne = période collective* (tous les enseignants) ;
*N lignes = période ciblée sur ces N enseignants*. Ne pas modéliser ça par un
champ `enseignant_id` nullable sur la période : la version 1 le faisait, et il a
fallu migrer dès qu'on a voulu payer deux enseignants ensemble sans payer tout
l'établissement.

Suppression d'un enseignant : **interdite** tant qu'il figure dans un périmètre
(pas de cascade — retirer silencieusement le périmètre invaliderait les bulletins
qu'il justifie).

### 3.4 `config_paie_enseignant` — configuration

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id`, `enseignant_id` | | |
| `type_config` | énum | `salaire` \| `horaire` \| `mixte` |
| `salaire_mensuel` | décimal(10,2) | requis si `salaire`/`mixte` |
| `salaire_annuel` | décimal(12,2) | alternative au mensuel (÷12) |
| `taux_horaire_defaut` | décimal(8,2) | dernier recours de la résolution de tarif |
| `seuil_heures_sup` | entier | défaut **40** — heures/semaine avant majoration |
| `multiplicateur_heures_sup` | décimal(3,2) | défaut **1.5** |
| `effet_du` | date | obligatoire |
| `effet_au` | date | nullable = sans fin |
| `cree_par`, `cree_le`, `modifie_le` | | |

**Règle de sélection :** la configuration retenue pour une période est celle dont
`effet_du ≤ date_fin_periode` **ET** (`effet_au` est vide **OU**
`effet_au ≥ date_debut_periode`), la plus récente d'abord.

> **Piège vécu en production.** Une configuration *expirée* apparaît comme
> « configuré » dans une liste de configurations, alors qu'elle produit
> exactement le même effet qu'une absence : l'enseignant est **ignoré en silence**
> par le calcul. Le modèle doit donc exposer un **état calculé** à quatre valeurs :
> `active` \| `expiree` \| `future` \| `absente` — et l'écran doit le montrer.

### 3.5 `seance` (origine professionnelle) — la source des heures

Colonnes d'origine (planning) :

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id` | | |
| `matiere_id` (ECUE) | identifiant | obligatoire |
| `cohorte_id` (session d'UE) | identifiant | obligatoire |
| `libelle` | texte | libre, ex. « Rattrapage du 12 » |
| `date` | date | obligatoire — **détermine la période de rattachement** |
| `heure_debut`, `heure_fin` | heure | nullable ; contrainte `fin ≥ debut` |
| `enseignant_id` | identifiant | **nullable** ; c'est l'intervenant *réel*, remplacement compris |
| `salle_id` | identifiant | nullable |

Colonnes ajoutées par la paie :

| Propriété | Type | Règle |
|---|---|---|
| `statut` | énum | `planifiee` (défaut) \| `realisee` \| `annulee` |
| `statut_modifie_par`, `statut_modifie_le` | | traçabilité du constat |
| `valide_par`, `valide_le` | | traçabilité de l'acte de gestion |
| `duree_payee` | décimal(5,2) | **dérogation comptable**, nullable |
| `duree_payee_par`, `duree_payee_le` | | qui a dérogé, quand |
| `saisie_comptable` | booléen | `true` = séance ajoutée depuis l'écran de paie, pas par l'enseignant |

**Reprise de données :** toutes les séances préexistantes prennent `planifiee` et
restent non validées. **Aucun backfill rétroactif** — payer sur du planning non
vérifié serait une erreur comptable.

### 3.6 `tarif_horaire_matiere` — tarification fine

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id` | | |
| `matiere_id` | identifiant | obligatoire |
| `enseignant_id` | identifiant | **nullable** — vide = tarif générique de la matière |
| `montant_horaire` | décimal(12,2) | ≥ 0 |
| `devise` | texte | défaut devise de l'établissement |
| `valide_du` | date | obligatoire |
| `valide_au` | date | nullable = sans fin |
| `notes`, `cree_par`, `cree_le`, `modifie_le` | | |

**Contraintes :**
- `valide_au` vide **ou** `≥ valide_du`.
- **Pas deux tarifs chevauchants** pour un même couple (matière, enseignant).
  Le tarif générique (enseignant vide) constitue **son propre couple**, distinct
  de tout tarif nominatif. En SQL cela se fait par une contrainte d'exclusion
  avec `COALESCE(enseignant_id, uuid_zero)` ; ailleurs, par une vérification
  transactionnelle explicite (§13).

### 3.7 `bulletin` — le paiement

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id`, `enseignant_id`, `periode_id` | | |
| `config_id` | identifiant | configuration ayant servi au calcul |
| `type_paiement` | énum | `salaire` \| `horaire` \| `prime` \| `retenue` |
| `montant_base` | décimal | heures normales, ou salaire prorata |
| `montant_heures_sup` | décimal | |
| `montant_primes` | décimal | **saisi manuellement**, aucune règle automatique |
| `montant_retenues` | décimal | idem |
| `montant_total` | décimal | |
| `devise` | texte(3) | alignée sur l'établissement |
| `details_calcul` | document JSON | ventilation lisible (voir §6.4) |
| `statut` | énum | `calcule` \| `approuve` \| `paye` \| `conteste` \| `annule` |
| `calcule_le` | horodatage | acte 1 |
| `archive_le`, `archive_par` | | acte 2 — arrêté du montant |
| `approuve_le`, `approuve_par` | | posés en même temps que l'archivage |
| `paye_le`, `paye_par` | | acte 3 — **versement réel**, nulle part ailleurs |
| `notes`, `cree_par`, `cree_le`, `modifie_le` | | |

**Contrainte d'unicité :** `(tenant, enseignant, periode, type_paiement)`.
Sans elle, deux calculs concurrents insèrent deux bulletins pour le même couple.

**Affichage des statuts :** `calcule` → « Calculé » ; `approuve` → **« Impayé »**
(une somme est due, elle n'a pas été versée) ; `paye` → « Payé ».

### 3.8 `ligne_detail_heure` — la justification unitaire

C'est la table qui rend un paiement **opposable**.

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id`, `bulletin_id` | | |
| `origine` | énum | `academique` \| `professionnel` |
| `ref_seance_academique` | identifiant | nullable |
| `ref_seance_professionnelle` | identifiant | nullable |
| `nb_heures` | décimal(4,2) | **historisé** |
| `taux_horaire` | décimal(8,2) | **historisé** |
| `montant` | décimal(10,2) | |
| `heures_sup` | booléen | |

**Contrainte d'exclusivité :** exactement **une** référence d'origine renseignée,
et elle doit être cohérente avec `origine`. Une ligne professionnelle ne porte
jamais de référence académique et réciproquement.

**Unicité :** une même séance ne peut apparaître qu'une fois par bulletin —
à exprimer par index uniques **partiels** (un par colonne de référence), car deux
valeurs nulles ne sont pas égales en SQL.

**Historisation (règle majeure) :** `nb_heures` et `taux_horaire` sont **figés au
moment du calcul**. Modifier un tarif après approbation ne doit **jamais** altérer
un bulletin existant. C'est la ligne de détail qui porte la vérité, pas la table
des tarifs.

**Suppression :** la référence passe à vide (`SET NULL`) plutôt que de cascader —
supprimer une séance ne doit pas effacer la justification d'un montant déjà versé.

### 3.9 `journal_audit_paiement`

| Propriété | Type | Règle |
|---|---|---|
| `id`, `tenant_id`, `bulletin_id` | | |
| `action` | texte | `cree` \| `modifie` \| `approuve` \| `paye` \| `annule` |
| `anciennes_valeurs`, `nouvelles_valeurs` | JSON | |
| `motif` | texte | |
| `modifie_par` | identifiant | |
| **`modifie_par_nom`** | **texte** | **identité FIGÉE** |
| `modifie_le` | horodatage | |

> **Trois correctifs successifs ont été nécessaires ici** (migrations 0109→0111).
> Le journal doit **survivre à la suppression du bulletin** (pas de cascade), **et**
> à la suppression du compte utilisateur, **et** à son renommage. La seule solution
> qui tient : **dénormaliser le nom de l'auteur au moment de l'action**. Une
> jointure vers la table des utilisateurs ne dit pas qui a agi *alors*, elle dit
> qui porte ce compte *aujourd'hui*.

---

## 4. Écran 1 — Configuration

**Rôle :** définir qui est payable et comment.

**Fonctionnalités :**
- Lister les configurations, filtrables par enseignant.
- Créer / modifier / supprimer une configuration (type, montants, seuil et
  multiplicateur d'heures sup, période de validité).
- Consulter la configuration *courante* d'un enseignant donné.

**Règles d'écran :**
- Les champs affichés dépendent du type : un mensualisé n'a pas de taux horaire à
  saisir, un horaire n'a pas de salaire.
- Le seuil et le multiplicateur d'heures sup s'appliquent **aux deux origines
  cumulées**.

---

## 5. Écran 2 — Validation des séances

**Rôle :** transformer un planning en heures payables. C'est le prérequis absolu :
sans lui, le calcul paierait le planning.

### 5.1 Fonctionnalités

| Fonction | Détail |
|---|---|
| **Lister les séances** | Filtres : enseignant, cohorte, matière, filière, intervalle de dates, **année scolaire**, statut, validées/non, payables/non, présence saisie. Paginé. |
| **Changer le statut** | `planifiee` → `realisee` / `annulee`. Trace l'auteur et la date. |
| **Valider / dévalider en lot** | Jusqu'à 500 séances. **Application partielle** (§5.4). |
| **Déroger sur la durée** | Fixer un volume horaire de paie sans toucher aux horaires. `null` retire la dérogation. |
| **Ajouter une séance comptable** | Séance que l'enseignant n'avait pas enregistrée. Horaires **ou** volume horaire — l'un des deux suffit, mais pas aucun. |
| **Séances manquantes** | Rapprochement : créneaux d'emploi du temps attendus sans séance correspondante, sur un intervalle. Permet de savoir *ce qui manque* au lieu d'ajouter à l'aveugle. |
| **Chevauchements** | Deux séances du même enseignant qui se recoupent le même jour → anomalie signalée avant validation (risque de double comptage). |
| **Fiche de séance** | Détail unitaire avec son état de paie. |
| **Options de filtres** | Les listes d'options (années scolaires, enseignants à traiter) viennent du **serveur**, pas de la page affichée — sinon une année disparaît du menu dès que la pagination tronque. |

### 5.2 Le prédicat de payabilité — à définir **une seule fois**

```
prete_a_valider :=
      statut = 'realisee'
  AND enseignant_id est renseigné
  AND ( duree_payee est renseignée
        OU (heure_debut ET heure_fin sont renseignées) )

payable := prete_a_valider ET valide_le est renseigné

duree_retenue := duree_payee, sinon (heure_fin − heure_debut) en heures décimales
```

> **Règle d'ingénierie non négociable.** Ces trois expressions doivent vivre **à
> un seul endroit** et être **importées** par tous ceux qui doivent s'accorder :
> l'écran de validation, les compteurs de la vue d'ensemble, et le collecteur
> d'heures du calcul. Chaque fois qu'elles ont été recopiées, le résultat a été
> le même : *un écran qui annonce des heures que le calcul ne retrouve pas* —
> l'écart le plus difficile à diagnostiquer pour un gestionnaire de paie.

### 5.3 Le prédicat d'heure consommée — la seconde moitié de la règle

Le prédicat ci-dessus répond à « cette séance est-elle **éligible** ? ». Il ne
sait rien des bulletins déjà émis. Il faut donc, en plus :

```
deja_payee(seance, periode_en_cours) :=
  il existe une ligne de détail rattachée à cette séance,
  dont le bulletin n'est PAS annulé,
  et dont la période est DIFFÉRENTE de la période en cours de calcul
```

Deux points de sémantique, tous deux appris à leurs dépens :

1. **Un bulletin annulé relâche ses heures.** Annuler signifie que le paiement
   n'a pas eu lieu : les heures redeviennent dues. L'archivage, lui, ne relâche
   rien — un bulletin archivé reste payé.
2. **La période en cours de calcul ne s'exclut pas elle-même.** Un recalcul
   réécrit son propre détail (suppression puis réinsertion) ; s'il considérait
   ses propres lignes comme consommées, il produirait un bulletin vide au second
   passage.

**Qui filtre des heures payables doit appliquer LES DEUX prédicats.**

### 5.4 Validation en lot : application partielle

Faire échouer tout le lot sur une anomalie bloquerait 200 séances pour une seule.
Le résultat renvoie donc :

```
{ nb_mises_a_jour, rejets: [ { seance_id, motif } ] }
```

Motifs de rejet possibles (à exposer à l'écran, jamais griser sans explication) :

| Motif | Signification |
|---|---|
| `STATUT_NON_REALISEE` | la séance est encore planifiée, ou annulée |
| `NON_VALIDEE` | pas encore validée pour la paie |
| `SANS_ENSEIGNANT` | aucun bénéficiaire |
| `HORAIRES_INCOMPLETS` | durée indéterminable, et aucune dérogation |
| `DEJA_PAYEE` | rattachée à un bulletin arrêté ou versé |

### 5.5 Verrouillage

Une séance rattachée à un bulletin au statut **arrêté (`approuve`) ou versé
(`paye`)** ne peut plus être **dévalidée** ni **supprimée**.

### 5.6 Tri de la liste — détail qui compte

Le passé d'abord, du plus récent au plus ancien ; les séances à venir ensuite.
Un simple tri décroissant sur la date remontait les cours planifiés jusqu'en 2029 :
l'écran s'ouvrait sur des séances qu'aucun paiement ne pouvait couvrir.

### 5.7 Indicateurs de l'écran

Calculés **par le serveur sur tout le périmètre filtré**, jamais sur la page
affichée (sinon on annonce « 10 séances » sur un lot de 300) :

- Séances à traiter (total)
- Prêtes à valider (aucun autre motif de blocage)
- Heures à valider (si vous validez les lignes prêtes)
- Séances déjà rattachées à un paiement

---

## 6. Écran 3 — Bulletin de paiement

**Rôle :** point d'entrée du parcours de paie, et moteur du calcul.

### 6.1 La vue d'ensemble

L'écran liste **TOUS les enseignants de l'établissement**, pas seulement ceux qui
ont une configuration.

> **C'est délibéré et c'est tout l'intérêt.** Une liste de configurations ne peut
> pas, par construction, montrer un enseignant qui n'en a pas — or c'est
> exactement celui qu'il faut repérer, puisqu'il est ignoré en silence par le
> calcul. Recouper deux listes côté client échoue de toute façon : elles sont
> paginées, et l'enseignant non configuré disparaît dès la première troncature.
> **La jointure appartient au serveur.**

Pas de pagination sur cet écran : un établissement compte des dizaines
d'enseignants, et l'écran sert justement à repérer les manquants.

**Par enseignant, une carte affiche :**

| Donnée | Précision |
|---|---|
| Identité + matricule | le matricule lève l'ambiguïté entre homonymes |
| État de configuration | `active` / `expiree` / `future` / `absente` — dit ce que ça implique **pour le calcul** |
| Heures validées de la période courante | cumul des durées retenues, **heures consommées exclues** |
| **Séances à valider** | séances *réalisées mais non validées* sur la période |
| Bulletin courant | le plus récent **non archivé** : statut, montant, période |
| Nombre de bulletins archivés | |

> **Pourquoi le compteur « séances à valider » existe.** Sans lui, deux situations
> opposées se présentent à l'identique — « 0 heure » : l'enseignant qui n'a pas
> fait cours, et celui qui a fait cours sans que personne ne valide ses séances.
> Le premier n'attend rien ; le second sera sauté de la paie **en silence**.

> **Pourquoi les heures sont celles de la période courante, pas de tous les
> temps.** L'écran suit un cycle : une période s'ouvre, ses heures apparaissent,
> le bulletin se génère, l'archivage remet le compteur à zéro. Un cumul perpétuel
> ne redescendrait jamais et laisserait croire qu'il reste toujours quelque chose
> à payer.

> **Sur un salaire fixe**, les heures sont **constatées, jamais valorisées**.
> L'écran doit le dire explicitement, sinon un cumul de 594 h en face d'un
> bulletin qui ne les mentionne pas passe pour un bug.

### 6.2 Actions de l'écran

| Action | Effet |
|---|---|
| **Créer une période** | Collective ou ciblée. Formulaire désactivé s'il existe déjà une période en attente de calcul. |
| **Calculer / recalculer** | Lance le moteur sur la période ouverte. `recalculer = true` réécrit les bulletins existants. |
| **Aperçu (dry-run)** | Calcule **sans persister**, renvoie le détail ligne à ligne. |
| **Éditer le bulletin (PDF)** | Document individuel. |
| **Archiver** | Arrête le montant (§6.5). Accepte une liste, **ou `tous: true`**. |
| **Verser** | Constate le décaissement (§6.6). Même forme. |

> **Pourquoi `tous: true` et pas une liste d'identifiants.** La vue d'ensemble ne
> remonte qu'**un** bulletin par enseignant (le plus récent non archivé). Faire
> énumérer les identifiants par l'écran revenait à n'archiver que ce qu'il
> affichait : « Tout archiver (3) » en classait trois et en laissait d'autres
> derrière, sans rien dire. Le décompte doit venir du **serveur**.
>
> Réciproquement : quand `tous` est absent, une liste vide ne doit **jamais**
> valoir « tout », sans quoi un appel mal formé clôturerait la période entière.

### 6.3 Le moteur de calcul

```
ENTRÉE : tenant, période, [enseignants], périmètre ∈ {tous, académique, professionnel},
         recalculer?, aperçu?

1.  Charger les bornes de la période.
2.  Charger les enseignants du périmètre (actifs uniquement).
3.  COLLECTE : pour chaque origine retenue, UNE SEULE requête pour toute la
    période, tous enseignants confondus.
    → filtrée par le prédicat de payabilité ET par l'exclusion des heures consommées.
4.  Précharger les tarifs de la période (une requête par table de tarifs).
5.  Regrouper les heures par enseignant ; écarter celles hors périmètre.
6.  POUR CHAQUE enseignant :
    a. Résoudre sa configuration valide sur la période.
       → absente ? ÉCARTÉ, motif SANS_CONFIG.
    b. Si config 'horaire' ET aucune heure → ÉCARTÉ, motif SANS_HEURE.
    c. Tarifer chaque heure (§7).
       → une seule heure non tarifable ? ÉCARTÉ, motif TARIF_INTROUVABLE.
    d. Calculer selon le type de config (§6.4).
7.  SORTIE : { résultats[], écartés[] } — chaque écarté avec son MOTIF.
```

> **Le compte rendu doit nommer les écartés et pourquoi.** Un compte rendu qui se
> contente d'omettre un enseignant ne permet pas de savoir s'il manque une
> configuration, des heures, ou un tarif. C'est la différence entre « il n'est
> pas payé » et « je sais pourquoi il n'est pas payé ».

**Performance :** une requête par origine, pas une par enseignant. Objectif tenu :
une période de **500 séances × 100 enseignants en moins de 30 secondes**.

### 6.4 Les trois modes de calcul

**Mode `salaire`** — prorata des jours ouvrés :

```
salaire_mensuel := salaire_mensuel, sinon salaire_annuel / 12
prorata         := jours_ouvres(période) / jours_ouvres_standards(mois de début)
montant_base    := salaire_mensuel × prorata
```
Les heures n'entrent **pas** dans le montant. Aucune ligne de détail n'est
produite ; les séances sont listées à titre informatif.
*Jours ouvrés = hors samedi et dimanche.*

**Mode `horaire`** — heures sup appréciées **par semaine calendaire (lundi)** :

```
POUR CHAQUE semaine :
  cumul := 0
  POUR CHAQUE heure de la semaine (triée par date) :
     taux   := taux résolu de cette heure
     cumul  += durée
     h_sup  := max(0, min(durée, cumul − seuil_hebdo))
     h_norm := durée − h_sup
     si h_norm > 0 : ligne(h_norm, taux,  h_norm × taux,  normal)
     si h_sup  > 0 : ligne(h_sup,  taux × multiplicateur, ..., heures_sup)
```

> Le cumul hebdomadaire **mélange délibérément les origines** : c'est le temps de
> travail réel de la personne qui déclenche les heures supplémentaires.
> Une séance à cheval sur le seuil est **coupée en deux lignes de détail**.

**Mode `mixte`** — les deux composantes s'additionnent : `salaire + horaire`.

**`details_calcul` (JSON) à produire dans tous les cas :**

```json
{
  "heuresNormales": 12.5,
  "heuresSup": 2,
  "taux": { "normal": 5000, "heuresSup": 7500 },
  "joursPeriode": 31,
  "joursOuvres": 22,
  "ventilation": [
    { "libelle": "Heures normales",        "montant": 62500, "heures": 12.5, "taux": 5000 },
    { "libelle": "Heures supplémentaires", "montant": 15000, "heures": 2,    "taux": 7500 },
    { "libelle": "dont Académique",        "montant": 0,     "heures": 8 },
    { "libelle": "dont Professionnel",     "montant": 0,     "heures": 6.5 }
  ]
}
```

### 6.5 Recalcul — règles d'idempotence

- Un recalcul **reconstruit intégralement** le détail : suppression puis
  réinsertion. Aucune ligne orpheline, aucun doublon.
- Un recalcul **ne modifie jamais** un bulletin `approuve`, `paye` ou `annule` ;
  ces cas sont **remontés dans le compte rendu**.
- **Deux recalculs successifs sur la même période produisent un résultat
  strictement identique.** C'est le test d'acceptation le plus discriminant.

### 6.6 Archiver — arrêter le montant

```
POUR les bulletins non archivés (liste explicite, ou tous) :
    archive_le  := maintenant
    archive_par := utilisateur
    statut      := 'approuve'
    approuve_par := approuve_par sinon utilisateur      -- ne jamais écraser
    approuve_le  := approuve_le  sinon maintenant       -- une approbation antérieure
```

- **Idempotent** : réarchiver ne redate pas, sinon l'ordre de l'historique
  changerait à chaque clic.
- **Effet de bord voulu** : `approuve` fait partie des statuts verrouillants — les
  séances restent verrouillées après archivage.
- Les heures consommées **ne bougent pas** : le détail reste en place, donc elles
  restent décomptées. *Classer n'est pas annuler.*

### 6.7 Verser — constater le décaissement

```
POUR les bulletins au statut 'approuve' UNIQUEMENT (liste explicite, ou tous) :
    statut   := 'paye'
    paye_le  := maintenant
    paye_par := utilisateur
```

- Le filtre porte sur le **statut**, pas seulement sur les identifiants reçus : un
  appel qui viserait large ne peut pas court-circuiter la règle.
- On ne verse pas ce qui n'a pas été arrêté ; un bulletin `annule` ou `conteste`
  ne doit pas l'être du tout.
- **Idempotent** : un bulletin déjà versé n'entre plus dans le périmètre.
- `paye_par` répond à « qui a constaté le versement » — sans cette colonne, le
  journal attribuait la ligne à l'approbateur, c'est-à-dire à celui qui a arrêté
  le montant, pas à celui qui a sorti l'argent.

---

## 7. Résolution du tarif d'une heure

Ordre **figé**, du plus spécifique au plus général :

```
1. tarif (matière + enseignant) valide à la date de la séance
2. tarif (matière, générique)   valide à la date de la séance
3. taux_horaire_defaut de la configuration de l'enseignant
4. si config = 'salaire' → 0 (un salarié n'a pas de taux : ce n'est PAS une anomalie)
5. sinon → ANOMALIE EXPLICITE, jamais un montant nul silencieux
```

Départage entre plusieurs tarifs candidats : **le nominatif avant le générique**,
puis le plus récemment ouvert.

**Préchargement :** les tarifs de la période sont chargés en une requête et
indexés en mémoire (`matière × enseignant × date`). Résoudre ligne à ligne
produirait N requêtes pour N heures.

**Traçabilité :** la résolution expose l'origine du tarif retenu —
`tarif_matiere_enseignant` \| `tarif_matiere_generique` \| `config_defaut` — pour
qu'un montant contesté puisse être expliqué.

---

## 8. Écran 4 — Historique des paiements

**Rôle :** répondre à « qu'a-t-on versé à cette personne, et quand ? »

**Contenu :** tous les bulletins **archivés**, le plus récent en tête.

| Colonne | Précision |
|---|---|
| Enseignant | |
| Période + année scolaire | |
| Type de paiement | |
| Heures normales / heures sup | lues dans `details_calcul` |
| Nombre de lignes de détail | |
| Montant + devise | |
| Statut | « Impayé » tant que non versé |
| **Archivé le / par** | identité **figée** du journal d'audit ; jointure en simple repli |
| **Versé le** | distinct de l'archivage |
| Actions | éditer le PDF, enregistrer le versement |

**Filtres :** enseignant, année scolaire, période. Changer d'année réinitialise la
période (elle appartenait peut-être à l'année qu'on quitte).

**Export :** l'export porte **le périmètre affiché**, filtres compris, et **les
mêmes colonnes** que l'écran.

**Règle d'écran :** l'édition du PDF est bloquée tant que le bulletin est impayé —
message explicite : « enregistrez le versement pour pouvoir éditer le document ».

---

## 9. Le bulletin PDF

**Principe fondateur :** **aucun calcul dans le générateur.** Les montants sont
lus tels qu'ils ont été écrits. Recalculer produirait un PDF qui ne correspond pas
au montant approuvé — exactement ce qu'un bulletin ne doit jamais faire.

**Séparer la collecte de la mise en page** : le gabarit doit pouvoir changer de
charte sans qu'on touche aux requêtes, et inversement.

**Données du document :**

```
En-tête      : établissement (nom, emblème, république, devise), période, statut
Bénéficiaire : nom, matricule, email
Base de calcul (selon le mode) :
   salaire → salaire mensuel de référence, jours ouvrés / jours calendaires
   horaire → heures normales retenues, heures sup et leur taux majoré,
             seuil hebdomadaire et multiplicateur
Lignes       : date · origine · intitulé · cohorte · heures · taux · montant · [heures sup]
Récapitulatif: base, heures sup, primes, retenues, TOTAL
Total en lettres
```

**Contrainte de traçabilité :** 100 % des heures payées doivent être rattachables
à une séance identifiable (date, matière, cohorte), vérifiable depuis le détail du
paiement **et** depuis le bulletin.

**Configuration affichée :** celle **en vigueur sur la période**, pas celle
d'aujourd'hui — sinon le bulletin afficherait un taux qui n'a jamais servi à ce
calcul.

---

## 10. Contrat d'API

Forme de réponse uniforme : `{ success: true, data }` ou
`{ success: false, error: CODE, message, details? }`.

### 10.1 Séances

| Verbe | Chemin | Rôle |
|---|---|---|
| GET | `/remuneration/seances` | Liste filtrée + paginée + agrégats serveur |
| GET | `/remuneration/seances/annees-scolaires` | Options du filtre |
| GET | `/remuneration/seances/enseignants` | Enseignants ayant du travail en attente |
| GET | `/remuneration/seances/manquantes?du&au` | Créneaux attendus sans séance |
| GET | `/remuneration/seances/overlaps` | Chevauchements |
| GET | `/remuneration/seances/{id}` | Fiche |
| PATCH | `/remuneration/seances/{id}/statut` | `{ statut }` |
| PATCH | `/remuneration/seances/{id}/duree` | `{ duree: nombre \| null }` |
| POST | `/remuneration/seances/validate` | `{ seanceIds[], validated }` → application partielle |
| POST | `/remuneration/seances` | Séance comptable |

> **Piège de routage.** Tous les chemins statiques (`/annees-scolaires`,
> `/enseignants`, `/manquantes`, `/overlaps`) doivent être déclarés **avant**
> `/{id}`, sinon « overlaps » est cherché comme un identifiant.

### 10.2 Tarifs

| Verbe | Chemin |
|---|---|
| GET | `/remuneration/tarifs?matiereId&enseignantId&actifLe` |
| GET | `/remuneration/tarifs/resolve?matiereId&enseignantId&date` |
| POST / GET / PUT / DELETE | `/remuneration/tarifs[/{id}]` |

### 10.3 Bulletins

| Verbe | Chemin | Rôle |
|---|---|---|
| GET | `/remuneration/bulletins/enseignants` | Vue d'ensemble (§6.1) |
| GET | `/remuneration/bulletins/periode-en-attente` | Pilote l'activation du formulaire |
| GET | `/remuneration/bulletins/periodes` | Périodes + périmètre + consommation |
| POST | `/remuneration/bulletins/archiver` | `{ paymentIds[] } \| { tous: true }` |
| POST | `/remuneration/bulletins/verser` | idem |
| GET | `/remuneration/bulletins/historique?enseignantId` | |
| POST | `/paiements/calculate` | `{ periodId, teacherIds?, recalculate?, scope?, dryRun? }` |
| GET | `/paiements/{id}/bulletin.pdf` | |
| PATCH | `/paiements/{id}/statut` | |
| PATCH | `/paiements/{id}/ajustements` | primes / retenues manuelles |

### 10.4 Espace enseignant

| Verbe | Chemin |
|---|---|
| GET | `/remuneration/my/seances` |
| GET | `/remuneration/my/payments` |

> **Règle de sécurité absolue.** L'identifiant de l'enseignant est **dérivé du
> jeton**, jamais d'un paramètre. Accepter un `teacherId` en requête rendrait
> toutes les rémunérations lisibles par n'importe quel enseignant authentifié.

### 10.5 Codes d'erreur

| Code | HTTP |
|---|---|
| `SEANCE_INTROUVABLE`, `TARIF_INTROUVABLE`, `ENSEIGNANT_INTROUVABLE` | 404 |
| `SEANCE_DEJA_PAYEE`, `TARIF_CHEVAUCHANT` | 409 |
| `SEANCE_NON_PAYABLE`, `AUCUN_TARIF_RESOLU`, `VALIDATION` | 422 |
| `INTERVALLE_INVALIDE` | 400 |
| `INTERDIT` | 403 |

---

## 11. Sécurité, rôles, cloisonnement

| Surface | Accès |
|---|---|
| Configuration, validation des séances, tarifs, calcul, archivage, versement | **Administration** |
| Consultation de sa propre rémunération et de ses propres séances | **Enseignant concerné, et lui seul** |

**Cloisonnement multi-établissement :** chaque table porte le `tenant_id`, et
**toute** requête est filtrée dessus. Dans l'implémentation actuelle c'est
renforcé par de la sécurité au niveau des lignes (RLS PostgreSQL, avec une
variable de contexte positionnée par transaction). Sur une autre stack, prévoir
**un mécanisme équivalent au niveau de la couche d'accès aux données** — un filtre
appliqué par convention se contourne un jour par oubli.

**Audit :** toute modification de statut d'un bulletin est tracée, sans distinction
d'origine.

---

## 12. Cas limites — à traiter explicitement

| Cas | Décision retenue |
|---|---|
| Séance à cheval sur deux périodes | Rattachée à la période contenant sa **date**. **Pas de prorata** — le prorata rendrait le bulletin illisible. |
| Séance hors de toute période | Reste validable ; payée quand une période la couvrira. |
| Séance validée après clôture de la période | N'entre pas dans le bulletin de cette période ; signalée « validée hors période close ». |
| Séance sans enseignant | Jamais payable (aucun bénéficiaire). |
| Enseignant devenu inactif en cours de période | Ses séances validées avant désactivation **restent dues et sont payées**. |
| Enseignant remplacé sur une séance | Payé à **l'intervenant réellement inscrit sur la séance**, pas au titulaire de l'affectation. |
| Suppression d'une séance déjà payée | Refusée tant qu'elle figure dans un bulletin arrêté ou versé. |
| Heures supplémentaires | Seuil apprécié sur le **cumul des deux origines**. |
| Devise | Un établissement, une devise. Un bulletin ne mêle jamais deux devises. |
| Chevauchement d'horaires | Signalé comme anomalie **avant** validation. |
| Primes et retenues | **Saisie manuelle uniquement.** Aucune règle automatique. |

---

## 13. Ce que la plateforme cible doit savoir faire

Le module s'appuie sur cinq capacités. Si la stack visée n'en offre pas une
nativement, voici la contrepartie à écrire.

| Capacité utilisée | Rôle | Si absente |
|---|---|---|
| **Transactions** | Archivage, versement, validation en lot, recalcul (suppression + réinsertion du détail) | **Indispensable.** Sans transaction, un recalcul interrompu laisse un bulletin sans détail. Ne pas porter le module sans. |
| **Contrainte d'exclusion sur plages de dates** | Interdire deux tarifs chevauchants pour un même couple | Vérification transactionnelle avec verrou sur la clé (matière, enseignant), sinon deux créations concurrentes passent toutes les deux. |
| **Index uniques partiels** | Une séance n'apparaît qu'une fois par bulletin | Contrainte applicative + vérification en transaction. |
| **Sécurité au niveau des lignes** | Cloisonnement multi-établissement | Filtre `tenant` **centralisé dans la couche d'accès**, jamais laissé à l'appelant. |
| **Génération PDF côté serveur** | Bulletin | Tout moteur HTML→PDF convient : le gabarit est du HTML/CSS pur, sans dépendance à la base. |

**Ce qui n'est PAS requis :** aucune fonctionnalité exotique de base de données
au-delà de ce tableau. Le moteur de calcul lui-même est **du code pur, sans
entrée/sortie** — il prend une configuration et une liste d'heures tarifées, et
rend un résultat. C'est ce qui le rend testable sans base, et c'est la première
chose à porter.

---

## 14. Plan d'implémentation recommandé

L'ordre suit les dépendances réelles, pas l'ordre des écrans.

| Lot | Contenu | Livrable vérifiable |
|---|---|---|
| **L0 — Socle** | Tables, cloisonnement, transactions | Un enregistrement d'un établissement est invisible depuis un autre |
| **L1 — Configuration** | CRUD + état calculé à 4 valeurs | Un enseignant à configuration expirée s'affiche comme tel |
| **L2 — Cycle de vie des séances** | Statut, validation, durée dérogée, prédicats **centralisés** | Trois séances (réalisée, annulée, planifiée) : seule la réalisée **et** validée est payable |
| **L3 — Moteur de calcul pur** | Les trois modes, heures sup hebdomadaires, sans aucune I/O | Tests unitaires sans base : 4 h académiques + 3 h professionnelles = **un** bulletin de 7 h |
| **L4 — Collecteurs + heures consommées** | Une requête par origine, exclusion des heures déjà payées | Deux calculs successifs → résultat strictement identique |
| **L5 — Tarification** | Tarifs par matière, résolution ordonnée, préchargement | Tarif nominatif > générique > défaut ; anomalie explicite si rien |
| **L6 — Persistance & workflow** | Bulletins, détail historisé, calculer / arrêter / verser, audit figé | Un tarif modifié après approbation ne change aucun montant approuvé |
| **L7 — Écrans** | Les quatre écrans, agrégats serveur | Un enseignant non configuré est visible sur l'écran des bulletins |
| **L8 — Restitution** | PDF, historique, exports, espace enseignant | Un bulletin mixte présente les deux origines, séance par séance |

**Conseil d'ordre.** Ne pas commencer par les écrans. Les erreurs coûteuses de ce
module ne sont pas des erreurs d'interface : ce sont des prédicats recopiés, des
compteurs calculés sur la page au lieu du périmètre, et des actes financiers
confondus.

---

## 15. Jeu de tests d'acceptation

À reprendre tel quel — ce sont les critères qui ont réellement discriminé les
implémentations correctes des autres.

| # | Scénario | Attendu |
|---|---|---|
| T1 | Enseignant **exclusivement professionnel**, horaire, 6 h validées | Bulletin non nul, égal à heures × tarif à l'unité monétaire près |
| T2 | Enseignant **mixte** : 4 h académiques + 3 h professionnelles, même période | **UN SEUL** bulletin de 7 h, détail distinguant l'origine de chaque ligne |
| T3 | Enseignant **salarié** avec des séances validées | Montant inchangé, séances listées à titre informatif, sans effet |
| T4 | Séance `planifiee` / `annulee` / non validée / sans enseignant / sans horaires | **Aucun montant produit**, dans les cinq cas |
| T5 | **Recalcul lancé deux fois** de suite | Résultat strictement identique, aucune ligne de détail dupliquée |
| T6 | Recalcul sur un bulletin `approuve` ou `paye` | Non écrasé, et **signalé dans le compte rendu** |
| T7 | Tarif modifié **après** approbation | Aucun montant approuvé ou versé n'est modifié |
| T8 | Enseignant **sans configuration** valide sur la période | Écarté **et signalé explicitement**, jamais silencieusement absent |
| T9 | Heure payable **sans aucun tarif résoluble** | Anomalie explicite, jamais un montant nul |
| T10 | Deux périodes couvrant la même date, même séance validée | La séance n'est payée **qu'une fois** |
| T11 | Bulletin **annulé** puis recalcul | Les heures redeviennent disponibles |
| T12 | Bulletin **archivé** puis recalcul | Les heures restent consommées |
| T13 | Validation en lot avec 1 séance non éligible sur 200 | 199 validées, 1 rejetée **avec son motif** |
| T14 | Archivage | `paye_le` reste **vide** ; le statut affiche « Impayé » |
| T15 | Versement d'un bulletin encore `calcule` | Refusé — il doit d'abord être arrêté |
| T16 | Enseignant A consulte l'API `my/*` | Ne voit **aucune** donnée de l'enseignant B |
| T17 | 500 séances × 100 enseignants | Calcul en **moins de 30 secondes** |
| T18 | Ventilation des rapports | Académique + Professionnel + **hors-heures** = Total (§16) |
| T19 | Liste de séances paginée à 10 sur 300 | Les compteurs annoncent **300**, pas 10 |
| T20 | « Tout archiver » avec un enseignant ayant 2 bulletins ouverts | **Les deux** sont archivés |

---

## 16. Le troisième poste de ventilation

Les rapports doivent offrir un filtre d'origine (Académique / Professionnel /
Tous), appliqué de façon cohérente à l'affichage, aux totaux **et** aux exports.

Mais la ventilation compte **trois** postes, pas deux :

```
Académique  +  Professionnel  +  hors-heures  =  Total
```

> **Pourquoi.** Un enseignant **salarié** n'a aucune ligne de détail horaire : son
> montant ne provient d'aucune origine. Avec seulement deux postes, l'écart
> apparaîtrait comme une erreur de calcul. Le poste « hors-heures » recueille les
> montants qu'aucune ligne d'heures ne justifie — salaires, primes, retenues.
>
> Vérifié en base sur l'implémentation actuelle : `0 + 244 000 + 900 000 = 1 144 000`.

---

## 17. Les dix erreurs à ne pas refaire

Condensé du retour d'expérience — chacune a coûté un correctif en production.

1. **Recopier un prédicat métier.** Payabilité, durée retenue, heure consommée :
   une définition, un endroit, importée partout. Une variante locale produit un
   écran qui annonce des heures que le calcul ne retrouve pas.
2. **Confondre archiver et verser.** Trois actes, trois dates, trois auteurs.
3. **Calculer les agrégats sur la page affichée.** Une liste paginée annonce
   toujours le mauvais total. Les compteurs appartiennent au serveur.
4. **Laisser l'écran énumérer les identifiants d'une action de masse.** Il ne voit
   qu'une partie du périmètre. Prévoir une forme « tout », et interdire qu'une
   liste vide vaille « tout ».
5. **Jointure vers les utilisateurs pour l'audit.** Elle dit qui porte ce compte
   aujourd'hui, pas qui a agi alors. Dénormaliser le nom.
6. **Écarter un enseignant sans dire pourquoi.** « Pas payé » et « je sais
   pourquoi » sont deux produits différents.
7. **Ne montrer que les enseignants configurés.** L'écran doit montrer ceux qui
   ne le sont pas — c'est sa raison d'être.
8. **Traiter « configuration expirée » comme « configuration ».** Effet identique
   à une absence : ignoré en silence.
9. **Trier les séances par date décroissante seule.** L'écran s'ouvre sur du
   planning à cinq ans. Passé d'abord, futur ensuite.
10. **Déclarer les routes paramétrées avant les routes statiques.** `overlaps`
    finit cherché comme un identifiant.

---

## Annexe A — Correspondance avec l'implémentation actuelle

| Concept du document | Table actuelle | Service actuel |
|---|---|---|
| `periode_paie` | `payment_periods` | `payment-periods.ts` |
| `periode_cibles` | `payment_period_teachers` | idem |
| `config_paie_enseignant` | `teacher_payment_configs` | `teacher-payment-configs.ts` |
| `seance` (professionnel) | `professional_ecue_seances` | `professional-seance-validation.service.ts` |
| `tarif_horaire_matiere` (pro) | `professional_ecue_hourly_rates` | `professional-ecue-rates.service.ts` |
| `tarif_horaire_matiere` (académique) | `course_hourly_rates` | `payment-calculator.ts` |
| `bulletin` | `teacher_payments` | `teacher-payments.ts` |
| `ligne_detail_heure` | `payment_hour_details` | `payment-calculator.ts` |
| `journal_audit_paiement` | `payment_audit_log` | — |
| Prédicats centralisés | — | `professional-seance-validation.service.ts` (exportés) |
| Heures consommées | — | `hour-collectors/heures-consommees.ts` |
| Collecteurs | — | `hour-collectors/{academic,professional}-hour-collector.ts` |
| Moteur de calcul | — | `payment-calculator.ts` |
| Vue d'ensemble bulletins | — | `teacher-payroll-overview.service.ts` |
| PDF | — | `teacher-payslip.service.ts` + `teacher-payslip-template.service.ts` |

Migrations de référence : `0011` (socle paie), `0103` (unification des deux
origines), `0104` (durée dérogée), `0106`/`0107` (périodes ciblées), `0108`
(archivage), `0109`→`0111` (audit résilient), `0112` (chevauchement autorisé),
`0114` (versement distinct de l'archivage).

Spécification fonctionnelle d'origine : `specs/031-remuneration-professionnelle/`.

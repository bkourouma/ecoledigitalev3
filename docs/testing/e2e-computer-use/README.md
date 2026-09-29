# Campagne E2E « De la création du programme à la délivrance du diplôme »

Scénarios de test de bout en bout destinés à être **joués par un agent Claude Code pilotant un
navigateur**, sur l'environnement de développement local (web `:3000`, API `:4000`, base
`dbecoledigitale`).

---

## Les fichiers

| Fichier | À quoi il sert | Qui le lit |
|---|---|---|
| `PARCOURS-COMPLET-MODULE-PRO.md` | **Parcours unique et autonome** du module professionnel, de la filière au diplôme, sur les cinq profils (admin, enseignants, étudiants, parent, owner), écran par écran. À coller tel quel dans Claude (extension Chrome) | l'agent navigateur |
| `00-protocole-agent.md` | Contrat d'exécution : discipline de budget, classement des anomalies, format de rapport, règles de prudence | **chaque agent, avant son scénario** |
| `01-lancement-campagne.md` | Prérequis, ordre d'exécution, prompt de lancement, réaction aux rapports | l'orchestrateur |
| `scenarios/S01..S17` | Les dix-sept scénarios, un fichier chacun | l'agent qui joue le scénario |
| `registre-donnees.md` | Identifiants créés et valeurs attendues — le seul canal entre scénarios | tout le monde |
| `modeles/fiche-anomalie.md` | Ce que doit contenir une anomalie pour être corrigeable sans rejeu | les agents |
| `modeles/rapport-final.md` | Le document de sortie, d'où part le chantier de correction | l'orchestrateur |
| `rapports/`, `captures/` | Sorties de campagne | — |

---

## Les trois chaînes

**A — Module professionnel (le cœur).** C'est la seule chaîne qui mène réellement à un diplôme.
Dix scénarios, de la création du cycle jusqu'à l'écran où l'étudiant télécharge son diplôme.

```
S01 socle (cycle, filière, classe, UE, ECUE, semestre)
 └─ S02 ouverture de classe, enseignant, emploi du temps, signataires
     └─ S03 étudiants et inscriptions
         ├─ S04 séances et présences
         │   └─ S05 notes session 1 + conduite
         │       └─ S06 rattrapages session 2
         │           └─ S07 bulletins et clôture
         │               ├─ S08 DIPLÔME : éligibilité, octroi, PDF, révocation
         │               └─ S09 attestation de réussite
         │                   └─ S10 vues étudiant et parent
         └─ (chaîne B)
```

**B — Volet financier.** S11 encaissement, S12 commissions de prospection, S13 rémunération du
formateur, S14 tunnel d'inscription publique. S11 à S13 s'accrochent à la chaîne A ; S14 est
autonome.
**S17** rejoue la rémunération de bout en bout (génération, archivage, versement, vue
enseignante) : autonome, à coller tel quel dans Claude web, **sur une base isolée uniquement**.

**C — Parcours académique classique.** S15 et S16, indépendants. À noter d'emblée, parce que
c'est une réponse à la question de départ : **ce parcours ne délivre aucun diplôme**. Il
s'arrête aux bulletins et aux relevés de notes. Le diplôme n'existe que dans le module
professionnel.

Trois étudiants traversent la chaîne A avec trois destins voulus — **A** réussit tout, **B**
passe par le rattrapage, **C** est ajourné — parce qu'un seul étudiant ne teste qu'une branche
sur trois du calcul de bulletin et de l'éligibilité au diplôme.

---

## Ce que la lecture du code a déjà mis en évidence

Ces points sont **constatés dans le code**, pas encore vérifiés à l'exécution. Les scénarios
sont écrits pour les confirmer ou les infirmer, avec les chiffres à l'appui. Ils ne sont pas à
recopier tels quels dans le rapport final : c'est l'exécution qui tranche.

| # | Constat | Où il se vérifie |
|---|---|---|
| 1 | Le formulaire de création d'UE n'expose **aucun champ UV** et envoie systématiquement `0`. Or l'éligibilité au diplôme compare « UV acquises ≥ UV requises » : avec 0 des deux côtés, le critère de crédits est inopérant. | S01 étape 5, S07 étape 3, **S08 étape 2** |
| 2 | Un diplôme se calcule sur un **cycle entier** (Licence 1→3), déduit du nom de la classe, et non sur une classe. Une spécialité partagée avec une filière réelle rendrait le diplôme inatteignable. | **S08 étape 1** |
| 3 | L'écran des moyennes semestrielles ne liste que les classes dont le **cycle contient « BTS »**. Un établissement sans BTS ne peut générer aucun bulletin académique. | **S15 étape 1**, S16 étape 4 |
| 4 | `/annee-academique/bulletins` n'a pas de page : l'URL renvoie un 404. | S16 (piège documenté) |
| 5 | L'écran de paiement public semble afficher un **montant et un numéro d'inscription codés en dur**, indépendants de la formation choisie. | **S14 étape 3** |
| 6 | Le repli de paiement en mode développement redirige vers `/payments/mock`, page qui n'existe pas. | S14 étape 4 |
| 7 | Les pages `/professionnel/admin/*` n'ont **aucune garde côté écran** : la protection est côté serveur. Un rôle non autorisé voit une page vide plutôt qu'un refus. | S10 étape 5 |
| 8 | Relevés de notes et rapports de présence sont **entièrement manuels** et leurs liens sont retirés du menu. Ils peuvent contredire les bulletins calculés. | S16 étapes 7 et 8 |
| 9 | Aucune règle ne lie **solde impayé** et délivrance du diplôme : un étudiant qui doit de l'argent est diplômé si ses UE sont validées. | S08 (question posée, pas testée comme un bug) |
| 10 | Le motif de révocation d'un diplôme — donnée d'archive — passe par une boîte de dialogue native du navigateur. | S08 étape 8 |
| 11 | La documentation `module-professionnel-diplomes-requirements.md` décrit un modèle **par matière et par programme** que le code a remplacé par un modèle **par UE et par cycle**. La doc est périmée. | à trancher au rapport final |

---

## Maîtrise du budget

Le coût d'une campagne tient à trois choses, dans cet ordre : les captures d'écran, les clics
un par un, et la relecture de pages déjà validées. Les règles qui suivent sont dans
`00-protocole-agent.md` §3 et s'appliquent à tous les scénarios :

- lecture des pages en **texte** (`read_page`, `get_page_text`), jamais en image ;
- capture d'écran **réservée aux preuves d'anomalie et aux documents PDF**, 3 par scénario au
  plus, toujours à `scale: 0.5` ;
- gestes **enchaînés** en un seul appel dès qu'on peut en prévoir deux ;
- plafond de **70 appels d'outils** par scénario, avec reddition de comptes à 60.

**Modèle** : les seize scénarios se jouent en **Sonnet 5**. L'analyse des anomalies, le
diagnostic dans le code et les correctifs restent à Opus — c'est-à-dire à l'orchestrateur, pas
aux agents.

---

## Garde-fous

- **Tout objet créé porte le tag de run** (`E2E-JJMM-N`). Aucun objet sans tag ne doit être
  modifié ni supprimé, quelle qu'en soit l'apparence.
- **Aucun paiement réel**, aucune donnée bancaire saisie. Devant un vrai formulaire de
  prestataire : arrêt immédiat.
- **Aucune adresse e-mail réelle** : tout est en `.test`, non routable.
- **Les agents ne corrigent rien** — ils constatent et rapportent. Toute modification de code
  ou de base passe par l'orchestrateur.
- **Un seul contournement est autorisé** dans toute la campagne : nommer le cycle académique
  « BTS » en S15, et c'est justement pour pouvoir documenter le filtre qui l'impose.

---

## Limites connues avant même de commencer

Trois gestes risquent de ne pas être automatisables par un agent navigateur. Ils sont signalés
dans les scénarios concernés, avec pour consigne de **s'arrêter et de le dire** plutôt que de
contourner :

1. **L'upload de fichier obligatoire** à la création d'un étudiant (S03, S15) — s'il échoue, la
   campagne ne peut pas créer ses étudiants et doit être amorcée à la main.
2. **Les mots de passe générés** des comptes enseignant, étudiant et parent, envoyés par e-mail
   à des adresses non routables (S02, S10, S13) — sans eux, les vues aval ne se vérifient pas
   de bout en bout.
3. **La boîte de dialogue native** de la révocation de diplôme (S08).

Aucun de ces trois points n'est un défaut du produit en soi ; ce sont des limites du dispositif
de test, et le rapport final doit les porter dans « ce qui n'a pas été testé » plutôt que de
laisser croire à une couverture complète.

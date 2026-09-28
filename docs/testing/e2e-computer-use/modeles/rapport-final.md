# Modèle — rapport final de campagne

> Produit par l'orchestrateur à partir des rapports de scénarios. C'est le document
> d'entrée du chantier de correction : il doit se lire seul, sans la conversation.

---

```markdown
# Campagne E2E <TAG_RUN> — Programme → Diplôme
**Date** : <JJ/MM/AAAA>  ·  **Environnement** : local dev (web :3000, API :4000, base dbecoledigitale)
**Commit / état du code** : <si connu>  ·  **Modèle d'exécution** : Sonnet 5 (scénarios), Opus 5 (analyse)

## 1. Verdict

<Trois à cinq lignes. La chaîne va-t-elle de bout en bout, oui ou non ? Si non, où casse-t-elle ?
Pas de diplomatie : si le diplôme n'a pas pu être délivré, c'est la première phrase.>

| | |
|---|---|
| Scénarios joués | <n> / <total> |
| OK | <n> |
| OK avec réserves | <n> |
| Échec bloquant | <n> |
| Non joués (bloqués en amont) | <n> — <lesquels> |

## 2. Tableau de bord des scénarios

| ID | Scénario | Rôle | Statut | Anomalies |
|---|---|---|---|---|
| S01 | ... | admin | OK | — |

## 3. Anomalies par priorité d'implémentation

Priorité = gravité × nombre de scénarios aval condamnés. Une bloquante qui condamne la
délivrance du diplôme passe devant une majeure isolée.

### P1 — à corriger avant toute autre chose
| Réf | Titre | Localisation présumée | Scénarios débloqués |
|---|---|---|---|

### P2 — résultat faux, à corriger avant mise en service
### P3 — confort, libellés, ergonomie

<Pour chaque anomalie : la fiche complète, reprise telle quelle depuis le rapport de scénario.>

## 4. Analyse de cause (par anomalie P1/P2)

<Ce que l'orchestrateur a pu établir en lisant le code, après coup : fichier + ligne, nature du
défaut, correctif proposé. Distinguer nettement ce qui est **constaté** de ce qui est **supposé**.>

## 5. Plan d'implémentation

| # | Correctif | Fichiers | Effort | Risque de régression | Anomalies couvertes |
|---|---|---|---|---|---|

<Ordonné pour que chaque lot débloque le maximum de scénarios aval. Précise ce qui exige une
migration SQL, ce qui exige un redémarrage de l'API, ce qui est purement front.>

## 6. Couverture — ce qui n'a PAS été testé

<Honnêteté obligatoire. Les zones sautées faute de budget, les gestes impossibles à automatiser
(paiement réel, envoi d'e-mail), les cas limites laissés de côté. Une campagne qui prétend tout
couvrir fait plus de mal qu'une campagne qui dit où sont ses trous.>

## 7. Données laissées en base

| Type | Libellé (tag <TAG_RUN>) | UUID | À supprimer ? |
|---|---|---|---|

<Et la marche à suivre pour nettoyer.>
```

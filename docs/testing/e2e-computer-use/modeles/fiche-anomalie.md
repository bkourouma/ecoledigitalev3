# Modèle — fiche d'anomalie

> Une fiche par anomalie. Les anomalies **bloquantes** et **majeures** ont toutes les rubriques ;
> une **mineure** tient en trois lignes (identité, constat, capture facultative).
>
> Objectif de la fiche : permettre à l'orchestrateur de corriger **sans rejouer le test**.
> Une fiche qui oblige à redemander la requête réseau ou l'erreur console fait perdre un
> aller-retour complet de campagne.

---

```markdown
### ANO-<ID_SCENARIO>-<NN> — <titre court, factuel>

| | |
|---|---|
| **Gravité** | BLOQUANTE / MAJEURE / MINEURE |
| **Scénario** | <ID> — <titre> |
| **Étape** | <numéro et libellé de l'étape du scénario> |
| **Rôle connecté** | <admin / enseignant / étudiant / parent / commercial> |
| **URL** | `http://localhost:3000/...` |
| **Tag de run** | `E2E-JJMM-N` |

**Geste exact**
<Le clic ou la saisie, avec les valeurs employées. Assez précis pour être rejoué à l'identique.>

**Attendu**
<Une phrase.>

**Constaté**
<Une phrase. Le message d'erreur exact s'il y en a un, entre guillemets.>

**Requête fautive**
```
<MÉTHODE> <chemin>  →  <code HTTP>
Corps de réponse (extrait) : <le message d'erreur, pas le corps entier>
```

**Erreurs console** (0 à 3 lignes, les plus parlantes)
```
<...>
```

**Log serveur** (si évident, 5 lignes max)
```
<...>
```

**Capture** : `captures/<ID_SCENARIO>-<NN>.png` — uniquement si le problème est visuel.

**Reproductibilité** : systématique / intermittente (<n> tentatives sur <m>) / une seule occurrence

**Impact sur la suite du scénario**
<Ce qui n'a pas pu être testé à cause de cette anomalie. C'est ce qui détermine la priorité
réelle : une anomalie bloquante qui condamne 4 scénarios aval passe avant tout le reste.>

**Piste** (facultatif, une ligne)
<Seulement si tu as vu quelque chose de concret — un champ absent de la réponse API, un
identifiant à null. Pas de spéculation sur le code que tu n'as pas lu.>
```

---

## Ce qui rend une fiche inutilisable

- « Ça ne marche pas » sans le message d'erreur.
- Une capture d'écran à la place de la requête réseau : on voit le symptôme, pas la cause.
- Le corps de réponse complet collé sur 200 lignes : on cherche l'aiguille.
- Une piste de correction inventée à partir de rien : elle oriente mal et coûte plus cher que
  pas de piste du tout.
- Plusieurs symptômes différents fusionnés dans une seule fiche : chaque cause = une fiche.

# ADR-003 — DSL des règles académiques (Rules Engine)

- **Statut** : Accepté (revue du 2026-10-01 : itérations bornées, statuts actifs et classement validés)
- **Date** : 2026-10-01
- **Décideurs** : équipe plateforme ; contexte : décision D5 du plan de mise en œuvre (§3.8), tâche 0.8 « Spike DSL »
- **Preuves** : `packages/rules-engine/spike/` (code, résultats, README) ; implémentation `packages/rules-engine/`

## Contexte

Le plan (§3.8, décision D5) exige un moteur de règles **libre mais sandboxé** : le super-admin publie les RuleSets réglementaires, l'administrateur d'un
établissement rédige une variante qui n'est activée qu'après **simulation** sur ses données puis validation du super-admin. Chaque bulletin doit citer la version de
règle utilisée, être **reproductible** et **explicable**.

Cela impose un langage d'expressions saisi par des humains (donc potentiellement hostile ou simplement erroné), exécuté côté serveur sur des données d'élèves.
Le **critère éliminatoire** posé par le plan est l'impossibilité de boucle infinie ; l'isolation (pas d'échappée vers le runtime Node) est son corollaire.
Critères complémentaires retenus : budget d'évaluation imposable (nœuds et temps), **arithmétique décimale exacte** (les seuils décident d'admissions : 9,995 ne vaut pas 10),
déterminisme (ni horloge, ni aléa, ni accès global), vérification des noms/types **à la publication**, messages d'erreur **en français**, taille de dépendance, maintenance.

Les formules à porter sont celles du code actuel : note ECUE `devoirs × 0,4 + examen × 0,6`, moyenne UE pondérée par crédits, ECUE éliminatoire < 5, validation à 10 sur la valeur
**non arrondie** (`apps/api/src/services/bulletin-calc.ts`), moyenne pondérée par coefficient, `(S1 + 2·S2) / 3`, mentions 16/14/12/10/8, classement avec ex æquo
(`apps/api/src/routes/semester-averages.ts`).

Constat qui motive l'exigence décimale : le code actuel calcule en flottants binaires. Sur la grille des notes à deux décimales (0,00 à 20,00 pour les devoirs *et* l'examen,
4 004 001 couples), **24 couples** donnent une note exactement égale à 10 que le code actuel juge `< 10` (ex. devoirs 0,4 et examen 16,4 : `0.4*0.4 + 16.4*0.6 = 9.999999999999998`),
et des cas symétriques franchissent à tort le seuil éliminatoire de 5 (devoirs 0,2 et examen 8,2 : `4.999999999999999 < 5` alors que la note vaut exactement 5, ce qui bloquerait l'UE).
Ces cas sont consignés dans `packages/rules-engine/test/golden-bts-lmd.test.ts`.

## Décision

**Écrire un DSL maison : analyseur de Pratt écrit à la main → AST gelé → vérificateur statique → interpréteur à liste blanche, arithmétique `decimal.js`, budget d'évaluation et trace.**
Il est livré dans le package pur `@ecoledigitale/rules-engine` (zéro I/O, zéro dépendance à Fastify/pg/Next ; seulement `decimal.js` et `zod`).

Raison principale : c'est la **seule** option qui satisfait *simultanément* l'éliminatoire (aucune boucle ni récursion possible, y compris par construction de la grammaire), l'isolation
(aucun accès à autre chose que les propriétés propres de données déclarées au schéma), un **budget d'évaluation déterministe** (les bibliothèques CEL testées n'en offrent aucun), la **décimale exacte**
native et une vérification à la publication produisant des messages français avec position, suggestion orthographique et suivi de la nullité. Le coût (un petit interpréteur à maintenir, ≈ 3 000 lignes
avec modèle, résolution, simulation et commentaires, couvert par 293 tests) est jugé inférieur au coût de contournement de chacune des alternatives.

### Tableau comparatif (résultats du spike, `packages/rules-engine/spike/README.md`)

| Critère | CEL `@marcbachmann/cel-js` 8.0 | CEL `cel-js` 0.8 | CEL `@bufbuild/cel` 0.6 | JSONata 2.2 | Maison Peggy | **Maison Pratt (retenu)** |
|---|---|---|---|---|---|---|
| **Boucle infinie impossible** (éliminatoire) | Oui (non Turing-complet) | Oui | Oui | **Non** : `$f := function(){ $f() }` ne termine jamais (T1, T2 : timeout 8 s) | Oui | **Oui** (pas de fonctions définissables ni de récursion ; itération uniquement via 4 intégrées bornées par les données) |
| **Isolation** (`constructor`, `__proto__`, `process`) | Bloquée (erreur d'exécution) | **Fuite** : `a.constructor` renvoie une fonction, `a.__proto__` un objet (E1, E2, E6) | Bloquée | Bloquée (`undefined`), mais `$eval` (évaluation dynamique) disponible | Bloquée | **Refusée à la compilation** (champ non déclaré) |
| **Budget d'évaluation** (nœuds/temps) | **Aucun** (limites d'analyse seulement) ; T6 10^9 itérations : timeout | Aucun | Aucun ; T6 timeout | Aucun ; T1, T2, T6 timeout | Facile à ajouter | **Oui** : nœuds (déterministe) + temps ; T6 équivalent : erreur propre en < 3 s |
| **ReDoS** | Timeout sur `(a+)+$` (T7) | `matches` absent | **Sûr (RE2)** | Timeout | N/A (pas de regex) | N/A (pas de regex) |
| **Décimal exact** | Non (`double`) ; type `Decimal` enregistrable mais littéraux impossibles (`dec("0.4")`), ÷ 30–40 en débit | Non | Non | Non (flottants) | Oui | **Oui**, littéraux décimaux natifs, précision 40 chiffres, `round_half_up`/`round_half_even` exacts |
| **Pile saturée par entrée pathologique** (T3–T5) | Limites configurables (maxDepth, maxAstNodes) | Oui, plantage | Oui, plantage | Oui, plantage ; 3,1 s pour 5 000 parenthèses | Oui, plantage | **Non** : limites de longueur, profondeur, hauteur et nombre de nœuds |
| **Déterminisme** (horloge/aléa) | Aucun accès | Aucun | Aucun | **`$now()`, `$millis()`, `$random()` présents** | Aucun | Aucun (Date.now confiné au budget de temps, jamais lisible par une règle) |
| **Vérification à la publication** | **Oui** (noms, types, surcharges) | Non (exécution) | Non (exécution) | Non ; `undefined`/`NaN` silencieux (V1, V4, V6) | Noms, pas de types | **Oui** : noms, champs, clés de recherche, arité, types, **nullité avec flux** (`is_null`, `&&`, `if`) |
| **Messages d'erreur en français** | Non (anglais, curseur) | Non (10 alternatives de jetons) | Non | Non | Non (anglais à réécrire) | **Oui**, ligne/colonne, conseil, « Vouliez-vous dire … ? » |
| **Taille installée** (dépendances comprises) | 222 KiB | 3,1 MiB | 7,2 MiB | 834 KiB | 857 KiB (Peggy) + decimal.js | ≈ 121 KiB compilés + decimal.js 278 KiB + zod (déjà dans le dépôt) |
| **Débit** (éval./s, compilée une fois) | 0,9–3,7 M | 0,25 M | 0,3–0,9 M | 0,04–0,12 M | 0,03–0,08 M | 0,04–0,12 M (trace complète activée) |
| **Maintenance** | 1 dépendance tierce, v8 | v0.8, 2 dépendances | v0.6 (pré-1.0), Apache-2.0 | Projet établi, v2 | Dépendance de build | **À notre charge** (risque assumé, cf. Conséquences) |

Verdict par option, dans l'ordre du critère éliminatoire :

1. **JSONata : éliminé.** Le langage est Turing-complet (récursion terminale optimisée) et expose `$eval`, `$now()`, `$random()`.
2. **`cel-js` : éliminé.** La fuite de références de fonction (`a.constructor`) est une porte d'entrée vers `constructor.constructor("return process")()`.
3. **CEL (`@marcbachmann/cel-js`, `@bufbuild/cel`) : sûr sur l'éliminatoire mais insuffisant.** Pas de budget d'évaluation (une règle de dix lignes imbriquant des macros suffit à figer le thread),
   ReDoS (sauf RE2), pas de décimal exact, pas de nullité suivie, messages en anglais ; chaque manque se comble en *réécrivant* la moitié de l'environnement, c'est-à-dire en maintenant un second moteur
   par-dessus.
4. **Peggy + interpréteur : viable mais dominé** par le parseur écrit à la main (pile saturée, messages anglais à réécrire, étape de génération).

## Conséquences

### Langage livré

- Littéraux : nombres décimaux (`0.4`), textes (`"Bien"`), `true`, `false`, `null`, listes `[1, 2, 3]` ; opérateurs `+ - * / % == != < <= > >= && || !` (court-circuit) ; commentaires `// …`.
- Données : variables déclarées au schéma (`devoirs`), champs (`ue.credits`), « plucks » de listes (`ecues.note`), recherches paramétrées (`period("S1").average`). Le contexte est immuable ; seules ses propriétés propres de type donnée sont lues (jamais d'accesseur, ni de prototype).
- Bibliothèque (liste blanche) : `avg, wavg, sum, min, max, count, clamp, abs, round_half_up, round_half_even, floor, ceil, if, coalesce, is_null, rank, len` ainsi que `map, filter, any, all` dont la **lambda** `x => …` n'existe que comme second argument (ce n'est pas une valeur : non stockable, non appelable, donc sans récursion).
- Nullité statique : une valeur « pouvant être absente » (`number?`) est refusée dans une opération arithmétique ou un test d'ordre, sauf après `is_null`/`coalesce`/`!= null` (le vérificateur suit le flux). Les agrégats ignorent les valeurs absentes.
- Sortie : `value` (Decimal/texte/booléen/null), `json` (nombres en chaînes décimales exactes), `trace` post-ordre des valeurs intermédiaires (extrait de source, position), `nodesEvaluated`.
- Paramètres de règle (`params.seuil_validation`) avec bornes : les seuils réglementaires sont des données du RuleSet, pas des constantes de code (conforme à la règle « aucune règle académique codée en dur »).

### Garanties de terminaison et de sûreté

- Pas de boucle ni de récursion : l'AST est un arbre fini ; l'évaluation est un parcours unique. L'itération (`map/filter/any/all`, agrégats, `rank`) ne porte que sur des listes finies fournies par le contexte ou littérales (≤ 200).
- Limites de compilation (défauts, configurables) : 10 000 caractères, profondeur d'analyse 64, hauteur d'arbre 128, 2 000 nœuds. Aucun dépassement de pile n'est possible (testé jusqu'à 200 000 niveaux).
- Budget d'évaluation (défauts, configurables) : 100 000 nœuds (chaque élément de liste lu ou itéré coûte une unité), 1 000 ms (filet de sécurité), 500 entrées de trace. Le budget de nœuds est **déterministe** ; seul le budget de temps dépend de l'horloge et ne peut que *interrompre*, jamais modifier une valeur.
- Seules les règles produites par `compile()` sont évaluables (marque interne + AST gelé) : une règle reconstruite depuis du JSON ou forgée est refusée.
- Décimal : `Decimal.clone` privé (précision 40, demi-supérieur), la configuration globale de `decimal.js` n'est pas touchée. Les divisions sont arrondies à 40 chiffres significatifs ; `(a/b)*b` n'est donc pas toujours `a` (limite documentée).

### Gouvernance et modèle

- Types + schémas Zod : `RuleSet` (portée nationale ou établissement, pays, système éducatif, niveau) → `RuleVersion` (`status`: `draft|simulated|proposed|approved|published|retired`, `effectiveFrom/To` inclusifs en dates calendaires, `source`) → `Rule` (type, expression, paramètres, schéma d'entrée, type de résultat).
- `resolveRuleSet(ruleSets, requête)` : fonction pure, la date est un paramètre. Une variante d'établissement active l'emporte **toujours** sur le national ; statuts actifs par défaut : établissement `approved|published`, national `published` (configurable) ; à égalité : spécificité (niveau, système), date d'effet la plus récente, version la plus haute, identifiant. Elle renvoie aussi la liste des versions écartées avec la raison.
- `canTransition` encode la chaîne `draft → simulated → proposed → approved → published → retired` : l'étape « simulée » est obligatoire avant « proposée », l'admin d'établissement ne peut ni approuver ni publier ni toucher au national.
- `simulate(ancienne, nouvelle, jeu_de_données)` : rapport pur de différences (par règle et par cas : valeur modifiée, erreur introduite/résolue, delta exact, transitions de mention, règles ajoutées/retirées, erreurs de compilation).

### Conséquences sur le code existant

- `bulletin-calc.ts` et `semester-averages.ts` restent inchangés dans cette tâche. Les golden tests portent leurs formules et les **comparent au code historique** (2 000 UE et 5 800 jeux de moyennes aléatoires, identiques hors cas d'égalité de seuil à l'erreur flottante près) ; la bascule (spec 012, tranche 2.4) devra accepter les rares corrections de seuil listées en Contexte.
- Divergence assumée : le classement du moteur juge l'égalité sur la valeur arrondie à 4 décimales (`rank(x, liste, 4)`), alors que le code actuel chaîne une tolérance de 0,0001 entre voisins triés (non transitive). Les deux coïncident sur des moyennes à deux décimales.

### Coûts et risques

- **Maintenance interne** d'un langage : mitigée par une surface volontairement petite, une batterie de 293 tests (évasions, déterminisme sur 1 000 exécutions, limites, budgets, différentiel contre le code historique) et un test d'analyse statique qui interdit `eval`, `Function`, `process`, `Math.random`, `new Date`, E/S dans `src/`.
- **Formation des rédacteurs de règles** : la syntaxe est proche de l'expression de tableur ; les messages français et les suggestions limitent la courbe d'apprentissage. Un éditeur (colorisation, `validate()` au fil de la frappe) reste à construire dans le portail.
- **Évolution du langage** : toute nouvelle fonction doit être ajoutée à la liste blanche (`function-names.ts`, `functions.ts`) avec ses règles de type, ses tests et un coût de budget ; il n'existe pas de mécanisme d'extension par les RuleSets (voulu).
- **Débit** : ≥ 40 000 évaluations/s mesurées sur un poste chargé, très au-delà du besoin (génération de bulletins par lots dans le worker).

### Points à valider

1. **« Pas de boucles » (plan §3.8)** : le plan écrit « pas de boucles ». Nous avons ajouté `map/filter/any/all` (itération bornée par les données, coûtée au budget) parce que « ECUE éliminatoire dans l'UE » et « UE incomplète » ne s'expriment pas autrement sans pré-calculer des drapeaux hors DSL. Le critère éliminatoire (impossibilité de boucle infinie ou de récursion non bornée) reste satisfait. À confirmer, ou à retirer (seules `ue_validee` et `credits_valides` en dépendent).
2. **Statuts actifs** pour la résolution (`approved` côté établissement, `published` côté national) : cohérent avec « variante approuvée > national », à confirmer avec le super-admin.
3. **Chaînage de règles** (la sortie d'une règle alimentant la suivante) : volontairement hors du noyau ; chaque règle est évaluée sur un contexte fourni par l'appelant (spec 012 / 013 pour l'orchestration et l'instantané de bulletin).

## Alternatives rejetées

- **JSONata** — rejeté (éliminatoire) : Turing-complet, récursion non bornée sans budget, `$eval`, `$now()`/`$random()` natifs (non déterministe), erreurs silencieuses (`undefined`, `NaN`) qui contredisent la vérification à la publication, flottants.
- **CEL `cel-js`** — rejeté : fuite de références de fonction (`constructor`, `__proto__`, `toString`), aucune vérification statique, `matches` absent, chevrotain (3,1 MiB).
- **CEL `@bufbuild/cel`** — rejeté : bon sur l'isolation et RE2, mais sans budget d'évaluation (T6), sans vérification statique en API publique (les erreurs sont des valeurs à l'exécution), flottants, 7,2 MiB, version 0.x.
- **CEL `@marcbachmann/cel-js`** — meilleur des CEL (vérification statique réelle, limites d'analyse, très rapide) mais rejeté : pas de budget d'évaluation (T6, T7 figent le thread), pas de décimal exact (le type enregistrable oblige à écrire `dec("0.4")` partout), pas de suivi de nullité, messages anglais. Il reste la solution de repli si le coût de maintenance du DSL maison devenait inacceptable, au prix d'un budget par exécution en processus isolé.
- **Parseur Peggy + interpréteur** — rejeté au profit du Pratt manuel : même résultat fonctionnel, mais pile saturée dès ~5 000 parenthèses sans moyen propre de borner la profondeur, messages d'erreur anglais à réécrire, étape de génération de code.
- **`eval` / `new Function` / `vm` Node sur du JavaScript restreint** — rejeté : exclu par le plan (§3.8) ; les bacs à sable `vm` ne constituent pas une frontière de sécurité et n'offrent ni budget déterministe ni décimal.
- **Règles en code TypeScript déployé** — rejeté : contredit D5 (RuleSets publiés à chaud par le super-admin, variantes d'établissement, simulation avant activation) et l'exigence de bulletins reproductibles par version de règle.

## Statut

**Accepté** pour l'implémentation du noyau (`packages/rules-engine`, tâche 0.8). L'intégration à l'API (RuleSets en base, instantanés de bulletin, écrans de simulation) est traitée par la spec 012-rules-engine (tranche 2.4).

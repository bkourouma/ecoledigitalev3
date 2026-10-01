# Spike ADR-003 : quel langage d'expressions pour le Rules Engine ?

Dossier **hors workspace et hors build** (non référencé par `pnpm-workspace.yaml`, exclu de `tsconfig.build.json` et de Vitest).
Il sert de preuve pour `docs/adr/ADR-003-dsl-regles-academiques.md`. Les bibliothèques candidates y sont **réellement installées**
(versions exactes dans `package.json`) et passées à la même batterie de tests.

## Candidats

| Id | Approche | Version |
|---|---|---|
| `cel-marc` | CEL, `@marcbachmann/cel-js` (flottants, environnement typé) | 8.0.0 |
| `cel-marc-dec` | idem + type `Decimal` enregistré à la main (`dec("0.4")`, opérateurs surchargés) | 8.0.0 + decimal.js 10.6.0 |
| `cel-js` | CEL, `cel-js` (chevrotain) | 0.8.2 |
| `cel-bufbuild` | CEL, `@bufbuild/cel` (regex RE2) | 0.6.1 |
| `jsonata` | JSONata | 2.2.2 |
| `maison-peggy` | parseur Peggy + interpréteur à liste blanche + decimal.js (`proto/`) | peggy 5.1.0 |
| `maison-pratt` | parseur de Pratt écrit à la main + interpréteur + decimal.js = **`@ecoledigitale/rules-engine`** (`../src`) | — |

## Reproduire

```bash
cd packages/rules-engine && pnpm run build        # le candidat « maison-pratt » est chargé depuis ../dist
cd spike && pnpm install --ignore-workspace
SPIKE_SEQ=1 SPIKE_TIMEOUT_MS=8000 node run-spike.mjs   # batterie complète -> results.json
node pkg-info.mjs                                       # taille des dépendances
```

Chaque cas tourne dans un `worker_thread` tué après `SPIKE_TIMEOUT_MS` (les boucles infinies sont donc observables sans bloquer le harnais).
Fichiers : `battery.mjs` (cas), `adapters.mjs` (une interface commune par moteur), `worker.mjs`, `run-spike.mjs`, `results.json` (sortie machine),
`spike-output.txt` (sortie lisible du run consigné ci-dessous), `pkg-info.txt`.

## Résultats (run consigné : `spike-output.txt`)

Légende : OK = valeur exacte attendue ; FAUX = valeur différente ; TIMEOUT = non terminé en 8 s (worker tué) ; N/A = non exprimable dans le langage
(c'est une propriété : par construction) ; « compile » = refusé avant toute évaluation.

### 1. Terminaison et déni de service

| Cas | cel-marc | cel-js | cel-bufbuild | jsonata | maison (Pratt) |
|---|---|---|---|---|---|
| T1 récursion infinie `f() = f()` | N/A | N/A | N/A | **TIMEOUT** | N/A |
| T2 récursion terminale 10^9 itérations | N/A | N/A | N/A | **TIMEOUT** | N/A |
| T3 5 000 parenthèses imbriquées | refusé (maxDepth 250) | pile saturée (« Maximum call stack ») | pile saturée | **accepté, 3,1 s** | refusé (limite de longueur ; cf. tests : profondeur 64) |
| T4 200 000 parenthèses | refusé | pile saturée | pile saturée | pile saturée | refusé |
| T5 chaîne de 200 000 `1+1+…` | refusé (maxAstNodes) | accepté (95 ms) | pile saturée (1,5 s) | pile saturée | refusé |
| T6 9 comprehensions imbriquées (10^9 évaluations) | **TIMEOUT** | non parsé | **TIMEOUT** | **TIMEOUT** | budget de nœuds : erreur propre < 3 s (test `security.test.ts`) |
| T7 ReDoS `(a+)+$` | **TIMEOUT** | `matches` absent | OK (RE2, 44 ms) | **TIMEOUT** | N/A (aucune regex) |

Lecture : CEL est non Turing-complet (T1/T2 impossibles) mais **aucune** bibliothèque CEL JS n'offre de budget d'évaluation : T6 (explosion
combinatoire de macros imbriquées) et T7 (ReDoS, sauf RE2) bloquent le thread. Seules les limites d'analyse existent (`@marcbachmann/cel-js` : `maxAstNodes`, `maxDepth`).
JSONata autorise la récursion : T1 ne s'arrête jamais (aucune limite native ; la parade documentée est un « timebox » par `setTimeout` qui ne coupe pas une boucle synchrone).

### 2. Arithmétique décimale

| Cas | cel-marc | cel-marc-dec | cel-js | cel-bufbuild | jsonata | maison |
|---|---|---|---|---|---|---|
| F1 `11.25*0.4 + 9*0.6` = 9,9 | FAUX 9.899999999999999 | OK | FAUX | FAUX | FAUX | OK |
| D1 `0.1+0.2 == 0.3` | FAUX | OK | FAUX | FAUX | FAUX | OK |
| D3 `0.7+0.1 >= 0.8` | FAUX | OK | FAUX | FAUX | FAUX | OK |
| D6 seuil exact `0.4*12.5 + 0.6*8.3333333333333333 >= 10` | FAUX | OK | FAUX | FAUX | FAUX | OK |
| D2 `round_half_up(9.995, 2)` = 10 | OK¹ | OK | OK¹ | OK¹ | OK¹ | OK |
| D4, D5 | OK | OK | OK | OK | OK | OK |

¹ Uniquement parce que la fonction d'arrondi du spike utilise l'astuce de l'exposant décimal sur le littéral ; elle échoue dès que la valeur est *calculée*.
Aucune des libs CEL n'a de type décimal natif (`int` = bigint, `double` = flottant, `int * double` est une erreur de type). `cel-marc-dec` prouve qu'on peut
enregistrer un type `Decimal` et ses opérateurs, au prix d'une syntaxe lourde (`dec("0.4") * devoirs`), de l'impossibilité d'écrire un littéral décimal, et d'un débit ÷ 30 à ÷ 40
sur la machine du spike.

### 3. Déterminisme et isolation

| Cas | cel-marc | cel-js | cel-bufbuild | jsonata | maison |
|---|---|---|---|---|---|
| E1 `a.constructor` | erreur | **FUITE (fonction)** | erreur | undefined | refusé à la compilation |
| E2 `a.__proto__` | erreur | **FUITE (objet)** | erreur | undefined | refusé |
| E6 `a.toString` | erreur | **FUITE (fonction)** | erreur | undefined | refusé |
| E3 `a.constructor.constructor("return process")()` | syntaxe | syntaxe | syntaxe | undefined | refusé (appel non autorisé) |
| E4/E5 `process`, `globalThis` | erreur | erreur | erreur | undefined | refusé (nom inconnu) |
| E7 `{"__proto__": {...}}` | `{}` (pas de pollution) | `{}` | `{}` | clé propre `__proto__` | N/A |
| E8 `$eval("1+1")` (évaluation dynamique) | N/A | N/A | N/A | **autorisée** | N/A |
| N1/N2 horloge, aléa | absents | absents | absents | **`$now()`, `$random()` présents** | absents |

Aucune pollution réelle de `Object.prototype` constatée (vérifiée après chaque cas). `cel-js` 0.8.2 expose en revanche les membres hérités de `Object.prototype`
(fuite de références de fonctions : base d'une évasion `constructor.constructor`) : **éliminatoire pour cet usage**.

### 4. Vérification à la publication et messages d'erreur

| Cas | cel-marc | cel-js | cel-bufbuild | jsonata | maison |
|---|---|---|---|---|---|
| V1 nom inconnu | **compile** | exécution | exécution | **silencieux (`undefined`)** | **compile** + suggestion |
| V2 `devoirs + "abc"` | **compile** | exécution | exécution | exécution | **compile** |
| V3 fonction inconnue | compile | exécution | exécution | exécution (« non-function ») | compile + suggestion |
| V4 arité `clamp(1)` | compile | **`NaN` silencieux** | exécution | **`NaN` silencieux** | compile |
| V5 syntaxe | compile (anglais, extrait + curseur) | compile (anglais, 10 alternatives) | compile (anglais) | compile (anglais) | compile (**français**, ligne/colonne) |
| V6 faute de frappe de champ | exécution | exécution | exécution | **silencieux** | **compile** + suggestion |
| V7 `1 / 0` | `Infinity` | erreur | `Infinity` | `Infinity` | erreur typée |

Seul `@marcbachmann/cel-js` fait une vraie vérification statique (noms, types, surcharges) ; aucun moteur tiers ne produit de message en français, ne suit la nullité
(valeur « peut être absente ») ni ne propose de suggestion orthographique.

### 5. Taille et débit

Tailles installées (dépendances transitives comprises, `pkg-info.txt`) : jsonata 834 KiB ; `@marcbachmann/cel-js` 222 KiB ; `cel-js` 3,1 MiB (chevrotain, ramda, lodash-es) ;
`@bufbuild/cel` 7,2 MiB (+ `@bufbuild/protobuf` en pair) ; peggy 857 KiB (dev seulement si grammaire précompilée) ; decimal.js 278 KiB.
Le package final : ~121 KiB de JS compilé + decimal.js (278 KiB) + zod (déjà présent dans le monorepo).

Débit (évaluations/s, expression compilée une fois, note ECUE) : le run consigné s'est fait sur une machine chargée (valeurs absolues basses) ; un run à vide
donnait cel-marc ≈ 3,7 M/s, cel-bufbuild ≈ 0,9 M/s, cel-js ≈ 0,25 M/s, jsonata ≈ 0,12 M/s, cel-marc-dec ≈ 0,09 M/s, maison (Peggy) ≈ 0,08 M/s, maison (Pratt, trace complète activée) ≈ 0,12 M/s.
Ordre de grandeur utile : ≥ 40 000 évaluations/s sur un poste chargé, soit > 1 000 bulletins complets (≈ 30 règles chacun) par seconde, très au-delà du besoin.

### 6. Candidat Peggy (prototype `proto/`)

Même interpréteur à liste blanche, analyseur généré par Peggy : fonctionne et reste sûr, mais (a) la récursivité de l'analyseur généré sature la pile dès ~5 000 parenthèses
(« Maximum call stack size exceeded ») sans moyen propre d'imposer une profondeur maximale autre qu'une limite de longueur ; (b) ses messages d'erreur sont en anglais
(`Expected "!", "(", … but end of input found.`) et doivent être réécrits ; (c) il ajoute une étape de génération de code (ou 857 KiB de runtime). Le parseur de Pratt
écrit à la main a donné un meilleur contrôle (profondeur, hauteur d'arbre, nombre de nœuds, messages français avec position et suggestions) pour ~500 lignes (lexeur + parseur).

## Limites de ce spike

- Les expressions pathologiques ne couvrent pas tous les vecteurs possibles (mémoire, chaînes géantes, bigint) ; la batterie du package (`../test/security.test.ts`, `limits-trace.test.ts`) va plus loin pour le candidat retenu.
- Pas de benchmark à vide systématique : le débit n'est pas un critère discriminant ici.
- Les affirmations sur la maintenance des projets tiers ne sont pas vérifiées au-delà des numéros de version et licences (npm).

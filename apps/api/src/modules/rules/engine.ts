/**
 * SEULE porte d'entrée du moteur de règles (`@ecoledigitale/rules-engine`) dans `apps/`.
 *
 * Règle d'architecture (ADR-001, spec 012 A-01) : seul le module `rules` importe le moteur ; `results`,
 * `higher` et `reportcards` passent par `rules/index.ts`. La règle `rules-engine-only-in-rules-module` de
 * `.dependency-cruiser.cjs` l'impose (nom du paquet ET chemin du dépôt).
 *
 * Pourquoi un chemin relatif plutôt que le nom du paquet : `packages/rules-engine` pointe `main` vers `dist/`
 * (paquet compilé) et `apps/api` ne le déclare pas encore en dépendance. Le chemin relatif résout le SOURCE
 * TypeScript sous tsx, vitest et tsc sans aucun câblage hors du module (même résultat que les alias des autres
 * modules pour `@ecoledigitale/kernel`). Quand l'assemblage ajoutera la dépendance de workspace, ce fichier
 * deviendra `export * from "@ecoledigitale/rules-engine"` — c'est le seul à changer.
 */
export * from "../../../../../packages/rules-engine/src/index";

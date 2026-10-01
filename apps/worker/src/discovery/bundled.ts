import type { BundledModule } from "./discover";

/**
 * `undefined` en développement (`tsx`) : la découverte scanne alors le disque.
 *
 * En production (`pnpm build`), `scripts/build.mjs` REMPLACE ce fichier par une version
 * générée qui importe statiquement chaque `modules/<key>/subscribers.ts` et `jobs.ts`
 * trouvés au moment du build : le bundle est autonome (pas de TypeScript ni de dossier
 * `modules/` à l'exécution).
 */
export const bundledModules: BundledModule[] | undefined = undefined;

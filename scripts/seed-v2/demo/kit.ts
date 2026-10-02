/**
 * Outils communs du prolongement de démonstration : exécution d'étapes isolées (une étape qui échoue est signalée sans
 * interrompre la démonstration), dates, attente d'événements, accès aux listes paginées.
 */
import type { Actor } from "../actors";
import type { ScenarioContext } from "../scenario";
import { waitFor } from "../runtime";

export { waitFor };

export const dayMs = 86_400_000;
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
export const today = (): string => isoDay(new Date());

/** Un tableau de cas : ni index hors bornes (noUncheckedIndexedAccess) ni `undefined` silencieux. */
export function at<T>(list: readonly T[], index: number, what: string): T {
  const v = list[index];
  if (v === undefined) throw new Error(`Élément introuvable : ${what} [${index}]`);
  return v;
}

export interface DemoWarning {
  step: string;
  message: string;
}

export interface DemoKit {
  ctx: ScenarioContext;
  warnings: DemoWarning[];
  /** Exécute une étape ; en cas d'échec, consigne un avertissement et continue (la démonstration reste utilisable). */
  step(name: string, fn: () => Promise<void>): Promise<boolean>;
  count(key: string, n?: number): void;
  note(line: string): void;
}

export function createKit(ctx: ScenarioContext): DemoKit {
  const warnings: DemoWarning[] = [];
  return {
    ctx,
    warnings,
    async step(name, fn) {
      ctx.log(`• ${name}`);
      try {
        await fn();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push({ step: name, message });
        ctx.log(`  ⚠ étape ignorée : ${message.slice(0, 500)}`);
        return false;
      }
    },
    count(key, n = 1) {
      ctx.counts[key] = (ctx.counts[key] ?? 0) + n;
    },
    note(line) {
      ctx.notes.push(line);
    },
  };
}

/** Parcourt une liste paginée simple (`items`) en une page ; les listes de la démonstration sont petites. */
export async function listItems<T = Record<string, any>>(actor: Actor, url: string): Promise<T[]> {
  const r = await actor.get(url);
  return ((r.body.items ?? r.body) as T[]) ?? [];
}

/** Variante qui tolère un refus (rôle sans droit, module non activé) et renvoie `null`. */
export async function tryGet<T = any>(actor: Actor, url: string): Promise<T | null> {
  const r = await actor.raw("GET", url);
  return r.status >= 200 && r.status < 300 ? (r.body as T) : null;
}

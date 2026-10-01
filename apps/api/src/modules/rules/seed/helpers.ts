import type { ParameterSpec } from "../engine";

/** Paramètre numérique BORNÉ (R-RUL-07 : un paramètre numérique porte toujours ses bornes). */
export function num(defaultValue: number, min: number, max: number | undefined, description: string): ParameterSpec {
  return { type: "number", default: defaultValue, min, ...(max !== undefined ? { max } : {}), description };
}

/** Paramètre texte (paramètre de mode : ses valeurs permises sont fixées par le contrat). */
export function mode(defaultValue: string, description: string): ParameterSpec {
  return { type: "string", default: defaultValue, description };
}

/** Table de libellés français : `labels({ PASSABLE: "Passable" })`. */
export function labels(map: Record<string, string>): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(map).map(([code, fr]) => [code, { fr }]));
}

/** Seuil /20 gradué (0..20), pour les échelles de mention et les seuils de décision. */
export const threshold = (defaultValue: number, description: string): ParameterSpec => num(defaultValue, 0, 20, description);

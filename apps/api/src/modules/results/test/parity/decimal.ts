/**
 * Arrondi décimal EXACT (demi-supérieur) sur des chaînes, pour projeter les valeurs de `results` à la précision du legacy
 * (colonnes `numeric(6,2)`). Aucun flottant n'entre dans le calcul : on part de la chaîne produite par les règles.
 * Ce fichier est un OUTIL DE TEST (adaptateur de parité) ; le module `results` ne contient aucune arithmétique.
 */
export function round2(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new RangeError(`Décimal invalide : « ${value} »`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let scaled = BigInt(`${m[2]}${frac.slice(0, 2)}`);
  if ((frac[2] ?? "0") >= "5") scaled += 1n;
  const out = Number(scaled) / 100;
  return m[1] === "-" ? -out : out;
}

/** Nombre décimal JSON → chaîne décimale exacte (pas de notation scientifique pour les notes /20 ou ≤ 5 décimales). */
export function decimalString(n: number): string {
  const s = String(n);
  if (/e/i.test(s)) throw new RangeError(`Notation scientifique non gérée : ${s}`);
  return s;
}

export const toNumber = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

/**
 * Âge à une date de référence (fonctions PURES, spec 018 §16 « 008 : âge à une date de référence »).
 *
 * La date de référence est TOUJOURS fournie par l'appelant ou par la règle (ex. « au 31 décembre de l'année de l'examen ») :
 * jamais l'horloge. Aucun seuil d'âge n'est connu ici : le module ne fournit que des années révolues.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** `true` si la chaîne est une date calendaire réelle AAAA-MM-JJ (le 30 février est refusé). */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export interface AgeOptions {
  /**
   * Jour d'anniversaire d'une personne née un 29 février les années non bissextiles : `MARCH_1` (défaut : l'âge est acquis le
   * 1er mars) ou `FEB_28` (acquis le 28 février). C'est une CONVENTION d'application d'un texte, pas une valeur du module : une
   * règle qui en dépend la porte dans son RuleSet.
   */
  readonly leapBirthday?: "MARCH_1" | "FEB_28";
}

/**
 * Années révolues à `referenceDate` pour une naissance `birthDate`.
 *  - le jour anniversaire, l'âge est déjà acquis ;
 *  - `null` si `referenceDate` précède la naissance (pas encore né : aucune valeur n'est inventée) ;
 *  - `RangeError` si une date n'est pas une date calendaire AAAA-MM-JJ (erreur de programmation de l'appelant).
 */
export function ageInYearsOn(birthDate: string, referenceDate: string, options: AgeOptions = {}): number | null {
  if (!isValidIsoDate(birthDate)) throw new RangeError("birthDate : date AAAA-MM-JJ invalide.");
  if (!isValidIsoDate(referenceDate)) throw new RangeError("referenceDate : date AAAA-MM-JJ invalide.");
  if (referenceDate < birthDate) return null;
  const [by, bm, bd] = [Number(birthDate.slice(0, 4)), Number(birthDate.slice(5, 7)), Number(birthDate.slice(8, 10))];
  const [ry, rm, rd] = [Number(referenceDate.slice(0, 4)), Number(referenceDate.slice(5, 7)), Number(referenceDate.slice(8, 10))];
  // Anniversaire de l'année de référence (mois, jour) ; un 29 février devient le 1er mars ou le 28 février hors année bissextile.
  let [am, ad] = [bm, bd];
  if (bm === 2 && bd === 29 && !isLeap(ry)) [am, ad] = options.leapBirthday === "FEB_28" ? [2, 28] : [3, 1];
  const birthdayReached = rm > am || (rm === am && rd >= ad);
  return ry - by - (birthdayReached ? 0 : 1);
}
